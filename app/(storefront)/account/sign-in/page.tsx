import type { Metadata } from "next";
import Link from "next/link";

import { SignInForm } from "@/components/accounts/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

export default function SignInPage() {
  return (
    <main className="shell-tight py-12">
      <section className="card mx-auto flex max-w-xl flex-col gap-5 rounded-[2rem] p-8">
        <header className="flex flex-col gap-2 text-center">
          <p className="eyebrow">My account</p>
          <h1 className="font-display text-ink text-4xl font-normal uppercase">Sign in</h1>
          <p className="text-ink-muted text-sm">
            Enter the email you order with and we&rsquo;ll send you a one-time sign-in link.
          </p>
        </header>

        <SignInForm />

        <p className="text-ink-subtle border-border border-t pt-4 text-center text-sm">
          Don&rsquo;t have an account yet? Place an order, then choose{" "}
          <strong className="text-ink font-medium">Save my account</strong> on your
          confirmation page. <Link href="/#trays" className="text-brand underline">Browse trays</Link>
        </p>
      </section>
    </main>
  );
}
