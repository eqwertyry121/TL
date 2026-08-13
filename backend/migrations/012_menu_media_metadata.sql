CREATE TABLE IF NOT EXISTS menu_media (
  display_path text PRIMARY KEY CHECK (display_path LIKE '/media/menu/%'),
  thumbnail_path text NOT NULL CHECK (thumbnail_path LIKE '/media/menu/%'),
  display_width integer NOT NULL CHECK (display_width > 0),
  display_height integer NOT NULL CHECK (display_height > 0),
  display_bytes integer NOT NULL CHECK (display_bytes >= 0),
  display_mime text NOT NULL DEFAULT 'image/jpeg',
  thumbnail_width integer NOT NULL CHECK (thumbnail_width > 0),
  thumbnail_height integer NOT NULL CHECK (thumbnail_height > 0),
  thumbnail_bytes integer NOT NULL CHECK (thumbnail_bytes >= 0),
  thumbnail_mime text NOT NULL DEFAULT 'image/jpeg',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_media_created
ON menu_media(created_at DESC);
