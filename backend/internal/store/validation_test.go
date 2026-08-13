package store

import (
	"testing"

	"github.com/google/uuid"
)

func TestValidMenuItemInputRestrictsPhotoPathToOptimizedMenuMedia(t *testing.T) {
	base := UpsertMenuItemInput{
		CategoryID:    uuid.New(),
		TitleRU:       "Test dish",
		DescriptionRU: "Description",
		PriceMinor:    100,
		MinQuantity:   1,
		SortOrder:     10,
		Visible:       true,
	}

	valid := []string{
		"",
		"/media/menu/12345678-1234-1234-1234-123456789012.jpg",
		" /media/menu/photo_thumb.jpg ",
	}
	for _, photoPath := range valid {
		input := base
		input.PhotoPath = photoPath
		if !validMenuItemInput(input) {
			t.Fatalf("expected photo_path %q to be valid", photoPath)
		}
	}

	invalid := []string{
		"https://example.com/photo.jpg",
		"http://example.com/photo.jpg",
		"fixtures/classic.webp",
		"/media/menu/photo.png",
		"/media/menu/photo.webp",
		"/media/menu/../secret.jpg",
		"/uploads/photo.jpg",
	}
	for _, photoPath := range invalid {
		input := base
		input.PhotoPath = photoPath
		if validMenuItemInput(input) {
			t.Fatalf("expected photo_path %q to be invalid", photoPath)
		}
	}
}
