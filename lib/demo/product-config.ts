export interface ProductConfigIdentity {
  productId: string;
  slug: string;
}

export interface DemoRuleIdentity {
  productId: string;
  slug: string;
}

export interface DemoConfigPlan {
  demoProductId: string;
  configuredProductId: string;
  slug: string;
  action: "upsert" | "reuse";
}

/**
 * Plan demo configuration without ever replacing an unrelated Square row.
 *
 * A development database is often reused after connecting Square. In that
 * case the customer-facing slugs already belong to real Square object IDs.
 * Demo mode can safely reuse those scheduling rules, but it must not rewrite
 * their primary keys. A DEMO_* ID attached to another slug is a genuine
 * collision and is rejected before the transaction performs any writes.
 */
export function planDemoProductConfigs(
  existing: readonly ProductConfigIdentity[],
  rules: readonly DemoRuleIdentity[],
): DemoConfigPlan[] {
  const byId = new Map(existing.map((row) => [row.productId, row]));
  const bySlug = new Map(existing.map((row) => [row.slug, row]));

  return rules.map((rule) => {
    const idMatch = byId.get(rule.productId);
    if (idMatch && idMatch.slug !== rule.slug) {
      throw new Error(
        `Demo product ID ${rule.productId} is already assigned to slug ${idMatch.slug}.`,
      );
    }

    const slugMatch = bySlug.get(rule.slug);
    if (slugMatch && slugMatch.productId !== rule.productId) {
      return {
        demoProductId: rule.productId,
        configuredProductId: slugMatch.productId,
        slug: rule.slug,
        action: "reuse",
      };
    }

    return {
      demoProductId: rule.productId,
      configuredProductId: rule.productId,
      slug: rule.slug,
      action: "upsert",
    };
  });
}

/** Match a catalog fixture to rules by ID, or by its known demo slug fallback. */
export function matchProductConfig<T extends ProductConfigIdentity>(
  productId: string,
  configs: readonly T[],
  demoRules: readonly DemoRuleIdentity[],
  demoMode: boolean,
): T | undefined {
  const exact = configs.find((config) => config.productId === productId);
  if (exact || !demoMode) return exact;

  const demoRule = demoRules.find((rule) => rule.productId === productId);
  return demoRule
    ? configs.find((config) => config.slug === demoRule.slug)
    : undefined;
}
