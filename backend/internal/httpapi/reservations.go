package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/eqwertyry121/TL/backend/internal/store"
)

func (s *Server) reservationAvailability(w http.ResponseWriter, r *http.Request) {
	guests := 2
	if raw := strings.TrimSpace(r.URL.Query().Get("guests")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, core.ErrInvalidInput)
			return
		}
		guests = parsed
	}
	availability, err := s.store.ReservationAvailability(r.Context(), mustSession(r), guests, s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	writeConditionalJSON(w, r, http.StatusOK, availability, "private, no-cache, no-store")
}

func (s *Server) myReservation(w http.ResponseWriter, r *http.Request) {
	reservation, err := s.store.ActiveReservation(r.Context(), mustSession(r), s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	writeConditionalJSON(w, r, http.StatusOK, map[string]any{"reservation": reservation}, "private, no-cache, no-store")
}

func (s *Server) createReservation(w http.ResponseWriter, r *http.Request) {
	var input store.CreateReservationInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	reservation, err := s.store.CreateReservation(
		r.Context(), mustSession(r), input, r.Header.Get("Idempotency-Key"), s.now(),
	)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, reservation)
}

func (s *Server) cancelReservation(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	reservation, err := s.store.CancelReservation(r.Context(), mustSession(r), id, false)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, reservation)
}

func (s *Server) adminReservations(w http.ResponseWriter, r *http.Request) {
	reservations, err := s.store.AdminReservations(r.Context(), mustSession(r), s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	writeConditionalJSON(w, r, http.StatusOK, map[string]any{"reservations": reservations}, "private, no-cache, no-store")
}

func (s *Server) adminCancelReservation(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	reservation, err := s.store.CancelReservation(r.Context(), mustSession(r), id, true)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, reservation)
}
