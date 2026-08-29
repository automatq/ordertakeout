import next from "eslint-config-next";

const config = [
  {
    /* spike/ and apps/ are standalone Expo projects with their own package.json,
       tsconfig and lint rules. They are not part of the Next.js app and must
       not be linted with its config. */
    ignores: [".next/**", "node_modules/**", "drizzle/**", "next-env.d.ts", "spike/**", "apps/**"],
  },
  ...next,
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      /**
       * Guards the theming strategy documented in docs/THEMING.md: rebranding is
       * only a one-file change while every colour resolves through a design token.
       * A single `bg-[#6D4AA8]` or `text-purple-600` turns the branding handoff
       * into a hunt through the codebase, so those are build failures here.
       */
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/(?:^|\\s)(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|outline|decoration|divide|accent|caret|placeholder)-\\[#/]",
          message:
            "Arbitrary colour value. Use a design token (bg-surface, text-ink, …) and define it in app/globals.css — see docs/THEMING.md.",
        },
        {
          selector:
            "Literal[value=/(?:^|\\s)(?:bg|text|border|ring|fill|stroke|from|via|to|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\\d{3})\\b/]",
          message:
            "Stock Tailwind palette colour. Use a semantic design token (bg-surface, text-ink-muted, text-status-ready, …) so the site stays re-brandable — see docs/THEMING.md.",
        },
      ],
    },
  },
];

export default config;
