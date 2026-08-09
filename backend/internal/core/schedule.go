package core

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

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
	schedule := normalizedSchedule(settings.Schedule)
	next := nextOpening(localNow, schedule)

	if settings.ManualDayOff {
		return AcceptResult{OK: false, Reason: "manual_day_off", NextOpening: next}
	}

	day := schedule[int(localNow.Weekday())]
	if day.Closed {
		return AcceptResult{OK: false, Reason: "weekly_day_off", NextOpening: next}
	}
	hour, min, sec := localNow.Clock()
	seconds := hour*3600 + min*60 + sec
	openSeconds, _ := timeToSeconds(day.OpenTime)
	cutoffSeconds, _ := timeToSeconds(day.OrderCutoffTime)
	if seconds < openSeconds || seconds >= cutoffSeconds {
		return AcceptResult{OK: false, Reason: "schedule_closed", NextOpening: next}
	}
	return AcceptResult{OK: true, Reason: "open", NextOpening: time.Time{}}
}

func nextOpening(localNow time.Time, schedule map[int]ScheduleDay) time.Time {
	for day := 0; day < 8; day++ {
		weekday := int(time.Date(localNow.Year(), localNow.Month(), localNow.Day()+day, 0, 0, 0, 0, localNow.Location()).Weekday())
		scheduleDay := schedule[weekday]
		if scheduleDay.Closed {
			continue
		}
		openSeconds, _ := timeToSeconds(scheduleDay.OpenTime)
		candidate := time.Date(
			localNow.Year(),
			localNow.Month(),
			localNow.Day()+day,
			openSeconds/3600,
			(openSeconds%3600)/60,
			0,
			0,
			localNow.Location(),
		)
		if candidate.Before(localNow) || candidate.Equal(localNow) {
			continue
		}
		return candidate
	}
	return time.Time{}
}

func DefaultSchedule() []ScheduleDay {
	return []ScheduleDay{
		{DayOfWeek: 0, Closed: false, OpenTime: "13:00", OrderCutoffTime: "21:00", CloseTime: "22:00"},
		{DayOfWeek: 1, Closed: true, OpenTime: "13:00", OrderCutoffTime: "21:00", CloseTime: "22:00"},
		{DayOfWeek: 2, Closed: false, OpenTime: "13:00", OrderCutoffTime: "21:00", CloseTime: "22:00"},
		{DayOfWeek: 3, Closed: false, OpenTime: "13:00", OrderCutoffTime: "21:00", CloseTime: "22:00"},
		{DayOfWeek: 4, Closed: false, OpenTime: "13:00", OrderCutoffTime: "21:00", CloseTime: "22:00"},
		{DayOfWeek: 5, Closed: false, OpenTime: "13:00", OrderCutoffTime: "21:00", CloseTime: "22:00"},
		{DayOfWeek: 6, Closed: false, OpenTime: "13:00", OrderCutoffTime: "21:00", CloseTime: "22:00"},
	}
}

func ValidateSchedule(input []ScheduleDay) ([]ScheduleDay, error) {
	if len(input) != 7 {
		return nil, ErrInvalidInput
	}
	seen := map[int]bool{}
	output := make([]ScheduleDay, 0, 7)
	for _, day := range input {
		if day.DayOfWeek < 0 || day.DayOfWeek > 6 || seen[day.DayOfWeek] {
			return nil, ErrInvalidInput
		}
		seen[day.DayOfWeek] = true
		day.OpenTime = normalizeTime(day.OpenTime)
		day.OrderCutoffTime = normalizeTime(day.OrderCutoffTime)
		day.CloseTime = normalizeTime(day.CloseTime)
		openSeconds, err := timeToSeconds(day.OpenTime)
		if err != nil {
			return nil, ErrInvalidInput
		}
		cutoffSeconds, err := timeToSeconds(day.OrderCutoffTime)
		if err != nil {
			return nil, ErrInvalidInput
		}
		closeSeconds, err := timeToSeconds(day.CloseTime)
		if err != nil {
			return nil, ErrInvalidInput
		}
		if !day.Closed && !(openSeconds < cutoffSeconds && cutoffSeconds <= closeSeconds) {
			return nil, ErrInvalidInput
		}
		output = append(output, day)
	}
	return output, nil
}

func normalizedSchedule(input []ScheduleDay) map[int]ScheduleDay {
	days, err := ValidateSchedule(input)
	if err != nil {
		days = DefaultSchedule()
	}
	output := map[int]ScheduleDay{}
	for _, day := range days {
		output[day.DayOfWeek] = day
	}
	return output
}

func normalizeTime(value string) string {
	value = strings.TrimSpace(value)
	parts := strings.Split(value, ":")
	if len(parts) < 2 {
		return value
	}
	hour, errHour := strconv.Atoi(parts[0])
	minute, errMinute := strconv.Atoi(parts[1])
	if errHour != nil || errMinute != nil {
		return value
	}
	return fmt.Sprintf("%02d:%02d", hour, minute)
}

func timeToSeconds(value string) (int, error) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("%w: invalid time", ErrInvalidInput)
	}
	hour, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, err
	}
	minute, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, err
	}
	if hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 0, fmt.Errorf("%w: invalid time", ErrInvalidInput)
	}
	return hour*3600 + minute*60, nil
}
