import 'package:flutter/material.dart';

import '../theme.dart';

class VfStatTile extends StatelessWidget {
  const VfStatTile({
    super.key,
    required this.value,
    required this.caption,
  });

  final String value;
  final String caption;

  @override
  Widget build(BuildContext context) {
    final colors = VfColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          value,
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                color: colors.fg,
                fontWeight: FontWeight.w600,
              ),
        ),
        const SizedBox(height: 4),
        Text(
          caption,
          style: TextStyle(color: colors.fgMuted, fontSize: 13),
        ),
      ],
    );
  }
}
