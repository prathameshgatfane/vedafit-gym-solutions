import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:member_app/theme.dart';
import 'package:member_app/widgets/vf_card.dart';
import 'package:member_app/widgets/vf_days_bar.dart';
import 'package:member_app/widgets/vf_feedback.dart';
import 'package:member_app/widgets/vf_stat_tile.dart';
import 'package:member_app/widgets/vf_status_chip.dart';

Widget _light(Widget child) {
  return MaterialApp(
    theme: buildMemberLightTheme(),
    home: Scaffold(body: child),
  );
}

Widget _dark(Widget child) {
  return MaterialApp(
    theme: buildMemberTheme(),
    home: Scaffold(body: child),
  );
}

void main() {
  test('daysBarProgress uses daysRemaining over the start→end span', () {
    expect(
      daysBarProgress(
        startDate: '2026-09-01',
        endDate: '2026-09-11',
        daysRemaining: 5,
      ),
      0.5,
    );
    expect(
      daysBarProgress(
        startDate: 'bad',
        endDate: 'also-bad',
        daysRemaining: 0,
      ),
      0,
    );
  });

  test('toneForStatus matches admin StatusBadge families', () {
    expect(toneForStatus('ACTIVE'), VfChipTone.accent);
    expect(toneForStatus('SUCCESS'), VfChipTone.accent);
    expect(toneForStatus('PAID'), VfChipTone.accent);
    expect(toneForStatus('UNPAID'), VfChipTone.warning);
    expect(toneForStatus('PENDING'), VfChipTone.warning);
    expect(toneForStatus('FAILED'), VfChipTone.danger);
    expect(toneForStatus('EXPIRED'), VfChipTone.muted);
    expect(toneForStatus('CANCELLED'), VfChipTone.muted);
    expect(toneForStatus('REFUNDED'), VfChipTone.muted);
    expect(labelForStatus('PARTIALLY_PAID'), 'PART PAID');
  });

  testWidgets('light ACTIVE chip uses accent-text, not lime', (tester) async {
    await tester.pumpWidget(_light(const VfStatusChip(status: 'ACTIVE')));

    final text = tester.widget<Text>(find.text('ACTIVE'));
    expect(text.style?.color, const Color(0xFF3D4D00));
    expect(text.style?.color, isNot(Brand.green));
  });

  testWidgets('FAILED chip uses the danger token', (tester) async {
    await tester.pumpWidget(_light(const VfStatusChip(status: 'FAILED')));

    expect(
      tester.widget<Text>(find.text('FAILED')).style?.color,
      VfColors.light.danger,
    );
  });

  testWidgets('VfCard uses the surface token', (tester) async {
    await tester.pumpWidget(
      _dark(const VfCard(child: Text('inside'))),
    );

    final box = tester.widget<Container>(
      find.ancestor(of: find.text('inside'), matching: find.byType(Container)).first,
    );
    final decoration = box.decoration as BoxDecoration;
    expect(decoration.color, VfColors.dark.surface);
    expect(decoration.borderRadius, BorderRadius.circular(20));
  });

  testWidgets('VfStatTile paints value as fg and caption as muted', (tester) async {
    await tester.pumpWidget(
      _light(const VfStatTile(value: '₹1500.00', caption: 'Outstanding')),
    );

    expect(
      tester.widget<Text>(find.text('₹1500.00')).style?.color,
      VfColors.light.fg,
    );
    expect(
      tester.widget<Text>(find.text('Outstanding')).style?.color,
      VfColors.light.fgMuted,
    );
    expect(
      tester.widget<Text>(find.text('₹1500.00')).style?.color,
      isNot(Brand.green),
    );
  });

  testWidgets('VfDaysBar label is muted; fill is lime', (tester) async {
    await tester.pumpWidget(
      _light(
        const VfDaysBar(
          startDate: '2026-09-01',
          endDate: '2026-09-11',
          daysRemaining: 5,
        ),
      ),
    );

    expect(find.byKey(const Key('vf-days-bar')), findsOneWidget);
    expect(
      tester.widget<Text>(find.text('5 day(s) remaining')).style?.color,
      VfColors.light.fgMuted,
    );
    final bar = tester.widget<LinearProgressIndicator>(find.byType(LinearProgressIndicator));
    expect(bar.value, 0.5);
    expect(bar.color, Brand.green);
  });

  testWidgets('empty / error / loading use tokens, not redAccent', (tester) async {
    await tester.pumpWidget(
      _light(
        const Column(
          children: [
            VfEmpty(message: 'No visits'),
            VfError(message: 'Could not load'),
            VfLoading(),
          ],
        ),
      ),
    );

    expect(find.byKey(const Key('vf-empty')), findsOneWidget);
    expect(find.byKey(const Key('vf-error')), findsOneWidget);
    expect(find.byKey(const Key('vf-loading')), findsOneWidget);
    expect(
      tester.widget<Text>(find.text('No visits')).style?.color,
      VfColors.light.fgMuted,
    );
    expect(
      tester.widget<Text>(find.text('Could not load')).style?.color,
      VfColors.light.danger,
    );
    expect(
      tester.widget<Text>(find.text('Could not load')).style?.color,
      isNot(Colors.redAccent),
    );
  });
}
