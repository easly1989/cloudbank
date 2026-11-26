import { describe, expect, it } from "vitest";

import { moveOrder } from "./sourceOrder";

describe("moveOrder", () => {
  it("moves a source up and down", () => {
    expect(moveOrder([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveOrder([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
  });
  it("moves nothing past either end, or onto itself", () => {
    expect(moveOrder([1, 2, 3], 0, -1)).toBeNull();
    expect(moveOrder([1, 2, 3], 2, 3)).toBeNull();
    expect(moveOrder([1, 2, 3], 1, 1)).toBeNull();
  });
});
