"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { confirmPickup, previewPickup } from "@/app/actions/staff";
import type { PickupVerificationPreview } from "@/lib/orders/pickup-verification";

type Barcode = { rawValue: string };

type Detector = { detect(source: HTMLVideoElement): Promise<Barcode[]> };

type DetectorConstructor = new (options: { formats: string[] }) => Detector;

declare global {
  interface Window {
    BarcodeDetector?: DetectorConstructor;
  }
}

function cameraSupported(): boolean {
  return typeof window !== "undefined" &&
    typeof window.BarcodeDetector === "function" &&
    Boolean(navigator.mediaDevices?.getUserMedia);
}

type Method = "qr" | "manual";

export function PickupVerificationDialog({
  onClose,
  onVerified,
}: {
  onClose: () => void;
  onVerified: (preview: PickupVerificationPreview) => Promise<void>;
}) {
  const [rawPass, setRawPass] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [preview, setPreview] = useState<PickupVerificationPreview | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [staffInitials, setStaffInitials] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const stopCamera = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stopCamera();
      returnFocusRef.current?.focus();
    };
  }, [onClose, stopCamera]);

  async function lookup(value: string, selectedMethod: Method) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await previewPickup({ method: selectedMethod, value });
        if ("ok" in result) {
          setPreview(null);
          setError(result.reason);
          return;
        }
        setMethod(selectedMethod);
        setPreview(result);
      } catch {
        setError("The pickup check did not load. Check the connection and try again.");
      }
    });
  }

  async function startCamera() {
    if (!cameraSupported()) {
      setCameraError("Camera scanning is not supported in this browser. Use the scanner input or enter the order number.");
      return;
    }
    setCameraError(null);
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      const Constructor = window.BarcodeDetector;
      if (!video || !Constructor) throw new Error("Camera scanning is unavailable.");
      video.srcObject = stream;
      await video.play();
      const detector = new Constructor({ formats: ["qr_code"] });
      let cancelled = false;
      stopRef.current = () => { cancelled = true; };
      setCameraActive(true);

      const scan = async (): Promise<void> => {
        if (cancelled || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes[0]?.rawValue;
          if (value) {
            stopCamera();
            setRawPass(value);
            void lookup(value, "qr");
            return;
          }
        } catch {
          // A frame can be unavailable while the camera is warming up; keep scanning.
        }
        window.setTimeout(() => void scan(), 200);
      };
      void scan();
    } catch (cause) {
      stopCamera();
      const message = cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Camera access was denied. Allow it in your browser, or use the scanner input instead."
        : "We couldn’t start the camera. Use the scanner input or enter the order number.";
      setCameraError(message);
    }
  }

  function submitQr(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rawPass.trim()) void lookup(rawPass, "qr");
  }

  function submitManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (orderNumber.trim()) void lookup(orderNumber, "manual");
  }

  function confirm() {
    if (!preview || !method) return;
    const value = method === "qr" ? rawPass : orderNumber;
    startTransition(async () => {
      try {
        const result = await confirmPickup({ method, value, staffInitials });
        if (!result.ok) {
          setError(result.reason);
          return;
        }
        await onVerified(preview);
        onClose();
      } catch {
        setError("Pickup could not be saved. Check the connection and try again.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-ink/50 p-0 sm:items-center sm:justify-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pickup-verification-heading"
        className="bg-canvas shadow-raised flex max-h-[92dvh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-t-[2rem] p-5 sm:rounded-[2rem] sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-secondary text-xs font-semibold tracking-[0.14em] uppercase">Counter check</p>
            <h2 id="pickup-verification-heading" className="font-display text-ink mt-1 text-3xl font-normal uppercase">Verify pickup</h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close pickup verification">
            Close
          </button>
        </div>

        {preview ? (
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-ink text-lg">{preview.orderNumber}</strong>
              <span className="tag">{preview.method === "qr" ? "QR pass" : "Manual lookup"}</span>
            </div>
            <p className="text-ink">
              Confirm the customer&rsquo;s name: <strong>{preview.customerName}</strong>
            </p>
            <p className="text-ink-muted text-sm">
              {preview.itemCount} item{preview.itemCount === 1 ? "" : "s"} &middot; {preview.pickupLocationName ?? "Pickup location"} &middot; {preview.pickupDate} at {preview.pickupTime}
            </p>
            <div className="flex flex-col gap-1.5 sm:max-w-48">
              <label htmlFor="pickup-initials" className="text-ink-subtle text-sm font-medium">Your initials</label>
              <input
                id="pickup-initials"
                value={staffInitials}
                onChange={(event) => setStaffInitials(event.target.value.toUpperCase())}
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={6}
                placeholder="e.g. AM"
                className="input"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={pending} onClick={confirm} className="btn btn-primary">
                {pending ? <span className="spinner" aria-hidden /> : null}
                Confirm pickup
              </button>
              <button type="button" disabled={pending} onClick={() => { setPreview(null); setMethod(null); setError(null); }} className="btn btn-secondary">
                Check another order
              </button>
            </div>
          </div>
        ) : (
          <>
            <form onSubmit={submitQr} className="card flex flex-col gap-3 p-5">
              <div>
                <h3 className="text-ink font-semibold">Scan customer QR pass</h3>
                <p className="text-ink-muted mt-1 text-sm">Use a connected scanner, then press Enter.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  ref={inputRef}
                  value={rawPass}
                  onChange={(event) => setRawPass(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Scan pickup pass"
                  className="input flex-1"
                />
                <button type="submit" disabled={pending || !rawPass.trim()} className="btn btn-primary">Check pass</button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void startCamera()} disabled={cameraActive || pending} className="btn btn-secondary btn-sm">
                  {cameraActive ? "Scanning…" : "Use camera"}
                </button>
                {cameraActive ? <button type="button" onClick={stopCamera} className="btn btn-ghost btn-sm">Stop camera</button> : null}
              </div>
              <video ref={videoRef} muted playsInline className={cameraActive ? "aspect-video w-full rounded-control bg-ink object-cover" : "hidden"} />
              {cameraError ? <p role="status" className="field-hint">{cameraError}</p> : null}
            </form>

            <form onSubmit={submitManual} className="card flex flex-col gap-3 p-5">
              <div>
                <h3 className="text-ink font-semibold">Manual fallback</h3>
                <p className="text-ink-muted mt-1 text-sm">Enter the order number if the customer can&rsquo;t show their QR pass.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} autoComplete="off" autoCapitalize="characters" placeholder="PT-…" className="input flex-1" />
                <button type="submit" disabled={pending || !orderNumber.trim()} className="btn btn-secondary">Find order</button>
              </div>
            </form>
          </>
        )}

        {error ? <p role="alert" className="field-error">{error}</p> : null}
      </section>
    </div>
  );
}
