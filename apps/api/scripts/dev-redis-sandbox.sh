#!/usr/bin/env bash
# Local Redis for this sandboxed dev environment, WITHOUT Docker.
#
# Why this exists: the normal path is `docker compose -f infrastructure/docker/docker-compose.yml
# up -d` (see that file — Phase 12 added a redis service). This sandbox has no Docker, same as
# the MySQL story in scripts/dev-mysql-sandbox.sh, so we unpack the Ubuntu redis-server .deb
# under /tmp and run an unprivileged redis-server on 6379.
#
# Usage:
#   ./scripts/dev-redis-sandbox.sh start
#   ./scripts/dev-redis-sandbox.sh stop
#   ./scripts/dev-redis-sandbox.sh status

set -euo pipefail

BASE_DIR="/tmp/gym-redis"
PREFIX="$BASE_DIR/opt"
PID_FILE="$BASE_DIR/redis.pid"
LOG_FILE="$BASE_DIR/redis.log"
PORT=6379

LIBDIR="$PREFIX/usr/lib/x86_64-linux-gnu"

cli() {
  if [ -x "$PREFIX/usr/bin/redis-cli" ]; then
    LD_LIBRARY_PATH="${LIBDIR}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$PREFIX/usr/bin/redis-cli" -p "$PORT" "$@"
    return
  fi
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli -p "$PORT" "$@"
    return
  fi
  return 1
}

is_running() {
  cli ping >/dev/null 2>&1
}

ensure_binary() {
  if command -v redis-server >/dev/null 2>&1; then
    echo "$(command -v redis-server)"
    return
  fi
  local libdir="$PREFIX/usr/lib/x86_64-linux-gnu"
  if [ -x "$PREFIX/usr/bin/redis-server" ] && [ -e "$libdir/liblzf.so.1" ] && [ -e "$libdir/libjemalloc.so.2" ]; then
    echo "$PREFIX/usr/bin/redis-server"
    return
  fi

  mkdir -p "$PREFIX" "$BASE_DIR/debs"
  echo "Downloading redis-server .deb + runtime libs (no system Redis, no Docker) ..." >&2
  (cd "$BASE_DIR/debs" && apt-get download redis-server redis-tools liblzf1 libjemalloc2 >/dev/null)
  for deb in "$BASE_DIR"/debs/*.deb; do
    dpkg-deb -x "$deb" "$PREFIX"
  done
  echo "$PREFIX/usr/bin/redis-server"
}

start() {
  if is_running; then
    echo "Already running on port $PORT"
    return
  fi

  mkdir -p "$BASE_DIR/data"
  local bin
  bin="$(ensure_binary)"

  echo "Starting redis-server on 127.0.0.1:$PORT ..."
  # Ubuntu's redis-server is linked against liblzf / jemalloc that live next to the
  # unpacked .deb, not in /usr/lib on this sandbox.
  local libdir="$PREFIX/usr/lib/x86_64-linux-gnu"
  LD_LIBRARY_PATH="${libdir}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$bin" \
    --bind 127.0.0.1 \
    --port "$PORT" \
    --dir "$BASE_DIR/data" \
    --pidfile "$PID_FILE" \
    --logfile "$LOG_FILE" \
    --daemonize yes \
    --protected-mode yes \
    --save ""

  for _ in $(seq 1 20); do
    if is_running; then
      echo "Redis is up on 127.0.0.1:$PORT"
      return
    fi
    sleep 0.25
  done
  echo "redis-server did not start — check $LOG_FILE" >&2
  exit 1
}

stop() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  echo "Stopped (or was not running)."
}

status() {
  if is_running; then
    echo "running on 127.0.0.1:$PORT"
  else
    echo "not running"
    exit 1
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
