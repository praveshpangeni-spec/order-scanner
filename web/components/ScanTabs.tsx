"use client";
import { useEffect, useState } from "react";
import ScanFlow from "./ScanFlow";
import BulkFlow from "./BulkFlow";

type Mode = "single" | "bulk";
const KEY = "order_ocr_scan_mode";

/** Scan tab: switch between one order and many orders at once. */
export default function ScanTabs() {
  const [mode, setMode] = useState<Mode>("single");

  useEffect(() => {
    try {
      const m = localStorage.getItem(KEY);
      if (m === "single" || m === "bulk") setMode(m);
    } catch {}
  }, []);

  function choose(m: Mode) {
    setMode(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {}
  }

  const tab = (m: Mode, label: string) => (
    <button
      onClick={() => choose(m)}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
        mode === m ? "bg-brand text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {tab("single", "Single order")}
        {tab("bulk", "Bulk (many orders)")}
      </div>
      {mode === "single" ? <ScanFlow /> : <BulkFlow />}
    </div>
  );
}
