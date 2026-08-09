package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type TelegramUser struct {
	ID           int64  `json:"id"`
	FirstName    string `json:"first_name"`
	Username     string `json:"username"`
	LanguageCode string `json:"language_code"`
}

var ErrInvalidInitData = errors.New("invalid telegram initData")

func VerifyTelegramInitData(rawInitData, botToken string, maxAge time.Duration, now time.Time) (TelegramUser, error) {
	if strings.TrimSpace(botToken) == "" {
		return TelegramUser{}, ErrInvalidInitData
	}
	values, err := url.ParseQuery(rawInitData)
	if err != nil {
		return TelegramUser{}, err
	}
	hash := values.Get("hash")
	if hash == "" {
		return TelegramUser{}, ErrInvalidInitData
	}
	values.Del("hash")
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+values.Get(key))
	}
	checkString := strings.Join(parts, "\n")

	secretHMAC := hmac.New(sha256.New, []byte("WebAppData"))
	_, _ = secretHMAC.Write([]byte(botToken))
	secret := secretHMAC.Sum(nil)
	dataHMAC := hmac.New(sha256.New, secret)
	_, _ = dataHMAC.Write([]byte(checkString))
	expected := hex.EncodeToString(dataHMAC.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(hash)) {
		return TelegramUser{}, ErrInvalidInitData
	}
	authDate, err := strconv.ParseInt(values.Get("auth_date"), 10, 64)
	if err != nil {
		return TelegramUser{}, ErrInvalidInitData
	}
	if maxAge > 0 && now.Sub(time.Unix(authDate, 0)) > maxAge {
		return TelegramUser{}, ErrInvalidInitData
	}
	var user TelegramUser
	if err := json.Unmarshal([]byte(values.Get("user")), &user); err != nil {
		return TelegramUser{}, err
	}
	if user.ID == 0 {
		return TelegramUser{}, ErrInvalidInitData
	}
	if user.LanguageCode == "" {
		user.LanguageCode = "ru"
	}
	return user, nil
}
