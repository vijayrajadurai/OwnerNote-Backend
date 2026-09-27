export type InventoryMovementDto = {
  id: string;
  productId: string;
  type: "IN" | "OUT" | "ADJUSTMENT";
  quantity: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  // Null only for movements written before this column existed — never
  // backfilled/guessed, see the schema comment on InventoryMovement.
  balanceAfter: number | null;
  createdAt: string;
};

export type InventoryProductDto = {
  id: string;
  businessId: string;
  name: string;
  category: string;
  subCategory: string | null;
  brand: string | null;
  sku: string | null;
  barcode: string | null;
  unit: string;
  currentStock: number;
  minimumStock: number;
  purchasePrice: number | null;
  sellingPrice: number | null;
  mrp: number | null;
  gstRate: number | null;
  supplierId: string | null;
  // Denormalized for display convenience only — always derived from the
  // live Supplier row, never stored independently.
  supplierName: string | null;
  imageUri: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
