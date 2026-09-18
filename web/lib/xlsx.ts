"use client";
import * as XLSX from "xlsx";
import type { Order, OrderItem, Product } from "@order/shared";
import { toExportRows } from "@order/shared";

function download(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

/** Export orders + items to an .xlsx download. */
export function exportOrdersXlsx(orders: Order[], items: OrderItem[]) {
  const byOrder = new Map<string, OrderItem[]>();
  for (const it of items) {
    const a = byOrder.get(it.order_id) || [];
    a.push(it);
    byOrder.set(it.order_id, a);
  }
  const data = orders.map((order) => ({
    order,
    items: byOrder.get(order.id) || [],
  }));
  const rows = toExportRows(data);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 30 },
    { wch: 14 }, { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 11 }, { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  const stamp = new Date().toISOString().slice(0, 10);
  download(wb, `orders-${stamp}.xlsx`);
}

export interface SheetPreview {
  headers: string[];
  rows: Record<string, any>[];
}

/** Read an uploaded product-list file (.xlsx/.csv) into headers + rows. */
export async function readProductFile(file: File): Promise<SheetPreview> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

export interface ColumnMap {
  name: string;
  code?: string;
  unit?: string;
  price?: string;
  category?: string;
}

function slug(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Turn imported rows + a column mapping into Product objects. */
export function rowsToProducts(rows: Record<string, any>[], map: ColumnMap): Product[] {
  const out: Product[] = [];
  for (const r of rows) {
    const name = String(r[map.name] ?? "").trim();
    if (!name) continue;
    const priceRaw = map.price ? r[map.price] : null;
    const price =
      priceRaw === "" || priceRaw == null ? null : Number(priceRaw);
    const code = map.code ? String(r[map.code] ?? "").trim() : slug(name);
    out.push({
      id: code || slug(name),
      name,
      code: code || slug(name),
      unit: map.unit ? String(r[map.unit] ?? "").trim() || null : null,
      category: map.category ? String(r[map.category] ?? "").trim() || null : null,
      price: Number.isFinite(price as number) ? (price as number) : null,
      aliases: [],
    });
  }
  return out;
}
