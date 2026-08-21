import { describe, expect, it } from "vitest";

import { serializeJsonLd } from "./serialize-json-ld";

describe("serializeJsonLd", () => {
  it("cannot terminate the script when Square-controlled text contains markup", () => {
    const value = {
      name: 'Harina </script><img src=x onerror="alert(1)">',
      address: "Bread < Bakery",
    };

    const serialized = serializeJsonLd(value);

    expect(serialized).not.toContain("</script");
    expect(serialized).not.toContain("<img");
    expect(serialized).toContain("\\u003c/script>");
    expect(JSON.parse(serialized)).toEqual(value);
  });
});
