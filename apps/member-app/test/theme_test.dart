import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:member_app/screens/login_page.dart';
import 'package:member_app/theme.dart';
import 'package:member_app/theme_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

Widget _loginHarness() {
  return ProviderScope(
    child: Consumer(
      builder: (context, ref, _) {
        return MaterialApp(
          theme: buildMemberLightTheme(),
          darkTheme: buildMemberTheme(),
          themeMode: ref.watch(memberThemeProvider),
          home: const LoginPage(),
        );
      },
    ),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('light tokens lock heading #141414 on cream and keep lime off body text', () {
    expect(VfColors.light.fg, const Color(0xFF141414));
    expect(VfColors.light.bg, const Color(0xFFFEF9F5));
    expect(VfColors.light.accentText, isNot(Brand.green));
    expect(VfColors.light.fg, isNot(Brand.green));
    expect(VfColors.light.fgMuted, isNot(Brand.green));
  });

  testWidgets('light login heading is #141414 on cream and no lime body text', (tester) async {
    SharedPreferences.setMockInitialValues({memberThemeStorageKey: 'light'});
    await tester.pumpWidget(_loginHarness());
    await tester.pumpAndSettle();

    final heading = tester.widget<Text>(find.byKey(const Key('login-heading')));
    expect(heading.style?.color, const Color(0xFF141414));

    final ctx = tester.element(find.byKey(const Key('login-heading')));
    expect(Theme.of(ctx).scaffoldBackgroundColor, const Color(0xFFFEF9F5));
    expect(VfColors.of(ctx).fg, const Color(0xFF141414));
    expect(VfColors.of(ctx).accentText, const Color(0xFF3D4D00));

    for (final text in tester.widgetList<Text>(find.byType(Text))) {
      expect(
        text.style?.color,
        isNot(Brand.green),
        reason: 'lime must not be body text (${text.data})',
      );
    }
  });

  testWidgets('theme toggle persists across a new process (fresh ProviderScope)', (tester) async {
    await tester.pumpWidget(_loginHarness());
    await tester.pumpAndSettle();

    var ctx = tester.element(find.byKey(const Key('login-heading')));
    expect(Theme.of(ctx).brightness, Brightness.dark);

    await tester.tap(find.byKey(const Key('theme-toggle')));
    await tester.pumpAndSettle();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(memberThemeStorageKey), 'light');

    ctx = tester.element(find.byKey(const Key('login-heading')));
    expect(Theme.of(ctx).scaffoldBackgroundColor, const Color(0xFFFEF9F5));
    expect(
      tester.widget<Text>(find.byKey(const Key('login-heading'))).style?.color,
      const Color(0xFF141414),
    );

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(_loginHarness());
    await tester.pumpAndSettle();

    ctx = tester.element(find.byKey(const Key('login-heading')));
    expect(Theme.of(ctx).brightness, Brightness.light);
    expect(Theme.of(ctx).scaffoldBackgroundColor, const Color(0xFFFEF9F5));
    expect(
      tester.widget<Text>(find.byKey(const Key('login-heading'))).style?.color,
      const Color(0xFF141414),
    );
  });
}
