-- Locked Decision 1.21 — expenses are a live book (editable/deletable), grouped by an enum,
-- dated as a civil DATE. CHARACTER SET utf8mb4 COLLATE utf8mb4_bin on every CHAR(26) so the
-- FKs against Phase 1's binary ids do not hit errno 3780.

CREATE TABLE `expenses` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `organizationId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `branchId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    `category` ENUM('RENT', 'UTILITIES', 'SALARIES', 'EQUIPMENT', 'MARKETING', 'SOFTWARE', 'MAINTENANCE', 'SUPPLIES', 'PROFESSIONAL_FEES', 'OTHER') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `expenseDate` DATE NOT NULL,
    `paidTo` VARCHAR(120) NULL,
    `notes` VARCHAR(500) NULL,
    `createdByUserId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `expenses_organizationId_expenseDate_idx`(`organizationId`, `expenseDate`),
    INDEX `expenses_organizationId_branchId_idx`(`organizationId`, `branchId`),
    INDEX `expenses_organizationId_category_idx`(`organizationId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `expenses` ADD CONSTRAINT `expenses_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
