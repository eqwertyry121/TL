INSERT INTO menu_media (
  display_path, thumbnail_path,
  display_width, display_height, display_bytes, display_mime,
  thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
)
VALUES (
  '/media/menu/family-box.jpg', '/media/menu/family-box_thumb.jpg',
  960, 640, 132873, 'image/jpeg',
  480, 320, 29800, 'image/jpeg'
)
ON CONFLICT (display_path) DO UPDATE SET
  thumbnail_path = EXCLUDED.thumbnail_path,
  display_width = EXCLUDED.display_width,
  display_height = EXCLUDED.display_height,
  display_bytes = EXCLUDED.display_bytes,
  display_mime = EXCLUDED.display_mime,
  thumbnail_width = EXCLUDED.thumbnail_width,
  thumbnail_height = EXCLUDED.thumbnail_height,
  thumbnail_bytes = EXCLUDED.thumbnail_bytes,
  thumbnail_mime = EXCLUDED.thumbnail_mime;

UPDATE menu_items
SET photo_path = '/media/menu/family-box.jpg',
    version = version + 1,
    updated_at = now()
WHERE id = '77777777-7777-7777-7777-777777777001';

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
