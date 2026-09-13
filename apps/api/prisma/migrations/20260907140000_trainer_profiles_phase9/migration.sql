-- Locked Decision 1.19 — a trainer is a User with a TrainerProfile, and the roster is a
-- current assignment table, not a column on members (many-to-many: a member can have more than
-- one trainer). CHARACTER SET utf8mb4 COLLATE utf8mb4_bin on every CHAR(26) so the FKs against
-- Phase 1's binary ids do not hit errno 3780.

CREATE TABLE `trainer_profiles` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `organizationId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `userId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `specialization` VARCHAR(120) NULL,
    `commissionPct` DECIMAL(5, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trainer_profiles_userId_key`(`userId`),
    INDEX `trainer_profiles_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `trainer_assignments` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `organizationId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `trainerProfileId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `memberId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedByUserId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,

    UNIQUE INDEX `trainer_assignments_trainerProfileId_memberId_key`(`trainerProfileId`, `memberId`),
    INDEX `trainer_assignments_organizationId_memberId_idx`(`organizationId`, `memberId`),
    INDEX `trainer_assignments_trainerProfileId_idx`(`trainerProfileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `trainer_profiles` ADD CONSTRAINT `trainer_profiles_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `trainer_profiles` ADD CONSTRAINT `trainer_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `trainer_assignments` ADD CONSTRAINT `trainer_assignments_trainerProfileId_fkey` FOREIGN KEY (`trainerProfileId`) REFERENCES `trainer_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `trainer_assignments` ADD CONSTRAINT `trainer_assignments_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `trainer_assignments` ADD CONSTRAINT `trainer_assignments_assignedByUserId_fkey` FOREIGN KEY (`assignedByUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
