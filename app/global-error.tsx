"use client";

/**
 * Last resort: the root layout itself failed.
 *
 * This replaces the whole document, so it must render its own `<html>`/`<body>`
 * — and it cannot rely on the design tokens, because a failure this high up may
 * be the stylesheet not loading at all. Hence the inline styles: they are the
 * one place in this codebase where a hardcoded colour is the correct call.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#f5f1e9",
          color: "#1a1a1a",
          fontFamily: "system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "26rem" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
            Harina Bakeshoppe is temporarily unavailable
          </h1>
          <p style={{ color: "#5c5449", marginBottom: "1.5rem", lineHeight: 1.5 }}>
            Sorry — something broke on our side. Please try again, or call us on{" "}
            <a href="tel:+16473685000" style={{ color: "#ce3f23" }}>
              (647) 368-5000
            </a>
            .
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              font: "inherit",
              padding: "0.85rem 1.5rem",
              borderRadius: "1rem",
              border: "2px solid #ce3f23",
              background: "#ce3f23",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ color: "#6f665a", fontSize: "0.75rem", marginTop: "1.5rem" }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
