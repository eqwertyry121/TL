-- Attach optimized product photos to drinks that previously had empty photo_path.

INSERT INTO menu_media (
  display_path, thumbnail_path, display_width, display_height, display_bytes, display_mime,
  thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
)
VALUES
  ('/media/menu/rosa-still-water.jpg', '/media/menu/rosa-still-water_thumb.jpg', 960, 540, 27314, 'image/jpeg', 480, 270, 7813, 'image/jpeg'),
  ('/media/menu/coca-cola-033l.jpg', '/media/menu/coca-cola-033l_thumb.jpg', 960, 540, 25184, 'image/jpeg', 480, 270, 8270, 'image/jpeg'),
  ('/media/menu/coca-cola-05l.jpg', '/media/menu/coca-cola-05l_thumb.jpg', 960, 540, 22815, 'image/jpeg', 480, 270, 6771, 'image/jpeg'),
  ('/media/menu/coca-cola-1l.jpg', '/media/menu/coca-cola-1l_thumb.jpg', 960, 540, 18733, 'image/jpeg', 480, 270, 6004, 'image/jpeg')
ON CONFLICT (display_path) DO UPDATE
SET thumbnail_path = EXCLUDED.thumbnail_path,
    display_width = EXCLUDED.display_width,
    display_height = EXCLUDED.display_height,
    display_bytes = EXCLUDED.display_bytes,
    display_mime = EXCLUDED.display_mime,
    thumbnail_width = EXCLUDED.thumbnail_width,
    thumbnail_height = EXCLUDED.thumbnail_height,
    thumbnail_bytes = EXCLUDED.thumbnail_bytes,
    thumbnail_mime = EXCLUDED.thumbnail_mime;

WITH updated AS (
  UPDATE menu_items
  SET photo_path = CASE id
      WHEN '44444444-4444-4444-4444-444444444014' THEN '/media/menu/rosa-still-water.jpg'
      WHEN '44444444-4444-4444-4444-444444444018' THEN '/media/menu/coca-cola-033l.jpg'
      WHEN '44444444-4444-4444-4444-444444444019' THEN '/media/menu/coca-cola-05l.jpg'
      WHEN '44444444-4444-4444-4444-444444444020' THEN '/media/menu/coca-cola-1l.jpg'
      ELSE photo_path
    END,
    version = version + 1,
    updated_at = now()
  WHERE id IN (
      '44444444-4444-4444-4444-444444444014',
      '44444444-4444-4444-4444-444444444018',
      '44444444-4444-4444-4444-444444444019',
      '44444444-4444-4444-4444-444444444020'
    )
    AND photo_path IS DISTINCT FROM CASE id
      WHEN '44444444-4444-4444-4444-444444444014' THEN '/media/menu/rosa-still-water.jpg'
      WHEN '44444444-4444-4444-4444-444444444018' THEN '/media/menu/coca-cola-033l.jpg'
      WHEN '44444444-4444-4444-4444-444444444019' THEN '/media/menu/coca-cola-05l.jpg'
      WHEN '44444444-4444-4444-4444-444444444020' THEN '/media/menu/coca-cola-1l.jpg'
      ELSE photo_path
    END
  RETURNING 1
)
UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now()
WHERE EXISTS (SELECT 1 FROM updated);
