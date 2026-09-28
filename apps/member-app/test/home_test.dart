import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:member_app/api/models.dart';
import 'package:member_app/auth/session.dart';
import 'package:member_app/portal/portal_repository.dart';
import 'package:member_app/router.dart';
import 'package:member_app/theme.dart';
import 'package:member_app/widgets/vf_days_bar.dart';
import 'package:member_app/widgets/vf_status_chip.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Alice Portal as of 2026-09-24 — same rows as MySQL + `GET /me`.
const _aliceHome = HomePayload(
  member: MemberProfile(
    id: '01m34y06d67bnkrct615ggpjpv',
    firstName: 'Alice',
    lastName: 'Portal',
    phone: '+919111100001',
    status: 'ACTIVE',
    branchId: '01m34xvcm1jg4wkgk8abtqf4v6',
  ),
  organization: OrgSummary(id: 'o1', name: 'Demo Gym', slug: 'demo-gym'),
  branch: BranchSummary(id: 'b1', name: 'Main Branch'),
  currentMembership: MembershipView(
    id: '01m34y06dzexsqkh2ynfnh2m5z',
    memberId: '01m34y06d67bnkrct615ggpjpv',
    status: 'ACTIVE',
    startDate: '2026-09-17',
    endDate: '2026-10-02',
    priceAtPurchase: '2000.00',
    daysRemaining: 10,
    isUpcoming: false,
    plan: PlanSummary(
      id: '01m34y065q18rqznw5ppjcyrsw',
      name: 'P13 Portal Gold',
      status: 'ACTIVE',
    ),
  ),
  outstandingPending: '1500.00',
);

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
}

Widget _app({HomePayload home = _aliceHome}) {
  return ProviderScope(
    overrides: [
      sessionProvider.overrideWith(_SeededSession.new),
      homeProvider.overrideWith((ref) async => home),
    ],
    child: Consumer(
      builder: (context, ref, _) {
        return MaterialApp.router(
          theme: buildMemberLightTheme(),
          darkTheme: buildMemberTheme(),
          themeMode: ThemeMode.light,
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

  testWidgets('home shows Alice greeting, hero, and MySQL-matched numbers', (tester) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-name')), findsOneWidget);
    expect(find.text('Hello Alice Portal'), findsOneWidget);
    expect(find.text('Demo Gym · Main Branch'), findsOneWidget);

    expect(
      tester.widget<Text>(find.byKey(const Key('home-membership'))).data,
      'P13 Portal Gold',
    );
    expect(find.byType(VfStatusChip), findsOneWidget);
    expect(find.text('ACTIVE'), findsOneWidget);
    expect(
      tester.widget<Text>(find.text('ACTIVE')).style?.color,
      const Color(0xFF3D4D00),
    );
    expect(
      tester.widget<Text>(find.text('ACTIVE')).style?.color,
      isNot(Brand.green),
    );

    expect(find.byType(VfDaysBar), findsOneWidget);
    expect(find.text('10 day(s) remaining'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('home-days'))).data,
      'Ends 2026-10-02',
    );
    expect(find.text('₹1500.00'), findsOneWidget);
    expect(find.byKey(const Key('home-outstanding')), findsOneWidget);
    expect(find.text('No live membership'), findsNothing);
  });

  testWidgets('empty home still reads No live membership', (tester) async {
    await tester.pumpWidget(
      _app(home: _aliceHome.copyWith(currentMembership: null)),
    );
    await tester.pumpAndSettle();

    expect(find.text('No live membership'), findsOneWidget);
    expect(find.byKey(const Key('vf-empty')), findsOneWidget);
    expect(find.byKey(const Key('home-membership')), findsNothing);
    expect(find.text('₹1500.00'), findsOneWidget);
  });

  testWidgets('outstanding tile navigates to Payments', (tester) async {
    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('home-outstanding')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('Payments-heading')), findsOneWidget);
  });
}
