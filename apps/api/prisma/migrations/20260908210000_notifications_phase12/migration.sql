-- Locked Decision 1.22 — templates grouped by enum event/channel; log unique on
-- (organizationId, event, entityId, channel, localDate) is the idempotency lock.
-- CHARACTER SET utf8mb4 COLLATE utf8mb4_bin on every CHAR(26) so the FKs against
-- Phase 1's binary ids do not hit errno 3780.

CREATE TABLE `notification_templates` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `organizationId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `event` ENUM('MEMBERSHIP_EXPIRING', 'PAYMENT_DUE') NOT NULL,
    `channel` ENUM('SMS', 'EMAIL', 'PUSH') NOT NULL,
    `body` VARCHAR(1000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_templates_organizationId_event_channel_key`(`organizationId`, `event`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_logs` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `organizationId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `memberId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    `event` ENUM('MEMBERSHIP_EXPIRING', 'PAYMENT_DUE') NOT NULL,
    `channel` ENUM('SMS', 'EMAIL', 'PUSH') NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `entityType` ENUM('MEMBERSHIP', 'INVOICE') NOT NULL,
    `entityId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `localDate` DATE NOT NULL,
    `body` VARCHAR(1000) NOT NULL,
    `lastError` VARCHAR(500) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `notification_logs_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `notification_logs_organizationId_status_idx`(`organizationId`, `status`),
    INDEX `notification_logs_organizationId_event_idx`(`organizationId`, `event`),
    UNIQUE INDEX `notification_logs_idempotency_key`(`organizationId`, `event`, `entityId`, `channel`, `localDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `notification_templates` ADD CONSTRAINT `notification_templates_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `notification_logs` ADD CONSTRAINT `notification_logs_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `notification_logs` ADD CONSTRAINT `notification_logs_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
