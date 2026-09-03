package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/eqwertyry121/TL/backend/internal/store"
)

type telegramUpdate struct {
	UpdateID int64            `json:"update_id"`
	Message  *telegramMessage `json:"message"`
}

type telegramMessage struct {
	MessageID      int64                 `json:"message_id"`
	Date           int64                 `json:"date"`
	From           *telegramUser         `json:"from"`
	Chat           *telegramChat         `json:"chat"`
	Text           string                `json:"text"`
	Contact        *telegramContact      `json:"contact"`
	Location       *telegramLocation     `json:"location"`
	ReplyToMessage *telegramReplyMessage `json:"reply_to_message"`
}

type telegramUser struct {
	ID int64 `json:"id"`
}

type telegramChat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

type telegramContact struct {
	PhoneNumber string `json:"phone_number"`
	UserID      int64  `json:"user_id"`
}

type telegramLocation struct {
	Latitude           float64  `json:"latitude"`
	Longitude          float64  `json:"longitude"`
	HorizontalAccuracy *float64 `json:"horizontal_accuracy"`
}

type telegramReplyMessage struct {
	MessageID int64 `json:"message_id"`
}

type telegramSendMessageResponse struct {
	OK          bool   `json:"ok"`
	Description string `json:"description"`
	Result      struct {
		MessageID int64 `json:"message_id"`
	} `json:"result"`
}

func (s *Server) contact(w http.ResponseWriter, r *http.Request) {
	contact, err := s.store.VerifiedContact(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contact)
}

func (s *Server) createCashLocationChallenge(w http.ResponseWriter, r *http.Request) {
	var req store.CreateCashLocationChallengeInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	sess := mustSession(r)
	devBypass := s.cfg.Env != "production" &&
		s.isBootstrapOwnerTelegramID(sess.TelegramUserID)
	challenge, err := s.store.CreateCashLocationChallenge(r.Context(), sess, req, s.now(), devBypass)
	if err != nil {
		writeError(w, err)
		return
	}
	// Owners can switch the shared Telegram bot to the DEV sandbox. If they
	// later open the production Mini App directly, route the requested location
	// back to production; otherwise the bot relays it to DEV where this
	// production challenge does not exist.
	if !s.cfg.DevSandboxMode && s.isDevSandboxAllowedTelegramID(sess.TelegramUserID) {
		if err := s.store.SetTelegramSandboxPreference(r.Context(), sess.TelegramUserID, false); err != nil {
			writeError(w, err)
			return
		}
	}
	challenge.BotURL = clientBotURL(s.cfg.ClientBotUsername)
	sendPrompt := true
	if req.SendPrompt != nil {
		sendPrompt = *req.SendPrompt
	}
	if challenge.Status == core.CashLocationPending && sendPrompt {
		promptID, err := s.sendLocationPrompt(r.Context(), sess.TelegramUserID)
		if err != nil {
			_ = s.store.RejectCashLocationChallenge(r.Context(), sess, challenge.ID, "PROMPT_SEND_FAILED")
			writeError(w, core.ErrInvalidInput)
			return
		}
		if err := s.store.AttachCashLocationPrompt(r.Context(), sess, challenge.ID, promptID); err != nil {
			writeError(w, err)
			return
		}
		challenge, err = s.store.CashLocationChallenge(r.Context(), sess, challenge.ID, s.now())
		if err != nil {
			writeError(w, err)
			return
		}
		challenge.BotURL = clientBotURL(s.cfg.ClientBotUsername)
	}
	writeJSON(w, http.StatusCreated, challenge)
}

func (s *Server) cashLocationChallenge(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	challenge, err := s.store.CashLocationChallenge(r.Context(), mustSession(r), id, s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	challenge.BotURL = clientBotURL(s.cfg.ClientBotUsername)
	writeJSON(w, http.StatusOK, challenge)
}

type verifyCashLocationRequest struct {
	Latitude           *float64 `json:"latitude"`
	Longitude          *float64 `json:"longitude"`
	HorizontalAccuracy *float64 `json:"horizontal_accuracy"`
}

func (s *Server) verifyCashLocationChallenge(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Env == "production" && !s.cfg.DevSandboxMode {
		writeError(w, core.ErrForbidden)
		return
	}
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req verifyCashLocationRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	if req.Latitude == nil || req.Longitude == nil {
		writeError(w, core.ErrInvalidInput)
		return
	}
	challenge, err := s.store.VerifyCashLocationForSession(
		r.Context(),
		mustSession(r),
		id,
		*req.Latitude,
		*req.Longitude,
		req.HorizontalAccuracy,
		s.now(),
	)
	if err != nil {
		writeError(w, err)
		return
	}
	challenge.BotURL = clientBotURL(s.cfg.ClientBotUsername)
	writeJSON(w, http.StatusOK, challenge)
}

func (s *Server) clientTelegramWebhook(w http.ResponseWriter, r *http.Request) {
	if s.cfg.TelegramWebhookSecret != "" && r.Header.Get("X-Telegram-Bot-Api-Secret-Token") != s.cfg.TelegramWebhookSecret {
		writeError(w, core.ErrForbidden)
		return
	}
	var update telegramUpdate
	if err := decodeTelegramJSON(r, &update); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	message := update.Message
	if message == nil || message.From == nil || message.Chat == nil || message.Chat.Type != "private" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if !s.cfg.DevSandboxMode && s.isDevSandboxAllowedTelegramID(message.From.ID) {
		if isBotCommand(message.Text, "/dev") {
			if err := s.store.SetTelegramSandboxPreference(r.Context(), message.From.ID, true); err != nil {
				writeError(w, err)
				return
			}
			_, _ = s.sendClientBotMessage(r.Context(), message.Chat.ID, "DEV sandbox включён. Здесь можно безопасно создавать тестовые заказы и проверять новые функции.", s.sandboxMiniAppKeyboard())
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
		if isBotCommand(message.Text, "/prod") {
			if err := s.store.SetTelegramSandboxPreference(r.Context(), message.From.ID, false); err != nil {
				writeError(w, err)
				return
			}
			_, _ = s.sendClientBotMessage(r.Context(), message.Chat.ID, "Production включён.", s.mainMiniAppKeyboard())
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
		sandboxEnabled, err := s.store.TelegramSandboxPreference(r.Context(), message.From.ID)
		if err != nil {
			writeError(w, err)
			return
		}
		if sandboxEnabled && s.cfg.DevSandboxWebhookURL != "" {
			if err := s.relayTelegramUpdate(r.Context(), update); err != nil {
				s.log().Warn("dev sandbox Telegram relay failed", "error", err)
				_, _ = s.sendClientBotMessage(r.Context(), message.Chat.ID, "DEV sandbox временно недоступен. Отправьте /prod, чтобы вернуться в production.", replyKeyboardRemove())
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
	}
	if message.Contact != nil {
		if err := s.store.VerifyTelegramContact(r.Context(), message.From.ID, message.Contact.UserID, message.Contact.PhoneNumber); err == nil {
			_, _ = s.sendClientBotMessage(r.Context(), message.Chat.ID, "Телефон подтверждён. Вернитесь к оформлению заказа.", replyKeyboardRemove())
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if message.Location != nil {
		var replyTo int64
		if message.ReplyToMessage != nil {
			replyTo = message.ReplyToMessage.MessageID
		}
		challenge, err := s.store.VerifyCashLocationFromTelegram(
			r.Context(),
			message.From.ID,
			replyTo,
			time.Unix(message.Date, 0),
			message.Location.Latitude,
			message.Location.Longitude,
			message.Location.HorizontalAccuracy,
			s.now(),
		)
		if err == nil {
			_, _ = s.sendClientBotMessage(r.Context(), message.Chat.ID, cashLocationResultText(challenge), replyKeyboardRemove())
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if isShareLocationCommand(message.Text) || strings.Contains(strings.ToLower(message.Text), "местополож") {
		_, _ = s.sendLocationPrompt(r.Context(), message.Chat.ID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if isBotCommand(message.Text, "/start") {
		_, _ = s.sendClientBotMessage(r.Context(), message.Chat.ID, "Добро пожаловать в Tako Lako", s.mainMiniAppKeyboard())
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if isBotCommand(message.Text, "/book") {
		_, _ = s.sendClientBotMessage(r.Context(), message.Chat.ID, "Выберите удобное время в Mini App", s.bookingMiniAppKeyboard())
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if isBotCommand(message.Text, "/order") || isBotCommand(message.Text, "/menu") {
		_, _ = s.sendClientBotMessage(r.Context(), message.Chat.ID, "Откройте меню Tako Lako", s.orderMiniAppKeyboard())
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) relayTelegramUpdate(ctx context.Context, update telegramUpdate) error {
	payload, err := json.Marshal(update)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.DevSandboxWebhookURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.cfg.TelegramWebhookSecret != "" {
		req.Header.Set("X-Telegram-Bot-Api-Secret-Token", s.cfg.TelegramWebhookSecret)
	}
	resp, err := s.telegramClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("sandbox webhook status %d", resp.StatusCode)
	}
	return nil
}

func (s *Server) sendLocationPrompt(ctx context.Context, chatID int64) (int64, error) {
	if strings.TrimSpace(s.cfg.ClientBotToken) == "" {
		return 0, core.ErrInvalidInput
	}
	replyMarkup := map[string]any{
		"keyboard": [][]map[string]any{
			{
				{
					"text":             "Отправить моё местоположение",
					"request_location": true,
				},
			},
		},
		"resize_keyboard":         true,
		"one_time_keyboard":       false,
		"is_persistent":           true,
		"input_field_placeholder": "Нажмите кнопку геолокации",
	}
	return s.sendClientBotMessage(ctx, chatID, "Нужно отправить геолокацию, не текст.\n\nНажмите кнопку ниже: «Отправить моё местоположение».\n\nЕсли кнопки нет — отправьте /share, я покажу её снова.\n\nС компьютера это часто не работает. Тогда откройте заказ на телефоне.", replyMarkup)
}

func newTelegramHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 8 * time.Second,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   3 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			MaxIdleConns:          16,
			MaxIdleConnsPerHost:   4,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 5 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}
}

func (s *Server) telegramClient() *http.Client {
	if s.telegramHTTPClient != nil {
		return s.telegramHTTPClient
	}
	return newTelegramHTTPClient()
}

func isShareLocationCommand(text string) bool {
	normalized := strings.ToLower(strings.TrimSpace(text))
	return normalized == "/share" || strings.HasPrefix(normalized, "/share@")
}

func isBotCommand(text, command string) bool {
	normalized := strings.ToLower(strings.TrimSpace(text))
	command = strings.ToLower(command)
	return normalized == command || strings.HasPrefix(normalized, command+"@") || strings.HasPrefix(normalized, command+" ")
}

func (s *Server) mainMiniAppKeyboard() map[string]any {
	return map[string]any{"inline_keyboard": [][]map[string]any{
		{{"text": "Заказать еду", "web_app": map[string]any{"url": s.clientMiniAppURL("/")}}},
		{{"text": "Забронировать стол", "web_app": map[string]any{"url": s.clientMiniAppURL("/booking")}}},
	}}
}

func (s *Server) sandboxMiniAppKeyboard() map[string]any {
	return map[string]any{"inline_keyboard": [][]map[string]any{
		{{"text": "Открыть DEV Mini App", "web_app": map[string]any{"url": miniAppURL(s.cfg.DevSandboxMiniAppURL, "/", s.cfg.BuildSHA)}}},
		{{"text": "DEV: забронировать стол", "web_app": map[string]any{"url": miniAppURL(s.cfg.DevSandboxMiniAppURL, "/booking", s.cfg.BuildSHA)}}},
	}}
}

func (s *Server) bookingMiniAppKeyboard() map[string]any {
	return map[string]any{"inline_keyboard": [][]map[string]any{
		{{"text": "Забронировать стол", "web_app": map[string]any{"url": s.clientMiniAppURL("/booking")}}},
	}}
}

func (s *Server) orderMiniAppKeyboard() map[string]any {
	return map[string]any{"inline_keyboard": [][]map[string]any{
		{{"text": "Открыть меню", "web_app": map[string]any{"url": s.clientMiniAppURL("/")}}},
	}}
}

func (s *Server) clientMiniAppURL(route string) string {
	return miniAppURL(s.cfg.ClientMiniAppURL, route, s.cfg.BuildSHA)
}

func miniAppURL(rawBase, route, buildSHA string) string {
	base := strings.TrimRight(strings.TrimSpace(rawBase), "/")
	if base == "" {
		base = "https://takolako.site/main"
	}
	version := safeVersionToken(buildSHA)
	versionQuery := ""
	if version != "" && version != "dev" && version != "unknown" {
		versionQuery = "?v=" + version
	}
	route = "/" + strings.Trim(strings.TrimSpace(route), "/")
	if route == "/" {
		return base + "/" + versionQuery + "#/"
	}
	return base + "/" + versionQuery + "#" + route
}

func (s *Server) sendClientBotMessage(ctx context.Context, chatID int64, text string, replyMarkup any) (int64, error) {
	payload := map[string]any{
		"chat_id": chatID,
		"text":    text,
	}
	if replyMarkup != nil {
		payload["reply_markup"] = replyMarkup
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+s.cfg.ClientBotToken+"/sendMessage", bytes.NewReader(raw))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := s.telegramClient().Do(request)
	if err != nil {
		return 0, fmt.Errorf("telegram_network_error")
	}
	defer response.Body.Close()
	var result telegramSendMessageResponse
	_ = json.NewDecoder(response.Body).Decode(&result)
	if response.StatusCode < 200 || response.StatusCode >= 300 || !result.OK {
		return 0, fmt.Errorf("telegram_http_%d", response.StatusCode)
	}
	return result.Result.MessageID, nil
}

func replyKeyboardRemove() map[string]any {
	return map[string]any{"remove_keyboard": true}
}

func cashLocationResultText(challenge core.CashLocationChallenge) string {
	switch challenge.Status {
	case core.CashLocationVerified:
		return "Местоположение подтверждено. Вернитесь к оформлению заказа."
	case core.CashLocationRejected:
		switch challenge.RejectionReason {
		case "OUTSIDE_CASH_AREA":
			return "Вы находитесь вне зоны доставки для оплаты наличными."
		case "LOCATION_INACCURATE", "LOCATION_ACCURACY_MISSING":
			return "Геолокация неточная. На компьютере так бывает часто — откройте заказ на телефоне или повторите у окна/на улице."
		case "LOCATION_NOT_CONFIGURED":
			return "Оплата наличными временно недоступна: геопроверка не настроена."
		default:
			return "Местоположение не подтверждено. Повторите проверку из оформления заказа."
		}
	case core.CashLocationExpired:
		return "Проверка местоположения истекла. Вернитесь к заказу и повторите."
	default:
		return "Проверяем местоположение. Вернитесь к оформлению заказа через несколько секунд."
	}
}

func clientBotURL(username string) string {
	username = strings.TrimPrefix(strings.TrimSpace(username), "@")
	if username == "" {
		return ""
	}
	return "https://t.me/" + username
}

func decodeTelegramJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 128*1024)).Decode(target)
}
