#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$DIR/backups/standalone-local/postgres"
LOG_FILE="$DIR/backups/standalone-local/postgres.log"
PORT="${POSTGRES_PORT:-55440}"

if ! command -v pg_ctl >/dev/null 2>&1; then
  echo "Error: pg_ctl is not installed or not in PATH."
  echo "Install PostgreSQL with 'brew install postgresql@15' or ensure /opt/homebrew/bin is in your PATH."
  exit 1
fi

case "$1" in
  start)
    if [ ! -d "$DATA_DIR" ]; then
      echo "Initializing database cluster at $DATA_DIR..."
      mkdir -p "$(dirname "$DATA_DIR")"
      initdb -D "$DATA_DIR" -A trust -U "${USER:-cristalwilliams}" --no-locale
    fi
    echo "Starting PostgreSQL on 127.0.0.1:$PORT..."
    pg_ctl -D "$DATA_DIR" -l "$LOG_FILE" -o "-p $PORT -h 127.0.0.1" start
    echo "PostgreSQL started. Log: $LOG_FILE"
    ;;
  stop)
    echo "Stopping PostgreSQL..."
    pg_ctl -D "$DATA_DIR" -m fast stop || true
    echo "PostgreSQL stopped."
    ;;
  status)
    pg_ctl -D "$DATA_DIR" status || true
    ;;
  restart)
    echo "Restarting PostgreSQL on 127.0.0.1:$PORT..."
    pg_ctl -D "$DATA_DIR" -m fast stop || true
    pg_ctl -D "$DATA_DIR" -l "$LOG_FILE" -o "-p $PORT -h 127.0.0.1" start
    ;;
  *)
    echo "Usage: $0 {start|stop|status|restart}"
    exit 1
    ;;
esac

