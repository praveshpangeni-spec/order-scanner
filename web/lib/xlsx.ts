"use client";
import * as XLSX from "xlsx";
import type { Order, OrderItem, Product } from "@order/shared";
import { toExportRows, priceFor } from "@order/shared";
import seed from "./products.seed.json";

function download(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

function colLetter(i: number): string {
  let s = "";
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** Canonical product order from the master seed (names lower-cased). */
const SEED_ORDER: string[] = (seed as any[]).map((p) => String(p.name).toLowerCase());
function seedIndex(name: string): number {
  const i = SEED_ORDER.indexOf(name.toLowerCase());
  return i < 0 ? 9999 : i;
}

/**
 * Build the party-wise SALES & STOCK workbook for one month: one sheet per
 * depot, product rows × party (SALES/STOCK) columns, MP column, and a bottom
 * TOTAL row with a live SUMPRODUCT(sales, MP) per party.
 */
export function exportMatrixXlsx(
  monthName: string,
  locations: string[],
  partiesByLoc: Record<string, string[]>,
  products: Product[],
  orders: Order[],
  items: OrderItem[]
) {
  const wb = XLSX.utils.book_new();
  const ordersById = new Map(orders.map((o) => [o.id, o]));

  const ordered = [...products].sort((a, b) => seedIndex(a.name) - seedIndex(b.name));

  for (const loc of locations) {
    const parties = partiesByLoc[loc] || [];
    // qty[party][productId] = summed sales quantity
    const qty: Record<string, Record<string, number>> = {};
    for (const p of parties) qty[p] = {};
    for (const it of items) {
      const o = ordersById.get(it.order_id);
      if (!o || o.location !== loc) continue;
      const party = (o.customer || "").trim();
      const bucket = qty[party] || (parties.includes(party) ? (qty[party] = {}) : null);
      if (!bucket) continue;
      const keyId = it.product_id || it.product_name;
      bucket[keyId] = (bucket[keyId] || 0) + (it.quantity || 0);
    }

    const N = ordered.length;
    const aoa: (string | number)[][] = [];
    // Row 0: title + party names (each spanning its SALES/STOCK pair)
    const titleRow: (string | number)[] = [`PARTY WISE / UNIT WISE SALES & STOCK — ${monthName}`, ""];
    for (const p of parties) {
      titleRow.push(p, "");
    }
    aoa.push(titleRow);
    // Row 1: column headers
    const hdr: (string | number)[] = ["PRODUCTS", "MP"];
    for (const _ of parties) hdr.push("SALES", "STOCK");
    aoa.push(hdr);
    // Product rows
    for (const prod of ordered) {
      const row: (string | number)[] = [prod.name, priceFor(prod, loc) ?? 0];
      for (const p of parties) {
        const q = qty[p]?.[prod.id] ?? qty[p]?.[prod.name] ?? 0;
        row.push(q === 0 ? "" : q, "");
      }
      aoa.push(row);
    }
    // TOTAL row (formulas filled after)
    const totalRow: (string | number)[] = ["TOTAL", ""];
    for (const _ of parties) totalRow.push("", "");
    aoa.push(totalRow);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // SUMPRODUCT per party SALES column: rows 3..(2+N) are product rows (1-based).
    const firstDataRow = 3;
    const lastDataRow = 2 + N;
    const totalRowNum = 3 + N;
    const mpRange = `$B${firstDataRow}:$B${lastDataRow}`;
    parties.forEach((_, k) => {
      const salesCol = colLetter(2 + k * 2); // C, E, G, ...
      const cellRef = `${salesCol}${totalRowNum}`;
      ws[cellRef] = {
        t: "n",
        f: `SUMPRODUCT(${salesCol}${firstDataRow}:${salesCol}${lastDataRow},${mpRange})`,
      };
    });

    // Column widths + header merges for readability.
    ws["!cols"] = [{ wch: 34 }, { wch: 8 }, ...parties.flatMap(() => [{ wch: 8 }, { wch: 8 }])];
    ws["!merges"] = parties.map((_, k) => ({
      s: { r: 0, c: 2 + k * 2 },
      e: { r: 0, c: 3 + k * 2 },
    }));

    const sheetName = loc.slice(0, 28);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const safe = monthName.replace(/[^A-Za-z0-9_-]+/g, "-");
  download(wb, `sales-${safe || "month"}.xlsx`);
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
