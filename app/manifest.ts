import type { MetadataRoute } from "next";

import { STORE_INFO } from "@/lib/store";

/**
 * Colors are literal hex mirroring the @theme tokens in app/globals.css
 * (--color-canvas, --color-brand) — a manifest is static JSON and cannot read
 * CSS custom properties. Keep them in sync with docs/THEMING.md.
 *
 * Icons are derived from public/harina/badge.png (256px source); the 512px
 * variant is upscaled and should be replaced with designer artwork before a
 * marketing push — see README.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: STORE_INFO.name,
    short_name: "Harina",
    description: STORE_INFO.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#f5f1e9",
    theme_color: "#ce3f23",
    icons: [
      { src: "/harina/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/harina/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
