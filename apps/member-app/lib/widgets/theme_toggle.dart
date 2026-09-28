import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../theme.dart';
import '../theme_controller.dart';

class ThemeToggleButton extends ConsumerWidget {
  const ThemeToggleButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(memberThemeProvider);
    final isLight = mode == ThemeMode.light;
    final colors = VfColors.of(context);
    return IconButton(
      key: const Key('theme-toggle'),
      tooltip: isLight ? 'Switch to dark theme' : 'Switch to light theme',
      onPressed: () => ref.read(memberThemeProvider.notifier).toggle(),
      icon: Icon(
        isLight ? Icons.dark_mode_outlined : Icons.light_mode_outlined,
        color: colors.fg,
      ),
    );
  }
}
