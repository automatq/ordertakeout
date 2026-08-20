"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CartLink } from "@/components/cart/cart-link";
import { MegaMenuPanel } from "@/components/storefront/mega-menu-panel";
import { megaMenus, plainNavLinks } from "@/components/storefront/nav-menus";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  CloseIcon,
  MenuIcon,
  PhoneIcon,
  PlusIcon,
} from "@/components/ui/icons";
import { STORE_INFO } from "@/lib/store";

/**
 * Storefront header with a megamenu.
 *
 * The old header had no navigation at all — a logo, a phone number hidden below
 * `sm`, and a cart link. This version ports the studio's editorial megamenu:
 * desktop triggers that drop a three-column panel on hover, and a stacked
 * accordion below `lg`. Content lives in `nav-menus.ts`; the panel in
 * `mega-menu-panel.tsx`. The house fonts style it — Bebas Neue for headings,
 * Poppins for the rest.
 *
 * Hover open/close is intentionally deferred (a short delay each way) so a
 * cursor cutting diagonally across one trigger to reach another doesn't strobe
 * every panel on the way. Click toggles too, for touch and keyboard.
 */

/** Deferred hover so a diagonal cursor doesn't flash panels it's only crossing. */
const HOVER_OPEN_MS = 80;
const HOVER_CLOSE_MS = 180;

export function SiteHeader() {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<string | null>(null);

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close everything on Escape.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clear pending timers on unmount so a scheduled open/close can't fire into a
  // gone component.
  useEffect(() => cancelTimers, []);

  function cancelTimers() {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  function scheduleOpen(id: string) {
    cancelTimers();
    openTimer.current = setTimeout(() => setOpenMenu(id), HOVER_OPEN_MS);
  }

  function scheduleClose() {
    cancelTimers();
    closeTimer.current = setTimeout(() => setOpenMenu(null), HOVER_CLOSE_MS);
  }

  function toggleMenu(id: string) {
    cancelTimers();
    setOpenMenu((current) => (current === id ? null : id));
  }

  const activeMenu = megaMenus.find((menu) => menu.id === openMenu) ?? null;

  return (
    <header
      className="bg-canvas/90 border-border shadow-sticky sticky top-0 z-50 border-b backdrop-blur-xl"
      onMouseLeave={scheduleClose}
    >
      <div className="shell flex items-center justify-between gap-4 py-3">
        <Link
          href="/"
          aria-current={pathname === "/" ? "page" : undefined}
          className="flex shrink-0 items-center gap-3"
          onMouseEnter={cancelTimers}
        >
          <Image
            src="/harina/logo.png"
            alt={`${STORE_INFO.name} home`}
            width={230}
            height={167}
            priority
            className="h-12 w-auto object-contain sm:h-16"
          />
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {megaMenus.map((menu) => {
            const active = openMenu === menu.id;
            return (
              <button
                key={menu.id}
                type="button"
                onClick={() => toggleMenu(menu.id)}
                onMouseEnter={() => scheduleOpen(menu.id)}
                aria-expanded={active}
                aria-haspopup="true"
                className={`flex items-center gap-1.5 text-sm transition-colors ${
                  active ? "text-brand" : "text-ink-muted hover:text-brand"
                }`}
              >
                {menu.label}
                <ChevronDownIcon
                  className={`h-4 w-4 transition-transform ${active ? "rotate-180" : ""}`}
                />
              </button>
            );
          })}
          {plainNavLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              onMouseEnter={cancelTimers}
              className={`text-sm transition-colors ${
                pathname === link.href
                  ? "text-brand underline decoration-2 underline-offset-8"
                  : "text-ink-muted hover:text-brand"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-4">
          <a
            href={STORE_INFO.phoneHref}
            onMouseEnter={cancelTimers}
            className="text-ink-muted hover:text-brand hidden items-center gap-2 text-sm transition-colors sm:inline-flex"
          >
            <PhoneIcon />
            {STORE_INFO.phone}
          </a>

          <CartLink />

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-controls="site-menu"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="btn btn-secondary btn-icon btn-sm lg:hidden"
          >
            {mobileOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Desktop megamenu drop */}
      {activeMenu ? (
        <div
          onMouseEnter={cancelTimers}
          onMouseLeave={scheduleClose}
          className="animate-mega hidden lg:block"
        >
          <MegaMenuPanel menu={activeMenu} onLinkClick={() => setOpenMenu(null)} />
        </div>
      ) : null}

      {/* Mobile menu */}
      {mobileOpen ? (
        <nav
          id="site-menu"
          aria-label="Main"
          className="border-border bg-canvas max-h-[calc(100dvh-5rem)] overflow-y-auto border-t lg:hidden"
        >
          <div className="shell flex flex-col py-2">
            {megaMenus.map((menu) => {
              const expanded = mobileSection === menu.id;
              return (
                <div key={menu.id} className="border-border border-b">
                  <button
                    type="button"
                    onClick={() => setMobileSection(expanded ? null : menu.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between py-4 text-left"
                  >
                    <span className="font-display text-ink text-2xl font-normal uppercase">
                      {menu.label}
                    </span>
                    <PlusIcon
                      className={`text-ink-muted h-5 w-5 transition-transform ${
                        expanded ? "rotate-45" : ""
                      }`}
                    />
                  </button>
                  {expanded ? (
                    <ul className="flex flex-col gap-3 pb-5">
                      {menu.items.map((item) => (
                        <li key={item.href}>
                          <MobileLink href={item.href} onClick={closeMobile}>
                            <span className="text-ink-subtle text-xs tabular-nums">{item.num}</span>
                            <span>
                              <span className="font-display text-ink block text-lg leading-tight font-normal uppercase">
                                {item.title}
                              </span>
                              <span className="text-ink-muted mt-0.5 block text-sm leading-snug">
                                {item.desc}
                              </span>
                            </span>
                          </MobileLink>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}

            {plainNavLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                onClick={closeMobile}
                className={`border-border font-display border-b py-4 text-2xl font-normal uppercase ${
                  pathname === link.href ? "text-brand" : "text-ink"
                }`}
              >
                {link.label}
              </Link>
            ))}

            <a
              href={STORE_INFO.phoneHref}
              onClick={closeMobile}
              className="text-ink-muted flex items-center gap-2 py-4 text-sm"
            >
              <PhoneIcon />
              {STORE_INFO.phone}
              <ArrowUpRightIcon className="h-4 w-4" />
            </a>
          </div>
        </nav>
      ) : null}
    </header>
  );

  function closeMobile() {
    setMobileOpen(false);
    setMobileSection(null);
  }
}

/** Item link inside the mobile accordion; internal routes go through Next. */
function MobileLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const className = "flex items-baseline gap-3 py-1";
  if (href.startsWith("/")) {
    return (
      <Link href={href} onClick={onClick} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  );
}
