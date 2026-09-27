-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "balanceAfter" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "InventoryProduct" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "gstRate" DOUBLE PRECISION,
ADD COLUMN     "imageUri" TEXT,
ADD COLUMN     "mrp" DOUBLE PRECISION,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "purchasePrice" DOUBLE PRECISION,
ADD COLUMN     "sellingPrice" DOUBLE PRECISION,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "subCategory" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- CreateIndex
CREATE INDEX "InventoryProduct_supplierId_idx" ON "InventoryProduct"("supplierId");

-- AddForeignKey
ALTER TABLE "InventoryProduct" ADD CONSTRAINT "InventoryProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
