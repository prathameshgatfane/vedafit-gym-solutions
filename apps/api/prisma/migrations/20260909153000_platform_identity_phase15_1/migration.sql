-- Phase 15.1 — platform identity (Locked Decision 1.24.1).
-- Third audience: not gym users, not members. Additive; gym tables unchanged.
-- CHARACTER SET utf8mb4 COLLATE utf8mb4_bin on every CHAR so FKs against Phase 1
-- binary ids do not hit errno 3780. Email unique is global (one platform operator
-- catalog) and binary so case-folding cannot collide hashes.

CREATE TABLE `platform_users` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `passwordHash` VARCHAR(60) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `platform_users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_refresh_tokens` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `platformUserId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `familyId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `tokenHash` CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `platform_refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `platform_refresh_tokens_platformUserId_idx`(`platformUserId`),
    INDEX `platform_refresh_tokens_familyId_idx`(`familyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `platform_refresh_tokens` ADD CONSTRAINT `platform_refresh_tokens_platformUserId_fkey` FOREIGN KEY (`platformUserId`) REFERENCES `platform_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
