import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getVariantFeaturedFlags,
  isVariantInFeaturedCollection,
} from "../app/lib/catalog";

const tag = (id: string, systemKey: string) => ({
  id,
  name: systemKey,
  slug: systemKey,
  groupId: "tag-group-merchandising",
  systemKey,
  featuredSectionKey: systemKey,
});

describe("featured collections storefront contract", () => {
  it("đọc flag từ chính variant cho single, both và normal", () => {
    const bestSeller = { tags: [tag("best", "best_seller")] };
    const mustTry = { tags: [tag("must", "must_try")] };
    const both = { tags: [tag("best", "best_seller"), tag("must", "must_try")] };
    const normal = { tags: [] };

    expect(getVariantFeaturedFlags(bestSeller)).toEqual({ bestSeller: true, mustTry: false });
    expect(getVariantFeaturedFlags(mustTry)).toEqual({ bestSeller: false, mustTry: true });
    expect(getVariantFeaturedFlags(both)).toEqual({ bestSeller: true, mustTry: true });
    expect(getVariantFeaturedFlags(normal)).toEqual({ bestSeller: false, mustTry: false });
    expect(isVariantInFeaturedCollection(both, "best-seller")).toBe(true);
    expect(isVariantInFeaturedCollection(both, "must-try")).toBe(true);
  });

  it("homepage dùng canonical CTA và PDP render badge cluster trên mọi variant", () => {
    const publicSource = readFileSync("app/components/public-pages.tsx", "utf8");
    const cssSource = readFileSync("app/app.css", "utf8");
    expect(publicSource).toContain('"/shop?featured=best-seller"');
    expect(publicSource).toContain("const featuredLink =");
    expect(publicSource).toContain('to="/shop?featured=must-try"');
    expect(publicSource).toContain("getVariantFeaturedFlags(item)");
    expect(publicSource).toContain("variant-badge-cluster");
    expect(cssSource).toContain("background:#e65100");
    expect(cssSource).toContain("background:#059669");
    expect(cssSource).toContain("pointer-events:none");
    expect(cssSource).toContain("white-space:nowrap");
  });
});
