/**
 * Product-image sources accepted by both Next's image optimizer and the staff
 * product-rules form.
 *
 * Square has used both its own CDN and S3 buckets for Catalog image URLs. Keep
 * this list narrow and shared: accepting an arbitrary staff URL would save a
 * value that `<Image>` (and the page CSP) cannot render.
 */
export const SQUARE_PRODUCT_IMAGE_HOSTNAMES = [
  "items-images-production.s3.us-west-2.amazonaws.com",
  "items-images-staging.s3.us-west-2.amazonaws.com",
  "square-catalog-production.s3.amazonaws.com",
  "square-catalog-sandbox.s3.amazonaws.com",
  "*.squarecdn.com",
] as const;

export const PRODUCT_IMAGE_CSP_SOURCES = SQUARE_PRODUCT_IMAGE_HOSTNAMES.map(
  (hostname) => `https://${hostname}`,
);

/** Local staff overrides must refer to a real deploy-time asset in /public/harina. */
const LOCAL_PRODUCT_IMAGE =
  /^\/harina\/(?:[a-z0-9_-]+\/)*[a-z0-9][a-z0-9._-]*\.(?:avif|gif|jpe?g|png|webp)$/i;

function matchesAllowedHostname(hostname: string): boolean {
  return SQUARE_PRODUCT_IMAGE_HOSTNAMES.some((allowed) => {
    if (!allowed.startsWith("*.")) return hostname === allowed;
    return hostname.endsWith(allowed.slice(1));
  });
}

/** Whether a staff-entered image source will pass both Next/Image and the CSP. */
export function isAllowedProductImageSource(value: string): boolean {
  if (LOCAL_PRODUCT_IMAGE.test(value)) return true;

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      matchesAllowedHostname(url.hostname)
    );
  } catch {
    return false;
  }
}
