import { describe, expect, it } from "vitest";
import { loadCatalogData } from "../app/lib/catalog-context";

type ApiResponse = {
  status?: number;
  body?: unknown;
};

const productRow = {
  id: "product-real",
  slug: "product-real",
  name: "Sản phẩm thật",
  brand: "Gerber",
  brandId: "brand-gerber",
  brandSlug: "gerber",
  categorySlugs: ["bot-an-dam"],
  tagNames: ["Hữu cơ"],
  variants: [
    {
      id: "variant-real",
      name: "Gói 100g",
      sku: "REAL-100",
      priceVnd: 99000,
      availability: "AVAILABLE" as const,
    },
  ],
  images: [],
};

function response({ status = 200, body = { data: [] } }: ApiResponse = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetcher(overrides: Record<string, ApiResponse> = {}) {
  const requestedPaths: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    const path = String(input);
    requestedPaths.push(path);
    const override = overrides[path];
    return response(override);
  };
  return { fetcher, requestedPaths };
}

describe("CatalogProvider API boundary", () => {
  it("success với products [] coi catalog rỗng là authoritative", async () => {
    const { fetcher } = createFetcher();

    const result = await loadCatalogData(fetcher);

    expect(result.products).toEqual([]);
    expect(result.categories).toEqual([]);
    expect(result.brands).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it("success với taxonomy [] không khôi phục category hoặc tag fallback", async () => {
    const { fetcher } = createFetcher({
      "/api/products?limit=24": { body: { data: [productRow] } },
      "/api/categories": { body: { data: [] } },
      "/api/brands": { body: { data: [] } },
      "/api/tags": { body: { data: [] } },
    });

    const result = await loadCatalogData(fetcher);

    expect(result.products).toHaveLength(1);
    expect(result.categories).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it.each([401, 503])(
    "%s vẫn redirect /access-required và không thành empty catalog",
    async (status) => {
      const redirects: string[] = [];
      const { fetcher } = createFetcher({
        "/api/products?limit=24": { status },
      });

      await expect(
        loadCatalogData(fetcher, (path) => redirects.push(path)),
      ).rejects.toThrow("CATALOG_LOAD_FAILED");
      expect(redirects).toEqual(["/access-required"]);
    },
  );

  it("403 vẫn giữ error behavior hiện tại và không redirect hoặc empty", async () => {
    const redirects: string[] = [];
    const { fetcher } = createFetcher({
      "/api/products?limit=24": { status: 403 },
    });

    await expect(
      loadCatalogData(fetcher, (path) => redirects.push(path)),
    ).rejects.toThrow("CATALOG_LOAD_FAILED");
    expect(redirects).toEqual([]);
  });

  it("network failure vẫn reject và không được giả thành empty catalog", async () => {
    const redirects: string[] = [];
    const fetcher = async () => {
      throw new Error("network down");
    };

    await expect(
      loadCatalogData(fetcher, (path) => redirects.push(path)),
    ).rejects.toThrow("network down");
    expect(redirects).toEqual([]);
  });

  it("malformed JSON vẫn reject thay vì commit snapshot rỗng", async () => {
    const malformedFetcher = async (input: RequestInfo | URL) => {
      if (String(input) === "/api/products?limit=24")
        return new Response("not-json", { status: 200 });
      return response();
    };

    await expect(loadCatalogData(malformedFetcher)).rejects.toThrow();
  });

  it("success response không rỗng vẫn map và giữ catalog như trước", async () => {
    const { fetcher, requestedPaths } = createFetcher({
      "/api/products?limit=24": { body: { data: [productRow] } },
      "/api/categories": {
        body: {
          data: [
            {
              id: "cat-cereal",
              name: "Bột ăn dặm",
              slug: "bot-an-dam",
              productCount: 1,
            },
          ],
        },
      },
      "/api/brands": {
        body: { data: [{ id: "brand-gerber", name: "Gerber", slug: "gerber" }] },
      },
      "/api/tags": {
        body: { data: [{ id: "tag-organic", name: "Hữu cơ", slug: "huu-co" }] },
      },
    });

    const result = await loadCatalogData(fetcher);

    expect(result.products[0]).toMatchObject({
      id: productRow.id,
      slug: productRow.slug,
      name: productRow.name,
    });
    expect(result.categories).toEqual([
      expect.objectContaining({ id: "cat-cereal", productCount: 1 }),
    ]);
    expect(result.brands).toEqual([
      expect.objectContaining({ id: "brand-gerber", name: "Gerber" }),
    ]);
    expect(result.tags).toEqual(["Hữu cơ"]);
    expect(requestedPaths).toEqual([
      "/api/products?limit=24",
      "/api/categories",
      "/api/brands",
      "/api/tags",
    ]);
  });
});
