import { NotFoundContent } from "@/components/storefront/not-found-content";
import { SiteFooter } from "@/components/storefront/site-footer";
import { SiteHeader } from "@/components/storefront/site-header";

/**
 * Unmatched URLs.
 *
 * These resolve against the root layout, which is deliberately chrome-free, so
 * this page brings its own header and footer — otherwise a mistyped URL would
 * land the visitor on a bare page with no way back into the site.
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <div className="flex-1">
        <NotFoundContent />
      </div>
      <SiteFooter />
    </>
  );
}
