import { Order, OrderItem } from "./types";

export const EXPORT_HEADERS = [
  "Order Date",
  "Reference",
  "Customer",
  "Location",
  "Product",
  "Code",
  "Unit",
  "Quantity",
  "Unit Price",
  "Line Total",
  "Note",
];

export interface OrderWithItems {
  order: Order;
  items: OrderItem[];
}

/** Flatten orders + items into a single sheet (one row per line item). */
export function toExportRows(data: OrderWithItems[]): (string | number)[][] {
  const rows: (string | number)[][] = [EXPORT_HEADERS];
  for (const { order, items } of data) {
    const date = (order.created_at || "").slice(0, 10);
    for (const it of items) {
      rows.push([
        date,
        order.reference || "",
        order.customer || "",
        order.location || "",
        it.product_name,
        it.product_code || "",
        it.unit || "",
        it.quantity,
        it.unit_price,
        it.line_total,
        order.note || "",
      ]);
    }
  }
  return rows;
}
