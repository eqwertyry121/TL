package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"image"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/eqwertyry121/TL/backend/internal/config"
	"github.com/eqwertyry121/TL/backend/internal/menumedia"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type menuPhotoRow struct {
	id        uuid.UUID
	photoPath string
}

func main() {
	dryRun := flag.Bool("dry-run", true, "scan and log actions without writing files or updating PostgreSQL")
	limit := flag.Int("limit", 100, "maximum menu rows to scan")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(context.Background(), logger, *dryRun, *limit); err != nil {
		logger.Error("menu media backfill failed", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, logger *slog.Logger, dryRun bool, limit int) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if strings.TrimSpace(cfg.MediaDir) == "" {
		return errors.New("MEDIA_DIR is required")
	}
	if limit <= 0 {
		return errors.New("limit must be positive")
	}

	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return err
	}
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return err
	}
	defer pool.Close()

	rows, err := pool.Query(ctx, `
		SELECT id, photo_path
		FROM menu_items
		WHERE photo_path <> ''
		ORDER BY updated_at, id
		LIMIT $1
	`, limit)
	if err != nil {
		return err
	}
	defer rows.Close()

	candidates := []menuPhotoRow{}
	for rows.Next() {
		var row menuPhotoRow
		if err := rows.Scan(&row.id, &row.photoPath); err != nil {
			return err
		}
		candidates = append(candidates, row)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	processed := 0
	skipped := 0
	for _, row := range candidates {
		changed, err := backfillMenuPhoto(ctx, pool, cfg.MediaDir, row, dryRun, logger)
		if err != nil {
			logger.Warn("menu media backfill row failed", "menu_item_id", row.id, "error", err)
			continue
		}
		if changed {
			processed++
		} else {
			skipped++
		}
	}
	logger.Info("menu media backfill finished", "dry_run", dryRun, "scanned", len(candidates), "processed", processed, "skipped", skipped)
	return nil
}

func backfillMenuPhoto(ctx context.Context, pool *pgxpool.Pool, mediaDir string, row menuPhotoRow, dryRun bool, logger *slog.Logger) (bool, error) {
	sourcePath, err := mediaPath(mediaDir, row.photoPath)
	if err != nil {
		return false, err
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return false, err
	}
	defer source.Close()

	img, err := menumedia.DecodeLimited(source)
	if err != nil {
		return false, err
	}
	if !needsBackfill(row.photoPath, sourcePath, img) {
		return false, nil
	}

	newID := uuid.NewString()
	displayFilename := newID + ".jpg"
	thumbnailFilename := newID + "_thumb.jpg"
	displayURL := "/media/menu/" + displayFilename
	thumbnailURL := "/media/menu/" + thumbnailFilename
	displayPath := filepath.Join(mediaDir, "menu", displayFilename)
	thumbnailPath := filepath.Join(mediaDir, "menu", thumbnailFilename)

	if dryRun {
		logger.Info("menu media backfill candidate", "menu_item_id", row.id, "old_photo_path", row.photoPath, "new_photo_path", displayURL, "thumbnail_path", thumbnailURL)
		return true, nil
	}

	if err := os.MkdirAll(filepath.Dir(displayPath), 0o755); err != nil {
		return false, err
	}
	displayImage := menumedia.Resize(img, menumedia.DisplayMaxSide)
	thumbnailImage := menumedia.Resize(img, menumedia.ThumbnailMaxSide)
	displayWidth, displayHeight := menumedia.Dimensions(displayImage)
	thumbnailWidth, thumbnailHeight := menumedia.Dimensions(thumbnailImage)
	if err := menumedia.WriteJPEG(displayPath, displayImage, menumedia.DisplayQuality); err != nil {
		return false, err
	}
	if err := menumedia.WriteJPEG(thumbnailPath, thumbnailImage, menumedia.ThumbnailQuality); err != nil {
		_ = os.Remove(displayPath)
		return false, err
	}
	displayInfo, err := os.Stat(displayPath)
	if err != nil {
		_ = os.Remove(displayPath)
		_ = os.Remove(thumbnailPath)
		return false, err
	}
	thumbnailInfo, err := os.Stat(thumbnailPath)
	if err != nil {
		_ = os.Remove(displayPath)
		_ = os.Remove(thumbnailPath)
		return false, err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		_ = os.Remove(displayPath)
		_ = os.Remove(thumbnailPath)
		return false, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	if _, err := tx.Exec(ctx, `
		INSERT INTO menu_media (
			display_path, thumbnail_path, display_width, display_height, display_bytes,
			display_mime, thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
		)
		VALUES ($1, $2, $3, $4, $5, 'image/jpeg', $6, $7, $8, 'image/jpeg')
		ON CONFLICT (display_path) DO UPDATE SET
			thumbnail_path=EXCLUDED.thumbnail_path,
			display_width=EXCLUDED.display_width,
			display_height=EXCLUDED.display_height,
			display_bytes=EXCLUDED.display_bytes,
			display_mime=EXCLUDED.display_mime,
			thumbnail_width=EXCLUDED.thumbnail_width,
			thumbnail_height=EXCLUDED.thumbnail_height,
			thumbnail_bytes=EXCLUDED.thumbnail_bytes,
			thumbnail_mime=EXCLUDED.thumbnail_mime
	`, displayURL, thumbnailURL, displayWidth, displayHeight, int(displayInfo.Size()), thumbnailWidth, thumbnailHeight, int(thumbnailInfo.Size())); err != nil {
		_ = os.Remove(displayPath)
		_ = os.Remove(thumbnailPath)
		return false, err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE menu_items
		SET photo_path=$1, version=version+1, updated_at=now()
		WHERE id=$2 AND photo_path=$3
	`, displayURL, row.id, row.photoPath)
	if err != nil {
		_ = os.Remove(displayPath)
		_ = os.Remove(thumbnailPath)
		return false, err
	}
	if tag.RowsAffected() != 1 {
		_ = os.Remove(displayPath)
		_ = os.Remove(thumbnailPath)
		return false, fmt.Errorf("menu item photo_path changed concurrently: %s", row.id)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE app_settings
		SET menu_revision=menu_revision+1, updated_at=now()
		WHERE id=true
	`); err != nil {
		_ = os.Remove(displayPath)
		_ = os.Remove(thumbnailPath)
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		_ = os.Remove(displayPath)
		_ = os.Remove(thumbnailPath)
		return false, err
	}
	logger.Info("menu media backfilled", "menu_item_id", row.id, "old_photo_path", row.photoPath, "new_photo_path", displayURL, "thumbnail_path", thumbnailURL)
	return true, nil
}

func needsBackfill(photoPath, sourcePath string, img image.Image) bool {
	if !strings.HasSuffix(strings.ToLower(photoPath), ".jpg") {
		return true
	}
	ext := filepath.Ext(sourcePath)
	thumbPath := strings.TrimSuffix(sourcePath, ext) + "_thumb.jpg"
	if _, err := os.Stat(thumbPath); err != nil {
		return true
	}
	width, height := menumedia.Dimensions(img)
	return max(width, height) > menumedia.DisplayMaxSide
}

func mediaPath(mediaDir, photoPath string) (string, error) {
	if !strings.HasPrefix(photoPath, "/media/") {
		return "", fmt.Errorf("unsupported media path: %s", photoPath)
	}
	relative := filepath.Clean(strings.TrimPrefix(photoPath, "/media/"))
	if relative == "." || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("unsafe media path: %s", photoPath)
	}
	base, err := filepath.Abs(mediaDir)
	if err != nil {
		return "", err
	}
	target, err := filepath.Abs(filepath.Join(base, relative))
	if err != nil {
		return "", err
	}
	if target != base && !strings.HasPrefix(target, base+string(filepath.Separator)) {
		return "", fmt.Errorf("media path escapes MEDIA_DIR: %s", photoPath)
	}
	return target, nil
}
