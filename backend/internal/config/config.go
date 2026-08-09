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
	BootstrapOwnerTelegramID int64
	LocalRoleSwitcherEnabled bool
	EncryptionKey            []byte
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
	if cfg.Env == "production" {
		if cfg.ClientBotToken == "" {
			return Config{}, fmt.Errorf("%w: missing client bot token", core.ErrProductionUnsafeValue)
		}
		if cfg.StaffBotToken == "" {
			return Config{}, fmt.Errorf("%w: missing staff bot token", core.ErrProductionUnsafeValue)
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
	sum := sha256.Sum256([]byte(raw))
	return sum[:], nil
}
