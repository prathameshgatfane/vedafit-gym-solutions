import 'package:flutter_test/flutter_test.dart';
import 'package:member_app/api/env.dart';

void main() {
  test('debug without API_URL uses the Android emulator host loopback', () {
    // Widget/unit tests are not web and not release, so the Android
    // emulator default applies. Web still uses localhost via kIsWeb.
    expect(resolveApiUrl(), 'http://10.0.2.2:4000/api/v1');
    expect(definedApiUrl, isEmpty);
  });
}
