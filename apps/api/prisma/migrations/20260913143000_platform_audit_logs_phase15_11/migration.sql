-- Phase 15.11 — platform_audit_logs (Section 10.6 / 10.15).
-- Additive. Gym audit_logs / payments / invoices / organizations unchanged.
-- CHAR ids are utf8mb4_bin so they can sit next to Phase 1 binary ids (errno 3780).

CREATE TABLE `platform_audit_logs` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `platformUserId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    `organizationId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `beforeJson` JSON NULL,
    `afterJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `platform_audit_logs_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `platform_audit_logs_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `platform_audit_logs_platformUserId_idx`(`platformUserId`),
    INDEX `platform_audit_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
