import type { Metadata, Viewport } from "next";

import { Bebas_Neue, Poppins } from "next/font/google";

import { ToastProvider } from "@/components/ui/toast";
import { STORE_INFO } from "@/lib/store";

import "./globals.css";

/**
 * The root layout is deliberately chrome-free.
 *
 * It used to render the storefront header and footer, which meant every staff
 * route — the kitchen order queue, the prep sheet — was wrapped in a bakery
 * logo, a "Call us on…" line and a customer cart link, with two sticky headers
 * stacked on top of each other. The customer chrome now lives in the
 * `(storefront)` route group instead, so each audience owns its own shell.
 */

/* Self-hosted by next/font: no render-blocking round trip to Google, no flash
   of fallback text, and a matching size-adjust descriptor so swapping in the
   real face doesn't shift layout. Both are non-variable, so weights are
   enumerated — Bebas ships 400 only, which is why `font-display` must always
   be paired with `font-normal`. */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-poppins",
});

const bebasNeue = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-bebas-neue",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://harinabakeshoppe.com"),
  title: {
    default: "Filipino Bakery in Toronto & London | Harina Bakeshoppe",
    template: `%s — ${STORE_INFO.name}`,
  },
  description:
    "Experience the irresistible taste of freshly-baked goods at Harina Bakeshoppe. From cakes to pastries, indulge in warm treats bursting with flavor. Order now!",
  applicationName: STORE_INFO.name,
  openGraph: {
    type: "website",
    siteName: STORE_INFO.name,
    title: "Filipino Bakery in Toronto & London | Harina Bakeshoppe",
    description:
      "Pre-order party trays for pickup from Harina Bakeshoppe locations in Toronto and London, Ontario.",
  },
};

export const viewport: Viewport = {
  /* Matches --color-canvas, so the mobile browser chrome blends into the page
     instead of framing it in white. */
  themeColor: "#f5f1e9",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${poppins.variable} ${bebasNeue.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
