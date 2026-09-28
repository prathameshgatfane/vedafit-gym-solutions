import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme.dart';

class MemberShell extends StatelessWidget {
  const MemberShell({super.key, required this.child});

  final Widget child;

  static const destinations = <({String path, String label, IconData icon})>[
    (path: '/', label: 'Home', icon: Icons.home_outlined),
    (path: '/membership', label: 'Membership', icon: Icons.card_membership_outlined),
    (path: '/attendance', label: 'Attendance', icon: Icons.event_available_outlined),
    (path: '/payments', label: 'Payments', icon: Icons.payments_outlined),
    (path: '/profile', label: 'Profile', icon: Icons.person_outline),
  ];

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    final colors = VfColors.of(context);
    final index = indexFor(location);

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: index == 0
          ? null
          : AppBar(
              title: Text(destinations[index].label),
            ),
      body: child,
      bottomNavigationBar: NavigationBar(
        key: const Key('member-nav'),
        selectedIndex: index,
        onDestinationSelected: (next) => context.go(destinations[next].path),
        destinations: [
          for (final item in destinations)
            NavigationDestination(
              icon: Icon(item.icon),
              label: item.label,
            ),
        ],
      ),
    );
  }

  static int indexFor(String path) {
    if (path.startsWith('/membership')) return 1;
    if (path.startsWith('/attendance')) return 2;
    if (path.startsWith('/payments')) return 3;
    if (path.startsWith('/profile')) return 4;
    return 0;
  }
}
