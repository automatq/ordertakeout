import { describe, expect, it } from "vitest";

import { dismissVisibleUnread } from "./unread";

describe("dismissVisibleUnread", () => {
  it("preserves unread orders hidden by another location filter", () => {
    const result = dismissVisibleUnread(
      new Set(["toronto-order", "london-order"]),
      ["toronto-order"],
    );
    expect([...result]).toEqual(["london-order"]);
  });

  it("clears every unread order when every order is visible", () => {
    const result = dismissVisibleUnread(
      new Set(["toronto-order", "london-order"]),
      ["toronto-order", "london-order"],
    );
    expect(result.size).toBe(0);
  });
});
