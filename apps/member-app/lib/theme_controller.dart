import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Sibling of `vedafit.admin.theme` / `vedafit.platform.theme`. Own origin, own key.
const memberThemeStorageKey = 'vedafit.member.theme';

class MemberThemeController extends Notifier<ThemeMode> {
  bool _userSet = false;

  @override
  ThemeMode build() {
    Future.microtask(_hydrate);
    return ThemeMode.dark;
  }

  Future<void> _hydrate() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (_userSet) return;
      final raw = prefs.getString(memberThemeStorageKey);
      if (raw == 'light') {
        state = ThemeMode.light;
      } else if (raw == 'dark') {
        state = ThemeMode.dark;
      }
    } catch (_) {
      // Missing plugin / private mode: stay on the dark default.
    }
  }

  Future<void> toggle() async {
    _userSet = true;
    final next = state == ThemeMode.light ? ThemeMode.dark : ThemeMode.light;
    state = next;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        memberThemeStorageKey,
        next == ThemeMode.light ? 'light' : 'dark',
      );
    } catch (_) {
      // Preference still applies for this process.
    }
  }
}

final memberThemeProvider = NotifierProvider<MemberThemeController, ThemeMode>(
  MemberThemeController.new,
);
