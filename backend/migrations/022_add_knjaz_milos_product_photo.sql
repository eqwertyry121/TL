-- Attach the optimized Knjaz Milos sparkling water product photo.

INSERT INTO menu_media (
  display_path, thumbnail_path, display_width, display_height, display_bytes, display_mime,
  thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
)
VALUES
  ('/media/menu/knjaz-milos-sparkling-water.jpg', '/media/menu/knjaz-milos-sparkling-water_thumb.jpg', 960, 540, 18597, 'image/jpeg', 480, 270, 5471, 'image/jpeg')
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
  SET photo_path = '/media/menu/knjaz-milos-sparkling-water.jpg',
      version = version + 1,
      updated_at = now()
  WHERE id = '44444444-4444-4444-4444-444444444015'
    AND photo_path IS DISTINCT FROM '/media/menu/knjaz-milos-sparkling-water.jpg'
  RETURNING 1
)
UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now()
WHERE EXISTS (SELECT 1 FROM updated);
