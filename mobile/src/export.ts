import * as XLSX from "xlsx";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { Order, OrderItem } from "@order/shared";
import { toExportRows } from "@order/shared";

/** Build an .xlsx of all orders and open the share sheet. */
export async function exportOrders(
  orders: Order[],
  items: OrderItem[]
): Promise<string> {
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
  const ws = XLSX.utils.aoa_to_sheet(toExportRows(data));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });

  const stamp = new Date().toISOString().slice(0, 10);
  const uri = `${FileSystem.cacheDirectory}orders-${stamp}.xlsx`;
  await FileSystem.writeAsStringAsync(uri, b64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dialogTitle: "Export orders",
      UTI: "com.microsoft.excel.xlsx",
    });
  }
  return uri;
}
