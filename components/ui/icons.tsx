/**
 * The app's icon set.
 *
 * Hand-rolled rather than a dependency: `package.json` has no UI libraries by
 * design, and an icon pack would drag in either a runtime or its own sizing and
 * stroke conventions. There are ~15 glyphs in the whole product, so the cost of
 * owning them is a fraction of the cost of the pack.
 *
 * Every icon is a 24×24 stroked path inheriting `currentColor` and sized in
 * `em`, so it scales with the text it sits beside. All are `aria-hidden` — an
 * icon in this app never carries meaning on its own; its label does.
 */

type IconProps = {
  /** Tailwind sizing/colour classes. Defaults to 1em square. */
  className?: string;
};

function Icon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-[1em] w-[1em]"}
    >
      {children}
    </svg>
  );
}

export function BagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 8h12l-1 12H7L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </Icon>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 13 4 4L19 7" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Icon>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5 1.5 5h-15S6 13 6 9Z" />
      <path d="M10.5 18a1.5 1.5 0 0 0 3 0" />
    </Icon>
  );
}

export function BellOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 5.5A6 6 0 0 1 18 9c0 4 1.5 5 1.5 5h-9" />
      <path d="M6.2 6.2A6 6 0 0 0 6 9c0 4-1.5 5-1.5 5h6" />
      <path d="M10.5 18a1.5 1.5 0 0 0 3 0" />
      <path d="m4 4 16 16" />
    </Icon>
  );
}

export function PrinterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 9V4h10v5" />
      <path d="M5 9h14a1 1 0 0 1 1 1v6h-4v4H8v-4H4v-6a1 1 0 0 1 1-1Z" />
    </Icon>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Icon>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </Icon>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4" />
      <path d="M6.3 8A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.7 9.7 0 0 0 3.6-.7" />
      <path d="M9.9 10.1a3 3 0 0 0 4.1 4.2" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5" />
      <path d="M14 8l4 4-4 4M18 12H8" />
    </Icon>
  );
}

/**
 * The house "no photography yet" mark — a loaf. Used on the product card's
 * fallback tile and as the empty-state glyph on the storefront, so a catalog
 * without images still looks intentional rather than broken.
 */
export function LoafIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3Z" />
      <path d="M8.5 9c.5-1.5 1.5-2.5 3.5-2.5S15 7.5 15.5 9" />
      <path d="M9 13.5h.01M12 13.5h.01M15 13.5h.01" />
    </Icon>
  );
}

/**
 * Fingerprint, for passkey sign-in. Deliberately generic rather than a Face ID
 * glyph: the same button covers Touch ID, Windows Hello and hardware keys, and
 * the system prompt that follows already shows the right platform imagery.
 */
export function FingerprintIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 11v3a9 9 0 0 1-.6 3.2" />
      <path d="M8.5 11a3.5 3.5 0 0 1 7 0v2a13 13 0 0 1-.5 3.5" />
      <path d="M5 11a7 7 0 0 1 12.2-4.7" />
      <path d="M18.9 9A7 7 0 0 1 19 11v2c0 1-.1 2-.3 3" />
      <path d="M5.1 15A9 9 0 0 1 5 13.5V13" />
    </Icon>
  );
}
