import 'package:flutter/material.dart';

import '../theme.dart';

const _monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const _weekdayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/// Month shown by the strip: latest visit's month, or [fallback] when empty.
DateTime monthForVisits(Iterable<String> visitDates, {DateTime? fallback}) {
  DateTime? latest;
  for (final raw in visitDates) {
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) continue;
    final day = DateTime(parsed.year, parsed.month, parsed.day);
    if (latest == null || day.isAfter(latest)) latest = day;
  }
  final base = latest ?? fallback ?? DateTime.now();
  return DateTime(base.year, base.month);
}

class VfAttendanceStrip extends StatelessWidget {
  const VfAttendanceStrip({
    super.key,
    required this.visitDates,
    this.month,
  });

  /// Calendar dates (`yyyy-MM-dd`) that have a visit.
  final Set<String> visitDates;
  final DateTime? month;

  @override
  Widget build(BuildContext context) {
    final colors = VfColors.of(context);
    final shown = month ?? monthForVisits(visitDates);
    final first = DateTime(shown.year, shown.month, 1);
    final daysInMonth = DateTime(shown.year, shown.month + 1, 0).day;
    final leading = first.weekday - 1;

    return Column(
      key: const Key('vf-attendance-strip'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${_monthNames[shown.month - 1]} ${shown.year}',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: colors.fg,
                fontWeight: FontWeight.w600,
              ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            for (final label in _weekdayLabels)
              Expanded(
                child: Text(
                  label,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: colors.fgMuted, fontSize: 11),
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        for (var row = 0; row < ((leading + daysInMonth + 6) ~/ 7); row++)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                for (var col = 0; col < 7; col++)
                  Expanded(
                    child: _DayCell(
                      day: _dayAt(row, col, leading, daysInMonth),
                      year: shown.year,
                      month: shown.month,
                      visitDates: visitDates,
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  static int? _dayAt(int row, int col, int leading, int daysInMonth) {
    final index = row * 7 + col - leading + 1;
    if (index < 1 || index > daysInMonth) return null;
    return index;
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.day,
    required this.year,
    required this.month,
    required this.visitDates,
  });

  final int? day;
  final int year;
  final int month;
  final Set<String> visitDates;

  @override
  Widget build(BuildContext context) {
    final colors = VfColors.of(context);
    if (day == null) return const SizedBox(height: 36);
    final date =
        '${year.toString().padLeft(4, '0')}-${month.toString().padLeft(2, '0')}-${day.toString().padLeft(2, '0')}';
    final hasVisit = visitDates.contains(date);
    return SizedBox(
      height: 36,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            '$day',
            style: TextStyle(
              color: colors.fg,
              fontSize: 13,
              fontWeight: hasVisit ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
          const SizedBox(height: 3),
          if (hasVisit)
            Container(
              key: Key('attendance-dot-$date'),
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: colors.accent,
                shape: BoxShape.circle,
              ),
            )
          else
            const SizedBox(height: 6),
        ],
      ),
    );
  }
}
