#!/bin/sh
set -eu

APP_NAME="${APP_NAME:-TakoLako}"
API_HEALTH_URL="${API_HEALTH_URL:-https://api.takolako.site/health}"
ALERT_STATE_DIR="${ALERT_STATE_DIR:-/var/lib/tk-delivery-alerts}"
FAILED_NOTIFICATION_THRESHOLD="${FAILED_NOTIFICATION_THRESHOLD:-1}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/tk-delivery/deploy/docker-compose.api.yml}"
PROJECT_DIR="${PROJECT_DIR:-/opt/tk-delivery/deploy}"
POSTGRES_USER="${POSTGRES_USER:-tk_delivery}"
POSTGRES_DB="${POSTGRES_DB:-tk_delivery}"

case "$ALERT_STATE_DIR" in
  ""|"/"|"/var"|"/var/lib"|"/tmp"|"/opt")
    echo "Refusing unsafe ALERT_STATE_DIR: $ALERT_STATE_DIR" >&2
    exit 2
    ;;
esac

case "$FAILED_NOTIFICATION_THRESHOLD" in
  ""|*[!0-9]*)
    echo "FAILED_NOTIFICATION_THRESHOLD must be an integer" >&2
    exit 2
    ;;
esac

mkdir -p "$ALERT_STATE_DIR"

send_alert() {
  text="$1"
  if [ -z "${ALERT_BOT_TOKEN:-}" ] || [ -z "${ALERT_CHAT_ID:-}" ]; then
    echo "ALERT_BOT_TOKEN and ALERT_CHAT_ID are required for Telegram alerts" >&2
    return 1
  fi
  curl -fsS --max-time 10 \
    -X POST "https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${ALERT_CHAT_ID}" \
    --data-urlencode "text=${text}" \
    >/dev/null
}

alert_once() {
  key="$1"
  text="$2"
  state_file="$ALERT_STATE_DIR/$key.alerted"
  if [ ! -f "$state_file" ]; then
    send_alert "$text" && date -u +"%Y-%m-%dT%H:%M:%SZ" >"$state_file"
  fi
}

recover_once() {
  key="$1"
  text="$2"
  state_file="$ALERT_STATE_DIR/$key.alerted"
  if [ -f "$state_file" ]; then
    send_alert "$text" || true
    rm -f "$state_file"
  fi
}

if curl -fsS --max-time 10 "$API_HEALTH_URL" >/dev/null 2>&1; then
  recover_once "api-health" "✅ ${APP_NAME}: API снова отвечает ${API_HEALTH_URL}"
else
  alert_once "api-health" "🚨 ${APP_NAME}: API не отвечает ${API_HEALTH_URL}"
fi

if [ -f "$COMPOSE_FILE" ] && command -v docker >/dev/null 2>&1; then
  failed_count="$(
    cd "$PROJECT_DIR" && docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
      "SELECT count(*) FROM notification_jobs WHERE status = 'failed';" \
      2>/dev/null || true
  )"
  failed_count="$(printf "%s" "$failed_count" | tr -d '[:space:]')"

  case "$failed_count" in
    ""|*[!0-9]*)
      alert_once "notification-check" "🚨 ${APP_NAME}: не удалось проверить notification_jobs в Postgres"
      ;;
    *)
      recover_once "notification-check" "✅ ${APP_NAME}: проверка notification_jobs снова работает"
      if [ "$FAILED_NOTIFICATION_THRESHOLD" -gt 0 ] && [ "$failed_count" -ge "$FAILED_NOTIFICATION_THRESHOLD" ]; then
        alert_once "notification-failed" "⚠️ ${APP_NAME}: failed notification_jobs = ${failed_count}"
      else
        recover_once "notification-failed" "✅ ${APP_NAME}: failed notification_jobs = ${failed_count}"
      fi
      ;;
  esac
fi
