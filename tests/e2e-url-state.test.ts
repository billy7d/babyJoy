import { describe, expect, it } from "vitest";

import { semanticUrlState } from "./e2e-url-state.mjs";

describe("E2E semantic URL state", () => {
  it("coi query ordering khác nhau là cùng functional state", () => {
    const initial =
      "https://example.test/shop?category=a&q=x&sort=price_asc&page=1";
    const reordered =
      "https://example.test/shop?page=1&q=x&category=a&sort=price_asc";

    expect(semanticUrlState(initial)).toEqual(semanticUrlState(reordered));
  });

  it("coi tagIds là một phần của functional state", () => {
    const initial =
      "https://example.test/shop?page=1&q=x&category=a&sort=price_asc";
    const active = `${initial}&tagIds=age-a%2Ccharacteristic-x`;
    const differentActive = `${initial}&tagIds=age-b%2Ccharacteristic-x`;

    expect(semanticUrlState(active)).not.toEqual(semanticUrlState(initial));
    expect(semanticUrlState(active)).not.toEqual(
      semanticUrlState(differentActive),
    );
  });
});
