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

func TestValidMenuItemInputRestrictsDiscountPercent(t *testing.T) {
	base := UpsertMenuItemInput{
		CategoryID:  uuid.New(),
		TitleRU:     "Test dish",
		PriceMinor:  100,
		MinQuantity: 1,
	}
	for _, discountPercent := range []int{0, 1, 50, 99} {
		input := base
		input.DiscountPercent = discountPercent
		if !validMenuItemInput(input) {
			t.Fatalf("expected discount_percent %d to be valid", discountPercent)
		}
	}
	for _, discountPercent := range []int{-1, 100, 101} {
		input := base
		input.DiscountPercent = discountPercent
		if validMenuItemInput(input) {
			t.Fatalf("expected discount_percent %d to be invalid", discountPercent)
		}
	}
}

func TestDiscountedPriceRoundsToNearestMinorUnit(t *testing.T) {
	tests := []struct {
		price    int
		discount int
		want     int
	}{
		{price: 150, discount: 0, want: 150},
		{price: 150, discount: 15, want: 128},
		{price: 210, discount: 10, want: 189},
		{price: 100, discount: 99, want: 1},
	}
	for _, test := range tests {
		if got := discountedPrice(test.price, test.discount); got != test.want {
			t.Fatalf("discountedPrice(%d, %d) = %d, want %d", test.price, test.discount, got, test.want)
		}
	}
}
