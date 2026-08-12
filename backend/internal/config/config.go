package config

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/joho/godotenv"
)

type Config struct {
	Env                      string
	HTTPAddr                 string
	PublicBaseURL            string
	MediaDir                 string
	DatabaseURL              string
	Timezone                 string
	Currency                 string
	ClientBotUsername        string
	ClientBotToken           string
	StaffBotUsername         string
	StaffBotToken            string
	TelegramWebhookSecret    string
	AllowedOrigins           []string
	BootstrapOwnerTelegramID int64
	LocalRoleSwitcherEnabled bool
	EncryptionKey            []byte
	PIIHashKey               []byte
	SessionTTL               time.Duration
	InitDataMaxAge           time.Duration
	MaxItemQuantity          int
	NotificationDryRun       bool
	NotificationPollInterval time.Duration
}

func Load() (Config, error) {
	_ = godotenv.Load(".env.local", ".env")
	cfg := Config{
		Env:                      get("APP_ENV", "development"),
		HTTPAddr:                 get("HTTP_ADDR", ":8080"),
		PublicBaseURL:            get("APP_PUBLIC_BASE_URL", "http://127.0.0.1:8080"),
		MediaDir:                 get("MEDIA_DIR", "backend/uploads"),
		DatabaseURL:              get("POSTGRES_DSN", "postgres://tk_delivery:tk_delivery@localhost:5432/tk_delivery?sslmode=disable"),
		Timezone:                 get("APP_TIMEZONE", "Europe/Belgrade"),
		Currency:                 get("APP_CURRENCY", "RSD"),
		ClientBotUsername:        get("TELEGRAM_CLIENT_BOT_USERNAME", "TakoLako_main_bot"),
		ClientBotToken:           os.Getenv("TELEGRAM_CLIENT_BOT_TOKEN"),
		StaffBotUsername:         os.Getenv("TELEGRAM_STAFF_BOT_USERNAME"),
		StaffBotToken:            os.Getenv("TELEGRAM_STAFF_BOT_TOKEN"),
		TelegramWebhookSecret:    os.Getenv("TELEGRAM_WEBHOOK_SECRET"),
		AllowedOrigins:           splitCSV(get("APP_ALLOWED_ORIGINS", defaultAllowedOrigins())),
		BootstrapOwnerTelegramID: mustInt64(get("BOOTSTRAP_OWNER_TELEGRAM_ID", "1048084234")),
		LocalRoleSwitcherEnabled: getBool("LOCAL_ROLE_SWITCHER_ENABLED", true),
		SessionTTL:               getDuration("SESSION_TTL", 24*time.Hour),
		InitDataMaxAge:           getDuration("TELEGRAM_INIT_DATA_MAX_AGE", 24*time.Hour),
		MaxItemQuantity:          int(mustInt64(get("MAX_ITEM_QUANTITY", "10"))),
		NotificationDryRun:       getBool("NOTIFICATION_DRY_RUN", true),
		NotificationPollInterval: getDuration("NOTIFICATION_POLL_INTERVAL", 5*time.Second),
	}
	key, err := loadEncryptionKey(cfg.Env)
	if err != nil {
		return Config{}, err
	}
	cfg.EncryptionKey = key
	piiHashKey, err := loadPIIHashKey(cfg.Env)
	if err != nil {
		return Config{}, err
	}
	cfg.PIIHashKey = piiHashKey
	if cfg.Env == "production" {
		if strings.TrimSpace(os.Getenv("PII_HASH_KEY")) == strings.TrimSpace(os.Getenv("APP_ENCRYPTION_KEY")) {
			return Config{}, fmt.Errorf("%w: PII_HASH_KEY must be different from APP_ENCRYPTION_KEY", core.ErrProductionUnsafeValue)
		}
		if cfg.ClientBotToken == "" {
			return Config{}, fmt.Errorf("%w: missing client bot token", core.ErrProductionUnsafeValue)
		}
		if cfg.TelegramWebhookSecret == "" {
			return Config{}, fmt.Errorf("%w: missing Telegram webhook secret", core.ErrProductionUnsafeValue)
		}
	}
	return cfg, nil
}

func get(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func getBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value == "1" || strings.EqualFold(value, "true") || strings.EqualFold(value, "yes")
}

func getDuration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	if d, err := time.ParseDuration(value); err == nil {
		return d
	}
	return fallback
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		trimmed := strings.TrimRight(strings.TrimSpace(part), "/")
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		out = append(out, trimmed)
	}
	return out
}

func defaultAllowedOrigins() string {
	return strings.Join([]string{
		"https://takolako.site",
		"https://www.takolako.site",
		"http://127.0.0.1:5173",
		"http://127.0.0.1:5174",
		"http://127.0.0.1:5175",
		"http://127.0.0.1:5176",
		"http://localhost:5173",
		"http://localhost:5174",
		"http://localhost:5175",
		"http://localhost:5176",
	}, ",")
}

func mustInt64(value string) int64 {
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		panic(err)
	}
	return parsed
}

func loadEncryptionKey(env string) ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv("APP_ENCRYPTION_KEY"))
	if raw == "" {
		if env == "production" {
			return nil, fmt.Errorf("%w: missing APP_ENCRYPTION_KEY", core.ErrProductionUnsafeValue)
		}
		sum := sha256.Sum256([]byte("tk-delivery-local-dev-encryption-key"))
		return sum[:], nil
	}
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	if env == "production" && len(raw) < 32 {
		return nil, fmt.Errorf("%w: APP_ENCRYPTION_KEY must be 32-byte base64 or at least 32 characters", core.ErrProductionUnsafeValue)
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:], nil
}

func loadPIIHashKey(env string) ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv("PII_HASH_KEY"))
	if raw == "" {
		if env == "production" {
			return nil, fmt.Errorf("%w: missing PII_HASH_KEY", core.ErrProductionUnsafeValue)
		}
		sum := sha256.Sum256([]byte("tk-delivery-local-dev-pii-hash-key"))
		return sum[:], nil
	}
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil && len(decoded) >= 32 {
		return decoded, nil
	}
	if env == "production" && len(raw) < 32 {
		return nil, fmt.Errorf("%w: PII_HASH_KEY must be at least 32 characters or 32-byte base64", core.ErrProductionUnsafeValue)
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:], nil
}
