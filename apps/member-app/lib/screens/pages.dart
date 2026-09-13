import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/session.dart';
import '../portal/portal_repository.dart';
import '../theme.dart';

class _PageFrame extends StatelessWidget {
  const _PageFrame({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          title,
          key: Key('$title-heading'),
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                color: Brand.white,
                fontWeight: FontWeight.w600,
              ),
        ),
        const SizedBox(height: 16),
        child,
      ],
    );
  }
}

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final home = ref.watch(homeProvider);
    return _PageFrame(
      title: 'Home',
      child: home.when(
        loading: () => const Text('Loading…', style: TextStyle(color: Brand.greenMuted)),
        error: (error, _) => Text('$error', style: const TextStyle(color: Colors.redAccent)),
        data: (data) {
          final membership = data.currentMembership;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Hello ${data.member.firstName} ${data.member.lastName}',
                key: const Key('home-name'),
                style: const TextStyle(color: Brand.white, fontSize: 18),
              ),
              const SizedBox(height: 8),
              Text(
                data.organization.name,
                style: const TextStyle(color: Brand.greenMuted),
              ),
              const SizedBox(height: 16),
              _Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Current membership', style: TextStyle(color: Brand.greenMuted)),
                    const SizedBox(height: 8),
                    if (membership == null)
                      const Text('No live membership', style: TextStyle(color: Brand.white))
                    else ...[
                      Text(
                        '${membership.plan.name} · ${membership.status}',
                        key: const Key('home-membership'),
                        style: const TextStyle(color: Brand.white, fontSize: 16),
                      ),
                      Text(
                        '${membership.daysRemaining} day(s) remaining · ends ${membership.endDate}',
                        key: const Key('home-days'),
                        style: const TextStyle(color: Brand.greenMuted),
                      ),
                    ],
                    const SizedBox(height: 12),
                    Text(
                      'Outstanding ₹${data.outstandingPending}',
                      key: const Key('home-outstanding'),
                      style: const TextStyle(color: Brand.white),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class MembershipPage extends ConsumerWidget {
  const MembershipPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(membershipsProvider);
    return _PageFrame(
      title: 'Membership',
      child: list.when(
        loading: () => const Text('Loading…'),
        error: (error, _) => Text('$error'),
        data: (rows) => Column(
          children: [
            for (final row in rows)
              _Card(
                child: ListTile(
                  title: Text(
                    '${row.plan.name} · ${row.status}',
                    style: const TextStyle(color: Brand.white),
                  ),
                  subtitle: Text(
                    '${row.startDate} → ${row.endDate} · ${row.daysRemaining} day(s) left · ₹${row.priceAtPurchase}',
                    style: const TextStyle(color: Brand.greenMuted),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class AttendancePage extends ConsumerWidget {
  const AttendancePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(attendanceProvider);
    return _PageFrame(
      title: 'Attendance',
      child: list.when(
        loading: () => const Text('Loading…'),
        error: (error, _) => Text('$error'),
        data: (rows) => Column(
          children: [
            for (final row in rows)
              _Card(
                child: ListTile(
                  title: Text(row.attendanceDate, style: const TextStyle(color: Brand.white)),
                  subtitle: Text(
                    row.isOverride ? 'Override · ${row.overrideReason}' : 'Covered visit',
                    style: const TextStyle(color: Brand.greenMuted),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class PaymentsPage extends ConsumerWidget {
  const PaymentsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(paymentsProvider);
    return _PageFrame(
      title: 'Payments',
      child: list.when(
        loading: () => const Text('Loading…'),
        error: (error, _) => Text('$error'),
        data: (rows) => Column(
          children: [
            for (final row in rows)
              _Card(
                child: ListTile(
                  title: Text(
                    '₹${row.amount} · ${row.method}',
                    key: const Key('payment-amount'),
                    style: const TextStyle(color: Brand.white),
                  ),
                  subtitle: Text(
                    '${row.status}${row.isRefund ? ' · refund' : ''} · ${row.paidAt.toIso8601String()}',
                    style: const TextStyle(color: Brand.greenMuted),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).profile;
    if (session == null) {
      return const _PageFrame(title: 'Profile', child: Text('Not signed in'));
    }
    final member = session.member;
    return _PageFrame(
      title: 'Profile',
      child: _Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${member.firstName} ${member.lastName}',
              key: const Key('profile-name'),
              style: const TextStyle(color: Brand.white, fontSize: 18),
            ),
            const SizedBox(height: 8),
            Text(member.phone, key: const Key('profile-phone'), style: const TextStyle(color: Brand.greenMuted)),
            Text(session.organization.name, style: const TextStyle(color: Brand.greenMuted)),
            Text(session.branch.name, style: const TextStyle(color: Brand.greenMuted)),
          ],
        ),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Brand.black88,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Brand.white.withValues(alpha: 0.08)),
      ),
      child: child,
    );
  }
}
