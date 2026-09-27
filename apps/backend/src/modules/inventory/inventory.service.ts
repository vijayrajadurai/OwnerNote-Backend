import type { InventoryMovementType, InventoryProduct, Supplier } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NotFoundError, ValidationError } from "../../utils/errors";
import {
  analyzeInventoryProduct,
  buildInventoryIntelligenceSummary,
  canRemoveStock,
  findDuplicateProduct,
  type IntelligenceMovement,
} from "./inventory.logic";
import type { InventoryMovementDto, InventoryProductDto } from "./inventory.types";

type ProductWithSupplier = InventoryProduct & { supplier: Pick<Supplier, "name"> | null };

function serializeProduct(row: ProductWithSupplier): InventoryProductDto {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    category: row.category,
    subCategory: row.subCategory,
    brand: row.brand,
    sku: row.sku,
    barcode: row.barcode,
    unit: row.unit,
    currentStock: row.currentStock,
    minimumStock: row.minimumStock,
    purchasePrice: row.purchasePrice,
    sellingPrice: row.sellingPrice,
    mrp: row.mrp,
    gstRate: row.gstRate,
    supplierId: row.supplierId,
    supplierName: row.supplier?.name ?? null,
    imageUri: row.imageUri,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Never let a product point at a supplier from a different business, or one
// that doesn't exist — an orphan/foreign reference the spec explicitly rules
// out. Returns null unchanged (no supplier link is always valid).
async function assertOwnSupplierOrNull(businessId: string, supplierId: string | null | undefined): Promise<string | null> {
  if (supplierId === undefined || supplierId === null) return null;
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, businessId } });
  if (!supplier) throw new ValidationError("Supplier not found for this business");
  return supplier.id;
}

export async function listProducts(businessId: string): Promise<InventoryProductDto[]> {
  const rows = await prisma.inventoryProduct.findMany({
    where: { businessId },
    include: { supplier: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map(serializeProduct);
}

export async function getLowStockProducts(businessId: string): Promise<InventoryProductDto[]> {
  const rows = await prisma.inventoryProduct.findMany({
    where: { businessId },
    include: { supplier: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return rows.filter((r) => r.currentStock <= r.minimumStock).map(serializeProduct);
}

async function requireProduct(businessId: string, id: string): Promise<InventoryProduct> {
  const row = await prisma.inventoryProduct.findFirst({ where: { id, businessId } });
  if (!row) throw new NotFoundError("Inventory product not found");
  return row;
}

async function requireProductWithSupplier(businessId: string, id: string): Promise<ProductWithSupplier> {
  const row = await prisma.inventoryProduct.findFirst({
    where: { id, businessId },
    include: { supplier: { select: { name: true } } },
  });
  if (!row) throw new NotFoundError("Inventory product not found");
  return row;
}

export async function getProduct(businessId: string, id: string): Promise<InventoryProductDto> {
  return serializeProduct(await requireProductWithSupplier(businessId, id));
}

export interface CreateProductInput {
  name: string;
  category: string;
  subCategory?: string | null;
  brand?: string | null;
  sku?: string | null;
  barcode?: string | null;
  unit: string;
  currentStock: number;
  minimumStock: number;
  purchasePrice?: number | null;
  sellingPrice?: number | null;
  mrp?: number | null;
  gstRate?: number | null;
  supplierId?: string | null;
  imageUri?: string | null;
  notes?: string | null;
}

export type CreateProductResult = { outcome: "DUPLICATE"; existing: InventoryProductDto } | { outcome: "CREATED"; product: InventoryProductDto };

// Duplicate prevention happens here, before any row is written — same
// outcome-object convention groupBuying/localOffers already use.
export async function createProduct(businessId: string, input: CreateProductInput): Promise<CreateProductResult> {
  const existing = await prisma.inventoryProduct.findMany({ where: { businessId }, include: { supplier: { select: { name: true } } } });
  const duplicate = findDuplicateProduct(input.name, existing);
  if (duplicate) return { outcome: "DUPLICATE", existing: serializeProduct(duplicate) };

  const supplierId = await assertOwnSupplierOrNull(businessId, input.supplierId);

  const created = await prisma.$transaction(async (tx) => {
    const product = await tx.inventoryProduct.create({
      data: {
        businessId,
        name: input.name.trim(),
        category: input.category.trim(),
        subCategory: input.subCategory?.trim() || null,
        brand: input.brand?.trim() || null,
        sku: input.sku?.trim() || null,
        barcode: input.barcode?.trim() || null,
        unit: input.unit,
        currentStock: input.currentStock,
        minimumStock: input.minimumStock,
        purchasePrice: input.purchasePrice ?? null,
        sellingPrice: input.sellingPrice ?? null,
        mrp: input.mrp ?? null,
        gstRate: input.gstRate ?? null,
        supplierId,
        imageUri: input.imageUri?.trim() || null,
        notes: input.notes?.trim() || null,
      },
      include: { supplier: { select: { name: true } } },
    });
    // A non-zero opening stock is itself a real stock movement — Stock
    // History always explains the whole current quantity.
    if (input.currentStock > 0) {
      await tx.inventoryMovement.create({
        data: { productId: product.id, type: "IN", quantity: input.currentStock, reason: "OPENING_STOCK", balanceAfter: input.currentStock },
      });
    }
    return product;
  });

  return { outcome: "CREATED", product: serializeProduct(created) };
}

export interface UpdateProductInput {
  name?: string;
  category?: string;
  subCategory?: string | null;
  brand?: string | null;
  sku?: string | null;
  barcode?: string | null;
  unit?: string;
  minimumStock?: number;
  purchasePrice?: number | null;
  sellingPrice?: number | null;
  mrp?: number | null;
  gstRate?: number | null;
  supplierId?: string | null;
  imageUri?: string | null;
  notes?: string | null;
}

// Product identity/threshold/catalog fields only — currentStock is never
// edited directly here; it only ever changes via addStock/removeStock below.
export async function updateProduct(businessId: string, id: string, input: UpdateProductInput): Promise<InventoryProductDto> {
  const existing = await requireProduct(businessId, id);
  const supplierId = input.supplierId === undefined ? existing.supplierId : await assertOwnSupplierOrNull(businessId, input.supplierId);
  const updated = await prisma.inventoryProduct.update({
    where: { id },
    data: {
      name: input.name !== undefined ? input.name.trim() : existing.name,
      category: input.category !== undefined ? input.category.trim() : existing.category,
      subCategory: input.subCategory !== undefined ? input.subCategory?.trim() || null : existing.subCategory,
      brand: input.brand !== undefined ? input.brand?.trim() || null : existing.brand,
      sku: input.sku !== undefined ? input.sku?.trim() || null : existing.sku,
      barcode: input.barcode !== undefined ? input.barcode?.trim() || null : existing.barcode,
      unit: input.unit ?? existing.unit,
      minimumStock: input.minimumStock ?? existing.minimumStock,
      purchasePrice: input.purchasePrice !== undefined ? input.purchasePrice : existing.purchasePrice,
      sellingPrice: input.sellingPrice !== undefined ? input.sellingPrice : existing.sellingPrice,
      mrp: input.mrp !== undefined ? input.mrp : existing.mrp,
      gstRate: input.gstRate !== undefined ? input.gstRate : existing.gstRate,
      supplierId,
      imageUri: input.imageUri !== undefined ? input.imageUri?.trim() || null : existing.imageUri,
      notes: input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
    },
    include: { supplier: { select: { name: true } } },
  });
  return serializeProduct(updated);
}

export async function deleteProduct(businessId: string, id: string): Promise<void> {
  await requireProduct(businessId, id);
  await prisma.$transaction([
    prisma.inventoryMovement.deleteMany({ where: { productId: id } }),
    prisma.inventoryProduct.delete({ where: { id } }),
  ]);
}

export type StockChangeResult = { outcome: "OK"; product: InventoryProductDto } | { outcome: "INSUFFICIENT_STOCK"; available: number };

export async function addStock(businessId: string, productId: string, quantity: number, reason: string, occurredAt?: Date): Promise<InventoryProductDto> {
  const existing = await requireProduct(businessId, productId);
  const balanceAfter = existing.currentStock + quantity;
  const [updated] = await prisma.$transaction([
    prisma.inventoryProduct.update({
      where: { id: productId },
      data: { currentStock: balanceAfter },
      include: { supplier: { select: { name: true } } },
    }),
    prisma.inventoryMovement.create({
      data: { productId, type: "IN", quantity, reason, createdAt: occurredAt, balanceAfter },
    }),
  ]);
  return serializeProduct(updated);
}

// Never writes to the DB when the requested quantity exceeds what's on
// hand — never silently allow negative stock.
export async function removeStock(businessId: string, productId: string, quantity: number, reason: string, occurredAt?: Date): Promise<StockChangeResult> {
  const existing = await requireProduct(businessId, productId);
  const decision = canRemoveStock(existing.currentStock, quantity);
  if (!decision.ok) return { outcome: "INSUFFICIENT_STOCK", available: decision.available };

  const balanceAfter = existing.currentStock - quantity;
  const [updated] = await prisma.$transaction([
    prisma.inventoryProduct.update({
      where: { id: productId },
      data: { currentStock: balanceAfter },
      include: { supplier: { select: { name: true } } },
    }),
    prisma.inventoryMovement.create({
      data: { productId, type: "OUT", quantity, reason, createdAt: occurredAt, balanceAfter },
    }),
  ]);
  return { outcome: "OK", product: serializeProduct(updated) };
}

export async function listMovements(businessId: string, productId: string): Promise<InventoryMovementDto[]> {
  await requireProduct(businessId, productId);
  const rows = await prisma.inventoryMovement.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    type: row.type as InventoryMovementType,
    quantity: row.quantity,
    reason: row.reason,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    balanceAfter: row.balanceAfter,
    createdAt: row.createdAt.toISOString(),
  }));
}

// One aggregate query for every product's real OUT movements in the
// window, instead of one query per product (never an N+1 for a
// business-level summary).
async function getRecentOutMovementsByProduct(businessId: string, sinceDate: Date, now: Date): Promise<Map<string, IntelligenceMovement[]>> {
  const rows = await prisma.inventoryMovement.findMany({
    where: {
      type: "OUT",
      createdAt: { gte: sinceDate, lte: now },
      product: { businessId },
    },
    select: { productId: true, type: true, quantity: true, createdAt: true },
  });
  const byProduct = new Map<string, IntelligenceMovement[]>();
  for (const row of rows) {
    const movement: IntelligenceMovement = { type: row.type as "OUT", quantity: row.quantity, createdAt: row.createdAt };
    const list = byProduct.get(row.productId);
    if (list) list.push(movement);
    else byProduct.set(row.productId, [movement]);
  }
  return byProduct;
}

export async function getIntelligenceSummary(businessId: string, now: Date = new Date()) {
  const products = await prisma.inventoryProduct.findMany({ where: { businessId } });
  const since = new Date(now);
  since.setDate(since.getDate() - 30);
  const movementsByProduct = await getRecentOutMovementsByProduct(businessId, since, now);
  const analyses = products.map((p) =>
    analyzeInventoryProduct({ id: p.id, name: p.name, unit: p.unit, currentStock: p.currentStock, minimumStock: p.minimumStock }, movementsByProduct.get(p.id) ?? [], now),
  );
  return buildInventoryIntelligenceSummary(analyses);
}

export async function getProductIntelligence(businessId: string, productId: string, now: Date = new Date()) {
  const product = await requireProduct(businessId, productId);
  const movements = await prisma.inventoryMovement.findMany({
    where: { productId },
    select: { type: true, quantity: true, createdAt: true },
  });
  const intelligenceMovements: IntelligenceMovement[] = movements.map((m) => ({ type: m.type as "IN" | "OUT" | "ADJUSTMENT", quantity: m.quantity, createdAt: m.createdAt }));
  return analyzeInventoryProduct({ id: product.id, name: product.name, unit: product.unit, currentStock: product.currentStock, minimumStock: product.minimumStock }, intelligenceMovements, now);
}

export function assertPositiveQuantity(quantity: number): void {
  if (quantity <= 0) throw new ValidationError("Quantity must be greater than 0");
}
