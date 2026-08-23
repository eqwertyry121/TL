INSERT INTO menu_media (
  display_path, thumbnail_path,
  display_width, display_height, display_bytes, display_mime,
  thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
)
VALUES
  ('/media/menu/family-box-card.jpg', '/media/menu/family-box-card_thumb.jpg', 960, 640, 150941, 'image/jpeg', 480, 320, 37584, 'image/jpeg'),
  ('/media/menu/one-and-done-card.jpg', '/media/menu/one-and-done-card_thumb.jpg', 960, 640, 96859, 'image/jpeg', 480, 320, 26542, 'image/jpeg'),
  ('/media/menu/double-card.jpg', '/media/menu/double-card_thumb.jpg', 960, 640, 206932, 'image/jpeg', 480, 320, 43638, 'image/jpeg'),
  ('/media/menu/sweet-duo-card.jpg', '/media/menu/sweet-duo-card_thumb.jpg', 960, 640, 141407, 'image/jpeg', 480, 320, 33922, 'image/jpeg'),
  ('/media/menu/veggie-card.jpg', '/media/menu/veggie-card_thumb.jpg', 960, 640, 148381, 'image/jpeg', 480, 320, 36188, 'image/jpeg')
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
SET photo_path = combo_photos.photo_path,
    version = menu_items.version + 1,
    updated_at = now()
FROM (VALUES
  ('77777777-7777-7777-7777-777777777001'::uuid, '/media/menu/family-box-card.jpg'),
  ('77777777-7777-7777-7777-777777777002'::uuid, '/media/menu/one-and-done-card.jpg'),
  ('77777777-7777-7777-7777-777777777003'::uuid, '/media/menu/double-card.jpg'),
  ('77777777-7777-7777-7777-777777777004'::uuid, '/media/menu/sweet-duo-card.jpg'),
  ('77777777-7777-7777-7777-777777777005'::uuid, '/media/menu/veggie-card.jpg')
) AS combo_photos(id, photo_path)
WHERE menu_items.id = combo_photos.id;

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
