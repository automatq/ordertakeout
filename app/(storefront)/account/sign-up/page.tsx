import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignUpForm } from "@/components/accounts/sign-up-form";
import { currentAccountId } from "@/lib/accounts/session";
import { currentSignupPhone } from "@/lib/accounts/signup-token";

export const metadata: Metadata = { title: "Create your account", robots: { index: false } };

/**
 * Reached only by verifying a code texted to a number nobody has yet.
 *
 * Without a verified number there is nothing to register, so this page has no
 * standalone entry point — landing on it directly sends you to sign in.
 */
export default async function SignUpPage() {
  if (await currentAccountId()) redirect("/account");

  const phone = await currentSignupPhone();
  if (!phone) redirect("/account/sign-in");

  return (
    <main className="shell-tight py-12">
      <section className="card mx-auto flex max-w-xl flex-col gap-5 rounded-[2rem] p-8">
        <header className="flex flex-col gap-2 text-center">
          <p className="eyebrow">My account</p>
          <h1 className="font-display text-ink text-4xl font-normal uppercase">
            Nice to meet you
          </h1>
          <p className="text-ink-muted text-sm">
            Your number is confirmed. Tell us who you are and we&rsquo;ll fill your
            details in every time you order.
          </p>
        </header>

        <SignUpForm phone={phone} />

        <p className="text-ink-subtle border-border border-t pt-4 text-center text-sm">
          Already have an account?{" "}
          <Link href="/account/sign-in" className="text-brand underline">Sign in instead</Link>
        </p>
      </section>
    </main>
  );
}
