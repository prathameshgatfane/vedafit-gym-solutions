-- Phase 15.5 — SaaS plan catalog, entitlements, and one live subscription per org.
-- Platform software capability — not gym Payment / Invoice / Membership.
-- CHARACTER SET utf8mb4 COLLATE utf8mb4_bin on every CHAR(26) so FKs against
-- organizations.id do not hit errno 3780.

CREATE TABLE `saas_plans` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `code` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `priceMonthly` DECIMAL(10, 2) NOT NULL,
    `priceYearly` DECIMAL(10, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `trialDays` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `saas_plans_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `saas_plan_entitlements` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `planId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `key` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `valueType` ENUM('BOOLEAN', 'LIMIT', 'UNLIMITED') NOT NULL,
    `intValue` INTEGER NULL,
    `boolValue` BOOLEAN NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `saas_plan_entitlements_planId_key_key`(`planId`, `key`),
    INDEX `saas_plan_entitlements_planId_idx`(`planId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `organization_subscriptions` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `organizationId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `planId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED') NOT NULL,
    `billingInterval` ENUM('MONTHLY', 'YEARLY') NOT NULL,
    `priceSnapshot` DECIMAL(10, 2) NOT NULL,
    `currentPeriodStart` DATETIME(3) NOT NULL,
    `currentPeriodEnd` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `organization_subscriptions_organizationId_key`(`organizationId`),
    INDEX `organization_subscriptions_planId_idx`(`planId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `saas_plan_entitlements` ADD CONSTRAINT `saas_plan_entitlements_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `saas_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `organization_subscriptions` ADD CONSTRAINT `organization_subscriptions_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `organization_subscriptions` ADD CONSTRAINT `organization_subscriptions_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `saas_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
