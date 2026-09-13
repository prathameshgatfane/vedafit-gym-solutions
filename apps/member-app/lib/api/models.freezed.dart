// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'models.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

MemberProfile _$MemberProfileFromJson(Map<String, dynamic> json) {
  return _MemberProfile.fromJson(json);
}

/// @nodoc
mixin _$MemberProfile {
  String get id => throw _privateConstructorUsedError;
  String get firstName => throw _privateConstructorUsedError;
  String get lastName => throw _privateConstructorUsedError;
  String get phone => throw _privateConstructorUsedError;
  String? get email => throw _privateConstructorUsedError;
  String get status => throw _privateConstructorUsedError;
  String get branchId => throw _privateConstructorUsedError;

  /// Serializes this MemberProfile to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of MemberProfile
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $MemberProfileCopyWith<MemberProfile> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $MemberProfileCopyWith<$Res> {
  factory $MemberProfileCopyWith(
    MemberProfile value,
    $Res Function(MemberProfile) then,
  ) = _$MemberProfileCopyWithImpl<$Res, MemberProfile>;
  @useResult
  $Res call({
    String id,
    String firstName,
    String lastName,
    String phone,
    String? email,
    String status,
    String branchId,
  });
}

/// @nodoc
class _$MemberProfileCopyWithImpl<$Res, $Val extends MemberProfile>
    implements $MemberProfileCopyWith<$Res> {
  _$MemberProfileCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of MemberProfile
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? firstName = null,
    Object? lastName = null,
    Object? phone = null,
    Object? email = freezed,
    Object? status = null,
    Object? branchId = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            firstName: null == firstName
                ? _value.firstName
                : firstName // ignore: cast_nullable_to_non_nullable
                      as String,
            lastName: null == lastName
                ? _value.lastName
                : lastName // ignore: cast_nullable_to_non_nullable
                      as String,
            phone: null == phone
                ? _value.phone
                : phone // ignore: cast_nullable_to_non_nullable
                      as String,
            email: freezed == email
                ? _value.email
                : email // ignore: cast_nullable_to_non_nullable
                      as String?,
            status: null == status
                ? _value.status
                : status // ignore: cast_nullable_to_non_nullable
                      as String,
            branchId: null == branchId
                ? _value.branchId
                : branchId // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$MemberProfileImplCopyWith<$Res>
    implements $MemberProfileCopyWith<$Res> {
  factory _$$MemberProfileImplCopyWith(
    _$MemberProfileImpl value,
    $Res Function(_$MemberProfileImpl) then,
  ) = __$$MemberProfileImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String firstName,
    String lastName,
    String phone,
    String? email,
    String status,
    String branchId,
  });
}

/// @nodoc
class __$$MemberProfileImplCopyWithImpl<$Res>
    extends _$MemberProfileCopyWithImpl<$Res, _$MemberProfileImpl>
    implements _$$MemberProfileImplCopyWith<$Res> {
  __$$MemberProfileImplCopyWithImpl(
    _$MemberProfileImpl _value,
    $Res Function(_$MemberProfileImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of MemberProfile
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? firstName = null,
    Object? lastName = null,
    Object? phone = null,
    Object? email = freezed,
    Object? status = null,
    Object? branchId = null,
  }) {
    return _then(
      _$MemberProfileImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        firstName: null == firstName
            ? _value.firstName
            : firstName // ignore: cast_nullable_to_non_nullable
                  as String,
        lastName: null == lastName
            ? _value.lastName
            : lastName // ignore: cast_nullable_to_non_nullable
                  as String,
        phone: null == phone
            ? _value.phone
            : phone // ignore: cast_nullable_to_non_nullable
                  as String,
        email: freezed == email
            ? _value.email
            : email // ignore: cast_nullable_to_non_nullable
                  as String?,
        status: null == status
            ? _value.status
            : status // ignore: cast_nullable_to_non_nullable
                  as String,
        branchId: null == branchId
            ? _value.branchId
            : branchId // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$MemberProfileImpl implements _MemberProfile {
  const _$MemberProfileImpl({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phone,
    this.email,
    required this.status,
    required this.branchId,
  });

  factory _$MemberProfileImpl.fromJson(Map<String, dynamic> json) =>
      _$$MemberProfileImplFromJson(json);

  @override
  final String id;
  @override
  final String firstName;
  @override
  final String lastName;
  @override
  final String phone;
  @override
  final String? email;
  @override
  final String status;
  @override
  final String branchId;

  @override
  String toString() {
    return 'MemberProfile(id: $id, firstName: $firstName, lastName: $lastName, phone: $phone, email: $email, status: $status, branchId: $branchId)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$MemberProfileImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.firstName, firstName) ||
                other.firstName == firstName) &&
            (identical(other.lastName, lastName) ||
                other.lastName == lastName) &&
            (identical(other.phone, phone) || other.phone == phone) &&
            (identical(other.email, email) || other.email == email) &&
            (identical(other.status, status) || other.status == status) &&
            (identical(other.branchId, branchId) ||
                other.branchId == branchId));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    firstName,
    lastName,
    phone,
    email,
    status,
    branchId,
  );

  /// Create a copy of MemberProfile
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$MemberProfileImplCopyWith<_$MemberProfileImpl> get copyWith =>
      __$$MemberProfileImplCopyWithImpl<_$MemberProfileImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$MemberProfileImplToJson(this);
  }
}

abstract class _MemberProfile implements MemberProfile {
  const factory _MemberProfile({
    required final String id,
    required final String firstName,
    required final String lastName,
    required final String phone,
    final String? email,
    required final String status,
    required final String branchId,
  }) = _$MemberProfileImpl;

  factory _MemberProfile.fromJson(Map<String, dynamic> json) =
      _$MemberProfileImpl.fromJson;

  @override
  String get id;
  @override
  String get firstName;
  @override
  String get lastName;
  @override
  String get phone;
  @override
  String? get email;
  @override
  String get status;
  @override
  String get branchId;

  /// Create a copy of MemberProfile
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$MemberProfileImplCopyWith<_$MemberProfileImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

OrgSummary _$OrgSummaryFromJson(Map<String, dynamic> json) {
  return _OrgSummary.fromJson(json);
}

/// @nodoc
mixin _$OrgSummary {
  String get id => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  String get slug => throw _privateConstructorUsedError;
  String? get timezone => throw _privateConstructorUsedError;

  /// Serializes this OrgSummary to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of OrgSummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $OrgSummaryCopyWith<OrgSummary> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $OrgSummaryCopyWith<$Res> {
  factory $OrgSummaryCopyWith(
    OrgSummary value,
    $Res Function(OrgSummary) then,
  ) = _$OrgSummaryCopyWithImpl<$Res, OrgSummary>;
  @useResult
  $Res call({String id, String name, String slug, String? timezone});
}

/// @nodoc
class _$OrgSummaryCopyWithImpl<$Res, $Val extends OrgSummary>
    implements $OrgSummaryCopyWith<$Res> {
  _$OrgSummaryCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of OrgSummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? slug = null,
    Object? timezone = freezed,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            name: null == name
                ? _value.name
                : name // ignore: cast_nullable_to_non_nullable
                      as String,
            slug: null == slug
                ? _value.slug
                : slug // ignore: cast_nullable_to_non_nullable
                      as String,
            timezone: freezed == timezone
                ? _value.timezone
                : timezone // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$OrgSummaryImplCopyWith<$Res>
    implements $OrgSummaryCopyWith<$Res> {
  factory _$$OrgSummaryImplCopyWith(
    _$OrgSummaryImpl value,
    $Res Function(_$OrgSummaryImpl) then,
  ) = __$$OrgSummaryImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String id, String name, String slug, String? timezone});
}

/// @nodoc
class __$$OrgSummaryImplCopyWithImpl<$Res>
    extends _$OrgSummaryCopyWithImpl<$Res, _$OrgSummaryImpl>
    implements _$$OrgSummaryImplCopyWith<$Res> {
  __$$OrgSummaryImplCopyWithImpl(
    _$OrgSummaryImpl _value,
    $Res Function(_$OrgSummaryImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of OrgSummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? slug = null,
    Object? timezone = freezed,
  }) {
    return _then(
      _$OrgSummaryImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        name: null == name
            ? _value.name
            : name // ignore: cast_nullable_to_non_nullable
                  as String,
        slug: null == slug
            ? _value.slug
            : slug // ignore: cast_nullable_to_non_nullable
                  as String,
        timezone: freezed == timezone
            ? _value.timezone
            : timezone // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$OrgSummaryImpl implements _OrgSummary {
  const _$OrgSummaryImpl({
    required this.id,
    required this.name,
    required this.slug,
    this.timezone,
  });

  factory _$OrgSummaryImpl.fromJson(Map<String, dynamic> json) =>
      _$$OrgSummaryImplFromJson(json);

  @override
  final String id;
  @override
  final String name;
  @override
  final String slug;
  @override
  final String? timezone;

  @override
  String toString() {
    return 'OrgSummary(id: $id, name: $name, slug: $slug, timezone: $timezone)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$OrgSummaryImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.slug, slug) || other.slug == slug) &&
            (identical(other.timezone, timezone) ||
                other.timezone == timezone));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, name, slug, timezone);

  /// Create a copy of OrgSummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$OrgSummaryImplCopyWith<_$OrgSummaryImpl> get copyWith =>
      __$$OrgSummaryImplCopyWithImpl<_$OrgSummaryImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$OrgSummaryImplToJson(this);
  }
}

abstract class _OrgSummary implements OrgSummary {
  const factory _OrgSummary({
    required final String id,
    required final String name,
    required final String slug,
    final String? timezone,
  }) = _$OrgSummaryImpl;

  factory _OrgSummary.fromJson(Map<String, dynamic> json) =
      _$OrgSummaryImpl.fromJson;

  @override
  String get id;
  @override
  String get name;
  @override
  String get slug;
  @override
  String? get timezone;

  /// Create a copy of OrgSummary
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$OrgSummaryImplCopyWith<_$OrgSummaryImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

BranchSummary _$BranchSummaryFromJson(Map<String, dynamic> json) {
  return _BranchSummary.fromJson(json);
}

/// @nodoc
mixin _$BranchSummary {
  String get id => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;

  /// Serializes this BranchSummary to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of BranchSummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $BranchSummaryCopyWith<BranchSummary> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $BranchSummaryCopyWith<$Res> {
  factory $BranchSummaryCopyWith(
    BranchSummary value,
    $Res Function(BranchSummary) then,
  ) = _$BranchSummaryCopyWithImpl<$Res, BranchSummary>;
  @useResult
  $Res call({String id, String name});
}

/// @nodoc
class _$BranchSummaryCopyWithImpl<$Res, $Val extends BranchSummary>
    implements $BranchSummaryCopyWith<$Res> {
  _$BranchSummaryCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of BranchSummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? id = null, Object? name = null}) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            name: null == name
                ? _value.name
                : name // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$BranchSummaryImplCopyWith<$Res>
    implements $BranchSummaryCopyWith<$Res> {
  factory _$$BranchSummaryImplCopyWith(
    _$BranchSummaryImpl value,
    $Res Function(_$BranchSummaryImpl) then,
  ) = __$$BranchSummaryImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String id, String name});
}

/// @nodoc
class __$$BranchSummaryImplCopyWithImpl<$Res>
    extends _$BranchSummaryCopyWithImpl<$Res, _$BranchSummaryImpl>
    implements _$$BranchSummaryImplCopyWith<$Res> {
  __$$BranchSummaryImplCopyWithImpl(
    _$BranchSummaryImpl _value,
    $Res Function(_$BranchSummaryImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of BranchSummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? id = null, Object? name = null}) {
    return _then(
      _$BranchSummaryImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        name: null == name
            ? _value.name
            : name // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$BranchSummaryImpl implements _BranchSummary {
  const _$BranchSummaryImpl({required this.id, required this.name});

  factory _$BranchSummaryImpl.fromJson(Map<String, dynamic> json) =>
      _$$BranchSummaryImplFromJson(json);

  @override
  final String id;
  @override
  final String name;

  @override
  String toString() {
    return 'BranchSummary(id: $id, name: $name)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$BranchSummaryImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, name);

  /// Create a copy of BranchSummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$BranchSummaryImplCopyWith<_$BranchSummaryImpl> get copyWith =>
      __$$BranchSummaryImplCopyWithImpl<_$BranchSummaryImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$BranchSummaryImplToJson(this);
  }
}

abstract class _BranchSummary implements BranchSummary {
  const factory _BranchSummary({
    required final String id,
    required final String name,
  }) = _$BranchSummaryImpl;

  factory _BranchSummary.fromJson(Map<String, dynamic> json) =
      _$BranchSummaryImpl.fromJson;

  @override
  String get id;
  @override
  String get name;

  /// Create a copy of BranchSummary
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$BranchSummaryImplCopyWith<_$BranchSummaryImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

PlanSummary _$PlanSummaryFromJson(Map<String, dynamic> json) {
  return _PlanSummary.fromJson(json);
}

/// @nodoc
mixin _$PlanSummary {
  String get id => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  String get status => throw _privateConstructorUsedError;

  /// Serializes this PlanSummary to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of PlanSummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $PlanSummaryCopyWith<PlanSummary> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $PlanSummaryCopyWith<$Res> {
  factory $PlanSummaryCopyWith(
    PlanSummary value,
    $Res Function(PlanSummary) then,
  ) = _$PlanSummaryCopyWithImpl<$Res, PlanSummary>;
  @useResult
  $Res call({String id, String name, String status});
}

/// @nodoc
class _$PlanSummaryCopyWithImpl<$Res, $Val extends PlanSummary>
    implements $PlanSummaryCopyWith<$Res> {
  _$PlanSummaryCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of PlanSummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? id = null, Object? name = null, Object? status = null}) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            name: null == name
                ? _value.name
                : name // ignore: cast_nullable_to_non_nullable
                      as String,
            status: null == status
                ? _value.status
                : status // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$PlanSummaryImplCopyWith<$Res>
    implements $PlanSummaryCopyWith<$Res> {
  factory _$$PlanSummaryImplCopyWith(
    _$PlanSummaryImpl value,
    $Res Function(_$PlanSummaryImpl) then,
  ) = __$$PlanSummaryImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String id, String name, String status});
}

/// @nodoc
class __$$PlanSummaryImplCopyWithImpl<$Res>
    extends _$PlanSummaryCopyWithImpl<$Res, _$PlanSummaryImpl>
    implements _$$PlanSummaryImplCopyWith<$Res> {
  __$$PlanSummaryImplCopyWithImpl(
    _$PlanSummaryImpl _value,
    $Res Function(_$PlanSummaryImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of PlanSummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? id = null, Object? name = null, Object? status = null}) {
    return _then(
      _$PlanSummaryImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        name: null == name
            ? _value.name
            : name // ignore: cast_nullable_to_non_nullable
                  as String,
        status: null == status
            ? _value.status
            : status // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$PlanSummaryImpl implements _PlanSummary {
  const _$PlanSummaryImpl({
    required this.id,
    required this.name,
    required this.status,
  });

  factory _$PlanSummaryImpl.fromJson(Map<String, dynamic> json) =>
      _$$PlanSummaryImplFromJson(json);

  @override
  final String id;
  @override
  final String name;
  @override
  final String status;

  @override
  String toString() {
    return 'PlanSummary(id: $id, name: $name, status: $status)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$PlanSummaryImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.status, status) || other.status == status));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, name, status);

  /// Create a copy of PlanSummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$PlanSummaryImplCopyWith<_$PlanSummaryImpl> get copyWith =>
      __$$PlanSummaryImplCopyWithImpl<_$PlanSummaryImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$PlanSummaryImplToJson(this);
  }
}

abstract class _PlanSummary implements PlanSummary {
  const factory _PlanSummary({
    required final String id,
    required final String name,
    required final String status,
  }) = _$PlanSummaryImpl;

  factory _PlanSummary.fromJson(Map<String, dynamic> json) =
      _$PlanSummaryImpl.fromJson;

  @override
  String get id;
  @override
  String get name;
  @override
  String get status;

  /// Create a copy of PlanSummary
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$PlanSummaryImplCopyWith<_$PlanSummaryImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

MembershipView _$MembershipViewFromJson(Map<String, dynamic> json) {
  return _MembershipView.fromJson(json);
}

/// @nodoc
mixin _$MembershipView {
  String get id => throw _privateConstructorUsedError;
  String get memberId => throw _privateConstructorUsedError;
  String get status => throw _privateConstructorUsedError;
  String get startDate => throw _privateConstructorUsedError;
  String get endDate => throw _privateConstructorUsedError;
  String get priceAtPurchase => throw _privateConstructorUsedError;
  int get daysRemaining => throw _privateConstructorUsedError;
  bool get isUpcoming => throw _privateConstructorUsedError;
  PlanSummary get plan => throw _privateConstructorUsedError;

  /// Serializes this MembershipView to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of MembershipView
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $MembershipViewCopyWith<MembershipView> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $MembershipViewCopyWith<$Res> {
  factory $MembershipViewCopyWith(
    MembershipView value,
    $Res Function(MembershipView) then,
  ) = _$MembershipViewCopyWithImpl<$Res, MembershipView>;
  @useResult
  $Res call({
    String id,
    String memberId,
    String status,
    String startDate,
    String endDate,
    String priceAtPurchase,
    int daysRemaining,
    bool isUpcoming,
    PlanSummary plan,
  });

  $PlanSummaryCopyWith<$Res> get plan;
}

/// @nodoc
class _$MembershipViewCopyWithImpl<$Res, $Val extends MembershipView>
    implements $MembershipViewCopyWith<$Res> {
  _$MembershipViewCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of MembershipView
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? memberId = null,
    Object? status = null,
    Object? startDate = null,
    Object? endDate = null,
    Object? priceAtPurchase = null,
    Object? daysRemaining = null,
    Object? isUpcoming = null,
    Object? plan = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            memberId: null == memberId
                ? _value.memberId
                : memberId // ignore: cast_nullable_to_non_nullable
                      as String,
            status: null == status
                ? _value.status
                : status // ignore: cast_nullable_to_non_nullable
                      as String,
            startDate: null == startDate
                ? _value.startDate
                : startDate // ignore: cast_nullable_to_non_nullable
                      as String,
            endDate: null == endDate
                ? _value.endDate
                : endDate // ignore: cast_nullable_to_non_nullable
                      as String,
            priceAtPurchase: null == priceAtPurchase
                ? _value.priceAtPurchase
                : priceAtPurchase // ignore: cast_nullable_to_non_nullable
                      as String,
            daysRemaining: null == daysRemaining
                ? _value.daysRemaining
                : daysRemaining // ignore: cast_nullable_to_non_nullable
                      as int,
            isUpcoming: null == isUpcoming
                ? _value.isUpcoming
                : isUpcoming // ignore: cast_nullable_to_non_nullable
                      as bool,
            plan: null == plan
                ? _value.plan
                : plan // ignore: cast_nullable_to_non_nullable
                      as PlanSummary,
          )
          as $Val,
    );
  }

  /// Create a copy of MembershipView
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $PlanSummaryCopyWith<$Res> get plan {
    return $PlanSummaryCopyWith<$Res>(_value.plan, (value) {
      return _then(_value.copyWith(plan: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$MembershipViewImplCopyWith<$Res>
    implements $MembershipViewCopyWith<$Res> {
  factory _$$MembershipViewImplCopyWith(
    _$MembershipViewImpl value,
    $Res Function(_$MembershipViewImpl) then,
  ) = __$$MembershipViewImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String memberId,
    String status,
    String startDate,
    String endDate,
    String priceAtPurchase,
    int daysRemaining,
    bool isUpcoming,
    PlanSummary plan,
  });

  @override
  $PlanSummaryCopyWith<$Res> get plan;
}

/// @nodoc
class __$$MembershipViewImplCopyWithImpl<$Res>
    extends _$MembershipViewCopyWithImpl<$Res, _$MembershipViewImpl>
    implements _$$MembershipViewImplCopyWith<$Res> {
  __$$MembershipViewImplCopyWithImpl(
    _$MembershipViewImpl _value,
    $Res Function(_$MembershipViewImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of MembershipView
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? memberId = null,
    Object? status = null,
    Object? startDate = null,
    Object? endDate = null,
    Object? priceAtPurchase = null,
    Object? daysRemaining = null,
    Object? isUpcoming = null,
    Object? plan = null,
  }) {
    return _then(
      _$MembershipViewImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        memberId: null == memberId
            ? _value.memberId
            : memberId // ignore: cast_nullable_to_non_nullable
                  as String,
        status: null == status
            ? _value.status
            : status // ignore: cast_nullable_to_non_nullable
                  as String,
        startDate: null == startDate
            ? _value.startDate
            : startDate // ignore: cast_nullable_to_non_nullable
                  as String,
        endDate: null == endDate
            ? _value.endDate
            : endDate // ignore: cast_nullable_to_non_nullable
                  as String,
        priceAtPurchase: null == priceAtPurchase
            ? _value.priceAtPurchase
            : priceAtPurchase // ignore: cast_nullable_to_non_nullable
                  as String,
        daysRemaining: null == daysRemaining
            ? _value.daysRemaining
            : daysRemaining // ignore: cast_nullable_to_non_nullable
                  as int,
        isUpcoming: null == isUpcoming
            ? _value.isUpcoming
            : isUpcoming // ignore: cast_nullable_to_non_nullable
                  as bool,
        plan: null == plan
            ? _value.plan
            : plan // ignore: cast_nullable_to_non_nullable
                  as PlanSummary,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$MembershipViewImpl implements _MembershipView {
  const _$MembershipViewImpl({
    required this.id,
    required this.memberId,
    required this.status,
    required this.startDate,
    required this.endDate,
    required this.priceAtPurchase,
    required this.daysRemaining,
    required this.isUpcoming,
    required this.plan,
  });

  factory _$MembershipViewImpl.fromJson(Map<String, dynamic> json) =>
      _$$MembershipViewImplFromJson(json);

  @override
  final String id;
  @override
  final String memberId;
  @override
  final String status;
  @override
  final String startDate;
  @override
  final String endDate;
  @override
  final String priceAtPurchase;
  @override
  final int daysRemaining;
  @override
  final bool isUpcoming;
  @override
  final PlanSummary plan;

  @override
  String toString() {
    return 'MembershipView(id: $id, memberId: $memberId, status: $status, startDate: $startDate, endDate: $endDate, priceAtPurchase: $priceAtPurchase, daysRemaining: $daysRemaining, isUpcoming: $isUpcoming, plan: $plan)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$MembershipViewImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.memberId, memberId) ||
                other.memberId == memberId) &&
            (identical(other.status, status) || other.status == status) &&
            (identical(other.startDate, startDate) ||
                other.startDate == startDate) &&
            (identical(other.endDate, endDate) || other.endDate == endDate) &&
            (identical(other.priceAtPurchase, priceAtPurchase) ||
                other.priceAtPurchase == priceAtPurchase) &&
            (identical(other.daysRemaining, daysRemaining) ||
                other.daysRemaining == daysRemaining) &&
            (identical(other.isUpcoming, isUpcoming) ||
                other.isUpcoming == isUpcoming) &&
            (identical(other.plan, plan) || other.plan == plan));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    memberId,
    status,
    startDate,
    endDate,
    priceAtPurchase,
    daysRemaining,
    isUpcoming,
    plan,
  );

  /// Create a copy of MembershipView
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$MembershipViewImplCopyWith<_$MembershipViewImpl> get copyWith =>
      __$$MembershipViewImplCopyWithImpl<_$MembershipViewImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$MembershipViewImplToJson(this);
  }
}

abstract class _MembershipView implements MembershipView {
  const factory _MembershipView({
    required final String id,
    required final String memberId,
    required final String status,
    required final String startDate,
    required final String endDate,
    required final String priceAtPurchase,
    required final int daysRemaining,
    required final bool isUpcoming,
    required final PlanSummary plan,
  }) = _$MembershipViewImpl;

  factory _MembershipView.fromJson(Map<String, dynamic> json) =
      _$MembershipViewImpl.fromJson;

  @override
  String get id;
  @override
  String get memberId;
  @override
  String get status;
  @override
  String get startDate;
  @override
  String get endDate;
  @override
  String get priceAtPurchase;
  @override
  int get daysRemaining;
  @override
  bool get isUpcoming;
  @override
  PlanSummary get plan;

  /// Create a copy of MembershipView
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$MembershipViewImplCopyWith<_$MembershipViewImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

AttendanceView _$AttendanceViewFromJson(Map<String, dynamic> json) {
  return _AttendanceView.fromJson(json);
}

/// @nodoc
mixin _$AttendanceView {
  String get id => throw _privateConstructorUsedError;
  String get memberId => throw _privateConstructorUsedError;
  String get attendanceDate => throw _privateConstructorUsedError;
  bool get isOverride => throw _privateConstructorUsedError;
  String? get overrideReason => throw _privateConstructorUsedError;

  /// Serializes this AttendanceView to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of AttendanceView
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $AttendanceViewCopyWith<AttendanceView> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $AttendanceViewCopyWith<$Res> {
  factory $AttendanceViewCopyWith(
    AttendanceView value,
    $Res Function(AttendanceView) then,
  ) = _$AttendanceViewCopyWithImpl<$Res, AttendanceView>;
  @useResult
  $Res call({
    String id,
    String memberId,
    String attendanceDate,
    bool isOverride,
    String? overrideReason,
  });
}

/// @nodoc
class _$AttendanceViewCopyWithImpl<$Res, $Val extends AttendanceView>
    implements $AttendanceViewCopyWith<$Res> {
  _$AttendanceViewCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of AttendanceView
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? memberId = null,
    Object? attendanceDate = null,
    Object? isOverride = null,
    Object? overrideReason = freezed,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            memberId: null == memberId
                ? _value.memberId
                : memberId // ignore: cast_nullable_to_non_nullable
                      as String,
            attendanceDate: null == attendanceDate
                ? _value.attendanceDate
                : attendanceDate // ignore: cast_nullable_to_non_nullable
                      as String,
            isOverride: null == isOverride
                ? _value.isOverride
                : isOverride // ignore: cast_nullable_to_non_nullable
                      as bool,
            overrideReason: freezed == overrideReason
                ? _value.overrideReason
                : overrideReason // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$AttendanceViewImplCopyWith<$Res>
    implements $AttendanceViewCopyWith<$Res> {
  factory _$$AttendanceViewImplCopyWith(
    _$AttendanceViewImpl value,
    $Res Function(_$AttendanceViewImpl) then,
  ) = __$$AttendanceViewImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String memberId,
    String attendanceDate,
    bool isOverride,
    String? overrideReason,
  });
}

/// @nodoc
class __$$AttendanceViewImplCopyWithImpl<$Res>
    extends _$AttendanceViewCopyWithImpl<$Res, _$AttendanceViewImpl>
    implements _$$AttendanceViewImplCopyWith<$Res> {
  __$$AttendanceViewImplCopyWithImpl(
    _$AttendanceViewImpl _value,
    $Res Function(_$AttendanceViewImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of AttendanceView
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? memberId = null,
    Object? attendanceDate = null,
    Object? isOverride = null,
    Object? overrideReason = freezed,
  }) {
    return _then(
      _$AttendanceViewImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        memberId: null == memberId
            ? _value.memberId
            : memberId // ignore: cast_nullable_to_non_nullable
                  as String,
        attendanceDate: null == attendanceDate
            ? _value.attendanceDate
            : attendanceDate // ignore: cast_nullable_to_non_nullable
                  as String,
        isOverride: null == isOverride
            ? _value.isOverride
            : isOverride // ignore: cast_nullable_to_non_nullable
                  as bool,
        overrideReason: freezed == overrideReason
            ? _value.overrideReason
            : overrideReason // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$AttendanceViewImpl implements _AttendanceView {
  const _$AttendanceViewImpl({
    required this.id,
    required this.memberId,
    required this.attendanceDate,
    required this.isOverride,
    this.overrideReason,
  });

  factory _$AttendanceViewImpl.fromJson(Map<String, dynamic> json) =>
      _$$AttendanceViewImplFromJson(json);

  @override
  final String id;
  @override
  final String memberId;
  @override
  final String attendanceDate;
  @override
  final bool isOverride;
  @override
  final String? overrideReason;

  @override
  String toString() {
    return 'AttendanceView(id: $id, memberId: $memberId, attendanceDate: $attendanceDate, isOverride: $isOverride, overrideReason: $overrideReason)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AttendanceViewImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.memberId, memberId) ||
                other.memberId == memberId) &&
            (identical(other.attendanceDate, attendanceDate) ||
                other.attendanceDate == attendanceDate) &&
            (identical(other.isOverride, isOverride) ||
                other.isOverride == isOverride) &&
            (identical(other.overrideReason, overrideReason) ||
                other.overrideReason == overrideReason));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    memberId,
    attendanceDate,
    isOverride,
    overrideReason,
  );

  /// Create a copy of AttendanceView
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$AttendanceViewImplCopyWith<_$AttendanceViewImpl> get copyWith =>
      __$$AttendanceViewImplCopyWithImpl<_$AttendanceViewImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$AttendanceViewImplToJson(this);
  }
}

abstract class _AttendanceView implements AttendanceView {
  const factory _AttendanceView({
    required final String id,
    required final String memberId,
    required final String attendanceDate,
    required final bool isOverride,
    final String? overrideReason,
  }) = _$AttendanceViewImpl;

  factory _AttendanceView.fromJson(Map<String, dynamic> json) =
      _$AttendanceViewImpl.fromJson;

  @override
  String get id;
  @override
  String get memberId;
  @override
  String get attendanceDate;
  @override
  bool get isOverride;
  @override
  String? get overrideReason;

  /// Create a copy of AttendanceView
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$AttendanceViewImplCopyWith<_$AttendanceViewImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

PaymentView _$PaymentViewFromJson(Map<String, dynamic> json) {
  return _PaymentView.fromJson(json);
}

/// @nodoc
mixin _$PaymentView {
  String get id => throw _privateConstructorUsedError;
  String get memberId => throw _privateConstructorUsedError;
  String get amount => throw _privateConstructorUsedError;
  String get method => throw _privateConstructorUsedError;
  String get status => throw _privateConstructorUsedError;
  bool get isRefund => throw _privateConstructorUsedError;
  DateTime get paidAt => throw _privateConstructorUsedError;

  /// Serializes this PaymentView to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of PaymentView
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $PaymentViewCopyWith<PaymentView> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $PaymentViewCopyWith<$Res> {
  factory $PaymentViewCopyWith(
    PaymentView value,
    $Res Function(PaymentView) then,
  ) = _$PaymentViewCopyWithImpl<$Res, PaymentView>;
  @useResult
  $Res call({
    String id,
    String memberId,
    String amount,
    String method,
    String status,
    bool isRefund,
    DateTime paidAt,
  });
}

/// @nodoc
class _$PaymentViewCopyWithImpl<$Res, $Val extends PaymentView>
    implements $PaymentViewCopyWith<$Res> {
  _$PaymentViewCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of PaymentView
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? memberId = null,
    Object? amount = null,
    Object? method = null,
    Object? status = null,
    Object? isRefund = null,
    Object? paidAt = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            memberId: null == memberId
                ? _value.memberId
                : memberId // ignore: cast_nullable_to_non_nullable
                      as String,
            amount: null == amount
                ? _value.amount
                : amount // ignore: cast_nullable_to_non_nullable
                      as String,
            method: null == method
                ? _value.method
                : method // ignore: cast_nullable_to_non_nullable
                      as String,
            status: null == status
                ? _value.status
                : status // ignore: cast_nullable_to_non_nullable
                      as String,
            isRefund: null == isRefund
                ? _value.isRefund
                : isRefund // ignore: cast_nullable_to_non_nullable
                      as bool,
            paidAt: null == paidAt
                ? _value.paidAt
                : paidAt // ignore: cast_nullable_to_non_nullable
                      as DateTime,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$PaymentViewImplCopyWith<$Res>
    implements $PaymentViewCopyWith<$Res> {
  factory _$$PaymentViewImplCopyWith(
    _$PaymentViewImpl value,
    $Res Function(_$PaymentViewImpl) then,
  ) = __$$PaymentViewImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String memberId,
    String amount,
    String method,
    String status,
    bool isRefund,
    DateTime paidAt,
  });
}

/// @nodoc
class __$$PaymentViewImplCopyWithImpl<$Res>
    extends _$PaymentViewCopyWithImpl<$Res, _$PaymentViewImpl>
    implements _$$PaymentViewImplCopyWith<$Res> {
  __$$PaymentViewImplCopyWithImpl(
    _$PaymentViewImpl _value,
    $Res Function(_$PaymentViewImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of PaymentView
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? memberId = null,
    Object? amount = null,
    Object? method = null,
    Object? status = null,
    Object? isRefund = null,
    Object? paidAt = null,
  }) {
    return _then(
      _$PaymentViewImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        memberId: null == memberId
            ? _value.memberId
            : memberId // ignore: cast_nullable_to_non_nullable
                  as String,
        amount: null == amount
            ? _value.amount
            : amount // ignore: cast_nullable_to_non_nullable
                  as String,
        method: null == method
            ? _value.method
            : method // ignore: cast_nullable_to_non_nullable
                  as String,
        status: null == status
            ? _value.status
            : status // ignore: cast_nullable_to_non_nullable
                  as String,
        isRefund: null == isRefund
            ? _value.isRefund
            : isRefund // ignore: cast_nullable_to_non_nullable
                  as bool,
        paidAt: null == paidAt
            ? _value.paidAt
            : paidAt // ignore: cast_nullable_to_non_nullable
                  as DateTime,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$PaymentViewImpl implements _PaymentView {
  const _$PaymentViewImpl({
    required this.id,
    required this.memberId,
    required this.amount,
    required this.method,
    required this.status,
    required this.isRefund,
    required this.paidAt,
  });

  factory _$PaymentViewImpl.fromJson(Map<String, dynamic> json) =>
      _$$PaymentViewImplFromJson(json);

  @override
  final String id;
  @override
  final String memberId;
  @override
  final String amount;
  @override
  final String method;
  @override
  final String status;
  @override
  final bool isRefund;
  @override
  final DateTime paidAt;

  @override
  String toString() {
    return 'PaymentView(id: $id, memberId: $memberId, amount: $amount, method: $method, status: $status, isRefund: $isRefund, paidAt: $paidAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$PaymentViewImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.memberId, memberId) ||
                other.memberId == memberId) &&
            (identical(other.amount, amount) || other.amount == amount) &&
            (identical(other.method, method) || other.method == method) &&
            (identical(other.status, status) || other.status == status) &&
            (identical(other.isRefund, isRefund) ||
                other.isRefund == isRefund) &&
            (identical(other.paidAt, paidAt) || other.paidAt == paidAt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    memberId,
    amount,
    method,
    status,
    isRefund,
    paidAt,
  );

  /// Create a copy of PaymentView
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$PaymentViewImplCopyWith<_$PaymentViewImpl> get copyWith =>
      __$$PaymentViewImplCopyWithImpl<_$PaymentViewImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$PaymentViewImplToJson(this);
  }
}

abstract class _PaymentView implements PaymentView {
  const factory _PaymentView({
    required final String id,
    required final String memberId,
    required final String amount,
    required final String method,
    required final String status,
    required final bool isRefund,
    required final DateTime paidAt,
  }) = _$PaymentViewImpl;

  factory _PaymentView.fromJson(Map<String, dynamic> json) =
      _$PaymentViewImpl.fromJson;

  @override
  String get id;
  @override
  String get memberId;
  @override
  String get amount;
  @override
  String get method;
  @override
  String get status;
  @override
  bool get isRefund;
  @override
  DateTime get paidAt;

  /// Create a copy of PaymentView
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$PaymentViewImplCopyWith<_$PaymentViewImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

SessionPayload _$SessionPayloadFromJson(Map<String, dynamic> json) {
  return _SessionPayload.fromJson(json);
}

/// @nodoc
mixin _$SessionPayload {
  MemberProfile get member => throw _privateConstructorUsedError;
  OrgSummary get organization => throw _privateConstructorUsedError;
  BranchSummary get branch => throw _privateConstructorUsedError;

  /// Serializes this SessionPayload to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of SessionPayload
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $SessionPayloadCopyWith<SessionPayload> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $SessionPayloadCopyWith<$Res> {
  factory $SessionPayloadCopyWith(
    SessionPayload value,
    $Res Function(SessionPayload) then,
  ) = _$SessionPayloadCopyWithImpl<$Res, SessionPayload>;
  @useResult
  $Res call({
    MemberProfile member,
    OrgSummary organization,
    BranchSummary branch,
  });

  $MemberProfileCopyWith<$Res> get member;
  $OrgSummaryCopyWith<$Res> get organization;
  $BranchSummaryCopyWith<$Res> get branch;
}

/// @nodoc
class _$SessionPayloadCopyWithImpl<$Res, $Val extends SessionPayload>
    implements $SessionPayloadCopyWith<$Res> {
  _$SessionPayloadCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of SessionPayload
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? member = null,
    Object? organization = null,
    Object? branch = null,
  }) {
    return _then(
      _value.copyWith(
            member: null == member
                ? _value.member
                : member // ignore: cast_nullable_to_non_nullable
                      as MemberProfile,
            organization: null == organization
                ? _value.organization
                : organization // ignore: cast_nullable_to_non_nullable
                      as OrgSummary,
            branch: null == branch
                ? _value.branch
                : branch // ignore: cast_nullable_to_non_nullable
                      as BranchSummary,
          )
          as $Val,
    );
  }

  /// Create a copy of SessionPayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $MemberProfileCopyWith<$Res> get member {
    return $MemberProfileCopyWith<$Res>(_value.member, (value) {
      return _then(_value.copyWith(member: value) as $Val);
    });
  }

  /// Create a copy of SessionPayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $OrgSummaryCopyWith<$Res> get organization {
    return $OrgSummaryCopyWith<$Res>(_value.organization, (value) {
      return _then(_value.copyWith(organization: value) as $Val);
    });
  }

  /// Create a copy of SessionPayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $BranchSummaryCopyWith<$Res> get branch {
    return $BranchSummaryCopyWith<$Res>(_value.branch, (value) {
      return _then(_value.copyWith(branch: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$SessionPayloadImplCopyWith<$Res>
    implements $SessionPayloadCopyWith<$Res> {
  factory _$$SessionPayloadImplCopyWith(
    _$SessionPayloadImpl value,
    $Res Function(_$SessionPayloadImpl) then,
  ) = __$$SessionPayloadImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    MemberProfile member,
    OrgSummary organization,
    BranchSummary branch,
  });

  @override
  $MemberProfileCopyWith<$Res> get member;
  @override
  $OrgSummaryCopyWith<$Res> get organization;
  @override
  $BranchSummaryCopyWith<$Res> get branch;
}

/// @nodoc
class __$$SessionPayloadImplCopyWithImpl<$Res>
    extends _$SessionPayloadCopyWithImpl<$Res, _$SessionPayloadImpl>
    implements _$$SessionPayloadImplCopyWith<$Res> {
  __$$SessionPayloadImplCopyWithImpl(
    _$SessionPayloadImpl _value,
    $Res Function(_$SessionPayloadImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of SessionPayload
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? member = null,
    Object? organization = null,
    Object? branch = null,
  }) {
    return _then(
      _$SessionPayloadImpl(
        member: null == member
            ? _value.member
            : member // ignore: cast_nullable_to_non_nullable
                  as MemberProfile,
        organization: null == organization
            ? _value.organization
            : organization // ignore: cast_nullable_to_non_nullable
                  as OrgSummary,
        branch: null == branch
            ? _value.branch
            : branch // ignore: cast_nullable_to_non_nullable
                  as BranchSummary,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$SessionPayloadImpl implements _SessionPayload {
  const _$SessionPayloadImpl({
    required this.member,
    required this.organization,
    required this.branch,
  });

  factory _$SessionPayloadImpl.fromJson(Map<String, dynamic> json) =>
      _$$SessionPayloadImplFromJson(json);

  @override
  final MemberProfile member;
  @override
  final OrgSummary organization;
  @override
  final BranchSummary branch;

  @override
  String toString() {
    return 'SessionPayload(member: $member, organization: $organization, branch: $branch)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SessionPayloadImpl &&
            (identical(other.member, member) || other.member == member) &&
            (identical(other.organization, organization) ||
                other.organization == organization) &&
            (identical(other.branch, branch) || other.branch == branch));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, member, organization, branch);

  /// Create a copy of SessionPayload
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$SessionPayloadImplCopyWith<_$SessionPayloadImpl> get copyWith =>
      __$$SessionPayloadImplCopyWithImpl<_$SessionPayloadImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$SessionPayloadImplToJson(this);
  }
}

abstract class _SessionPayload implements SessionPayload {
  const factory _SessionPayload({
    required final MemberProfile member,
    required final OrgSummary organization,
    required final BranchSummary branch,
  }) = _$SessionPayloadImpl;

  factory _SessionPayload.fromJson(Map<String, dynamic> json) =
      _$SessionPayloadImpl.fromJson;

  @override
  MemberProfile get member;
  @override
  OrgSummary get organization;
  @override
  BranchSummary get branch;

  /// Create a copy of SessionPayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$SessionPayloadImplCopyWith<_$SessionPayloadImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

HomePayload _$HomePayloadFromJson(Map<String, dynamic> json) {
  return _HomePayload.fromJson(json);
}

/// @nodoc
mixin _$HomePayload {
  MemberProfile get member => throw _privateConstructorUsedError;
  OrgSummary get organization => throw _privateConstructorUsedError;
  BranchSummary get branch => throw _privateConstructorUsedError;
  MembershipView? get currentMembership => throw _privateConstructorUsedError;
  String get outstandingPending => throw _privateConstructorUsedError;

  /// Serializes this HomePayload to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of HomePayload
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $HomePayloadCopyWith<HomePayload> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $HomePayloadCopyWith<$Res> {
  factory $HomePayloadCopyWith(
    HomePayload value,
    $Res Function(HomePayload) then,
  ) = _$HomePayloadCopyWithImpl<$Res, HomePayload>;
  @useResult
  $Res call({
    MemberProfile member,
    OrgSummary organization,
    BranchSummary branch,
    MembershipView? currentMembership,
    String outstandingPending,
  });

  $MemberProfileCopyWith<$Res> get member;
  $OrgSummaryCopyWith<$Res> get organization;
  $BranchSummaryCopyWith<$Res> get branch;
  $MembershipViewCopyWith<$Res>? get currentMembership;
}

/// @nodoc
class _$HomePayloadCopyWithImpl<$Res, $Val extends HomePayload>
    implements $HomePayloadCopyWith<$Res> {
  _$HomePayloadCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of HomePayload
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? member = null,
    Object? organization = null,
    Object? branch = null,
    Object? currentMembership = freezed,
    Object? outstandingPending = null,
  }) {
    return _then(
      _value.copyWith(
            member: null == member
                ? _value.member
                : member // ignore: cast_nullable_to_non_nullable
                      as MemberProfile,
            organization: null == organization
                ? _value.organization
                : organization // ignore: cast_nullable_to_non_nullable
                      as OrgSummary,
            branch: null == branch
                ? _value.branch
                : branch // ignore: cast_nullable_to_non_nullable
                      as BranchSummary,
            currentMembership: freezed == currentMembership
                ? _value.currentMembership
                : currentMembership // ignore: cast_nullable_to_non_nullable
                      as MembershipView?,
            outstandingPending: null == outstandingPending
                ? _value.outstandingPending
                : outstandingPending // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }

  /// Create a copy of HomePayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $MemberProfileCopyWith<$Res> get member {
    return $MemberProfileCopyWith<$Res>(_value.member, (value) {
      return _then(_value.copyWith(member: value) as $Val);
    });
  }

  /// Create a copy of HomePayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $OrgSummaryCopyWith<$Res> get organization {
    return $OrgSummaryCopyWith<$Res>(_value.organization, (value) {
      return _then(_value.copyWith(organization: value) as $Val);
    });
  }

  /// Create a copy of HomePayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $BranchSummaryCopyWith<$Res> get branch {
    return $BranchSummaryCopyWith<$Res>(_value.branch, (value) {
      return _then(_value.copyWith(branch: value) as $Val);
    });
  }

  /// Create a copy of HomePayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $MembershipViewCopyWith<$Res>? get currentMembership {
    if (_value.currentMembership == null) {
      return null;
    }

    return $MembershipViewCopyWith<$Res>(_value.currentMembership!, (value) {
      return _then(_value.copyWith(currentMembership: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$HomePayloadImplCopyWith<$Res>
    implements $HomePayloadCopyWith<$Res> {
  factory _$$HomePayloadImplCopyWith(
    _$HomePayloadImpl value,
    $Res Function(_$HomePayloadImpl) then,
  ) = __$$HomePayloadImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    MemberProfile member,
    OrgSummary organization,
    BranchSummary branch,
    MembershipView? currentMembership,
    String outstandingPending,
  });

  @override
  $MemberProfileCopyWith<$Res> get member;
  @override
  $OrgSummaryCopyWith<$Res> get organization;
  @override
  $BranchSummaryCopyWith<$Res> get branch;
  @override
  $MembershipViewCopyWith<$Res>? get currentMembership;
}

/// @nodoc
class __$$HomePayloadImplCopyWithImpl<$Res>
    extends _$HomePayloadCopyWithImpl<$Res, _$HomePayloadImpl>
    implements _$$HomePayloadImplCopyWith<$Res> {
  __$$HomePayloadImplCopyWithImpl(
    _$HomePayloadImpl _value,
    $Res Function(_$HomePayloadImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of HomePayload
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? member = null,
    Object? organization = null,
    Object? branch = null,
    Object? currentMembership = freezed,
    Object? outstandingPending = null,
  }) {
    return _then(
      _$HomePayloadImpl(
        member: null == member
            ? _value.member
            : member // ignore: cast_nullable_to_non_nullable
                  as MemberProfile,
        organization: null == organization
            ? _value.organization
            : organization // ignore: cast_nullable_to_non_nullable
                  as OrgSummary,
        branch: null == branch
            ? _value.branch
            : branch // ignore: cast_nullable_to_non_nullable
                  as BranchSummary,
        currentMembership: freezed == currentMembership
            ? _value.currentMembership
            : currentMembership // ignore: cast_nullable_to_non_nullable
                  as MembershipView?,
        outstandingPending: null == outstandingPending
            ? _value.outstandingPending
            : outstandingPending // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$HomePayloadImpl implements _HomePayload {
  const _$HomePayloadImpl({
    required this.member,
    required this.organization,
    required this.branch,
    this.currentMembership,
    required this.outstandingPending,
  });

  factory _$HomePayloadImpl.fromJson(Map<String, dynamic> json) =>
      _$$HomePayloadImplFromJson(json);

  @override
  final MemberProfile member;
  @override
  final OrgSummary organization;
  @override
  final BranchSummary branch;
  @override
  final MembershipView? currentMembership;
  @override
  final String outstandingPending;

  @override
  String toString() {
    return 'HomePayload(member: $member, organization: $organization, branch: $branch, currentMembership: $currentMembership, outstandingPending: $outstandingPending)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$HomePayloadImpl &&
            (identical(other.member, member) || other.member == member) &&
            (identical(other.organization, organization) ||
                other.organization == organization) &&
            (identical(other.branch, branch) || other.branch == branch) &&
            (identical(other.currentMembership, currentMembership) ||
                other.currentMembership == currentMembership) &&
            (identical(other.outstandingPending, outstandingPending) ||
                other.outstandingPending == outstandingPending));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    member,
    organization,
    branch,
    currentMembership,
    outstandingPending,
  );

  /// Create a copy of HomePayload
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$HomePayloadImplCopyWith<_$HomePayloadImpl> get copyWith =>
      __$$HomePayloadImplCopyWithImpl<_$HomePayloadImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$HomePayloadImplToJson(this);
  }
}

abstract class _HomePayload implements HomePayload {
  const factory _HomePayload({
    required final MemberProfile member,
    required final OrgSummary organization,
    required final BranchSummary branch,
    final MembershipView? currentMembership,
    required final String outstandingPending,
  }) = _$HomePayloadImpl;

  factory _HomePayload.fromJson(Map<String, dynamic> json) =
      _$HomePayloadImpl.fromJson;

  @override
  MemberProfile get member;
  @override
  OrgSummary get organization;
  @override
  BranchSummary get branch;
  @override
  MembershipView? get currentMembership;
  @override
  String get outstandingPending;

  /// Create a copy of HomePayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$HomePayloadImplCopyWith<_$HomePayloadImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

LoginPayload _$LoginPayloadFromJson(Map<String, dynamic> json) {
  return _LoginPayload.fromJson(json);
}

/// @nodoc
mixin _$LoginPayload {
  String get accessToken => throw _privateConstructorUsedError;
  String get refreshToken => throw _privateConstructorUsedError;
  int get expiresIn => throw _privateConstructorUsedError;
  MemberProfile get member => throw _privateConstructorUsedError;
  OrgSummary get organization => throw _privateConstructorUsedError;
  BranchSummary get branch => throw _privateConstructorUsedError;

  /// Serializes this LoginPayload to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of LoginPayload
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $LoginPayloadCopyWith<LoginPayload> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $LoginPayloadCopyWith<$Res> {
  factory $LoginPayloadCopyWith(
    LoginPayload value,
    $Res Function(LoginPayload) then,
  ) = _$LoginPayloadCopyWithImpl<$Res, LoginPayload>;
  @useResult
  $Res call({
    String accessToken,
    String refreshToken,
    int expiresIn,
    MemberProfile member,
    OrgSummary organization,
    BranchSummary branch,
  });

  $MemberProfileCopyWith<$Res> get member;
  $OrgSummaryCopyWith<$Res> get organization;
  $BranchSummaryCopyWith<$Res> get branch;
}

/// @nodoc
class _$LoginPayloadCopyWithImpl<$Res, $Val extends LoginPayload>
    implements $LoginPayloadCopyWith<$Res> {
  _$LoginPayloadCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of LoginPayload
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? accessToken = null,
    Object? refreshToken = null,
    Object? expiresIn = null,
    Object? member = null,
    Object? organization = null,
    Object? branch = null,
  }) {
    return _then(
      _value.copyWith(
            accessToken: null == accessToken
                ? _value.accessToken
                : accessToken // ignore: cast_nullable_to_non_nullable
                      as String,
            refreshToken: null == refreshToken
                ? _value.refreshToken
                : refreshToken // ignore: cast_nullable_to_non_nullable
                      as String,
            expiresIn: null == expiresIn
                ? _value.expiresIn
                : expiresIn // ignore: cast_nullable_to_non_nullable
                      as int,
            member: null == member
                ? _value.member
                : member // ignore: cast_nullable_to_non_nullable
                      as MemberProfile,
            organization: null == organization
                ? _value.organization
                : organization // ignore: cast_nullable_to_non_nullable
                      as OrgSummary,
            branch: null == branch
                ? _value.branch
                : branch // ignore: cast_nullable_to_non_nullable
                      as BranchSummary,
          )
          as $Val,
    );
  }

  /// Create a copy of LoginPayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $MemberProfileCopyWith<$Res> get member {
    return $MemberProfileCopyWith<$Res>(_value.member, (value) {
      return _then(_value.copyWith(member: value) as $Val);
    });
  }

  /// Create a copy of LoginPayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $OrgSummaryCopyWith<$Res> get organization {
    return $OrgSummaryCopyWith<$Res>(_value.organization, (value) {
      return _then(_value.copyWith(organization: value) as $Val);
    });
  }

  /// Create a copy of LoginPayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $BranchSummaryCopyWith<$Res> get branch {
    return $BranchSummaryCopyWith<$Res>(_value.branch, (value) {
      return _then(_value.copyWith(branch: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$LoginPayloadImplCopyWith<$Res>
    implements $LoginPayloadCopyWith<$Res> {
  factory _$$LoginPayloadImplCopyWith(
    _$LoginPayloadImpl value,
    $Res Function(_$LoginPayloadImpl) then,
  ) = __$$LoginPayloadImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String accessToken,
    String refreshToken,
    int expiresIn,
    MemberProfile member,
    OrgSummary organization,
    BranchSummary branch,
  });

  @override
  $MemberProfileCopyWith<$Res> get member;
  @override
  $OrgSummaryCopyWith<$Res> get organization;
  @override
  $BranchSummaryCopyWith<$Res> get branch;
}

/// @nodoc
class __$$LoginPayloadImplCopyWithImpl<$Res>
    extends _$LoginPayloadCopyWithImpl<$Res, _$LoginPayloadImpl>
    implements _$$LoginPayloadImplCopyWith<$Res> {
  __$$LoginPayloadImplCopyWithImpl(
    _$LoginPayloadImpl _value,
    $Res Function(_$LoginPayloadImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of LoginPayload
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? accessToken = null,
    Object? refreshToken = null,
    Object? expiresIn = null,
    Object? member = null,
    Object? organization = null,
    Object? branch = null,
  }) {
    return _then(
      _$LoginPayloadImpl(
        accessToken: null == accessToken
            ? _value.accessToken
            : accessToken // ignore: cast_nullable_to_non_nullable
                  as String,
        refreshToken: null == refreshToken
            ? _value.refreshToken
            : refreshToken // ignore: cast_nullable_to_non_nullable
                  as String,
        expiresIn: null == expiresIn
            ? _value.expiresIn
            : expiresIn // ignore: cast_nullable_to_non_nullable
                  as int,
        member: null == member
            ? _value.member
            : member // ignore: cast_nullable_to_non_nullable
                  as MemberProfile,
        organization: null == organization
            ? _value.organization
            : organization // ignore: cast_nullable_to_non_nullable
                  as OrgSummary,
        branch: null == branch
            ? _value.branch
            : branch // ignore: cast_nullable_to_non_nullable
                  as BranchSummary,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$LoginPayloadImpl implements _LoginPayload {
  const _$LoginPayloadImpl({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
    required this.member,
    required this.organization,
    required this.branch,
  });

  factory _$LoginPayloadImpl.fromJson(Map<String, dynamic> json) =>
      _$$LoginPayloadImplFromJson(json);

  @override
  final String accessToken;
  @override
  final String refreshToken;
  @override
  final int expiresIn;
  @override
  final MemberProfile member;
  @override
  final OrgSummary organization;
  @override
  final BranchSummary branch;

  @override
  String toString() {
    return 'LoginPayload(accessToken: $accessToken, refreshToken: $refreshToken, expiresIn: $expiresIn, member: $member, organization: $organization, branch: $branch)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$LoginPayloadImpl &&
            (identical(other.accessToken, accessToken) ||
                other.accessToken == accessToken) &&
            (identical(other.refreshToken, refreshToken) ||
                other.refreshToken == refreshToken) &&
            (identical(other.expiresIn, expiresIn) ||
                other.expiresIn == expiresIn) &&
            (identical(other.member, member) || other.member == member) &&
            (identical(other.organization, organization) ||
                other.organization == organization) &&
            (identical(other.branch, branch) || other.branch == branch));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    accessToken,
    refreshToken,
    expiresIn,
    member,
    organization,
    branch,
  );

  /// Create a copy of LoginPayload
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$LoginPayloadImplCopyWith<_$LoginPayloadImpl> get copyWith =>
      __$$LoginPayloadImplCopyWithImpl<_$LoginPayloadImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$LoginPayloadImplToJson(this);
  }
}

abstract class _LoginPayload implements LoginPayload {
  const factory _LoginPayload({
    required final String accessToken,
    required final String refreshToken,
    required final int expiresIn,
    required final MemberProfile member,
    required final OrgSummary organization,
    required final BranchSummary branch,
  }) = _$LoginPayloadImpl;

  factory _LoginPayload.fromJson(Map<String, dynamic> json) =
      _$LoginPayloadImpl.fromJson;

  @override
  String get accessToken;
  @override
  String get refreshToken;
  @override
  int get expiresIn;
  @override
  MemberProfile get member;
  @override
  OrgSummary get organization;
  @override
  BranchSummary get branch;

  /// Create a copy of LoginPayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$LoginPayloadImplCopyWith<_$LoginPayloadImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

RefreshPayload _$RefreshPayloadFromJson(Map<String, dynamic> json) {
  return _RefreshPayload.fromJson(json);
}

/// @nodoc
mixin _$RefreshPayload {
  String get accessToken => throw _privateConstructorUsedError;
  String get refreshToken => throw _privateConstructorUsedError;
  int get expiresIn => throw _privateConstructorUsedError;

  /// Serializes this RefreshPayload to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of RefreshPayload
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $RefreshPayloadCopyWith<RefreshPayload> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $RefreshPayloadCopyWith<$Res> {
  factory $RefreshPayloadCopyWith(
    RefreshPayload value,
    $Res Function(RefreshPayload) then,
  ) = _$RefreshPayloadCopyWithImpl<$Res, RefreshPayload>;
  @useResult
  $Res call({String accessToken, String refreshToken, int expiresIn});
}

/// @nodoc
class _$RefreshPayloadCopyWithImpl<$Res, $Val extends RefreshPayload>
    implements $RefreshPayloadCopyWith<$Res> {
  _$RefreshPayloadCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of RefreshPayload
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? accessToken = null,
    Object? refreshToken = null,
    Object? expiresIn = null,
  }) {
    return _then(
      _value.copyWith(
            accessToken: null == accessToken
                ? _value.accessToken
                : accessToken // ignore: cast_nullable_to_non_nullable
                      as String,
            refreshToken: null == refreshToken
                ? _value.refreshToken
                : refreshToken // ignore: cast_nullable_to_non_nullable
                      as String,
            expiresIn: null == expiresIn
                ? _value.expiresIn
                : expiresIn // ignore: cast_nullable_to_non_nullable
                      as int,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$RefreshPayloadImplCopyWith<$Res>
    implements $RefreshPayloadCopyWith<$Res> {
  factory _$$RefreshPayloadImplCopyWith(
    _$RefreshPayloadImpl value,
    $Res Function(_$RefreshPayloadImpl) then,
  ) = __$$RefreshPayloadImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String accessToken, String refreshToken, int expiresIn});
}

/// @nodoc
class __$$RefreshPayloadImplCopyWithImpl<$Res>
    extends _$RefreshPayloadCopyWithImpl<$Res, _$RefreshPayloadImpl>
    implements _$$RefreshPayloadImplCopyWith<$Res> {
  __$$RefreshPayloadImplCopyWithImpl(
    _$RefreshPayloadImpl _value,
    $Res Function(_$RefreshPayloadImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of RefreshPayload
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? accessToken = null,
    Object? refreshToken = null,
    Object? expiresIn = null,
  }) {
    return _then(
      _$RefreshPayloadImpl(
        accessToken: null == accessToken
            ? _value.accessToken
            : accessToken // ignore: cast_nullable_to_non_nullable
                  as String,
        refreshToken: null == refreshToken
            ? _value.refreshToken
            : refreshToken // ignore: cast_nullable_to_non_nullable
                  as String,
        expiresIn: null == expiresIn
            ? _value.expiresIn
            : expiresIn // ignore: cast_nullable_to_non_nullable
                  as int,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$RefreshPayloadImpl implements _RefreshPayload {
  const _$RefreshPayloadImpl({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
  });

  factory _$RefreshPayloadImpl.fromJson(Map<String, dynamic> json) =>
      _$$RefreshPayloadImplFromJson(json);

  @override
  final String accessToken;
  @override
  final String refreshToken;
  @override
  final int expiresIn;

  @override
  String toString() {
    return 'RefreshPayload(accessToken: $accessToken, refreshToken: $refreshToken, expiresIn: $expiresIn)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$RefreshPayloadImpl &&
            (identical(other.accessToken, accessToken) ||
                other.accessToken == accessToken) &&
            (identical(other.refreshToken, refreshToken) ||
                other.refreshToken == refreshToken) &&
            (identical(other.expiresIn, expiresIn) ||
                other.expiresIn == expiresIn));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, accessToken, refreshToken, expiresIn);

  /// Create a copy of RefreshPayload
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$RefreshPayloadImplCopyWith<_$RefreshPayloadImpl> get copyWith =>
      __$$RefreshPayloadImplCopyWithImpl<_$RefreshPayloadImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$RefreshPayloadImplToJson(this);
  }
}

abstract class _RefreshPayload implements RefreshPayload {
  const factory _RefreshPayload({
    required final String accessToken,
    required final String refreshToken,
    required final int expiresIn,
  }) = _$RefreshPayloadImpl;

  factory _RefreshPayload.fromJson(Map<String, dynamic> json) =
      _$RefreshPayloadImpl.fromJson;

  @override
  String get accessToken;
  @override
  String get refreshToken;
  @override
  int get expiresIn;

  /// Create a copy of RefreshPayload
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$RefreshPayloadImplCopyWith<_$RefreshPayloadImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
