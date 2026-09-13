-- Locked Decision 1.23.2 — portal password on Member (nullable = not enabled);
-- member_refresh_tokens mirrors refresh_tokens so staff userId stays NOT NULL.
-- CHARACTER SET utf8mb4 COLLATE utf8mb4_bin on every CHAR so FKs against Phase 1
-- binary ids do not hit errno 3780.

ALTER TABLE `members` ADD COLUMN `passwordHash` VARCHAR(60) NULL;

CREATE TABLE `member_refresh_tokens` (
    `id` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `memberId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `familyId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `tokenHash` CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `member_refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `member_refresh_tokens_memberId_idx`(`memberId`),
    INDEX `member_refresh_tokens_familyId_idx`(`familyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `member_refresh_tokens` ADD CONSTRAINT `member_refresh_tokens_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
