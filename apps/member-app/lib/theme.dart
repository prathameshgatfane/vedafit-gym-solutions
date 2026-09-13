import 'package:flutter/material.dart';

/// Locked Decision 1.14 — same named palette as admin-web. Never hardcode hex in screens.
abstract final class Brand {
  static const black = Color(0xFF000000);
  static const black88 = Color(0xFF1F1F1F);
  static const green = Color(0xFFC9FF1F);
  static const greenMuted = Color(0xFFE9FFA5);
  static const white = Color(0xFFFEF9F5);
}

ThemeData buildMemberTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: Brand.black,
    colorScheme: const ColorScheme.dark(
      primary: Brand.green,
      onPrimary: Brand.black,
      surface: Brand.black88,
      onSurface: Brand.white,
    ),
  );
  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: Brand.black88,
      foregroundColor: Brand.white,
      elevation: 0,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Brand.black88,
      labelStyle: const TextStyle(color: Brand.greenMuted),
      enabledBorder: OutlineInputBorder(
        borderSide: BorderSide(color: Brand.white.withValues(alpha: 0.2)),
      ),
      focusedBorder: const OutlineInputBorder(
        borderSide: BorderSide(color: Brand.green),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Brand.green,
        foregroundColor: Brand.black,
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
      ),
    ),
  );
}
