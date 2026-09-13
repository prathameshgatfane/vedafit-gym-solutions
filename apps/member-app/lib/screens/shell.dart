import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/session.dart';
import '../theme.dart';

class MemberShell extends ConsumerWidget {
  const MemberShell({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = GoRouterState.of(context).uri.path;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Vedafit'),
        actions: [
          TextButton(
            onPressed: () => ref.read(sessionProvider.notifier).signOut(),
            child: const Text('Sign out', style: TextStyle(color: Brand.green)),
          ),
        ],
      ),
      body: Row(
        children: [
          NavigationRail(
            backgroundColor: Brand.black88,
            selectedIndex: _indexFor(location),
            onDestinationSelected: (index) {
              switch (index) {
                case 0:
                  context.go('/');
                case 1:
                  context.go('/membership');
                case 2:
                  context.go('/attendance');
                case 3:
                  context.go('/payments');
                case 4:
                  context.go('/profile');
              }
            },
            labelType: NavigationRailLabelType.all,
            destinations: const [
              NavigationRailDestination(
                icon: Icon(Icons.home_outlined),
                label: Text('Home'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.card_membership_outlined),
                label: Text('Membership'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.event_available_outlined),
                label: Text('Attendance'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.payments_outlined),
                label: Text('Payments'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.person_outline),
                label: Text('Profile'),
              ),
            ],
          ),
          Expanded(child: child),
        ],
      ),
    );
  }

  int _indexFor(String path) {
    if (path.startsWith('/membership')) return 1;
    if (path.startsWith('/attendance')) return 2;
    if (path.startsWith('/payments')) return 3;
    if (path.startsWith('/profile')) return 4;
    return 0;
  }
}
