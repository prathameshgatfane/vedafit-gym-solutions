#!/usr/bin/env bash
# Local MySQL for this sandboxed dev environment, WITHOUT Docker.
#
# Why this exists: the normal path is `docker compose -f infrastructure/docker/docker-compose.yml
# up -d` (see that file). This sandbox has no Docker, and the system's own `mysqld` is confined by
# an AppArmor profile (/etc/apparmor.d/usr.sbin.mysqld) to /var/lib/mysql, /var/log/mysql and
# /run/mysqld only — it cannot use a custom --datadir under $HOME. It CAN write under /tmp (see
# /etc/apparmor.d/abstractions/user-tmp: "owner /tmp/** rwkl"), so that's what this script uses.
# We also don't have credentials for the system mysqld (root@localhost uses auth_socket and we
# have no sudo password), so this runs a completely separate, unprivileged mysqld instance on a
# different port (3307) instead of touching the system service on 3306.
#
# On a real machine with Docker, ignore this script and use docker-compose instead — same port
# (3307), same DATABASE_URL, so apps/api/.env doesn't need to change either way.
#
# Usage:
#   ./scripts/dev-mysql-sandbox.sh start   # init (if needed) + start, create gym_dev/gym_test dbs
#   ./scripts/dev-mysql-sandbox.sh stop    # stop it
#   ./scripts/dev-mysql-sandbox.sh status  # check if running

set -euo pipefail

DATA_DIR="/tmp/gym-mysql/data"
BASE_DIR="/tmp/gym-mysql"
SOCKET="$BASE_DIR/mysqld.sock"
PID_FILE="$BASE_DIR/mysqld.pid"
ERROR_LOG="$BASE_DIR/error.log"
PORT=3307

APP_DB="gym_dev"
TEST_DB="gym_test"
APP_USER="gym_app"
APP_PASSWORD="gym_app_dev_pw"

is_running() {
  mysqladmin --socket="$SOCKET" -u root ping >/dev/null 2>&1
}

start() {
  if is_running; then
    echo "Already running on port $PORT (socket: $SOCKET)"
  else
    mkdir -p "$DATA_DIR"

    if [ ! -d "$DATA_DIR/mysql" ]; then
      echo "Initializing new data directory at $DATA_DIR ..."
      mysqld --initialize-insecure \
        --datadir="$DATA_DIR" \
        --basedir=/usr \
        --log-error="$BASE_DIR/init.log"
    fi

    echo "Starting mysqld on 127.0.0.1:$PORT ..."
    nohup mysqld \
      --datadir="$DATA_DIR" \
      --basedir=/usr \
      --socket="$SOCKET" \
      --pid-file="$PID_FILE" \
      --port="$PORT" \
      --bind-address=127.0.0.1 \
      --log-error="$ERROR_LOG" \
      >"$BASE_DIR/stdout.log" 2>&1 &
    disown

    for _ in $(seq 1 30); do
      if is_running; then
        break
      fi
      sleep 0.5
    done

    if ! is_running; then
      echo "mysqld did not start — check $ERROR_LOG" >&2
      exit 1
    fi
  fi

  # Idempotent regardless of whether we just started it or it was already running —
  # safe to re-run any time to make sure both DBs/user exist.
  echo "Ensuring $APP_DB / $TEST_DB databases and $APP_USER user exist ..."
  # Granted globally (not just on gym_dev/gym_test) because `prisma migrate dev` creates a
  # temporary shadow database with a name it picks itself, so the user needs CREATE/DROP DATABASE
  # rights — fine here since this is an isolated, throwaway local dev/test MySQL instance.
  mysql --socket="$SOCKET" -u root -e "
    CREATE DATABASE IF NOT EXISTS $APP_DB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
    CREATE DATABASE IF NOT EXISTS $TEST_DB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
    CREATE USER IF NOT EXISTS '$APP_USER'@'%' IDENTIFIED WITH mysql_native_password BY '$APP_PASSWORD';
    GRANT ALL PRIVILEGES ON *.* TO '$APP_USER'@'%' WITH GRANT OPTION;
    FLUSH PRIVILEGES;
  "

  echo "Ready. mysql://$APP_USER:$APP_PASSWORD@127.0.0.1:$PORT/$APP_DB"
}

stop() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    echo "Stopped."
  else
    echo "Not running (no pid file at $PID_FILE)."
  fi
}

status() {
  if is_running; then
    echo "Running on 127.0.0.1:$PORT (socket: $SOCKET)"
  else
    echo "Not running."
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
