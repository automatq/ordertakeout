import type { Metadata } from "next";
import Link from "next/link";

import { ConfirmSignIn } from "@/components/accounts/confirm-sign-in";

export const metadata: Metadata = {
  title: "Confirm sign in",
  robots: { index: false },
};

/**
 * Renders a button; consumption happens only in the button's POST action.
 * See components/accounts/confirm-sign-in.tsx for why a GET must never redeem.
 */
export default async function ConfirmSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="shell-tight py-12">
      <section className="card mx-auto flex max-w-xl flex-col gap-5 rounded-[2rem] p-8 text-center">
        <header className="flex flex-col gap-2">
          <p className="eyebrow">My account</p>
          <h1 className="font-display text-ink text-4xl font-normal uppercase">
            Almost there
          </h1>
        </header>

        {token ? (
          <ConfirmSignIn token={token} />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <p className="text-ink-muted text-sm">
              This page needs the link from your sign-in email. Open the email on this
              device and tap the button in it.
            </p>
            <Link href="/account/sign-in" className="btn btn-outline rounded-full">
              Request a sign-in link
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
