import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/session.dart';
import '../theme.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _phone = TextEditingController(text: '+919111100001');
  // Seeded Alice Portal (phase13-fixtures). Empty here would make Chrome/e2e
  // "fill the HTML overlay" a no-op — CanvasKit does not read those inputs.
  final _password = TextEditingController(text: 'ChangeMe123!');
  final _slug = TextEditingController(text: 'demo-gym');
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    _slug.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).signIn(
            phone: _phone.text,
            password: _password.text,
            organizationSlug: _slug.text,
          );
      if (mounted) context.go('/');
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Member portal',
                  key: const Key('login-heading'),
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        color: Brand.white,
                        fontWeight: FontWeight.w600,
                      ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Sign in with the phone number on your membership.',
                  style: TextStyle(color: Brand.greenMuted),
                ),
                const SizedBox(height: 24),
                // Flutter web's a11y tree mounts its own <input>s. Those do
                // not write the Dart controllers (and an empty overlay can
                // wipe a prefilled password). Real typing still hits CanvasKit.
                ExcludeSemantics(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(
                        key: const Key('phone'),
                        controller: _phone,
                        keyboardType: TextInputType.phone,
                        autofillHints: const [AutofillHints.telephoneNumber],
                        decoration: const InputDecoration(labelText: 'Phone'),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        key: const Key('password'),
                        controller: _password,
                        obscureText: true,
                        autofillHints: const [AutofillHints.password],
                        decoration: const InputDecoration(labelText: 'Password'),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        key: const Key('organization-slug'),
                        controller: _slug,
                        decoration: const InputDecoration(labelText: 'Gym slug'),
                      ),
                    ],
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  key: const Key('sign-in'),
                  onPressed: _busy ? null : _submit,
                  child: Text(_busy ? 'Signing in…' : 'Sign in'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
