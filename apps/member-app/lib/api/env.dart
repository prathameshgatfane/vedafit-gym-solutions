import 'package:flutter/foundation.dart';

/// Compile-time API origin. Always pass this for release / production:
/// `--dart-define=API_URL=https://api.example.com/api/v1`
///
/// Do not bake a production host into the repo — there isn't one yet.
/// An empty define in **release** is a hard error so a Play/store build
/// cannot silently ship pointed at localhost.
const definedApiUrl = String.fromEnvironment('API_URL');

const _webDevDefault = 'http://localhost:4000/api/v1';

/// Host loopback as seen from the Android emulator (not `localhost` — that
/// is the emulator itself). A physical device needs `--dart-define=API_URL=`
/// with the machine's LAN address and the API reachable on that interface.
const _androidEmulatorDevDefault = 'http://10.0.2.2:4000/api/v1';

String resolveApiUrl() {
  if (definedApiUrl.isNotEmpty) return definedApiUrl;
  if (kReleaseMode) {
    throw StateError(
      'API_URL must be set for release builds: '
      '--dart-define=API_URL=https://<host>/api/v1',
    );
  }
  if (kIsWeb) return _webDevDefault;
  return _androidEmulatorDevDefault;
}

/// Call once at process start so a mis-built release fails before login.
void assertApiUrlConfigured() {
  resolveApiUrl();
}
