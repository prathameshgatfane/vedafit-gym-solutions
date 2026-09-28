import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:member_app/screens/login_page.dart';
import 'package:member_app/widgets/vf_card.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('login screen shows the portal heading', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: LoginPage()),
      ),
    );
    expect(find.text('Member portal'), findsOneWidget);
    expect(find.byKey(const Key('sign-in')), findsOneWidget);
  });

  testWidgets('login has brand block, Alice prefills, and a full-width Sign in', (tester) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: LoginPage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('login-mark')), findsOneWidget);
    expect(find.text('Vedafit'), findsOneWidget);
    expect(find.byKey(const Key('login-heading')), findsOneWidget);
    expect(find.byType(Image), findsNothing);

    expect(
      tester.widget<TextField>(find.byKey(const Key('phone'))).controller?.text,
      '+919111100001',
    );
    expect(
      tester.widget<TextField>(find.byKey(const Key('password'))).controller?.text,
      'ChangeMe123!',
    );
    expect(
      tester.widget<TextField>(find.byKey(const Key('organization-slug'))).controller?.text,
      'demo-gym',
    );

    final button = tester.getRect(find.byKey(const Key('sign-in')));
    final card = tester.getRect(find.byType(VfCard));
    expect(button.left, closeTo(card.left + 16, 1));
    expect(button.right, closeTo(card.right - 16, 1));
    expect(button.width, greaterThan(280));
  });
}
