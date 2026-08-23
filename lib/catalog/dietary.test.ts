import { describe, expect, it } from "vitest";

import {
  parseAllergens,
  parseDietaryTags,
  validateAllergens,
  validateDietaryTags,
} from "./dietary";

describe("dietary vocabulary", () => {
  it("filters unknown stored tokens on read instead of crashing the menu", () => {
    expect(parseAllergens(["dairy", "glutenfree", "wheat", 5, null])).toEqual(["wheat", "dairy"]);
    expect(parseDietaryTags(["vegan", "keto"])).toEqual(["vegan"]);
    expect(parseAllergens("wheat")).toEqual([]);
    expect(parseAllergens(undefined)).toEqual([]);
  });

  it("returns tokens in canonical vocabulary order regardless of stored order", () => {
    expect(parseAllergens(["sesame", "wheat", "eggs"])).toEqual(["wheat", "eggs", "sesame"]);
  });

  it("hard-rejects unknown tokens on the write path — this is a health-claim surface", () => {
    expect(validateAllergens(["wheat", "gluten"])).toEqual({ ok: false, invalid: ["gluten"] });
    expect(validateDietaryTags(["vegan", "paleo"])).toEqual({ ok: false, invalid: ["paleo"] });
  });

  it("accepts and canonicalizes valid write-path tokens", () => {
    expect(validateAllergens(["dairy", "wheat"])).toEqual({
      ok: true,
      allergens: ["wheat", "dairy"],
    });
    expect(validateDietaryTags([])).toEqual({ ok: true, tags: [] });
  });
});
