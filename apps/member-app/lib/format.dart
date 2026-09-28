/// Calendar date from an API timestamp. UTC so a `…T16:08Z` IST evening
/// does not slip a day. Not a raw ISO string.
String formatPaidAt(DateTime paidAt) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  final d = paidAt.toUtc();
  return '${d.day} ${months[d.month - 1]} ${d.year}';
}

String initialsFor(String first, String last) {
  final a = first.trim();
  final b = last.trim();
  final left = a.isEmpty ? '' : a[0];
  final right = b.isEmpty ? '' : b[0];
  return '$left$right'.toUpperCase();
}
