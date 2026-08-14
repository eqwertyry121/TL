package httpapi

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/config"
	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/google/uuid"
)

func TestPerformanceBeaconAcceptsSafePayload(t *testing.T) {
	server := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/performance/beacon", strings.NewReader(`{
		"app":"client",
		"route":"menu",
		"build":"test-build",
		"ttfb_ms":12.3,
		"lcp_ms":456.7,
		"cls":0.02,
		"inp_ms":80
	}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.performanceBeacon(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusNoContent, w.Body.String())
	}
}

func TestVersionEndpointExposesSafeBuildAndSupportsConditionalGET(t *testing.T) {
	server := New(config.Config{BuildSHA: "Release/ABC 123?", ServerTimingEnabled: false}, nil)
	handler := server.Routes()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("unexpected Cache-Control: %q", w.Header().Get("Cache-Control"))
	}
	etag := w.Header().Get("ETag")
	if etag != `W/"version-release-abc-123-"` {
		t.Fatalf("ETag = %q, want version token", etag)
	}
	for _, required := range []string{
		`"service":"tk-delivery"`,
		`"build_sha":"release-abc-123-"`,
		`"api_contract":"global-optimization-v1"`,
	} {
		if !strings.Contains(w.Body.String(), required) {
			t.Fatalf("version response missing %s: %s", required, w.Body.String())
		}
	}

	conditionalReq := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
	conditionalReq.Header.Set("If-None-Match", etag)
	conditional := httptest.NewRecorder()
	handler.ServeHTTP(conditional, conditionalReq)

	if conditional.Code != http.StatusNotModified {
		t.Fatalf("conditional status = %d, want %d; body=%s", conditional.Code, http.StatusNotModified, conditional.Body.String())
	}
	if conditional.Body.String() != "" {
		t.Fatalf("304 should not include a body, got %q", conditional.Body.String())
	}
}

func TestPerformanceBeaconRouteEnumMatchesApps(t *testing.T) {
	accepted := map[string][]string{
		"client":  {"menu", "dish", "cart", "checkout", "order", "orders", "support", "terms", "returns", "privacy", "unknown"},
		"kitchen": {"orders", "unknown"},
		"courier": {"orders", "unknown"},
		"admin":   {"home", "orders", "menu", "schedule", "analytics", "settings", "audit", "staff", "unknown"},
	}
	for app, routes := range accepted {
		for _, route := range routes {
			if !validBeaconRoute(app, route) {
				t.Fatalf("validBeaconRoute(%q, %q) = false, want true", app, route)
			}
		}
	}
	for _, test := range []struct {
		app   string
		route string
	}{
		{app: "client", route: "order/123"},
		{app: "client", route: "/order/123"},
		{app: "client", route: "checkout-phone"},
		{app: "admin", route: "orders/123"},
		{app: "admin", route: "users"},
		{app: "kitchen", route: "menu"},
		{app: "courier", route: "order"},
		{app: "unknown", route: "orders"},
	} {
		if validBeaconRoute(test.app, test.route) {
			t.Fatalf("validBeaconRoute(%q, %q) = true, want false", test.app, test.route)
		}
	}
}

func TestPerformanceBeaconUsesConfiguredLoggerAndOmitsRequestData(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	server := New(config.Config{Env: "test"}, nil, logger)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/performance/beacon?phone=123&token=secret", strings.NewReader(`{
		"app":"client",
		"route":"menu",
		"build":"test-build",
		"ttfb_ms":12.3,
		"lcp_ms":456.7,
		"cls":0.02,
		"inp_ms":80
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer secret-session-token")
	req.Header.Set("X-Telegram-Init-Data", "query_id=secret-init-data")
	w := httptest.NewRecorder()

	server.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusNoContent, w.Body.String())
	}
	logLine := buf.String()
	for _, required := range []string{"performance beacon", `"app":"client"`, `"route":"menu"`, `"build":"test-build"`, `"lcp_ms":456.7`} {
		if !strings.Contains(logLine, required) {
			t.Fatalf("performance log missing %q: %s", required, logLine)
		}
	}
	for _, forbidden := range []string{"phone=123", "token=secret", "Authorization", "secret-session-token", "secret-init-data"} {
		if strings.Contains(logLine, forbidden) {
			t.Fatalf("performance log leaked %q: %s", forbidden, logLine)
		}
	}
}

func TestPerformanceBeaconRejectsUnsafeRoute(t *testing.T) {
	server := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/performance/beacon", strings.NewReader(`{
		"app":"client",
		"route":"order?phone=123",
		"build":"test-build"
	}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.performanceBeacon(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestPerformanceBeaconRejectsNonEnumRoute(t *testing.T) {
	server := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/performance/beacon", strings.NewReader(`{
		"app":"client",
		"route":"order/123",
		"build":"test-build"
	}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.performanceBeacon(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestPerformanceBeaconRejectsOutOfRangeMetric(t *testing.T) {
	server := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/performance/beacon", strings.NewReader(`{
		"app":"client",
		"route":"menu",
		"build":"test-build",
		"lcp_ms":999999
	}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.performanceBeacon(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestRequestLogOmitsSensitiveRequestData(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	server := New(config.Config{Env: "test"}, nil, logger)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/performance/beacon?phone=123", strings.NewReader(`{
		"app":"client",
		"route":"menu",
		"build":"test-build"
	}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer secret-session-token")
	w := httptest.NewRecorder()

	server.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusNoContent, w.Body.String())
	}
	logLine := buf.String()
	for _, forbidden := range []string{"phone=123", "Authorization", "secret-session-token"} {
		if strings.Contains(logLine, forbidden) {
			t.Fatalf("request log leaked %q: %s", forbidden, logLine)
		}
	}
	for _, required := range []string{"http request", "/api/v1/performance/beacon", `"status":204`, "response_bytes"} {
		if !strings.Contains(logLine, required) {
			t.Fatalf("request log missing %q: %s", required, logLine)
		}
	}
}

func TestLiveDoesNotRequireDatabase(t *testing.T) {
	var buf bytes.Buffer
	server := New(config.Config{Env: "test"}, nil, slog.New(slog.NewJSONHandler(&buf, nil)))
	req := httptest.NewRequest(http.MethodGet, "/live", nil)
	w := httptest.NewRecorder()

	server.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("live status = %d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
}

func TestReadyRequiresDatabase(t *testing.T) {
	var buf bytes.Buffer
	server := New(config.Config{Env: "test"}, nil, slog.New(slog.NewJSONHandler(&buf, nil)))
	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	w := httptest.NewRecorder()

	server.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("ready status = %d, want %d; body=%s", w.Code, http.StatusServiceUnavailable, w.Body.String())
	}
}

func TestTelegramHTTPClientHasBoundedTransport(t *testing.T) {
	client := newTelegramHTTPClient()
	if client.Timeout != 8*time.Second {
		t.Fatalf("client timeout = %s, want 8s", client.Timeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T, want *http.Transport", client.Transport)
	}
	if transport.DialContext == nil {
		t.Fatal("DialContext must be configured with connect timeout and keep-alive")
	}
	if transport.MaxIdleConns != 16 {
		t.Fatalf("MaxIdleConns = %d, want 16", transport.MaxIdleConns)
	}
	if transport.MaxIdleConnsPerHost != 4 {
		t.Fatalf("MaxIdleConnsPerHost = %d, want 4", transport.MaxIdleConnsPerHost)
	}
	if transport.IdleConnTimeout != 90*time.Second {
		t.Fatalf("IdleConnTimeout = %s, want 90s", transport.IdleConnTimeout)
	}
	if transport.ResponseHeaderTimeout != 5*time.Second {
		t.Fatalf("ResponseHeaderTimeout = %s, want 5s", transport.ResponseHeaderTimeout)
	}
	if transport.TLSHandshakeTimeout != 5*time.Second {
		t.Fatalf("TLSHandshakeTimeout = %s, want 5s", transport.TLSHandshakeTimeout)
	}
}

func TestSendClientBotMessageUsesSharedTelegramHTTPClient(t *testing.T) {
	called := false
	server := New(config.Config{Env: "test", ClientBotToken: "test-token"}, nil, slog.Default())
	server.telegramHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		called = true
		if req.URL.String() != "https://api.telegram.org/bottest-token/sendMessage" {
			t.Fatalf("telegram URL = %s", req.URL.String())
		}
		if req.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("Content-Type = %q, want application/json", req.Header.Get("Content-Type"))
		}
		body, err := io.ReadAll(req.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if !strings.Contains(string(body), `"chat_id":123`) || !strings.Contains(string(body), `"text":"hello"`) {
			t.Fatalf("unexpected request body: %s", body)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"ok":true,"result":{"message_id":42}}`)),
			Request:    req,
		}, nil
	})}

	messageID, err := server.sendClientBotMessage(context.Background(), 123, "hello", nil)
	if err != nil {
		t.Fatalf("send client bot message: %v", err)
	}
	if messageID != 42 {
		t.Fatalf("message id = %d, want 42", messageID)
	}
	if !called {
		t.Fatal("shared telegram HTTP client was not used")
	}
}

func TestCachedRuntimePayloadCoalescesConcurrentMisses(t *testing.T) {
	var calls atomic.Int64
	release := make(chan struct{})
	started := make(chan struct{})
	server := New(config.Config{Env: "test", Timezone: "Europe/Belgrade"}, nil, slog.Default())
	server.now = func() time.Time { return time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC) }
	server.loadRuntime = func(context.Context) (core.Runtime, int, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return core.Runtime{
			ServerTime:       server.now(),
			Timezone:         "Europe/Belgrade",
			AcceptingOrders:  true,
			Currency:         "RSD",
			EnabledPayments:  []string{"cash"},
			SupportedLocales: []string{"ru", "sr", "en"},
		}, 7, nil
	}

	runConcurrentCacheMisses(t, 50, func() error {
		entry, err := server.cachedRuntimePayload(context.Background())
		if err != nil {
			return err
		}
		if entry.revision != 7 {
			return fmt.Errorf("runtime revision = %d, want 7", entry.revision)
		}
		return nil
	}, started, release, &calls)

	if _, err := server.cachedRuntimePayload(context.Background()); err != nil {
		t.Fatalf("cached runtime payload after coalesced miss: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("runtime loader calls after warm cache = %d, want 1", got)
	}
}

func TestCachedMenuPayloadCoalescesConcurrentMisses(t *testing.T) {
	var calls atomic.Int64
	release := make(chan struct{})
	started := make(chan struct{})
	categoryID := uuid.New()
	server := New(config.Config{Env: "test"}, nil, slog.Default())
	server.now = func() time.Time { return time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC) }
	server.loadMenuRevision = func(_ context.Context, locale string) (int64, []core.Category, error) {
		if locale != "ru" {
			return 0, nil, fmt.Errorf("locale = %q, want ru", locale)
		}
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return 11, []core.Category{{ID: categoryID, Title: "Menu", SortOrder: 1}}, nil
	}

	runConcurrentCacheMisses(t, 50, func() error {
		entry, err := server.cachedMenuPayload(context.Background(), "ru")
		if err != nil {
			return err
		}
		if entry.revision != 11 || len(entry.categories) != 1 || entry.categories[0].ID != categoryID {
			return fmt.Errorf("unexpected menu entry: revision=%d categories=%v", entry.revision, entry.categories)
		}
		return nil
	}, started, release, &calls)

	if _, err := server.cachedMenuPayload(context.Background(), "ru"); err != nil {
		t.Fatalf("cached menu payload after coalesced miss: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("menu loader calls after warm cache = %d, want 1", got)
	}
}

func TestCORSAllowedPreflightCachesExactOrigin(t *testing.T) {
	server := New(config.Config{
		Env:            "test",
		AllowedOrigins: []string{"https://takolako.site/"},
	}, nil, slog.Default())
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/bootstrap/client", nil)
	req.Header.Set("Origin", "https://takolako.site")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "authorization,content-type,idempotency-key,if-none-match")
	w := httptest.NewRecorder()

	server.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusNoContent, w.Body.String())
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://takolako.site" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want exact origin", got)
	}
	if got := w.Header().Get("Access-Control-Max-Age"); got != "600" {
		t.Fatalf("Access-Control-Max-Age = %q, want 600", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got == "*" {
		t.Fatal("Access-Control-Allow-Origin must not be wildcard")
	}
	requireHeaderToken(t, "Access-Control-Allow-Methods", w.Header().Get("Access-Control-Allow-Methods"), "POST")
	requireHeaderToken(t, "Access-Control-Allow-Headers", w.Header().Get("Access-Control-Allow-Headers"), "Authorization")
	requireHeaderToken(t, "Access-Control-Allow-Headers", w.Header().Get("Access-Control-Allow-Headers"), "Content-Type")
	requireHeaderToken(t, "Access-Control-Allow-Headers", w.Header().Get("Access-Control-Allow-Headers"), "Idempotency-Key")
	requireHeaderToken(t, "Access-Control-Allow-Headers", w.Header().Get("Access-Control-Allow-Headers"), "If-None-Match")
	requireHeaderToken(t, "Access-Control-Expose-Headers", w.Header().Get("Access-Control-Expose-Headers"), "ETag")
	requireHeaderToken(t, "Access-Control-Expose-Headers", w.Header().Get("Access-Control-Expose-Headers"), "Server-Timing")
	requireHeaderToken(t, "Vary", w.Header().Get("Vary"), "Origin")
}

func TestCORSRejectsForeignOriginWithoutWildcardHeaders(t *testing.T) {
	server := New(config.Config{
		Env:            "test",
		AllowedOrigins: []string{"https://takolako.site"},
	}, nil, slog.Default())
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/bootstrap/client", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Access-Control-Request-Method", "POST")
	w := httptest.NewRecorder()

	server.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusForbidden, w.Body.String())
	}
	for _, name := range []string{
		"Access-Control-Allow-Origin",
		"Access-Control-Allow-Methods",
		"Access-Control-Allow-Headers",
		"Access-Control-Expose-Headers",
		"Access-Control-Max-Age",
	} {
		if got := w.Header().Get(name); got != "" {
			t.Fatalf("%s = %q, want empty for foreign origin", name, got)
		}
	}
}

func TestCORSAllowedGETUsesExactOriginAndVary(t *testing.T) {
	server := New(config.Config{
		Env:            "test",
		AllowedOrigins: []string{"https://takolako.site"},
	}, nil, slog.Default())
	req := httptest.NewRequest(http.MethodGet, "/live", nil)
	req.Header.Set("Origin", "https://takolako.site")
	w := httptest.NewRecorder()

	server.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://takolako.site" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want exact origin", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got == "*" {
		t.Fatal("Access-Control-Allow-Origin must not be wildcard")
	}
	requireHeaderToken(t, "Access-Control-Expose-Headers", w.Header().Get("Access-Control-Expose-Headers"), "ETag")
	requireHeaderToken(t, "Access-Control-Expose-Headers", w.Header().Get("Access-Control-Expose-Headers"), "Server-Timing")
	requireHeaderToken(t, "Vary", w.Header().Get("Vary"), "Origin")
}

func TestMediaServesImmutableETagAndSupportsNotModifiedAndRange(t *testing.T) {
	mediaDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(mediaDir, "menu"), 0o755); err != nil {
		t.Fatalf("mkdir media: %v", err)
	}
	raw := []byte{0xff, 0xd8, 0xff, 0xd9}
	if err := os.WriteFile(filepath.Join(mediaDir, "menu", "sample.jpg"), raw, 0o644); err != nil {
		t.Fatalf("write media: %v", err)
	}
	var buf bytes.Buffer
	server := New(config.Config{Env: "test", MediaDir: mediaDir}, nil, slog.New(slog.NewJSONHandler(&buf, nil)))
	req := httptest.NewRequest(http.MethodGet, "/media/menu/sample.jpg", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()

	server.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected media ETag")
	}
	if w.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("unexpected Cache-Control: %q", w.Header().Get("Cache-Control"))
	}
	if w.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("unexpected Content-Type: %q", w.Header().Get("Content-Type"))
	}
	if w.Header().Get("Content-Encoding") != "" {
		t.Fatalf("media should not be gzip-encoded, got %q", w.Header().Get("Content-Encoding"))
	}
	if !bytes.Equal(w.Body.Bytes(), raw) {
		t.Fatalf("unexpected media body: %v", w.Body.Bytes())
	}

	notModifiedReq := httptest.NewRequest(http.MethodGet, "/media/menu/sample.jpg", nil)
	notModifiedReq.Header.Set("Accept-Encoding", "gzip")
	notModifiedReq.Header.Set("If-None-Match", etag)
	notModified := httptest.NewRecorder()

	server.Routes().ServeHTTP(notModified, notModifiedReq)

	if notModified.Code != http.StatusNotModified {
		t.Fatalf("304 status = %d, want %d; body=%s", notModified.Code, http.StatusNotModified, notModified.Body.String())
	}
	if notModified.Body.Len() != 0 {
		t.Fatalf("304 should not include a body, got %q", notModified.Body.String())
	}
	if notModified.Header().Get("Content-Encoding") != "" {
		t.Fatalf("304 media should not have Content-Encoding, got %q", notModified.Header().Get("Content-Encoding"))
	}

	rangeReq := httptest.NewRequest(http.MethodGet, "/media/menu/sample.jpg", nil)
	rangeReq.Header.Set("Accept-Encoding", "gzip")
	rangeReq.Header.Set("Range", "bytes=1-2")
	rangeResponse := httptest.NewRecorder()

	server.Routes().ServeHTTP(rangeResponse, rangeReq)

	if rangeResponse.Code != http.StatusPartialContent {
		t.Fatalf("range status = %d, want %d; body=%s", rangeResponse.Code, http.StatusPartialContent, rangeResponse.Body.String())
	}
	if rangeResponse.Header().Get("Content-Range") != "bytes 1-2/4" {
		t.Fatalf("unexpected Content-Range: %q", rangeResponse.Header().Get("Content-Range"))
	}
	if !bytes.Equal(rangeResponse.Body.Bytes(), raw[1:3]) {
		t.Fatalf("unexpected range body: %v", rangeResponse.Body.Bytes())
	}
	if rangeResponse.Header().Get("Content-Encoding") != "" {
		t.Fatalf("range media should not be gzip-encoded, got %q", rangeResponse.Header().Get("Content-Encoding"))
	}
}

func TestMediaRejectsTraversalPath(t *testing.T) {
	server := New(config.Config{Env: "test", MediaDir: t.TempDir()}, nil, slog.Default())
	req := httptest.NewRequest(http.MethodGet, "/media/../secret.jpg", nil)
	w := httptest.NewRecorder()

	server.serveMedia(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestWriteJSONAddsEncodeServerTiming(t *testing.T) {
	handler := withServerTiming(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}))
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
	timing := w.Header().Get("Server-Timing")
	if !strings.Contains(timing, "encode;dur=") {
		t.Fatalf("Server-Timing missing encode metric: %q", timing)
	}
	if !strings.Contains(timing, "total;dur=") {
		t.Fatalf("Server-Timing missing total metric: %q", timing)
	}
}

func TestConditionalJSONReturnsNotModified(t *testing.T) {
	payload := map[string]any{"orders": []string{"one"}}
	firstReq := httptest.NewRequest(http.MethodGet, "/api/v1/orders", nil)
	first := httptest.NewRecorder()

	writeConditionalJSON(first, firstReq, http.StatusOK, payload, "private, no-cache, no-store")

	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d, want %d", first.Code, http.StatusOK)
	}
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected ETag")
	}

	secondReq := httptest.NewRequest(http.MethodGet, "/api/v1/orders", nil)
	secondReq.Header.Set("If-None-Match", etag)
	second := httptest.NewRecorder()

	writeConditionalJSON(second, secondReq, http.StatusOK, payload, "private, no-cache, no-store")

	if second.Code != http.StatusNotModified {
		t.Fatalf("second status = %d, want %d; body=%s", second.Code, http.StatusNotModified, second.Body.String())
	}
	if second.Body.Len() != 0 {
		t.Fatalf("304 should not include a body, got %q", second.Body.String())
	}
	if second.Header().Get("Cache-Control") != "private, no-cache, no-store" {
		t.Fatalf("unexpected Cache-Control: %q", second.Header().Get("Cache-Control"))
	}
}

func TestGzipDoesNotMarkNotModifiedResponses(t *testing.T) {
	handler := withGzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeConditionalJSONWithETag(w, r, http.StatusOK, map[string]any{"orders": []string{"one"}}, "private, no-cache, no-store", `"orders-v1"`)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/orders", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("If-None-Match", `"orders-v1"`)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotModified)
	}
	if w.Header().Get("Content-Encoding") != "" {
		t.Fatalf("304 should not have Content-Encoding, got %q", w.Header().Get("Content-Encoding"))
	}
	if w.Body.Len() != 0 {
		t.Fatalf("304 should not include body, got %q", w.Body.String())
	}
}

func TestGzipStillCompressesChangedConditionalResponses(t *testing.T) {
	handler := withGzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeConditionalJSONWithETag(w, r, http.StatusOK, map[string]any{"orders": []string{"one"}}, "private, no-cache, no-store", `"orders-v2"`)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/orders", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("If-None-Match", `"orders-v1"`)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("expected gzip response, got %q", w.Header().Get("Content-Encoding"))
	}
	reader, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("open gzip body: %v", err)
	}
	raw, err := io.ReadAll(reader)
	_ = reader.Close()
	if err != nil {
		t.Fatalf("read gzip body: %v", err)
	}
	if !strings.Contains(string(raw), `"orders"`) {
		t.Fatalf("unexpected body: %s", raw)
	}
}

func runConcurrentCacheMisses(t *testing.T, workers int, call func() error, started <-chan struct{}, release chan struct{}, calls *atomic.Int64) {
	t.Helper()
	begin := make(chan struct{})
	errs := make(chan error, workers)
	var ready sync.WaitGroup
	ready.Add(workers)
	for range workers {
		go func() {
			ready.Done()
			<-begin
			errs <- call()
		}()
	}
	ready.Wait()
	close(begin)

	select {
	case <-started:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("cache loader did not start")
	}

	time.Sleep(25 * time.Millisecond)
	blockedMissCalls := calls.Load()
	close(release)

	for range workers {
		if err := <-errs; err != nil {
			t.Fatalf("cache caller failed: %v", err)
		}
	}
	if blockedMissCalls != 1 {
		t.Fatalf("loader calls during blocked concurrent cache miss = %d, want 1", blockedMissCalls)
	}
}

func requireHeaderToken(t *testing.T, name string, got string, want string) {
	t.Helper()
	for _, token := range strings.Split(got, ",") {
		if strings.EqualFold(strings.TrimSpace(token), want) {
			return
		}
	}
	t.Fatalf("%s = %q, want token %q", name, got, want)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
