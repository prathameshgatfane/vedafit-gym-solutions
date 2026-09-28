import 'package:flutter/material.dart';

import '../theme.dart';

class VfLoading extends StatelessWidget {
  const VfLoading({super.key, this.label = 'Loading…'});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = VfColors.of(context);
    return Row(
      key: const Key('vf-loading'),
      children: [
        SizedBox(
          width: 18,
          height: 18,
          child: CircularProgressIndicator(strokeWidth: 2, color: colors.accentText),
        ),
        const SizedBox(width: 10),
        Text(label, style: TextStyle(color: colors.fgMuted)),
      ],
    );
  }
}

class VfEmpty extends StatelessWidget {
  const VfEmpty({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Text(
      message,
      key: const Key('vf-empty'),
      style: TextStyle(color: VfColors.of(context).fgMuted),
    );
  }
}

class VfError extends StatelessWidget {
  const VfError({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Text(
      message,
      key: const Key('vf-error'),
      style: TextStyle(color: VfColors.of(context).danger),
    );
  }
}
