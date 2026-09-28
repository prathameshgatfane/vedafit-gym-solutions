import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/env.dart';
import 'auth/session.dart';
import 'router.dart';
import 'theme.dart';
import 'theme_controller.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  assertApiUrlConfigured();
  // CanvasKit has no HTML inputs. The semantics tree is what Chrome (and the
  // Phase 13 harness) can read and click — without this, document.body is empty.
  SemanticsBinding.instance.ensureSemantics();
  runApp(const ProviderScope(child: MemberApp()));
}

class MemberApp extends ConsumerWidget {
  const MemberApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final router = ref.watch(routerProvider);
    final themeMode = ref.watch(memberThemeProvider);
    return MaterialApp.router(
      title: 'Vedafit Member',
      theme: buildMemberLightTheme(),
      darkTheme: buildMemberTheme(),
      themeMode: themeMode,
      routerConfig: router,
      builder: (context, child) {
        if (!session.ready) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return child ?? const SizedBox.shrink();
      },
    );
  }
}
