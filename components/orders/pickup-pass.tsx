"use client";

import { QRCodeSVG } from "qrcode.react";

/** A signed pass the customer can present to staff at the pickup counter. */
export function PickupPass({ value }: { value: string }) {
  return (
    <section
      aria-labelledby="pickup-pass-heading"
      className="card flex flex-col items-center gap-4 rounded-[2rem] p-6 text-center sm:p-8"
    >
      <div>
        <p className="text-secondary text-xs font-semibold tracking-[0.14em] uppercase">
          Pickup pass
        </p>
        <h2 id="pickup-pass-heading" className="font-display text-ink mt-1 text-3xl font-normal uppercase">
          Show this at the counter
        </h2>
      </div>
      <div className="rounded-[1.5rem] bg-white p-4 shadow-sm">
        <QRCodeSVG
          value={value}
          size={208}
          level="M"
          marginSize={4}
          title="Pickup verification QR code"
        />
      </div>
      <p className="text-ink-muted max-w-md text-sm text-pretty">
        Have this code ready when you collect your order. Staff will scan it and confirm your name before handing it over.
      </p>
    </section>
  );
}
