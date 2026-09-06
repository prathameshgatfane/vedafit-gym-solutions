-- Phase 2: refresh-token rotation with family-wide reuse detection.
--
-- `familyId` groups every token in one login session's rotation chain, so presenting an
-- already-rotated (or revoked) token can revoke the whole chain in a single statement instead
-- of only the token that was replayed. See DEVELOPMENT_PLAN.md Section 9 (2026-09-06).
--
-- `tokenHash` becomes CHAR(64) (SHA-256 hex) + UNIQUE so lookup-by-hash is a single index hit.
-- COLLATE utf8mb4_bin is applied explicitly here for the same reason as the
-- `char_columns_binary_collation` migration: Prisma's MySQL migrator emits no COLLATE clause and
-- the server default would otherwise make these case-insensitive (Locked Decision 1.2).

-- AlterTable
ALTER TABLE `password_reset_tokens`
    MODIFY `tokenHash` CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

-- AlterTable
ALTER TABLE `refresh_tokens`
    ADD COLUMN `familyId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    MODIFY `tokenHash` CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `password_reset_tokens_tokenHash_key` ON `password_reset_tokens`(`tokenHash`);

-- CreateIndex
CREATE UNIQUE INDEX `refresh_tokens_tokenHash_key` ON `refresh_tokens`(`tokenHash`);

-- CreateIndex
CREATE INDEX `refresh_tokens_familyId_idx` ON `refresh_tokens`(`familyId`);
