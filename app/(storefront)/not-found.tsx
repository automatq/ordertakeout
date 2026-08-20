import { NotFoundContent } from "@/components/storefront/not-found-content";

/** Catches `notFound()` from a storefront page — e.g. an unknown product slug. */
export default function StorefrontNotFound() {
  return <NotFoundContent />;
}
