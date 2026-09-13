import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:member_app/screens/login_page.dart';

void main() {
  testWidgets('login screen shows the portal heading', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: LoginPage()),
      ),
    );
    expect(find.text('Member portal'), findsOneWidget);
    expect(find.byKey(const Key('sign-in')), findsOneWidget);
  });
}
