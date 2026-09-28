import 'package:dio/dio.dart';

import 'env.dart';

typedef TokenReader = String? Function();
typedef TokenWriter = void Function(String token);
typedef RefreshFn = Future<String> Function();
typedef SignOutFn = Future<void> Function();

/// Dio wrapper. Access token is attached from memory; 401s single-flight a refresh (1.23.4).
class ApiClient {
  ApiClient({
    required TokenReader readAccessToken,
    required TokenWriter writeAccessToken,
    required RefreshFn refresh,
    required SignOutFn signOut,
  }) : _refresh = refresh,
       _signOut = signOut {
    _dio = Dio(
      BaseOptions(
        baseUrl: resolveApiUrl(),
        headers: {'Content-Type': 'application/json'},
        validateStatus: (status) => status != null && status < 500,
      ),
    );
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final token = readAccessToken();
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onResponse: (response, handler) async {
          if (response.statusCode != 401) {
            handler.next(response);
            return;
          }
          final path = response.requestOptions.path;
          if (path.contains('/auth/member/login') ||
              path.contains('/auth/member/refresh') ||
              path.contains('/auth/member/logout') ||
              path.contains('/auth/member/change-password')) {
            handler.next(response);
            return;
          }
          final extra = response.requestOptions.extra;
          if (extra['retried'] == true) {
            await _signOut();
            handler.next(response);
            return;
          }
          try {
            final next = await _refresh();
            writeAccessToken(next);
            final retry = response.requestOptions;
            retry.headers['Authorization'] = 'Bearer $next';
            retry.extra['retried'] = true;
            final replayed = await _dio.fetch(retry);
            handler.resolve(replayed);
          } catch (_) {
            await _signOut();
            handler.next(response);
          }
        },
      ),
    );
  }

  late final Dio _dio;
  final RefreshFn _refresh;
  final SignOutFn _signOut;

  Future<Response<Map<String, dynamic>>> get(String path) {
    return _dio.get<Map<String, dynamic>>(path);
  }

  Future<Response<Map<String, dynamic>>> post(
    String path, {
    Map<String, dynamic>? data,
  }) {
    return _dio.post<Map<String, dynamic>>(path, data: data);
  }
}

String apiErrorMessage(Response<Map<String, dynamic>> response, String fallback) {
  final error = response.data?['error'];
  if (error is Map && error['message'] is String) {
    return error['message'] as String;
  }
  return fallback;
}
