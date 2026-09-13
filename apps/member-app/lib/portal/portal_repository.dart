import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/session.dart';

class PortalRepository {
  PortalRepository(this._client);

  final ApiClient _client;

  Future<HomePayload> home() async {
    final response = await _client.get('/me');
    if (response.statusCode != 200 || response.data == null) {
      throw apiErrorMessage(response, 'Could not load home.');
    }
    return HomePayload.fromJson(response.data!['data'] as Map<String, dynamic>);
  }

  Future<List<MembershipView>> memberships() async {
    final response = await _client.get('/me/memberships');
    if (response.statusCode != 200 || response.data == null) {
      throw apiErrorMessage(response, 'Could not load memberships.');
    }
    final data = response.data!['data'] as List<dynamic>;
    return data
        .map((row) => MembershipView.fromJson(row as Map<String, dynamic>))
        .toList();
  }

  Future<List<AttendanceView>> attendance() async {
    final response = await _client.get('/me/attendance');
    if (response.statusCode != 200 || response.data == null) {
      throw apiErrorMessage(response, 'Could not load attendance.');
    }
    final data = response.data!['data'] as List<dynamic>;
    return data
        .map((row) => AttendanceView.fromJson(row as Map<String, dynamic>))
        .toList();
  }

  Future<List<PaymentView>> payments() async {
    final response = await _client.get('/me/payments');
    if (response.statusCode != 200 || response.data == null) {
      throw apiErrorMessage(response, 'Could not load payments.');
    }
    final data = response.data!['data'] as List<dynamic>;
    return data
        .map((row) => PaymentView.fromJson(row as Map<String, dynamic>))
        .toList();
  }
}

final portalRepositoryProvider = Provider<PortalRepository>((ref) {
  return PortalRepository(ref.read(sessionProvider.notifier).client);
});

final homeProvider = FutureProvider<HomePayload>((ref) {
  return ref.watch(portalRepositoryProvider).home();
});

final membershipsProvider = FutureProvider<List<MembershipView>>((ref) {
  return ref.watch(portalRepositoryProvider).memberships();
});

final attendanceProvider = FutureProvider<List<AttendanceView>>((ref) {
  return ref.watch(portalRepositoryProvider).attendance();
});

final paymentsProvider = FutureProvider<List<PaymentView>>((ref) {
  return ref.watch(portalRepositoryProvider).payments();
});
