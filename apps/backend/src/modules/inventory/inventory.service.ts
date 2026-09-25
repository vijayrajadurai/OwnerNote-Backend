import type { InventoryMovementType, InventoryProduct } from "@prisma/client";
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

function serializeProduct(row: InventoryProduct): InventoryProductDto {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    category: row.category,
    unit: row.unit,
    currentStock: row.currentStock,
    minimumStock: row.minimumStock,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProducts(businessId: string): Promise<InventoryProductDto[]> {
  const rows = await prisma.inventoryProduct.findMany({
    where: { businessId },
    orderBy: { name: "asc" },
  });
  return rows.map(serializeProduct);
}

export async function getLowStockProducts(businessId: string): Promise<InventoryProductDto[]> {
  const rows = await prisma.inventoryProduct.findMany({
    where: { businessId },
    orderBy: { name: "asc" },
  });
  return rows.filter((r) => r.currentStock <= r.minimumStock).map(serializeProduct);
}

async function requireProduct(businessId: string, id: string): Promise<InventoryProduct> {
  const row = await prisma.inventoryProduct.findFirst({ where: { id, businessId } });
  if (!row) throw new NotFoundError("Inventory product not found");
  return row;
}

export async function getProduct(businessId: string, id: string): Promise<InventoryProductDto> {
  return serializeProduct(await requireProduct(businessId, id));
}

export interface CreateProductInput {
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
}

export type CreateProductResult = { outcome: "DUPLICATE"; existing: InventoryProductDto } | { outcome: "CREATED"; product: InventoryProductDto };

// Duplicate prevention happens here, before any row is written — same
// outcome-object convention groupBuying/localOffers already use.
export async function createProduct(businessId: string, input: CreateProductInput): Promise<CreateProductResult> {
  const existing = await prisma.inventoryProduct.findMany({ where: { businessId } });
  const duplicate = findDuplicateProduct(input.name, existing);
  if (duplicate) return { outcome: "DUPLICATE", existing: serializeProduct(duplicate) };

  const created = await prisma.$transaction(async (tx) => {
    const product = await tx.inventoryProduct.create({
      data: {
        businessId,
        name: input.name.trim(),
        category: input.category.trim(),
        unit: input.unit,
        currentStock: input.currentStock,
        minimumStock: input.minimumStock,
      },
    });
    // A non-zero opening stock is itself a real stock movement — Stock
    // History always explains the whole current quantity.
    if (input.currentStock > 0) {
      await tx.inventoryMovement.create({
        data: { productId: product.id, type: "IN", quantity: input.currentStock, reason: "OPENING_STOCK" },
      });
    }
    return product;
  });

  return { outcome: "CREATED", product: serializeProduct(created) };
}

export interface UpdateProductInput {
  name?: string;
  category?: string;
  unit?: string;
  minimumStock?: number;
}

// Product identity/threshold fields only — currentStock is never edited
// directly here; it only ever changes via addStock/removeStock below.
export async function updateProduct(businessId: string, id: string, input: UpdateProductInput): Promise<InventoryProductDto> {
  const existing = await requireProduct(businessId, id);
  const updated = await prisma.inventoryProduct.update({
    where: { id },
    data: {
      name: input.name !== undefined ? input.name.trim() : existing.name,
      category: input.category !== undefined ? input.category.trim() : existing.category,
      unit: input.unit ?? existing.unit,
      minimumStock: input.minimumStock ?? existing.minimumStock,
    },
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
  const [updated] = await prisma.$transaction([
    prisma.inventoryProduct.update({
      where: { id: productId },
      data: { currentStock: existing.currentStock + quantity },
    }),
    prisma.inventoryMovement.create({
      data: { productId, type: "IN", quantity, reason, createdAt: occurredAt },
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

  const [updated] = await prisma.$transaction([
    prisma.inventoryProduct.update({
      where: { id: productId },
      data: { currentStock: existing.currentStock - quantity },
    }),
    prisma.inventoryMovement.create({
      data: { productId, type: "OUT", quantity, reason, createdAt: occurredAt },
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
