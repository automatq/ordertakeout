import type { Metadata } from "next";

import Link from "next/link";

import { CartLink } from "@/components/cart/cart-link";

import "./globals.css";

export const metadata: Metadata = {
  // Placeholder copy — replaced at branding handoff along with the theme tokens.
  title: "Party Tray Pre-Orders",
  description:
    "Order Ensaymada, Hopia and Ube Bar party trays online and pick them up in store.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <header className="border-border bg-surface border-b">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-display text-ink font-semibold">
              Party Trays
            </Link>
            <CartLink />
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
