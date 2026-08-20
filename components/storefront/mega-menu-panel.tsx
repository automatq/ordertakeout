import Link from "next/link";

import { ArrowUpRightIcon } from "@/components/ui/icons";
import type { MegaMenu } from "@/components/storefront/nav-menus";

/**
 * The desktop megamenu drop panel.
 *
 * Three columns on `lg`: an eyebrow + intro on the left, the numbered item list
 * in the middle, and a dark feature card with one CTA on the right. Below `lg`
 * the header renders a stacked accordion instead (see site-header.tsx), so this
 * panel is desktop-only.
 *
 * Everything resolves to design tokens: Bebas Neue (`font-display`) for the
 * headings, Poppins for descriptive copy, and the rust `brand` as the highlight.
 */
export function MegaMenuPanel({
  menu,
  onLinkClick,
}: {
  menu: MegaMenu;
  onLinkClick: () => void;
}) {
  return (
    <div className="border-border bg-canvas/95 border-t backdrop-blur-xl">
      <div className="shell grid gap-8 py-12 lg:grid-cols-12 lg:gap-14">
        {/* Eyebrow + intro */}
        <div className="lg:col-span-3">
          <p className="text-brand mb-3 text-[11px] font-medium tracking-[0.16em] uppercase">
            — {menu.eyebrow}
          </p>
          <p className="text-ink text-xl leading-snug lg:text-2xl">{menu.intro}</p>
        </div>

        {/* Item list */}
        <div className="border-border lg:col-span-5 lg:border-l lg:pl-10">
          <ul className="divide-border divide-y">
            {menu.items.map((item) => (
              <li key={item.num}>
                <NavLink
                  href={item.href}
                  onClick={onLinkClick}
                  className="group hover:bg-brand-tint -mx-3 grid grid-cols-12 items-start gap-4 rounded-card px-3 py-5 transition-colors"
                >
                  <span className="text-ink-subtle col-span-2 mt-2 text-xs tabular-nums">
                    {item.num}
                  </span>
                  <div className="col-span-9">
                    <h3 className="font-display text-ink group-hover:text-brand text-xl leading-tight font-normal uppercase transition-colors lg:text-2xl">
                      {item.title}
                    </h3>
                    <p className="text-ink-muted mt-1 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                  <ArrowUpRightIcon className="text-ink-subtle group-hover:text-brand col-span-1 mt-1 h-5 w-5 transition-all group-hover:translate-x-0.5" />
                </NavLink>
              </li>
            ))}
          </ul>
        </div>

        {/* Feature card */}
        <div className="lg:col-span-4">
          <div className="bg-ink text-canvas rounded-card flex h-full flex-col p-8">
            <p className="text-accent mb-4 text-[11px] font-medium tracking-[0.16em] uppercase">
              — {menu.feature.eyebrow}
            </p>
            <h4 className="font-display text-2xl leading-tight font-normal uppercase lg:text-3xl">
              {menu.feature.title}
            </h4>
            <p className="text-canvas/70 mt-3 flex-grow text-sm leading-relaxed">
              {menu.feature.body}
            </p>
            <NavLink
              href={menu.feature.ctaHref}
              onClick={onLinkClick}
              className="bg-canvas text-ink hover:bg-brand hover:text-brand-ink rounded-pill mt-6 inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium transition-colors"
            >
              {menu.feature.ctaLabel}
              <ArrowUpRightIcon className="h-4 w-4" />
            </NavLink>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Internal routes use Next's `Link`; `tel:`/`mailto:`/external hrefs fall back to
 * a plain anchor so they aren't handed to the client router.
 */
function NavLink({
  href,
  onClick,
  className,
  children,
}: {
  href: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
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
