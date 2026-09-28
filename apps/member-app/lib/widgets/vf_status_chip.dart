import 'package:flutter/material.dart';

import '../theme.dart';

/// Same status → color rules as admin-web `StatusBadge`.
/// Lime is fill only: ACTIVE/PAID/SUCCESS use [VfColors.accentText], not [Brand.green].
enum VfChipTone { accent, muted, warning, danger }

VfChipTone toneForStatus(String status) {
  switch (status) {
    case 'ACTIVE':
    case 'PAID':
    case 'SUCCESS':
    case 'CONVERTED':
    case 'SENT':
    case 'TRIAL_SCHEDULED':
      return VfChipTone.accent;
    case 'FROZEN':
    case 'CONTACTED':
      return VfChipTone.accent;
    case 'UNPAID':
    case 'PARTIALLY_PAID':
    case 'PENDING':
    case 'NEW':
    case 'QUEUED':
      return VfChipTone.warning;
    case 'FAILED':
      return VfChipTone.danger;
    default:
      return VfChipTone.muted;
  }
}

String labelForStatus(String status) {
  switch (status) {
    case 'PARTIALLY_PAID':
      return 'PART PAID';
    case 'TRIAL_SCHEDULED':
      return 'TRIAL';
    default:
      return status;
  }
}

class VfStatusChip extends StatelessWidget {
  const VfStatusChip({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final colors = VfColors.of(context);
    final tone = toneForStatus(status);
    final Color fg;
    final Color bg;
    final Color border;
    switch (tone) {
      case VfChipTone.accent:
        fg = colors.accentText;
        bg = colors.accent.withValues(alpha: 0.15);
        border = colors.accent.withValues(alpha: 0.40);
      case VfChipTone.warning:
        fg = colors.warning;
        bg = colors.warning.withValues(alpha: 0.10);
        border = colors.warning.withValues(alpha: 0.40);
      case VfChipTone.danger:
        fg = colors.danger;
        bg = colors.danger.withValues(alpha: 0.10);
        border = colors.danger.withValues(alpha: 0.40);
      case VfChipTone.muted:
        fg = colors.fgMuted;
        bg = colors.fg.withValues(alpha: 0.08);
        border = colors.fg.withValues(alpha: 0.20);
    }

    return Container(
      key: const Key('vf-status-chip'),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Text(
        labelForStatus(status),
        style: TextStyle(
          color: fg,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
