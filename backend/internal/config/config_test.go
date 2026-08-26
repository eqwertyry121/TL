package config

import (
	"errors"
	"strings"
	"testing"

	"github.com/eqwertyry121/TL/backend/internal/core"
)

func TestLoadRejectsInvalidAppEnv(t *testing.T) {
	t.Setenv("APP_ENV", "staging")

	_, err := Load()
	if !errors.Is(err, core.ErrProductionUnsafeValue) {
		t.Fatalf("Load error = %v, want production unsafe value", err)
	}
}

func TestLoadAcceptsStrictProductionConfig(t *testing.T) {
	setMinimalProductionEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load production config: %v", err)
	}
	if cfg.LocalRoleSwitcherEnabled || cfg.NotificationDryRun || cfg.ServerTimingEnabled {
		t.Fatalf("production unsafe switches enabled: role=%t dry=%t timing=%t", cfg.LocalRoleSwitcherEnabled, cfg.NotificationDryRun, cfg.ServerTimingEnabled)
	}
	if !cfg.FiscalProcessAccepted {
		t.Fatal("production fiscal process gate not accepted")
	}
}

func TestLoadParsesDevSandboxAllowlist(t *testing.T) {
	setMinimalProductionEnv(t)
	t.Setenv("DEV_SANDBOX_MODE", "true")
	t.Setenv("DEV_SANDBOX_ALLOWED_TELEGRAM_IDS", "1048084234,1048084234,8609105840")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load sandbox config: %v", err)
	}
	if !cfg.DevSandboxMode || len(cfg.DevSandboxAllowedIDs) != 2 || cfg.DevSandboxAllowedIDs[0] != 1048084234 {
		t.Fatalf("sandbox config = mode:%t ids:%v", cfg.DevSandboxMode, cfg.DevSandboxAllowedIDs)
	}
}

func TestLoadRejectsProductionDryRunNotifications(t *testing.T) {
	setMinimalProductionEnv(t)
	t.Setenv("NOTIFICATION_DRY_RUN", "true")

	_, err := Load()
	if !errors.Is(err, core.ErrProductionUnsafeValue) {
		t.Fatalf("Load error = %v, want production unsafe value", err)
	}
}

func TestLoadAllowsProductionWithoutFiscalAcceptance(t *testing.T) {
	setMinimalProductionEnv(t)
	t.Setenv("FISCAL_PROCESS_ACCEPTED", "false")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load production config without fiscal acceptance: %v", err)
	}
	if cfg.FiscalProcessAccepted {
		t.Fatal("fiscal process should stay unaccepted until explicitly configured")
	}
}

func setMinimalProductionEnv(t *testing.T) {
	t.Helper()
	t.Setenv("APP_ENV", "production")
	t.Setenv("APP_ENCRYPTION_KEY", strings.Repeat("a", 32))
	t.Setenv("PII_HASH_KEY", strings.Repeat("b", 32))
	t.Setenv("TELEGRAM_CLIENT_BOT_TOKEN", "123456:test-token")
	t.Setenv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret")
	t.Setenv("LOCAL_ROLE_SWITCHER_ENABLED", "false")
	t.Setenv("NOTIFICATION_DRY_RUN", "false")
	t.Setenv("SERVER_TIMING_ENABLED", "false")
	t.Setenv("FISCAL_PROCESS_ACCEPTED", "true")
}
