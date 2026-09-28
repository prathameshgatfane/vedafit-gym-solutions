import 'package:flutter/material.dart';

import '../theme.dart';

/// Share of the term still left. Uses API [daysRemaining] over (end − start).
/// No extra field from the server.
double daysBarProgress({
  required String startDate,
  required String endDate,
  required int daysRemaining,
}) {
  final start = DateTime.tryParse(startDate);
  final end = DateTime.tryParse(endDate);
  if (start == null || end == null) {
    return daysRemaining > 0 ? 1 : 0;
  }
  final total = end.difference(start).inDays;
  if (total <= 0) {
    return daysRemaining > 0 ? 1 : 0;
  }
  return (daysRemaining / total).clamp(0.0, 1.0);
}

class VfDaysBar extends StatelessWidget {
  const VfDaysBar({
    super.key,
    required this.startDate,
    required this.endDate,
    required this.daysRemaining,
  });

  final String startDate;
  final String endDate;
  final int daysRemaining;

  @override
  Widget build(BuildContext context) {
    final colors = VfColors.of(context);
    final progress = daysBarProgress(
      startDate: startDate,
      endDate: endDate,
      daysRemaining: daysRemaining,
    );
    return Column(
      key: const Key('vf-days-bar'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            value: progress,
            minHeight: 8,
            color: colors.accent,
            backgroundColor: colors.fg.withValues(alpha: 0.12),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          '$daysRemaining day(s) remaining',
          style: TextStyle(color: colors.fgMuted, fontSize: 12),
        ),
      ],
    );
  }
}
