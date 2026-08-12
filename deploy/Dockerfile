FROM golang:1.25.12-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /out/tk-delivery ./backend/cmd/app

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata wget \
	&& addgroup -S app \
	&& adduser -S -G app app

WORKDIR /app
RUN mkdir -p /app/uploads /app/backend/migrations \
	&& chown -R app:app /app
COPY --from=build --chown=app:app /out/tk-delivery /app/tk-delivery
COPY --chown=app:app backend/migrations /app/backend/migrations
EXPOSE 8080
USER app
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["/app/tk-delivery"]
