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
	Env                       string
	BuildSHA                  string
	HTTPAddr                  string
	PublicBaseURL             string
	MediaDir                  string
	DatabaseURL               string
	PostgresMaxConns          int32
	PostgresMinConns          int32
	PostgresMaxConnIdleTime   time.Duration
	Timezone                  string
	Currency                  string
	ClientBotUsername         string
	ClientBotToken            string
	ClientMiniAppURL          string
	TelegramAllowedUserIDs    []int64
	StaffBotUsername          string
	StaffBotToken             string
	TelegramWebhookSecret     string
	AllowedOrigins            []string
	BootstrapOwnerTelegramID  int64
	BootstrapOwnerTelegramIDs []int64
	LocalRoleSwitcherEnabled  bool
	EncryptionKey             []byte
	PIIHashKey                []byte
	SessionTTL                time.Duration
	InitDataMaxAge            time.Duration
	MaxItemQuantity           int
	NotificationDryRun        bool
	NotificationPollInterval  time.Duration
	NotificationConcurrency   int
	NotificationBacklogAfter  time.Duration
	ServerTimingEnabled       bool
	FiscalProcessAccepted     bool
	PIIRetentionDays          int
}

func Load() (Config, error) {
	_ = godotenv.Load(".env.local", ".env")
	env, err := loadAppEnv()
	if err != nil {
		return Config{}, err
	}
	localRoleSwitcherEnabled, err := getBoolStrict("LOCAL_ROLE_SWITCHER_ENABLED", env != "production")
	if err != nil {
		return Config{}, err
	}
	notificationDryRun, err := getBoolStrict("NOTIFICATION_DRY_RUN", false)
	if err != nil {
		return Config{}, err
	}
	fiscalProcessAccepted, err := getBoolStrict("FISCAL_PROCESS_ACCEPTED", false)
	if err != nil {
		return Config{}, err
	}
	cfg := Config{
		Env:                      env,
		BuildSHA:                 get("APP_BUILD_SHA", "dev"),
		HTTPAddr:                 get("HTTP_ADDR", ":8080"),
		PublicBaseURL:            get("APP_PUBLIC_BASE_URL", "http://127.0.0.1:8080"),
		MediaDir:                 get("MEDIA_DIR", "backend/uploads"),
		DatabaseURL:              get("POSTGRES_DSN", "postgres://tk_delivery:tk_delivery@localhost:5432/tk_delivery?sslmode=disable"),
		PostgresMaxConns:         int32(mustInt64(get("POSTGRES_MAX_CONNS", "8"))),
		PostgresMinConns:         int32(mustInt64(get("POSTGRES_MIN_CONNS", "1"))),
		PostgresMaxConnIdleTime:  getDuration("POSTGRES_MAX_CONN_IDLE_TIME", 5*time.Minute),
		Timezone:                 get("APP_TIMEZONE", "Europe/Belgrade"),
		Currency:                 get("APP_CURRENCY", "RSD"),
		ClientBotUsername:        get("TELEGRAM_CLIENT_BOT_USERNAME", "TakoLako_main_bot"),
		ClientBotToken:           os.Getenv("TELEGRAM_CLIENT_BOT_TOKEN"),
		ClientMiniAppURL:         get("TELEGRAM_CLIENT_MINI_APP_URL", "https://takolako.site/main/"),
		TelegramAllowedUserIDs:   positiveInt64CSV(os.Getenv("TELEGRAM_ALLOWED_USER_IDS")),
		StaffBotUsername:         os.Getenv("TELEGRAM_STAFF_BOT_USERNAME"),
		StaffBotToken:            os.Getenv("TELEGRAM_STAFF_BOT_TOKEN"),
		TelegramWebhookSecret:    os.Getenv("TELEGRAM_WEBHOOK_SECRET"),
		AllowedOrigins:           splitCSV(get("APP_ALLOWED_ORIGINS", defaultAllowedOrigins())),
		BootstrapOwnerTelegramID: mustInt64(get("BOOTSTRAP_OWNER_TELEGRAM_ID", "1048084234")),
		LocalRoleSwitcherEnabled: localRoleSwitcherEnabled,
		SessionTTL:               getDuration("SESSION_TTL", 24*time.Hour),
		InitDataMaxAge:           getDuration("TELEGRAM_INIT_DATA_MAX_AGE", 24*time.Hour),
		MaxItemQuantity:          int(mustInt64(get("MAX_ITEM_QUANTITY", "10"))),
		NotificationDryRun:       notificationDryRun,
		NotificationPollInterval: getDuration("NOTIFICATION_POLL_INTERVAL", 5*time.Second),
		NotificationConcurrency:  int(mustInt64(get("NOTIFICATION_CONCURRENCY", "4"))),
		NotificationBacklogAfter: getDuration("NOTIFICATION_BACKLOG_ALERT_AFTER", 60*time.Second),
		FiscalProcessAccepted:    fiscalProcessAccepted,
		PIIRetentionDays:         int(mustInt64(get("PII_RETENTION_DAYS", "730"))),
	}
	cfg.BootstrapOwnerTelegramIDs = bootstrapOwnerTelegramIDs()
	if len(cfg.BootstrapOwnerTelegramIDs) > 0 {
		cfg.BootstrapOwnerTelegramID = cfg.BootstrapOwnerTelegramIDs[0]
	}
	cfg.ServerTimingEnabled = cfg.Env != "production"
	if strings.TrimSpace(os.Getenv("SERVER_TIMING_ENABLED")) != "" {
		cfg.ServerTimingEnabled, err = getBoolStrict("SERVER_TIMING_ENABLED", cfg.ServerTimingEnabled)
		if err != nil {
			return Config{}, err
		}
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
		if cfg.LocalRoleSwitcherEnabled {
			return Config{}, fmt.Errorf("%w: LOCAL_ROLE_SWITCHER_ENABLED must be false in production", core.ErrProductionUnsafeValue)
		}
		if cfg.NotificationDryRun {
			return Config{}, fmt.Errorf("%w: NOTIFICATION_DRY_RUN must be false in production", core.ErrProductionUnsafeValue)
		}
		if cfg.ServerTimingEnabled {
			return Config{}, fmt.Errorf("%w: SERVER_TIMING_ENABLED must be false in production", core.ErrProductionUnsafeValue)
		}
		if cfg.ClientBotToken == "" {
			return Config{}, fmt.Errorf("%w: missing client bot token", core.ErrProductionUnsafeValue)
		}
		if cfg.TelegramWebhookSecret == "" {
			return Config{}, fmt.Errorf("%w: missing Telegram webhook secret", core.ErrProductionUnsafeValue)
		}
	}
	if strings.TrimSpace(cfg.StaffBotToken) == "" {
		cfg.StaffBotToken = cfg.ClientBotToken
	}
	if strings.TrimSpace(cfg.StaffBotUsername) == "" {
		cfg.StaffBotUsername = cfg.ClientBotUsername
	}
	if cfg.PostgresMaxConns < 1 {
		cfg.PostgresMaxConns = 1
	}
	if cfg.PostgresMinConns < 0 {
		cfg.PostgresMinConns = 0
	}
	if cfg.PostgresMinConns > cfg.PostgresMaxConns {
		cfg.PostgresMinConns = cfg.PostgresMaxConns
	}
	if cfg.NotificationConcurrency < 1 {
		cfg.NotificationConcurrency = 1
	}
	if cfg.NotificationConcurrency > 4 {
		cfg.NotificationConcurrency = 4
	}
	if cfg.PIIRetentionDays < 30 {
		cfg.PIIRetentionDays = 30
	}
	if cfg.PIIRetentionDays > 3650 {
		cfg.PIIRetentionDays = 3650
	}
	return cfg, nil
}

func get(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func getBoolStrict(key string, fallback bool) (bool, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes":
		return true, nil
	case "0", "false", "no":
		return false, nil
	default:
		return false, fmt.Errorf("%w: %s must be a boolean", core.ErrProductionUnsafeValue, key)
	}
}

func loadAppEnv() (string, error) {
	env := strings.ToLower(strings.TrimSpace(get("APP_ENV", "development")))
	switch env {
	case "development", "test", "testing", "production":
		return env, nil
	default:
		return "", fmt.Errorf("%w: APP_ENV must be development, test, testing, or production", core.ErrProductionUnsafeValue)
	}
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

func bootstrapOwnerTelegramIDs() []int64 {
	raw := strings.TrimSpace(os.Getenv("BOOTSTRAP_OWNER_TELEGRAM_IDS"))
	if raw == "" {
		if legacy := strings.TrimSpace(os.Getenv("BOOTSTRAP_OWNER_TELEGRAM_ID")); legacy != "" {
			raw = legacy
		} else {
			raw = "1048084234,8241921060,8609105840,7604602332"
		}
	}
	parts := strings.Split(raw, ",")
	out := make([]int64, 0, len(parts))
	seen := map[int64]bool{}
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" {
			continue
		}
		id := mustInt64(value)
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func positiveInt64CSV(raw string) []int64 {
	parts := strings.Split(strings.TrimSpace(raw), ",")
	out := make([]int64, 0, len(parts))
	seen := map[int64]bool{}
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" {
			continue
		}
		id := mustInt64(value)
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
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
