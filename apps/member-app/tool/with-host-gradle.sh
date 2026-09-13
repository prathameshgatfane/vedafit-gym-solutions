#!/usr/bin/env bash
# Run a Flutter/Gradle command against the persistent host cache.
#
# Cursor (and similar sandboxes) set GRADLE_USER_HOME to
# /tmp/cursor-sandbox-cache/... which re-downloads the Gradle distribution
# (~200MB) on every build. This wrapper forces $HOME/.gradle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_GRADLE="${HOME}/.gradle"

case "${GRADLE_USER_HOME:-}" in
  /tmp/cursor-sandbox-cache/* | "")
    export GRADLE_USER_HOME="${HOST_GRADLE}"
    ;;
esac
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$HOST_GRADLE}"

export ANDROID_HOME="${ANDROID_HOME:-${HOME}/Android/Sdk}"
export ANDROID_SDK_ROOT="${ANDROID_HOME}"
JAVA_HOME="$(dirname "$(dirname "$(readlink -f /usr/bin/java)")")"
export JAVA_HOME
export PATH="${HOME}/development/flutter/bin:${ANDROID_HOME}/platform-tools:${JAVA_HOME}/bin:${PATH}"

cd "${ROOT}"
# env -i so a parent sandbox cannot re-inject GRADLE_USER_HOME into Gradle.
exec /usr/bin/env -i \
  HOME="${HOME}" \
  USER="${USER:-$(id -un)}" \
  LOGNAME="${LOGNAME:-${USER:-$(id -un)}}" \
  LANG="${LANG:-en_US.UTF-8}" \
  PATH="${PATH}" \
  GRADLE_USER_HOME="${GRADLE_USER_HOME}" \
  ANDROID_HOME="${ANDROID_HOME}" \
  ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT}" \
  JAVA_HOME="${JAVA_HOME}" \
  "${HOME}/development/flutter/bin/flutter" "$@"
