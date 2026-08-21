/**
 * Serialize JSON for an inline HTML script without allowing `</script>` to end
 * the raw-text element. HTML parsers recognize that delimiter even when the
 * script has the non-executable `application/ld+json` type.
 */
export function serializeJsonLd(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("JSON-LD value must be serializable");
  return json.replace(/</g, "\\u003c");
}
