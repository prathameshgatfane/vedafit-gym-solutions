import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/session.dart';
import '../format.dart';
import '../portal/portal_repository.dart';
import '../theme.dart';
import '../widgets/theme_toggle.dart';
import '../widgets/vf_attendance_strip.dart';
import '../widgets/vf_card.dart';
import '../widgets/vf_days_bar.dart';
import '../widgets/vf_feedback.dart';
import '../widgets/vf_stat_tile.dart';
import '../widgets/vf_status_chip.dart';

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
                color: VfColors.of(context).fg,
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
    final profile = ref.watch(sessionProvider).profile;
    final colors = VfColors.of(context);
    final first = profile?.member.firstName;
    final last = profile?.member.lastName;
    final org = profile?.organization.name;
    final branch = profile?.branch.name;

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
        children: [
          Text(
            first == null ? 'Home' : 'Hello $first $last',
            key: const Key('home-name'),
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  color: colors.fg,
                  fontWeight: FontWeight.w600,
                ),
          ),
          if (org != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                branch == null ? org : '$org · $branch',
                style: TextStyle(color: colors.fgMuted, fontSize: 14),
              ),
            ),
          const SizedBox(height: 20),
          home.when(
            loading: () => const VfLoading(),
            error: (error, _) => VfError(message: '$error'),
            data: (data) {
              final membership = data.currentMembership;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  VfCard(
                    child: membership == null
                        ? const VfEmpty(message: 'No live membership')
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      membership.plan.name,
                                      key: const Key('home-membership'),
                                      style: TextStyle(
                                        color: colors.fg,
                                        fontSize: 18,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                  VfStatusChip(status: membership.status),
                                ],
                              ),
                              const SizedBox(height: 16),
                              VfDaysBar(
                                startDate: membership.startDate,
                                endDate: membership.endDate,
                                daysRemaining: membership.daysRemaining,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Ends ${membership.endDate}',
                                key: const Key('home-days'),
                                style: TextStyle(color: colors.fgMuted, fontSize: 13),
                              ),
                            ],
                          ),
                  ),
                  GestureDetector(
                    key: const Key('home-outstanding'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () => context.go('/payments'),
                    child: VfCard(
                      child: VfStatTile(
                        value: '₹${data.outstandingPending}',
                        caption: 'Outstanding',
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class MembershipPage extends ConsumerWidget {
  const MembershipPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(membershipsProvider);
    final colors = VfColors.of(context);
    return _PageFrame(
      title: 'Membership',
      child: list.when(
        loading: () => const VfLoading(),
        error: (error, _) => VfError(message: '$error'),
        data: (rows) {
          if (rows.isEmpty) return const VfEmpty(message: 'No memberships');
          return Column(
            children: [
              for (final row in rows)
                VfCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              row.plan.name,
                              style: TextStyle(
                                color: colors.fg,
                                fontSize: 18,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          VfStatusChip(status: row.status),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(
                        '${row.startDate} → ${row.endDate}',
                        style: TextStyle(color: colors.fgMuted),
                      ),
                      Text(
                        '${row.daysRemaining} day(s) left',
                        style: TextStyle(color: colors.fgMuted),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '₹${row.priceAtPurchase}',
                        style: TextStyle(
                          color: colors.fg,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
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

class AttendancePage extends ConsumerWidget {
  const AttendancePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(attendanceProvider);
    final colors = VfColors.of(context);
    return _PageFrame(
      title: 'Attendance',
      child: list.when(
        loading: () => const VfLoading(),
        error: (error, _) => VfError(message: '$error'),
        data: (rows) {
          final visits = rows.map((row) => row.attendanceDate).toSet();
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              VfCard(child: VfAttendanceStrip(visitDates: visits)),
              if (rows.isEmpty)
                const VfEmpty(message: 'No visits')
              else
                for (final row in rows)
                  VfCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          row.attendanceDate,
                          style: TextStyle(
                            color: colors.fg,
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          row.isOverride
                              ? 'Override · ${row.overrideReason}'
                              : 'Covered visit',
                          style: TextStyle(color: colors.fgMuted),
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

class PaymentsPage extends ConsumerWidget {
  const PaymentsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(paymentsProvider);
    final colors = VfColors.of(context);
    return _PageFrame(
      title: 'Payments',
      child: list.when(
        loading: () => const VfLoading(),
        error: (error, _) => VfError(message: '$error'),
        data: (rows) {
          if (rows.isEmpty) return const VfEmpty(message: 'No payments');
          return Column(
            children: [
              for (final row in rows)
                VfCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '₹${row.amount}',
                        key: const Key('payment-amount'),
                        style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                              color: colors.fg,
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Text(row.method, style: TextStyle(color: colors.fgMuted)),
                          const SizedBox(width: 8),
                          VfStatusChip(status: row.status),
                        ],
                      ),
                      if (row.isRefund) ...[
                        const SizedBox(height: 6),
                        Text('Refund', style: TextStyle(color: colors.fgMuted)),
                      ],
                      const SizedBox(height: 6),
                      Text(
                        formatPaidAt(row.paidAt),
                        style: TextStyle(color: colors.fgMuted, fontSize: 13),
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

class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).profile;
    if (session == null) {
      return const _PageFrame(title: 'Profile', child: VfEmpty(message: 'Not signed in'));
    }
    final member = session.member;
    final colors = VfColors.of(context);
    return _PageFrame(
      title: 'Profile',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          VfCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      key: const Key('profile-avatar'),
                      radius: 28,
                      backgroundColor: colors.accent,
                      child: Text(
                        initialsFor(member.firstName, member.lastName),
                        style: TextStyle(
                          color: colors.accentFg,
                          fontWeight: FontWeight.w700,
                          fontSize: 18,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        '${member.firstName} ${member.lastName}',
                        key: const Key('profile-name'),
                        style: TextStyle(
                          color: colors.fg,
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const ThemeToggleButton(),
                  ],
                ),
                const SizedBox(height: 16),
                Text(member.phone, key: const Key('profile-phone'), style: TextStyle(color: colors.fgMuted)),
                Text(
                  member.email ?? '—',
                  key: const Key('profile-email'),
                  style: TextStyle(color: colors.fgMuted),
                ),
                Text(session.organization.name, style: TextStyle(color: colors.fgMuted)),
                Text(session.branch.name, style: TextStyle(color: colors.fgMuted)),
                const SizedBox(height: 16),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    key: const Key('sign-out'),
                    onPressed: () => ref.read(sessionProvider.notifier).signOut(),
                    child: const Text('Sign out'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const _ChangePasswordCard(),
        ],
      ),
    );
  }
}

class _ChangePasswordCard extends ConsumerStatefulWidget {
  const _ChangePasswordCard();

  @override
  ConsumerState<_ChangePasswordCard> createState() => _ChangePasswordCardState();
}

class _ChangePasswordCardState extends ConsumerState<_ChangePasswordCard> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  String? _error;
  String? _success;
  bool _busy = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String? _strengthError(String password) {
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (!RegExp(r'[a-z]').hasMatch(password)) {
      return 'Password must contain a lowercase letter';
    }
    if (!RegExp(r'[A-Z]').hasMatch(password)) {
      return 'Password must contain an uppercase letter';
    }
    if (!RegExp(r'[0-9]').hasMatch(password)) {
      return 'Password must contain a number';
    }
    return null;
  }

  Future<void> _submit() async {
    final current = _current.text;
    final next = _next.text;
    final confirm = _confirm.text;
    if (current.isEmpty || next.isEmpty || confirm.isEmpty) {
      setState(() {
        _error = 'Fill in the current, new, and confirm fields.';
        _success = null;
      });
      return;
    }
    if (next != confirm) {
      setState(() {
        _error = 'New password and confirmation do not match.';
        _success = null;
      });
      return;
    }
    final strength = _strengthError(next);
    if (strength != null) {
      setState(() {
        _error = strength;
        _success = null;
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _success = null;
    });
    try {
      await ref.read(sessionProvider.notifier).changePassword(
            currentPassword: current,
            newPassword: next,
          );
      if (!mounted) return;
      _current.clear();
      _next.clear();
      _confirm.clear();
      setState(() => _success = 'Password updated.');
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = VfColors.of(context);
    return VfCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Change password',
            key: const Key('change-password-heading'),
            style: TextStyle(color: colors.fg, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('current-password'),
            controller: _current,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Current password'),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('new-password'),
            controller: _next,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'New password'),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('confirm-password'),
            controller: _confirm,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Confirm new password'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            VfError(message: _error!),
          ],
          if (_success != null) ...[
            const SizedBox(height: 12),
            Text(
              _success!,
              key: const Key('change-password-success'),
              style: TextStyle(color: colors.accentText),
            ),
          ],
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('change-password'),
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? 'Saving…' : 'Update password'),
          ),
        ],
      ),
    );
  }
}
