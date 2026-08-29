"use client";

/**
 * The three fields a profile is made of, shared by sign-up and editing.
 *
 * Kept in one place so the two forms cannot drift into disagreeing about what a
 * name is or which autocomplete tokens the browser gets — those tokens are the
 * whole reason a customer only types this once.
 */
export function ProfileFields({
  defaults,
  disabled,
  phoneReadOnly,
  errors,
}: {
  defaults: { name: string; email: string; phone: string };
  disabled?: boolean;
  /** Sign-up: the number is the one that was just verified, not a choice. */
  phoneReadOnly?: boolean;
  errors?: Partial<Record<"name" | "email" | "phone", string>>;
}) {
  return (
    <>
      <Field
        name="name"
        label="Name"
        type="text"
        autoComplete="name"
        defaultValue={defaults.name}
        disabled={disabled}
        error={errors?.name}
      />
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        defaultValue={defaults.email}
        disabled={disabled}
        error={errors?.email}
        hint="Where your confirmation and pickup reminder go."
      />
      <Field
        name="phone"
        label="Mobile number"
        type="tel"
        autoComplete="tel"
        defaultValue={defaults.phone}
        disabled={disabled}
        readOnly={phoneReadOnly}
        error={errors?.phone}
        hint={phoneReadOnly ? "The number you just confirmed." : undefined}
      />
    </>
  );
}

function Field({
  name,
  label,
  type,
  autoComplete,
  defaultValue,
  disabled,
  readOnly,
  error,
  hint,
}: {
  name: string;
  label: string;
  type: string;
  autoComplete: string;
  defaultValue: string;
  disabled?: boolean;
  readOnly?: boolean;
  error?: string;
  hint?: string;
}) {
  const describedBy = [error ? `${name}-error` : null, hint ? `${name}-hint` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-ink text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        disabled={disabled}
        readOnly={readOnly}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="border-border bg-canvas text-ink min-h-11 rounded-xl border px-3 read-only:opacity-70"
      />
      {hint ? (
        <p id={`${name}-hint`} className="text-ink-subtle text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
