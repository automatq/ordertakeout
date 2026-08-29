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
            No password needed. We&rsquo;ll send a one-time code or link to the number or
            email you order with.
          </p>
        </header>

        <SignInForm />

        <p className="text-ink-subtle border-border border-t pt-4 text-center text-sm">
          New here? Enter your mobile number above &mdash; we&rsquo;ll text a code and set
          your account up in one step. Or place an order and choose{" "}
          <strong className="text-ink font-medium">Save my account</strong> on the
          confirmation page. <Link href="/#order" className="text-brand underline">Browse the menu</Link>
        </p>
      </section>
    </main>
  );
}
