import 'package:freezed_annotation/freezed_annotation.dart';

part 'models.freezed.dart';
part 'models.g.dart';

@freezed
class MemberProfile with _$MemberProfile {
  const factory MemberProfile({
    required String id,
    required String firstName,
    required String lastName,
    required String phone,
    String? email,
    required String status,
    required String branchId,
  }) = _MemberProfile;

  factory MemberProfile.fromJson(Map<String, dynamic> json) =>
      _$MemberProfileFromJson(json);
}

@freezed
class OrgSummary with _$OrgSummary {
  const factory OrgSummary({
    required String id,
    required String name,
    required String slug,
    String? timezone,
  }) = _OrgSummary;

  factory OrgSummary.fromJson(Map<String, dynamic> json) =>
      _$OrgSummaryFromJson(json);
}

@freezed
class BranchSummary with _$BranchSummary {
  const factory BranchSummary({
    required String id,
    required String name,
  }) = _BranchSummary;

  factory BranchSummary.fromJson(Map<String, dynamic> json) =>
      _$BranchSummaryFromJson(json);
}

@freezed
class PlanSummary with _$PlanSummary {
  const factory PlanSummary({
    required String id,
    required String name,
    required String status,
  }) = _PlanSummary;

  factory PlanSummary.fromJson(Map<String, dynamic> json) =>
      _$PlanSummaryFromJson(json);
}

@freezed
class MembershipView with _$MembershipView {
  const factory MembershipView({
    required String id,
    required String memberId,
    required String status,
    required String startDate,
    required String endDate,
    required String priceAtPurchase,
    required int daysRemaining,
    required bool isUpcoming,
    required PlanSummary plan,
  }) = _MembershipView;

  factory MembershipView.fromJson(Map<String, dynamic> json) =>
      _$MembershipViewFromJson(json);
}

@freezed
class AttendanceView with _$AttendanceView {
  const factory AttendanceView({
    required String id,
    required String memberId,
    required String attendanceDate,
    required bool isOverride,
    String? overrideReason,
  }) = _AttendanceView;

  factory AttendanceView.fromJson(Map<String, dynamic> json) =>
      _$AttendanceViewFromJson(json);
}

@freezed
class PaymentView with _$PaymentView {
  const factory PaymentView({
    required String id,
    required String memberId,
    required String amount,
    required String method,
    required String status,
    required bool isRefund,
    required DateTime paidAt,
  }) = _PaymentView;

  factory PaymentView.fromJson(Map<String, dynamic> json) =>
      _$PaymentViewFromJson(json);
}

@freezed
class SessionPayload with _$SessionPayload {
  const factory SessionPayload({
    required MemberProfile member,
    required OrgSummary organization,
    required BranchSummary branch,
  }) = _SessionPayload;

  factory SessionPayload.fromJson(Map<String, dynamic> json) =>
      _$SessionPayloadFromJson(json);
}

@freezed
class HomePayload with _$HomePayload {
  const factory HomePayload({
    required MemberProfile member,
    required OrgSummary organization,
    required BranchSummary branch,
    MembershipView? currentMembership,
    required String outstandingPending,
  }) = _HomePayload;

  factory HomePayload.fromJson(Map<String, dynamic> json) =>
      _$HomePayloadFromJson(json);
}

@freezed
class LoginPayload with _$LoginPayload {
  const factory LoginPayload({
    required String accessToken,
    required String refreshToken,
    required int expiresIn,
    required MemberProfile member,
    required OrgSummary organization,
    required BranchSummary branch,
  }) = _LoginPayload;

  factory LoginPayload.fromJson(Map<String, dynamic> json) =>
      _$LoginPayloadFromJson(json);
}

@freezed
class RefreshPayload with _$RefreshPayload {
  const factory RefreshPayload({
    required String accessToken,
    required String refreshToken,
    required int expiresIn,
  }) = _RefreshPayload;

  factory RefreshPayload.fromJson(Map<String, dynamic> json) =>
      _$RefreshPayloadFromJson(json);
}
