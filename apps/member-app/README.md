# Vedafit member portal

Thin Flutter client: login, home, membership, attendance, payments, profile.
All computed values (status, `daysRemaining`, outstanding) come from the API.

## Toolchain

Flutter **3.44.9** stable / Dart **3.12.2** (`$HOME/development/flutter`).

```bash
export PATH="$HOME/development/flutter/bin:$PATH"
flutter doctor
```

This Linux host: Flutter ✓, Android SDK ✓ (need **compileSdk 37** for
`flutter_secure_storage` 11; if `sdkmanager` installs `platforms/android-37.0`,
symlink it to `android-37`), Chrome ✓. Linux desktop lacks clang/cmake/ninja.
**iOS is not buildable here** (`flutter build ios` is not a subcommand on Linux).

`pnpm-workspace.yaml` lists `apps/api` and `apps/admin-web` only. This folder is
Dart, not a JS workspace package.

## API URL (`--dart-define=API_URL=…`)

| Build | If `API_URL` is omitted |
|---|---|
| Web debug | `http://localhost:4000/api/v1` |
| Android/iOS debug | `http://10.0.2.2:4000/api/v1` (emulator host loopback) |
| **Release** | **Hard error** — will not ship pointed at localhost |

There is no production host in this repo. A store/Play build must pass a real
HTTPS origin, e.g.

```bash
flutter build appbundle --release --dart-define=API_URL=https://<your-api>/api/v1
```

A physical Android device cannot use `10.0.2.2`. Pass the machine's LAN address
and make sure the API is reachable on that interface.

CORS (`localhost` / `127.0.0.1`) is a **browser** rule. Native Android does not
use it.

## Web (Phase 13)

```bash
cd apps/api && pnpm tsx scripts/phase13-fixtures.ts
cd apps/member-app
flutter run -d chrome --web-port 8080
# or: flutter run -d web-server --web-port 8080 --web-hostname 127.0.0.1
```

Demo login (pre-filled): `+919111100001` / `ChangeMe123!` / `demo-gym`.

## Android (Phase 14)

Use `tool/with-host-gradle.sh` so Gradle hits `$HOME/.gradle` instead of Cursor's
`/tmp/cursor-sandbox-cache` (which re-downloads the distribution).

Debug APK:

```bash
./tool/with-host-gradle.sh build apk --debug
```

**Physical phone (same Wi‑Fi as this laptop), signed fat APK:**

```bash
# API must be up on 0.0.0.0:4000. Re-check the laptop IP each session:
#   ip -4 route get 1.1.1.1
# Current (2026-09-09 evening): 10.45.182.169 (was 192.168.1.19 earlier).
./tool/with-host-gradle.sh build apk --release \
  --dart-define=API_URL=http://10.45.182.169:4000/api/v1
```

Sideload `outputs/vedafit-member-lan-10.45.182.169-release.apk` (also written to
`build/app/outputs/flutter-apk/app-release.apk`). Enable "install unknown apps"
for your file manager. `10.0.2.2` is emulator-only and will not work on a phone.
The phone's Wi‑Fi IP should be in the same subnet (here `10.45.182.x`).

Play bundle (needs a real HTTPS API when you have one):

```bash
./tool/with-host-gradle.sh build appbundle --release \
  --dart-define=API_URL=https://<your-api>/api/v1
```

Signing: copy `android/key.properties.example` to `android/key.properties` and
point `storeFile` at a local `.jks`. **Never commit** `key.properties`, `*.jks`,
or `*.keystore` (`android/.gitignore` already lists them). Without
`key.properties`, release still builds but is debug-signed.

Debug/profile manifests allow cleartext HTTP so the local API works. Release
does **not** (`usesCleartextTraffic` is not on the main manifest) — production
must be HTTPS.

`INTERNET` is on the main manifest so release can call the API.

## Auth (1.23.4)

- Access token: Riverpod memory only.
- Refresh token: `flutter_secure_storage`. Android uses the plugin's default
  Keystore AES-GCM options (`storageNamespace: vedafit_member`). Web still
  encrypts into `localStorage` (not httpOnly). Staff login is unchanged
  (cookie-only).

## iOS

The `ios/` tree from `flutter create` is present (`com.vedafit.memberApp`). It
cannot be compiled or TestFlight-signed on this machine. That work needs macOS
+ Xcode.

## Codegen

```bash
dart run build_runner build --delete-conflicting-outputs
```

Freezed is pinned to **2.5.x**.
