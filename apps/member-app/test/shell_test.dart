import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:member_app/api/models.dart';
import 'package:member_app/auth/session.dart';
import 'package:member_app/router.dart';
import 'package:member_app/theme.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _SeededSession extends SessionController {
  @override
  SessionState build() {
    return const SessionState(
      accessToken: 'test-token',
      ready: true,
      profile: SessionPayload(
        member: MemberProfile(
          id: 'm1',
          firstName: 'Alice',
          lastName: 'Portal',
          phone: '+919111100001',
          status: 'ACTIVE',
          branchId: 'b1',
        ),
        organization: OrgSummary(id: 'o1', name: 'Demo Gym', slug: 'demo-gym'),
        branch: BranchSummary(id: 'b1', name: 'Main Branch'),
      ),
    );
  }

  @override
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {}

  @override
  Future<void> signOut() async {
    state = const SessionState(ready: true);
  }
}

Widget _app() {
  return ProviderScope(
    overrides: [sessionProvider.overrideWith(_SeededSession.new)],
    child: Consumer(
      builder: (context, ref, _) {
        return MaterialApp.router(
          theme: buildMemberLightTheme(),
          darkTheme: buildMemberTheme(),
          themeMode: ThemeMode.dark,
          routerConfig: ref.watch(routerProvider),
        );
      },
    ),
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('375-width shell has a bottom bar and no left rail', (tester) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.byType(NavigationRail), findsNothing);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byKey(const Key('member-nav')), findsOneWidget);

    final navBox = tester.renderObject<RenderBox>(find.byType(NavigationBar));
    expect(navBox.size.width, 375);

    expect(find.byType(NavigationRail), findsNothing);
    expect(find.text('Sign out'), findsNothing);
    expect(find.byKey(const Key('home-name')), findsOneWidget);
  });

  testWidgets('bottom destinations keep the existing go_router paths', (tester) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app());
    await tester.pump();

    Future<void> tapTab(String label, String heading) async {
      await tester.tap(find.text(label).last);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.byKey(Key('$heading-heading')), findsOneWidget);
      expect(find.byType(NavigationRail), findsNothing);
    }

    await tapTab('Membership', 'Membership');
    await tapTab('Attendance', 'Attendance');
    await tapTab('Payments', 'Payments');
    await tapTab('Profile', 'Profile');

    expect(find.byKey(const Key('sign-out')), findsOneWidget);

    await tester.tap(find.text('Home').last);
    await tester.pump();
    expect(find.byKey(const Key('home-name')), findsOneWidget);
  });
}
