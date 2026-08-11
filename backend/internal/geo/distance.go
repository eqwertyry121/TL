package geo

import "math"

const earthRadiusMeters = 6371008.8

func DistanceMeters(fromLat, fromLon, toLat, toLon float64) float64 {
	toRadians := func(degrees float64) float64 {
		return degrees * math.Pi / 180
	}
	lat1 := toRadians(fromLat)
	lon1 := toRadians(fromLon)
	lat2 := toRadians(toLat)
	lon2 := toRadians(toLon)
	dLat := lat2 - lat1
	dLon := lon2 - lon1
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusMeters * c
}

func ValidCoordinates(lat, lon float64) bool {
	return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}
