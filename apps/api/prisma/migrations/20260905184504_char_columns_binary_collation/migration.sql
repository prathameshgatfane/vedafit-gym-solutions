-- Locked Decision 1.2 (docs/architecture/DEVELOPMENT_PLAN.md) requires every ULID id/FK column
-- to use the case-sensitive, binary `utf8mb4_bin` collation. Prisma's MySQL migrator does not
-- expose a collation attribute in schema.prisma, and it created these CHAR(26) columns with the
-- server/connector default (`utf8mb4_unicode_ci`, case-insensitive) instead. This migration fixes
-- every such column, table by table, without touching any other (non-ID) column's collation.
--
-- FK checks are disabled for the duration because MySQL validates FK collation compatibility on
-- each ALTER TABLE; disabling briefly avoids ordering-dependent failures while every id/FK column
-- across both sides of each relation is converted to the same collation. Tables are empty at this
-- point (this runs right after the initial migration), so there is no data-integrity risk.
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `organizations`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `branches`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `organizationId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `users`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `organizationId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `branchId` CHAR(26) NULL COLLATE utf8mb4_bin,
  MODIFY `roleId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `roles`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `organizationId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `permissions`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `role_permissions`
  MODIFY `roleId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `permissionId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `members`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `organizationId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `branchId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `membership_plans`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `organizationId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `memberships`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `organizationId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `branchId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `memberId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `planId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `payments`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `organizationId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `memberId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `membershipId` CHAR(26) NULL COLLATE utf8mb4_bin,
  MODIFY `invoiceId` CHAR(26) NULL COLLATE utf8mb4_bin;

ALTER TABLE `invoices`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `organizationId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `memberId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `attendances`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `organizationId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `branchId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `memberId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `member_documents`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `memberId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `uploadedBy` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `refresh_tokens`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `userId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `password_reset_tokens`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `userId` CHAR(26) NOT NULL COLLATE utf8mb4_bin;

ALTER TABLE `audit_logs`
  MODIFY `id` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `organizationId` CHAR(26) NOT NULL COLLATE utf8mb4_bin,
  MODIFY `actorUserId` CHAR(26) NULL COLLATE utf8mb4_bin;

SET FOREIGN_KEY_CHECKS = 1;
