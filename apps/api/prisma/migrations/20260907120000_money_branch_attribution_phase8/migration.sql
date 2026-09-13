-- Locked Decision 1.18.2 — revenue is attributed to the branch that took the money, stamped at
-- write time, because `member.branchId` is editable and deriving attribution from it lets a member
-- transfer retroactively move historical revenue between branches.
--
-- Added nullable → backfilled → set NOT NULL, because both tables already hold rows. As in Phase 7,
-- `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` is spelled out on the CHAR(26) columns: the
-- referenced `branches.id` is binary from Phase 1's collation migration and MySQL refuses a foreign
-- key across mismatched collations (errno 3780).

ALTER TABLE `invoices`
    ADD COLUMN `branchId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;

ALTER TABLE `payments`
    ADD COLUMN `branchId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;

-- Backfill, best-available-estimate and honest about it (1.18.2). A membership term knows the
-- branch that sold it and is immutable, so it is preferred where there is one; everything else
-- falls back to the member's current branch, which is right for every member who has never
-- transferred and unverifiable for any who has.
UPDATE `invoices` `i`
    JOIN `memberships` `ms` ON `ms`.`id` = `i`.`membershipId`
    SET `i`.`branchId` = `ms`.`branchId`
    WHERE `i`.`branchId` IS NULL;

UPDATE `invoices` `i`
    JOIN `members` `m` ON `m`.`id` = `i`.`memberId`
    SET `i`.`branchId` = `m`.`branchId`
    WHERE `i`.`branchId` IS NULL;

-- A payment's branch is the invoice's, so the two can never disagree about where one bill was paid.
UPDATE `payments` `p`
    JOIN `invoices` `i` ON `i`.`id` = `p`.`invoiceId`
    SET `p`.`branchId` = `i`.`branchId`
    WHERE `p`.`branchId` IS NULL;

-- `payments.invoiceId` is nullable, so any row without one falls back to the member.
UPDATE `payments` `p`
    JOIN `members` `m` ON `m`.`id` = `p`.`memberId`
    SET `p`.`branchId` = `m`.`branchId`
    WHERE `p`.`branchId` IS NULL;

ALTER TABLE `invoices`
    MODIFY COLUMN `branchId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `payments`
    MODIFY COLUMN `branchId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `invoices` ADD CONSTRAINT `invoices_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payments` ADD CONSTRAINT `payments_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex: the dashboard's aggregate queries (Locked Decision 1.18). Each is the exact
-- (org, branch, range) shape the widget filters on, so the aggregate is an index scan rather than
-- a table scan that happens to be fast while the tables are small.
CREATE INDEX `payments_organizationId_branchId_paidAt_idx` ON `payments`(`organizationId`, `branchId`, `paidAt`);
CREATE INDEX `invoices_organizationId_branchId_amountPending_idx` ON `invoices`(`organizationId`, `branchId`, `amountPending`);
CREATE INDEX `members_organizationId_branchId_status_idx` ON `members`(`organizationId`, `branchId`, `status`);
CREATE INDEX `memberships_organizationId_branchId_status_endDate_idx` ON `memberships`(`organizationId`, `branchId`, `status`, `endDate`);
