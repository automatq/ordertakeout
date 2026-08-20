import Image from "next/image";
import Link from "next/link";

import { LoginForm } from "@/components/staff/login-form";
import { STORE_INFO } from "@/lib/store";

export const metadata = { title: "Staff sign in", robots: { index: false } };

/**
 * Staff sign-in.
 *
 * Sits outside the `(dashboard)` route group so it stays reachable without a
 * session — and, since the storefront chrome moved into `app/(storefront)`,
 * outside that too. It used to render as a bare centred column sandwiched
 * between the customer header and the marketing footer: roughly 15% sign-in
 * form and 85% shopfront.
 */
export default function StaffLoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="card flex flex-col gap-6 p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <Image
              src="/harina/logo.png"
              alt=""
              aria-hidden
              width={230}
              height={167}
              priority
              className="h-14 w-auto object-contain"
            />
            <div>
              <h1 className="font-display text-ink text-display-sm font-normal uppercase">
                Staff sign in
              </h1>
              <p className="text-ink-subtle text-sm">{STORE_INFO.name} order dashboard</p>
            </div>
          </div>

          <LoginForm />
        </div>

        <p className="text-ink-subtle mt-6 text-center text-sm">
          <Link href="/" className="link">
            Back to the shop
          </Link>
        </p>
      </div>
    </main>
  );
}
