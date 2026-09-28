import 'package:flutter/material.dart';

/// Locked Decision 1.14 + Section 11. Named hex only lives here — screens use [VfColors].
abstract final class Brand {
  static const black = Color(0xFF000000);
  static const black88 = Color(0xFF1F1F1F);
  static const green = Color(0xFFC9FF1F);
  static const greenMuted = Color(0xFFE9FFA5);
  static const white = Color(0xFFFEF9F5);
  /// Slice 0 muted-on-dark. Solid, not [white] at 40% alpha.
  static const whiteMuted = Color(0xFFC9C4BF);
  static const fgLight = Color(0xFF141414);
  static const fgMutedLight = Color(0xFF5C5854);
  static const accentTextLight = Color(0xFF3D4D00);
  static const dangerLight = Color(0xFF9B1C1C);
  static const warningLight = Color(0xFF92400E);
  static const dangerDark = Color(0xFFFCA5A5);
  static const warningDark = Color(0xFFFCD34D);
}

/// Semantic colors for the active brightness. Lime ([Brand.green]) is fill-only
/// in light — never body / heading / link / metric text.
@immutable
class VfColors extends ThemeExtension<VfColors> {
  const VfColors({
    required this.bg,
    required this.surface,
    required this.fg,
    required this.fgMuted,
    required this.accent,
    required this.accentFg,
    required this.accentText,
    required this.danger,
    required this.warning,
    required this.border,
  });

  final Color bg;
  final Color surface;
  final Color fg;
  final Color fgMuted;
  final Color accent;
  final Color accentFg;
  final Color accentText;
  final Color danger;
  final Color warning;
  final Color border;

  static const dark = VfColors(
    bg: Brand.black,
    surface: Brand.black88,
    fg: Brand.white,
    fgMuted: Brand.whiteMuted,
    accent: Brand.green,
    accentFg: Brand.black,
    accentText: Brand.green,
    danger: Brand.dangerDark,
    warning: Brand.warningDark,
    border: Color(0x1FFEF9F5),
  );

  static const light = VfColors(
    bg: Brand.white,
    surface: Color(0xFFFFFFFF),
    fg: Brand.fgLight,
    fgMuted: Brand.fgMutedLight,
    accent: Brand.green,
    accentFg: Brand.black,
    accentText: Brand.accentTextLight,
    danger: Brand.dangerLight,
    warning: Brand.warningLight,
    border: Color(0x1F141414),
  );

  static VfColors of(BuildContext context) {
    return Theme.of(context).extension<VfColors>() ?? dark;
  }

  @override
  VfColors copyWith({
    Color? bg,
    Color? surface,
    Color? fg,
    Color? fgMuted,
    Color? accent,
    Color? accentFg,
    Color? accentText,
    Color? danger,
    Color? warning,
    Color? border,
  }) {
    return VfColors(
      bg: bg ?? this.bg,
      surface: surface ?? this.surface,
      fg: fg ?? this.fg,
      fgMuted: fgMuted ?? this.fgMuted,
      accent: accent ?? this.accent,
      accentFg: accentFg ?? this.accentFg,
      accentText: accentText ?? this.accentText,
      danger: danger ?? this.danger,
      warning: warning ?? this.warning,
      border: border ?? this.border,
    );
  }

  @override
  VfColors lerp(ThemeExtension<VfColors>? other, double t) {
    if (other is! VfColors) return this;
    return VfColors(
      bg: Color.lerp(bg, other.bg, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      fg: Color.lerp(fg, other.fg, t)!,
      fgMuted: Color.lerp(fgMuted, other.fgMuted, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentFg: Color.lerp(accentFg, other.accentFg, t)!,
      accentText: Color.lerp(accentText, other.accentText, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      border: Color.lerp(border, other.border, t)!,
    );
  }
}

ThemeData buildMemberTheme() => _build(Brightness.dark, VfColors.dark);

ThemeData buildMemberLightTheme() => _build(Brightness.light, VfColors.light);

ThemeData _build(Brightness brightness, VfColors colors) {
  final isDark = brightness == Brightness.dark;
  final base = ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: colors.bg,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: colors.accent,
      onPrimary: colors.accentFg,
      secondary: colors.accent,
      onSecondary: colors.accentFg,
      error: colors.danger,
      onError: isDark ? Brand.black : Brand.white,
      surface: colors.surface,
      onSurface: colors.fg,
    ),
    extensions: <ThemeExtension<dynamic>>[colors],
  );
  return base.copyWith(
    appBarTheme: AppBarTheme(
      backgroundColor: colors.surface,
      foregroundColor: colors.fg,
      elevation: 0,
    ),
    iconTheme: IconThemeData(color: colors.fg),
    textTheme: base.textTheme.apply(
      bodyColor: colors.fg,
      displayColor: colors.fg,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.surface,
      labelStyle: TextStyle(color: colors.fgMuted),
      enabledBorder: OutlineInputBorder(
        borderSide: BorderSide(color: colors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderSide: BorderSide(color: colors.accent),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: colors.accent,
        foregroundColor: colors.accentFg,
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: colors.accentText),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: colors.surface,
      indicatorColor: colors.accent.withValues(alpha: 0.22),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(color: selected ? colors.accentText : colors.fgMuted);
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          color: selected ? colors.accentText : colors.fgMuted,
          fontSize: 12,
          fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
        );
      }),
    ),
  );
}
