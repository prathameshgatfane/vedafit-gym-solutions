import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import '../api/models.dart';

const _refreshKey = 'member_refresh_token';

/// Access token lives only here. Refresh token lives in [FlutterSecureStorage] (1.23.4).
class SessionState {
  const SessionState({
    this.accessToken,
    this.profile,
    this.ready = false,
  });

  final String? accessToken;
  final SessionPayload? profile;
  final bool ready;

  bool get isSignedIn => accessToken != null && profile != null;

  SessionState copyWith({
    String? accessToken,
    SessionPayload? profile,
    bool? ready,
    bool clear = false,
  }) {
    if (clear) {
      return SessionState(ready: ready ?? this.ready);
    }
    return SessionState(
      accessToken: accessToken ?? this.accessToken,
      profile: profile ?? this.profile,
      ready: ready ?? this.ready,
    );
  }
}

class SessionController extends Notifier<SessionState> {
  late final FlutterSecureStorage _storage;
  late final ApiClient client;
  Future<String>? _inFlightRefresh;

  @override
  SessionState build() {
    _storage = const FlutterSecureStorage(
      aOptions: AndroidOptions(storageNamespace: 'vedafit_member'),
      webOptions: WebOptions(
        dbName: 'vedafit_member',
        publicKey: 'vedafit_member',
      ),
    );
    client = ApiClient(
      readAccessToken: () => state.accessToken,
      writeAccessToken: (token) {
        state = state.copyWith(accessToken: token);
      },
      refresh: refreshAccessToken,
      signOut: signOut,
    );
    Future.microtask(restore);
    return const SessionState();
  }

  Future<void> restore() async {
    try {
      // Web Crypto / IndexedDB can hang in headless Chrome. Do not block
      // the splash — a timeout here is "not signed in", not a crash.
      final stored = await _storage
          .read(key: _refreshKey)
          .timeout(const Duration(seconds: 3));
      if (stored == null) {
        state = const SessionState(ready: true);
        return;
      }
      await refreshAccessToken(stored);
      await loadProfile();
    } catch (_) {
      await _storage.delete(key: _refreshKey).timeout(
            const Duration(seconds: 1),
            onTimeout: () {},
          );
      state = const SessionState(ready: true);
    }
  }

  Future<void> signIn({
    required String phone,
    required String password,
    required String organizationSlug,
  }) async {
    final response = await client.post(
      '/auth/member/login',
      data: {
        'phone': phone.trim(),
        'password': password,
        'organizationSlug': organizationSlug.trim(),
      },
    );
    if (response.statusCode != 200 || response.data == null) {
      throw apiErrorMessage(response, 'Could not sign in.');
    }
    final payload = LoginPayload.fromJson(
      response.data!['data'] as Map<String, dynamic>,
    );
    await _storage.write(key: _refreshKey, value: payload.refreshToken);
    state = SessionState(
      accessToken: payload.accessToken,
      profile: SessionPayload(
        member: payload.member,
        organization: payload.organization,
        branch: payload.branch,
      ),
      ready: true,
    );
  }

  Future<String> refreshAccessToken([String? raw]) async {
    final existing = _inFlightRefresh;
    if (existing != null) return existing;

    final future = () async {
      final token = raw ?? await _storage.read(key: _refreshKey);
      if (token == null) {
        throw StateError('No refresh token');
      }
      final bare = ApiClient(
        readAccessToken: () => null,
        writeAccessToken: (_) {},
        refresh: () async => throw StateError('nested'),
        signOut: () async {},
      );
      final response = await bare.post(
        '/auth/member/refresh',
        data: {'refreshToken': token},
      );
      if (response.statusCode != 200 || response.data == null) {
        throw apiErrorMessage(response, 'Session expired.');
      }
      final payload = RefreshPayload.fromJson(
        response.data!['data'] as Map<String, dynamic>,
      );
      await _storage.write(key: _refreshKey, value: payload.refreshToken);
      state = state.copyWith(accessToken: payload.accessToken, ready: true);
      return payload.accessToken;
    }();

    _inFlightRefresh = future;
    try {
      return await future;
    } finally {
      _inFlightRefresh = null;
    }
  }

  Future<void> loadProfile() async {
    final response = await client.get('/auth/member/me');
    if (response.statusCode != 200 || response.data == null) {
      throw apiErrorMessage(response, 'Could not load profile.');
    }
    state = state.copyWith(
      profile: SessionPayload.fromJson(
        response.data!['data'] as Map<String, dynamic>,
      ),
      ready: true,
    );
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final response = await client.post(
      '/auth/member/change-password',
      data: {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      },
    );
    if (response.statusCode != 200 || response.data == null) {
      throw apiErrorMessage(response, 'Could not change password.');
    }
    final payload = RefreshPayload.fromJson(
      response.data!['data'] as Map<String, dynamic>,
    );
    await _storage.write(key: _refreshKey, value: payload.refreshToken);
    state = state.copyWith(accessToken: payload.accessToken);
  }

  Future<void> signOut() async {
    final token = await _storage.read(key: _refreshKey);
    try {
      await client.post('/auth/member/logout', data: {'refreshToken': token});
    } catch (_) {}
    await _storage.delete(key: _refreshKey);
    state = const SessionState(ready: true);
  }
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(
  SessionController.new,
);
