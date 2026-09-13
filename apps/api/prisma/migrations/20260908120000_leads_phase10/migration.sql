-- Locked Decision 1.20 — leads are a status-driven pipeline, not a soft-deletable roster.
-- CHARACTER SET utf8mb4 COLLATE utf8mb4_bin on every CHAR(26) so the FKs against Phase 1's
-- binary ids do not hit errno 3780.

CREATE TABLE `leads` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `organizationId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `branchId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `source` VARCHAR(60) NULL,
    `status` ENUM('NEW', 'CONTACTED', 'TRIAL_SCHEDULED', 'CONVERTED', 'LOST') NOT NULL DEFAULT 'NEW',
    `assignedToUserId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    `followUpAt` DATETIME(3) NULL,
    `convertedMemberId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `leads_convertedMemberId_key`(`convertedMemberId`),
    INDEX `leads_organizationId_status_idx`(`organizationId`, `status`),
    INDEX `leads_organizationId_phone_idx`(`organizationId`, `phone`),
    INDEX `leads_organizationId_branchId_idx`(`organizationId`, `branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `leads` ADD CONSTRAINT `leads_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `leads` ADD CONSTRAINT `leads_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `leads` ADD CONSTRAINT `leads_assignedToUserId_fkey` FOREIGN KEY (`assignedToUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `leads` ADD CONSTRAINT `leads_convertedMemberId_fkey` FOREIGN KEY (`convertedMemberId`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
