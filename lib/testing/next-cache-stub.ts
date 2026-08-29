/**
 * Vitest stand-in for `next/cache`.
 *
 * The real module's `cacheLife()`/`cacheTag()` throw outside a Next server with
 * `cacheComponents` enabled, which made every `"use cache"` function — and any
 * integration test that reaches one, like the slot-reservation race — untestable
 * under Vitest. Caching semantics are Next's to test; these tests care about the
 * function bodies. Wired up as a resolve alias in vitest.config.ts, same
 * approach as the `server-only` alias. Not shipped: nothing outside the test
 * config imports this file.
 */

export function cacheLife(_profile: string): void {}

export function cacheTag(..._tags: string[]): void {}

export function updateTag(_tag: string): void {}

export function revalidateTag(_tag: string): void {}

export function revalidatePath(_path: string, _type?: "layout" | "page"): void {}
