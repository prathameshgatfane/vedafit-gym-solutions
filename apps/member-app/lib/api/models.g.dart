// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'models.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$MemberProfileImpl _$$MemberProfileImplFromJson(Map<String, dynamic> json) =>
    _$MemberProfileImpl(
      id: json['id'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      phone: json['phone'] as String,
      email: json['email'] as String?,
      status: json['status'] as String,
      branchId: json['branchId'] as String,
    );

Map<String, dynamic> _$$MemberProfileImplToJson(_$MemberProfileImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'firstName': instance.firstName,
      'lastName': instance.lastName,
      'phone': instance.phone,
      'email': instance.email,
      'status': instance.status,
      'branchId': instance.branchId,
    };

_$OrgSummaryImpl _$$OrgSummaryImplFromJson(Map<String, dynamic> json) =>
    _$OrgSummaryImpl(
      id: json['id'] as String,
      name: json['name'] as String,
      slug: json['slug'] as String,
      timezone: json['timezone'] as String?,
    );

Map<String, dynamic> _$$OrgSummaryImplToJson(_$OrgSummaryImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'slug': instance.slug,
      'timezone': instance.timezone,
    };

_$BranchSummaryImpl _$$BranchSummaryImplFromJson(Map<String, dynamic> json) =>
    _$BranchSummaryImpl(id: json['id'] as String, name: json['name'] as String);

Map<String, dynamic> _$$BranchSummaryImplToJson(_$BranchSummaryImpl instance) =>
    <String, dynamic>{'id': instance.id, 'name': instance.name};

_$PlanSummaryImpl _$$PlanSummaryImplFromJson(Map<String, dynamic> json) =>
    _$PlanSummaryImpl(
      id: json['id'] as String,
      name: json['name'] as String,
      status: json['status'] as String,
    );

Map<String, dynamic> _$$PlanSummaryImplToJson(_$PlanSummaryImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'status': instance.status,
    };

_$MembershipViewImpl _$$MembershipViewImplFromJson(Map<String, dynamic> json) =>
    _$MembershipViewImpl(
      id: json['id'] as String,
      memberId: json['memberId'] as String,
      status: json['status'] as String,
      startDate: json['startDate'] as String,
      endDate: json['endDate'] as String,
      priceAtPurchase: json['priceAtPurchase'] as String,
      daysRemaining: (json['daysRemaining'] as num).toInt(),
      isUpcoming: json['isUpcoming'] as bool,
      plan: PlanSummary.fromJson(json['plan'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$$MembershipViewImplToJson(
  _$MembershipViewImpl instance,
) => <String, dynamic>{
  'id': instance.id,
  'memberId': instance.memberId,
  'status': instance.status,
  'startDate': instance.startDate,
  'endDate': instance.endDate,
  'priceAtPurchase': instance.priceAtPurchase,
  'daysRemaining': instance.daysRemaining,
  'isUpcoming': instance.isUpcoming,
  'plan': instance.plan,
};

_$AttendanceViewImpl _$$AttendanceViewImplFromJson(Map<String, dynamic> json) =>
    _$AttendanceViewImpl(
      id: json['id'] as String,
      memberId: json['memberId'] as String,
      attendanceDate: json['attendanceDate'] as String,
      isOverride: json['isOverride'] as bool,
      overrideReason: json['overrideReason'] as String?,
    );

Map<String, dynamic> _$$AttendanceViewImplToJson(
  _$AttendanceViewImpl instance,
) => <String, dynamic>{
  'id': instance.id,
  'memberId': instance.memberId,
  'attendanceDate': instance.attendanceDate,
  'isOverride': instance.isOverride,
  'overrideReason': instance.overrideReason,
};

_$PaymentViewImpl _$$PaymentViewImplFromJson(Map<String, dynamic> json) =>
    _$PaymentViewImpl(
      id: json['id'] as String,
      memberId: json['memberId'] as String,
      amount: json['amount'] as String,
      method: json['method'] as String,
      status: json['status'] as String,
      isRefund: json['isRefund'] as bool,
      paidAt: DateTime.parse(json['paidAt'] as String),
    );

Map<String, dynamic> _$$PaymentViewImplToJson(_$PaymentViewImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'memberId': instance.memberId,
      'amount': instance.amount,
      'method': instance.method,
      'status': instance.status,
      'isRefund': instance.isRefund,
      'paidAt': instance.paidAt.toIso8601String(),
    };

_$SessionPayloadImpl _$$SessionPayloadImplFromJson(Map<String, dynamic> json) =>
    _$SessionPayloadImpl(
      member: MemberProfile.fromJson(json['member'] as Map<String, dynamic>),
      organization: OrgSummary.fromJson(
        json['organization'] as Map<String, dynamic>,
      ),
      branch: BranchSummary.fromJson(json['branch'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$$SessionPayloadImplToJson(
  _$SessionPayloadImpl instance,
) => <String, dynamic>{
  'member': instance.member,
  'organization': instance.organization,
  'branch': instance.branch,
};

_$HomePayloadImpl _$$HomePayloadImplFromJson(Map<String, dynamic> json) =>
    _$HomePayloadImpl(
      member: MemberProfile.fromJson(json['member'] as Map<String, dynamic>),
      organization: OrgSummary.fromJson(
        json['organization'] as Map<String, dynamic>,
      ),
      branch: BranchSummary.fromJson(json['branch'] as Map<String, dynamic>),
      currentMembership: json['currentMembership'] == null
          ? null
          : MembershipView.fromJson(
              json['currentMembership'] as Map<String, dynamic>,
            ),
      outstandingPending: json['outstandingPending'] as String,
    );

Map<String, dynamic> _$$HomePayloadImplToJson(_$HomePayloadImpl instance) =>
    <String, dynamic>{
      'member': instance.member,
      'organization': instance.organization,
      'branch': instance.branch,
      'currentMembership': instance.currentMembership,
      'outstandingPending': instance.outstandingPending,
    };

_$LoginPayloadImpl _$$LoginPayloadImplFromJson(Map<String, dynamic> json) =>
    _$LoginPayloadImpl(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
      expiresIn: (json['expiresIn'] as num).toInt(),
      member: MemberProfile.fromJson(json['member'] as Map<String, dynamic>),
      organization: OrgSummary.fromJson(
        json['organization'] as Map<String, dynamic>,
      ),
      branch: BranchSummary.fromJson(json['branch'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$$LoginPayloadImplToJson(_$LoginPayloadImpl instance) =>
    <String, dynamic>{
      'accessToken': instance.accessToken,
      'refreshToken': instance.refreshToken,
      'expiresIn': instance.expiresIn,
      'member': instance.member,
      'organization': instance.organization,
      'branch': instance.branch,
    };

_$RefreshPayloadImpl _$$RefreshPayloadImplFromJson(Map<String, dynamic> json) =>
    _$RefreshPayloadImpl(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
      expiresIn: (json['expiresIn'] as num).toInt(),
    );

Map<String, dynamic> _$$RefreshPayloadImplToJson(
  _$RefreshPayloadImpl instance,
) => <String, dynamic>{
  'accessToken': instance.accessToken,
  'refreshToken': instance.refreshToken,
  'expiresIn': instance.expiresIn,
};
