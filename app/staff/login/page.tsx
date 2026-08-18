import { LoginForm } from "@/components/staff/login-form";

export const metadata = { title: "Staff sign in" };

export default function StaffLoginPage() {
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-24">
      <h1 className="font-display text-ink text-2xl font-semibold">Staff sign in</h1>
      <LoginForm />
    </main>
  );
}
