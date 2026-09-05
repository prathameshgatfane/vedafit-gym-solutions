-- CreateTable
CREATE TABLE `organizations` (
    `id` CHAR(26) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `organizations_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branches` (
    `id` CHAR(26) NOT NULL,
    `organizationId` CHAR(26) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `branches_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(26) NOT NULL,
    `organizationId` CHAR(26) NOT NULL,
    `branchId` CHAR(26) NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `roleId` CHAR(26) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `users_organizationId_email_idx`(`organizationId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(26) NOT NULL,
    `organizationId` CHAR(26) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `roles_organizationId_name_key`(`organizationId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` CHAR(26) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,

    UNIQUE INDEX `permissions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` CHAR(26) NOT NULL,
    `permissionId` CHAR(26) NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `members` (
    `id` CHAR(26) NOT NULL,
    `organizationId` CHAR(26) NOT NULL,
    `branchId` CHAR(26) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `dateOfBirth` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `members_organizationId_phone_idx`(`organizationId`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_plans` (
    `id` CHAR(26) NOT NULL,
    `organizationId` CHAR(26) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `durationDays` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memberships` (
    `id` CHAR(26) NOT NULL,
    `organizationId` CHAR(26) NOT NULL,
    `branchId` CHAR(26) NOT NULL,
    `memberId` CHAR(26) NOT NULL,
    `planId` CHAR(26) NOT NULL,
    `priceAtPurchase` DECIMAL(10, 2) NOT NULL,
    `durationDaysAtPurchase` INTEGER NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'FROZEN', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `memberships_organizationId_endDate_idx`(`organizationId`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` CHAR(26) NOT NULL,
    `organizationId` CHAR(26) NOT NULL,
    `memberId` CHAR(26) NOT NULL,
    `membershipId` CHAR(26) NULL,
    `invoiceId` CHAR(26) NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `method` ENUM('CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER') NOT NULL,
    `status` ENUM('SUCCESS', 'FAILED', 'REFUNDED', 'PENDING') NOT NULL DEFAULT 'SUCCESS',
    `paidAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` CHAR(26) NOT NULL,
    `organizationId` CHAR(26) NOT NULL,
    `memberId` CHAR(26) NOT NULL,
    `invoiceNumber` VARCHAR(191) NOT NULL,
    `amountTotal` DECIMAL(10, 2) NOT NULL,
    `amountPaid` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `amountPending` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('DRAFT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_organizationId_invoiceNumber_key`(`organizationId`, `invoiceNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendances` (
    `id` CHAR(26) NOT NULL,
    `organizationId` CHAR(26) NOT NULL,
    `branchId` CHAR(26) NOT NULL,
    `memberId` CHAR(26) NOT NULL,
    `checkedInAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendances_memberId_checkedInAt_idx`(`memberId`, `checkedInAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_documents` (
    `id` CHAR(26) NOT NULL,
    `memberId` CHAR(26) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `fileUrl` VARCHAR(191) NOT NULL,
    `fileType` VARCHAR(191) NOT NULL,
    `fileSize` INTEGER NOT NULL,
    `uploadedBy` CHAR(26) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(26) NOT NULL,
    `userId` CHAR(26) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `refresh_tokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` CHAR(26) NOT NULL,
    `userId` CHAR(26) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `password_reset_tokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(26) NOT NULL,
    `organizationId` CHAR(26) NOT NULL,
    `actorUserId` CHAR(26) NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `beforeJson` JSON NULL,
    `afterJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_organizationId_entityType_entityId_idx`(`organizationId`, `entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `branches` ADD CONSTRAINT `branches_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_plans` ADD CONSTRAINT `membership_plans_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `membership_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_membershipId_fkey` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendances` ADD CONSTRAINT `attendances_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendances` ADD CONSTRAINT `attendances_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_documents` ADD CONSTRAINT `member_documents_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
