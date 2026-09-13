-- AlterTable: an attendance "day" is only meaningful in the gym's own timezone — taking the UTC
-- day files a 5 AM IST check-in under yesterday (Locked Decision 1.17.4).
ALTER TABLE `organizations`
    ADD COLUMN `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata';

-- AlterTable: which day the visit counts as, the term that covered it, why it wasn't covered, and
-- who waved them through (Locked Decisions 1.17.1 and 1.17.4).
-- `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` is spelled out on the CHAR(26) columns because the
-- referenced `id` columns are binary from Phase 1's collation migration, and MySQL refuses a
-- foreign key across mismatched collations (errno 3780).
ALTER TABLE `attendances`
    ADD COLUMN `attendanceDate` DATE NOT NULL,
    ADD COLUMN `membershipId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    ADD COLUMN `overrideReason` ENUM('NO_MEMBERSHIP', 'EXPIRED', 'FROZEN', 'CANCELLED', 'NOT_STARTED') NULL,
    ADD COLUMN `markedByUserId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;

-- CreateIndex: one check-in per member per calendar day (1.17.2). A real constraint rather than a
-- check-then-insert, because two taps on a slow connection are genuinely concurrent and under
-- REPEATABLE READ both transactions would see no existing row.
CREATE UNIQUE INDEX `attendances_memberId_attendanceDate_key` ON `attendances`(`memberId`, `attendanceDate`);

-- CreateIndex: the daily register, per branch and org-wide.
CREATE INDEX `attendances_organizationId_branchId_attendanceDate_idx` ON `attendances`(`organizationId`, `branchId`, `attendanceDate`);
CREATE INDEX `attendances_organizationId_attendanceDate_idx` ON `attendances`(`organizationId`, `attendanceDate`);

-- AddForeignKey
ALTER TABLE `attendances` ADD CONSTRAINT `attendances_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `attendances` ADD CONSTRAINT `attendances_membershipId_fkey` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `attendances` ADD CONSTRAINT `attendances_markedByUserId_fkey` FOREIGN KEY (`markedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
