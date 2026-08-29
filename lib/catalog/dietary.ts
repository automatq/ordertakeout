/**
 * Fixed vocabulary for allergen and dietary labelling.
 *
 * A closed set, not free text: this is a legal-adjacent surface, and a typo'd
 * or invented token ("glutenfree"?) would render as a health claim nobody
 * reviewed. Staff pick from these chips; the server rejects anything else; the
 * storefront filters unknown stored tokens rather than crashing, so a future
 * vocabulary change can't take the menu down.
 *
 * The allergen list is Canada's priority allergens that this bakery's kitchen
 * can actually contain — sesame is a Canadian priority allergen and easy to
 * forget. Absence of a chip is NOT a "free from" claim; every surface that
 * shows allergens must show ALLERGEN_DISCLAIMER with them.
 */

export const ALLERGENS = [
  "wheat",
  "dairy",
  "eggs",
  "tree_nuts",
  "peanuts",
  "soy",
  "sesame",
] as const;

export type Allergen = (typeof ALLERGENS)[number];

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  wheat: "Wheat",
  dairy: "Dairy",
  eggs: "Eggs",
  tree_nuts: "Tree nuts",
  peanuts: "Peanuts",
  soy: "Soy",
  sesame: "Sesame",
};

export const DIETARY_TAGS = [
  "vegetarian",
  "vegan",
  "halal_friendly",
  "contains_pork",
] as const;

export type DietaryTag = (typeof DIETARY_TAGS)[number];

export const DIETARY_LABELS: Record<DietaryTag, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  halal_friendly: "Halal-friendly",
  contains_pork: "Contains pork",
};

export const ALLERGEN_DISCLAIMER =
  "Everything is prepared in a shared kitchen. If you have an allergy, always confirm with the store before ordering.";

function isAllergen(value: unknown): value is Allergen {
  return typeof value === "string" && (ALLERGENS as readonly string[]).includes(value);
}

function isDietaryTag(value: unknown): value is DietaryTag {
  return typeof value === "string" && (DIETARY_TAGS as readonly string[]).includes(value);
}

/** Read path: unknown stored tokens are dropped, in canonical vocabulary order. */
export function parseAllergens(value: unknown): Allergen[] {
  if (!Array.isArray(value)) return [];
  return ALLERGENS.filter((allergen) => value.includes(allergen));
}

/** Read path: unknown stored tokens are dropped, in canonical vocabulary order. */
export function parseDietaryTags(value: unknown): DietaryTag[] {
  if (!Array.isArray(value)) return [];
  return DIETARY_TAGS.filter((tag) => value.includes(tag));
}

/** Write path: any token outside the vocabulary is a hard error, not a drop. */
export function validateAllergens(values: readonly string[]): { ok: true; allergens: Allergen[] } | { ok: false; invalid: string[] } {
  const invalid = values.filter((value) => !isAllergen(value));
  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, allergens: parseAllergens([...values]) };
}

/** Write path: any token outside the vocabulary is a hard error, not a drop. */
export function validateDietaryTags(values: readonly string[]): { ok: true; tags: DietaryTag[] } | { ok: false; invalid: string[] } {
  const invalid = values.filter((value) => !isDietaryTag(value));
  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, tags: parseDietaryTags([...values]) };
}
