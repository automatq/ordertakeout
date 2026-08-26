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
    /* A stable identity, so a later change to start_url does not make browsers
       treat this as a different app and orphan existing installs. */
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f1e9",
    /* Matches app/layout.tsx's viewport themeColor rather than the brand red.
       These colour adjacent surfaces — the browser address bar and the
       installed app's title bar — and the reasoning in layout.tsx applies to
       both: the app's own header is --color-canvas, so anything else frames the
       page instead of continuing it. */
    theme_color: "#f5f1e9",
    icons: [
      { src: "/harina/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/harina/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /* Android crops launcher icons to a circle or squircle. The "any" icons
         are a circle that touches the canvas edge, so masking clips it and
         leaves the corners transparent. This one insets the crest into the
         central safe zone over a full-bleed field sampled from the artwork. */
      {
        src: "/harina/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
