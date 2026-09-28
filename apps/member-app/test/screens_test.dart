import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:member_app/api/models.dart';
import 'package:member_app/auth/session.dart';
import 'package:member_app/format.dart';
import 'package:member_app/portal/portal_repository.dart';
import 'package:member_app/router.dart';
import 'package:member_app/theme.dart';
import 'package:member_app/widgets/vf_attendance_strip.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _aliceMember = MemberProfile(
  id: '01m34y06d67bnkrct615ggpjpv',
  firstName: 'Alice',
  lastName: 'Portal',
  phone: '+919111100001',
  status: 'ACTIVE',
  branchId: '01m34xvcm1jg4wkgk8abtqf4v6',
);

const _aliceMembership = MembershipView(
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
);

const _aliceVisit = AttendanceView(
  id: '01m34y06fp9h963e1ghe20e5td',
  memberId: '01m34y06d67bnkrct615ggpjpv',
  attendanceDate: '2026-09-22',
  isOverride: false,
);

const _overrideVisit = AttendanceView(
  id: 'override-1',
  memberId: '01m34y06d67bnkrct615ggpjpv',
  attendanceDate: '2026-09-21',
  isOverride: true,
  overrideReason: 'EXPIRED',
);

final _alicePayment = PaymentView(
  id: '01m34y06f15b75vdg2ttw131re',
  memberId: '01m34y06d67bnkrct615ggpjpv',
  amount: '500.00',
  method: 'UPI',
  status: 'SUCCESS',
  isRefund: false,
  paidAt: DateTime.utc(2026, 9, 22, 16, 8, 22, 243),
);

final _refundPayment = PaymentView(
  id: 'refund-1',
  memberId: '01m34y06d67bnkrct615ggpjpv',
  amount: '200.00',
  method: 'UPI',
  status: 'REFUNDED',
  isRefund: true,
  paidAt: DateTime.utc(2026, 9, 23, 10),
);

class _SeededSession extends SessionController {
  @override
  SessionState build() {
    return const SessionState(
      accessToken: 'test-token',
      ready: true,
      profile: SessionPayload(
        member: _aliceMember,
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

Widget _app({
  List<MembershipView> memberships = const [_aliceMembership],
  List<AttendanceView> attendance = const [_aliceVisit],
  List<PaymentView>? payments,
}) {
  return ProviderScope(
    overrides: [
      sessionProvider.overrideWith(_SeededSession.new),
      homeProvider.overrideWith((ref) async {
        return HomePayload(
          member: _aliceMember,
          organization: const OrgSummary(id: 'o1', name: 'Demo Gym', slug: 'demo-gym'),
          branch: const BranchSummary(id: 'b1', name: 'Main Branch'),
          currentMembership: _aliceMembership,
          outstandingPending: '1500.00',
        );
      }),
      membershipsProvider.overrideWith((ref) async => memberships),
      attendanceProvider.overrideWith((ref) async => attendance),
      paymentsProvider.overrideWith((ref) async => payments ?? [_alicePayment]),
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

Future<void> _openTab(WidgetTester tester, String label) async {
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('formatPaidAt is a calendar date, not an ISO string', () {
    expect(formatPaidAt(DateTime.utc(2026, 9, 22, 16, 8, 22, 243)), '22 Sep 2026');
    expect(formatPaidAt(DateTime.utc(2026, 9, 22, 16, 8, 22, 243)), isNot(contains('T')));
    expect(formatPaidAt(DateTime.utc(2026, 9, 22, 16, 8, 22, 243)), isNot(contains('Z')));
  });

  test('monthForVisits uses the latest visit month', () {
    expect(monthForVisits({'2026-09-22'}), DateTime(2026, 9));
    expect(monthForVisits({'2026-08-01', '2026-09-22'}), DateTime(2026, 9));
  });

  test('initialsFor uses first and last', () {
    expect(initialsFor('Alice', 'Portal'), 'AP');
  });

  testWidgets('membership card matches Alice MySQL / GET /me/memberships', (tester) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();
    await _openTab(tester, 'Membership');

    expect(find.text('P13 Portal Gold'), findsOneWidget);
    expect(find.text('ACTIVE'), findsOneWidget);
    expect(tester.widget<Text>(find.text('ACTIVE')).style?.color, const Color(0xFF3D4D00));
    expect(tester.widget<Text>(find.text('ACTIVE')).style?.color, isNot(Brand.green));
    expect(find.text('2026-09-17 → 2026-10-02'), findsOneWidget);
    expect(find.text('10 day(s) left'), findsOneWidget);
    expect(find.text('₹2000.00'), findsOneWidget);
    expect(find.text('₹111.00'), findsNothing);
  });

  testWidgets('empty memberships still reads No memberships', (tester) async {
    await tester.pumpWidget(_app(memberships: const []));
    await tester.pumpAndSettle();
    await _openTab(tester, 'Membership');
    expect(find.text('No memberships'), findsOneWidget);
    expect(find.byKey(const Key('vf-empty')), findsOneWidget);
  });

  testWidgets('attendance strip dots Alice visit 2026-09-22 and lists Covered visit', (tester) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();
    await _openTab(tester, 'Attendance');

    expect(find.text('September 2026'), findsOneWidget);
    expect(find.byKey(const Key('vf-attendance-strip')), findsOneWidget);
    expect(find.byKey(const Key('attendance-dot-2026-09-22')), findsOneWidget);
    expect(find.byKey(const Key('attendance-dot-2026-09-21')), findsNothing);

    final dot = tester.widget<Container>(find.byKey(const Key('attendance-dot-2026-09-22')));
    expect((dot.decoration as BoxDecoration).color, Brand.green);
    expect(tester.widget<Text>(find.text('22')).style?.color, isNot(Brand.green));

    expect(find.text('2026-09-22'), findsOneWidget);
    expect(find.text('Covered visit'), findsOneWidget);
    expect(find.textContaining('Override'), findsNothing);
  });

  testWidgets('override visit keeps Override · reason', (tester) async {
    await tester.pumpWidget(_app(attendance: const [_overrideVisit]));
    await tester.pumpAndSettle();
    await _openTab(tester, 'Attendance');

    expect(find.text('Override · EXPIRED'), findsOneWidget);
    expect(find.byKey(const Key('attendance-dot-2026-09-21')), findsOneWidget);
    expect(find.byKey(const Key('attendance-dot-2026-09-22')), findsNothing);
  });

  testWidgets('empty attendance still reads No visits', (tester) async {
    await tester.pumpWidget(_app(attendance: const []));
    await tester.pumpAndSettle();
    await _openTab(tester, 'Attendance');
    expect(find.text('No visits'), findsOneWidget);
    expect(find.byKey(const Key('vf-empty')), findsOneWidget);
    expect(find.byKey(const Key('attendance-dot-2026-09-22')), findsNothing);
  });

  testWidgets('payments card matches Alice MySQL / GET /me/payments', (tester) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();
    await _openTab(tester, 'Payments');

    expect(find.byKey(const Key('payment-amount')), findsOneWidget);
    expect(find.text('₹500.00'), findsOneWidget);
    expect(find.text('UPI'), findsOneWidget);
    expect(find.text('SUCCESS'), findsOneWidget);
    expect(tester.widget<Text>(find.text('SUCCESS')).style?.color, const Color(0xFF3D4D00));
    expect(tester.widget<Text>(find.text('SUCCESS')).style?.color, isNot(Brand.green));
    expect(find.text('22 Sep 2026'), findsOneWidget);
    expect(find.textContaining('2026-09-22T'), findsNothing);
    expect(find.text('Refund'), findsNothing);
    expect(find.text('₹111.00'), findsNothing);
    expect(find.text('CASH'), findsNothing);
  });

  testWidgets('refund flag shows on a reversed payment', (tester) async {
    await tester.pumpWidget(_app(payments: [_refundPayment]));
    await tester.pumpAndSettle();
    await _openTab(tester, 'Payments');
    expect(find.text('Refund'), findsOneWidget);
    expect(find.text('₹200.00'), findsOneWidget);
  });

  testWidgets('empty payments still reads No payments', (tester) async {
    await tester.pumpWidget(_app(payments: const []));
    await tester.pumpAndSettle();
    await _openTab(tester, 'Payments');
    expect(find.text('No payments'), findsOneWidget);
    expect(find.byKey(const Key('vf-empty')), findsOneWidget);
  });

  testWidgets('profile matches Alice session / MySQL and keeps Sign out', (tester) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();
    await _openTab(tester, 'Profile');

    expect(find.byKey(const Key('profile-avatar')), findsOneWidget);
    expect(find.text('AP'), findsOneWidget);
    expect(tester.widget<Text>(find.text('AP')).style?.color, isNot(Brand.green));
    expect(find.byKey(const Key('profile-name')), findsOneWidget);
    expect(find.text('Alice Portal'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('profile-phone'))).data,
      '+919111100001',
    );
    expect(tester.widget<Text>(find.byKey(const Key('profile-email'))).data, '—');
    expect(find.text('Demo Gym'), findsOneWidget);
    expect(find.text('Main Branch'), findsOneWidget);
    expect(find.byKey(const Key('theme-toggle')), findsOneWidget);
    expect(find.byKey(const Key('sign-out')), findsOneWidget);
    expect(find.byKey(const Key('change-password-heading')), findsOneWidget);
    expect(find.byKey(const Key('current-password')), findsOneWidget);
    expect(find.byKey(const Key('new-password')), findsOneWidget);
    expect(find.byKey(const Key('confirm-password')), findsOneWidget);
    expect(find.byKey(const Key('change-password')), findsOneWidget);
  });

  testWidgets('change-password form rejects a mismatch without leaving Profile', (tester) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();
    await _openTab(tester, 'Profile');

    await tester.enterText(find.byKey(const Key('current-password')), 'ChangeMe123!');
    await tester.enterText(find.byKey(const Key('new-password')), 'AliceNew9x');
    await tester.enterText(find.byKey(const Key('confirm-password')), 'Different1');
    await tester.ensureVisible(find.byKey(const Key('change-password')));
    await tester.tap(find.byKey(const Key('change-password')));
    await tester.pump();

    expect(find.byKey(const Key('vf-error')), findsOneWidget);
    expect(find.text('New password and confirmation do not match.'), findsOneWidget);
    expect(find.byKey(const Key('sign-out')), findsOneWidget);
    expect(find.byKey(const Key('theme-toggle')), findsOneWidget);
  });
}
