package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/config"
	cryptobox "github.com/eqwertyry121/TL/backend/internal/crypto"
	"github.com/eqwertyry121/TL/backend/internal/db"
	"github.com/eqwertyry121/TL/backend/internal/httpapi"
	"github.com/eqwertyry121/TL/backend/internal/notifications"
	"github.com/eqwertyry121/TL/backend/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(logger); err != nil {
		logger.Error("app stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return err
	}
	if err := db.Migrate(ctx, pool, filepath.Join("backend", "migrations")); err != nil {
		return err
	}
	box, err := cryptobox.NewBox(cfg.EncryptionKey)
	if err != nil {
		return err
	}
	st := store.New(pool, box, cfg.PIIHashKey)
	if err := st.MigrateLegacyPhoneHashes(ctx); err != nil {
		return err
	}
	if err := st.BootstrapOwner(ctx, cfg.BootstrapOwnerTelegramID); err != nil {
		return err
	}
	if cfg.MediaDir != "" {
		if err := os.MkdirAll(cfg.MediaDir, 0o755); err != nil {
			return err
		}
	}

	worker := notifications.New(pool, box, cfg.NotificationPollInterval, cfg.NotificationDryRun, cfg.ClientBotToken, cfg.StaffBotToken, cfg.PublicBaseURL, logger)
	go worker.Run(ctx)

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpapi.New(cfg, st).Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		logger.Info("http server listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
