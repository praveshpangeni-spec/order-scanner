import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import PWA from "@/components/PWA";

export const metadata: Metadata = {
  title: "Order Scanner",
  description: "Scan order books and build monthly party-wise sales.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Orders" },
  icons: { icon: "/icon-192.png", apple: "/icon-180.png" },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <nav className="mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-4 py-3">
            <Link href="/" className="mr-auto shrink-0 text-base font-bold text-brand">
              📷 Orders
            </Link>
            <Link href="/" className="btn-ghost shrink-0 !px-3 !py-1.5">
              Scan
            </Link>
            <Link href="/batch" className="btn-ghost shrink-0 !px-3 !py-1.5">
              Bulk
            </Link>
            <Link href="/orders" className="btn-ghost shrink-0 !px-3 !py-1.5">
              Book
            </Link>
            <Link href="/history" className="btn-ghost shrink-0 !px-3 !py-1.5">
              History
            </Link>
            <Link href="/products" className="btn-ghost shrink-0 !px-3 !py-1.5">
              Products
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
        <PWA />
      </body>
    </html>
  );
}
