-- Phase 5: membership lifecycle bookkeeping — DEVELOPMENT_PLAN.md Locked Decision 1.15.
--
-- `frozenAt` / `totalFrozenDays` back 1.15.2 (freezing pauses the clock): the shift applied to
-- `endDate` on unfreeze can't be derived after the fact, so the current freeze and the running
-- total are both recorded. `endDate - totalFrozenDays` still reconstructs the original term.
--
-- `previousMembershipId` backs 1.15.3/1.15.4: renewals and mid-term plan changes create a new
-- row, and this links it to the row it succeeded so a member's term chain is navigable.
--
-- COLLATE utf8mb4_bin is spelled out on the CHAR(26) column for the same reason as the
-- `char_columns_binary_collation` and `refresh_token_family` migrations: Prisma's MySQL migrator
-- emits no COLLATE clause, so the column would land as utf8mb4_unicode_ci (Locked Decision 1.2).
-- Here it is not merely a correctness nicety — MySQL rejects a self-referencing foreign key
-- outright (error 3780) when the referencing and referenced columns disagree on collation.

-- AlterTable
ALTER TABLE `memberships` ADD COLUMN `frozenAt` DATETIME(3) NULL,
    ADD COLUMN `previousMembershipId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    ADD COLUMN `totalFrozenDays` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `memberships_organizationId_memberId_status_idx` ON `memberships`(`organizationId`, `memberId`, `status`);

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_previousMembershipId_fkey` FOREIGN KEY (`previousMembershipId`) REFERENCES `memberships`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
