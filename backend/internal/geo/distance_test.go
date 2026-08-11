package geo

import "testing"

func TestDistanceMeters(t *testing.T) {
	restaurantLat := 45.241970
	restaurantLon := 19.808807

	if got := DistanceMeters(restaurantLat, restaurantLon, restaurantLat, restaurantLon); got != 0 {
		t.Fatalf("same point distance = %f, want 0", got)
	}

	nearNoviSadLat := 45.255100
	nearNoviSadLon := 19.845200
	if got := DistanceMeters(restaurantLat, restaurantLon, nearNoviSadLat, nearNoviSadLon); got <= 0 || got >= 12_000 {
		t.Fatalf("near Novi Sad distance = %f, want inside 12km", got)
	}

	belgradeLat := 44.812500
	belgradeLon := 20.461200
	if got := DistanceMeters(restaurantLat, restaurantLon, belgradeLat, belgradeLon); got <= 12_000 {
		t.Fatalf("Belgrade distance = %f, want outside 12km", got)
	}
}
