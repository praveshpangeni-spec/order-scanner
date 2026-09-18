import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Order Scanner",
  description: "Scan order images, match products, and export to Excel.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <nav className="mx-auto flex max-w-4xl items-center gap-1 px-4 py-3">
            <Link href="/" className="mr-auto text-lg font-bold text-brand">
              📷 Order Scanner
            </Link>
            <Link href="/" className="btn-ghost !px-3 !py-1.5">
              Scan
            </Link>
            <Link href="/orders" className="btn-ghost !px-3 !py-1.5">
              Orders
            </Link>
            <Link href="/products" className="btn-ghost !px-3 !py-1.5">
              Products
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
