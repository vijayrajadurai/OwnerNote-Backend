export type InventoryMovementDto = {
  id: string;
  productId: string;
  type: "IN" | "OUT" | "ADJUSTMENT";
  quantity: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
};

export type InventoryProductDto = {
  id: string;
  businessId: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
  createdAt: string;
  updatedAt: string;
};
