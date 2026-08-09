package notifications

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Worker struct {
	pool     *pgxpool.Pool
	interval time.Duration
	dryRun   bool
	logger   *slog.Logger
}

func New(pool *pgxpool.Pool, interval time.Duration, dryRun bool, logger *slog.Logger) *Worker {
	return &Worker{pool: pool, interval: interval, dryRun: dryRun, logger: logger}
}

func (w *Worker) Run(ctx context.Context) {
	if w.interval <= 0 {
		w.interval = 5 * time.Second
	}
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		if err := w.ProcessOnce(ctx); err != nil {
			w.logger.Warn("notification worker error", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *Worker) ProcessOnce(ctx context.Context) error {
	if !w.dryRun {
		// Real Telegram delivery is wired after production bot tokens are split.
		return nil
	}
	_, err := w.pool.Exec(ctx, `
		UPDATE notification_jobs
		SET status='sent', attempts=attempts+1, updated_at=now()
		WHERE id IN (
			SELECT id FROM notification_jobs
			WHERE status='pending' AND next_attempt_at <= now()
			ORDER BY created_at
			LIMIT 20
			FOR UPDATE SKIP LOCKED
		)
	`)
	return err
}
