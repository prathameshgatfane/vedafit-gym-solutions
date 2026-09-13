-- Phase 6 — the schema Locked Decision 1.16 requires.
--
-- Every CHAR(26) column below carries an explicit `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`.
-- Prisma's migrator emits the database default (utf8mb4_unicode_ci) for new columns, while the
-- `id` columns they reference were made binary by 20260905184504_char_columns_binary_collation —
-- and MySQL refuses a foreign key across mismatched collations (errno 3780). Same hand-edit as
-- the Phase 5 membership-chain migration.

-- AlterTable: an invoice says which term it bills, and ad-hoc invoices say what they are for.
ALTER TABLE `invoices`
    ADD COLUMN `membershipId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    ADD COLUMN `notes` VARCHAR(500) NULL,
    MODIFY `invoiceNumber` VARCHAR(32) NOT NULL;

-- AlterTable: a refund is a new row pointing at the payment it reverses (1.16.3).
ALTER TABLE `payments`
    ADD COLUMN `refundOfPaymentId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;

-- CreateTable: the per-org, per-year invoice number counter (1.16.4).
CREATE TABLE `invoice_sequences` (
    `organizationId` CHAR(26) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `year` INTEGER NOT NULL,
    `nextValue` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`organizationId`, `year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `invoices_organizationId_status_idx` ON `invoices`(`organizationId`, `status`);

-- CreateIndex
CREATE INDEX `invoices_organizationId_memberId_idx` ON `invoices`(`organizationId`, `memberId`);

-- CreateIndex
CREATE INDEX `payments_organizationId_paidAt_idx` ON `payments`(`organizationId`, `paidAt`);

-- CreateIndex
CREATE INDEX `payments_organizationId_memberId_idx` ON `payments`(`organizationId`, `memberId`);

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_refundOfPaymentId_fkey` FOREIGN KEY (`refundOfPaymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_membershipId_fkey` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
