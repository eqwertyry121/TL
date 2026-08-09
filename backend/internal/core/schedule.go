package core

import "time"

type AcceptResult struct {
	OK          bool
	Reason      string
	NextOpening time.Time
}

func CanAcceptOrder(now time.Time, settings Settings) AcceptResult {
	loc, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		loc = time.FixedZone("Europe/Belgrade", 3600)
	}
	localNow := now.In(loc)
	next := nextOpening(localNow)

	if settings.ManualDayOff {
		return AcceptResult{OK: false, Reason: "manual_day_off", NextOpening: next}
	}
	if localNow.Weekday() == time.Monday {
		return AcceptResult{OK: false, Reason: "weekly_day_off", NextOpening: next}
	}
	hour, min, sec := localNow.Clock()
	seconds := hour*3600 + min*60 + sec
	if seconds < 13*3600 || seconds >= 21*3600 {
		return AcceptResult{OK: false, Reason: "schedule_closed", NextOpening: next}
	}
	return AcceptResult{OK: true, Reason: "open", NextOpening: time.Time{}}
}

func nextOpening(localNow time.Time) time.Time {
	for day := 0; day < 8; day++ {
		candidate := time.Date(localNow.Year(), localNow.Month(), localNow.Day()+day, 13, 0, 0, 0, localNow.Location())
		if candidate.Before(localNow) || candidate.Equal(localNow) {
			continue
		}
		if candidate.Weekday() == time.Monday {
			continue
		}
		return candidate
	}
	return time.Time{}
}
