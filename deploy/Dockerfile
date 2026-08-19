FROM golang:1.25.13-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG APP_BUILD_SHA=unknown
RUN go build -ldflags="-X main.buildSHA=${APP_BUILD_SHA}" -o /out/tk-delivery ./backend/cmd/app

FROM alpine:3.22

ARG APP_UID=10001
ARG APP_GID=10001

RUN apk add --no-cache ca-certificates tzdata wget \
	&& addgroup -S -g "${APP_GID}" app \
	&& adduser -S -G app -u "${APP_UID}" app

WORKDIR /app
ENV APP_BUILD_SHA=unknown
RUN mkdir -p /app/uploads /app/backend/migrations \
	&& chown -R app:app /app
COPY --from=build --chown=app:app /out/tk-delivery /app/tk-delivery
COPY --chown=app:app backend/migrations /app/backend/migrations
COPY --chown=app:app deploy/entrypoint.sh /app/entrypoint.sh
COPY --chown=app:app docs/menu_assets_from_telegram/production_media/*.jpg /app/seed-media/menu/
RUN chmod +x /app/entrypoint.sh
EXPOSE 8080
USER app
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD wget -qO- http://127.0.0.1:8080/ready >/dev/null || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["/app/tk-delivery"]
