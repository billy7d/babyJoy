import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../workers/app";
import {
  buildPaginationMeta,
  getPaginationItems,
} from "../shared/pagination";

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

class StatementAdapter {
  private values: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    const next = new StatementAdapter(this.statement);
    next.values = values;
    return next;
  }

  all<T>() {
    return Promise.resolve({ results: this.statement.all(...this.values) as T[] });
  }

  first<T>() {
    return Promise.resolve((this.statement.get(...this.values) as T | undefined) ?? null);
  }
}

class D1Adapter {
  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new StatementAdapter(this.database.prepare(sql));
  }
}

const databases: DatabaseSync[] = [];

function createEnv() {
  const database = new DatabaseSync(":memory:");
  database.exec(migration("0001_initial.sql"));
  database.exec(migration("0006_product_taxonomy_v1.sql"));
  database.exec(
    `INSERT INTO tags (id, name, slug, group_type, sort_order) VALUES
      ('tag-organic', 'Hữu cơ', 'huu-co', 'ATTRIBUTE', 1),
      ('tag-no-sugar', 'Không thêm đường', 'khong-them-duong', 'ATTRIBUTE', 2)`,
  );
  databases.push(database);
  return {
    database,
    env: {
      DB: new D1Adapter(database),
      PRODUCT_IMAGES: { head: async () => ({}) },
      ENVIRONMENT: "development",
      STOREFRONT_ACCESS_GATE_ENABLED: "false",
    } as unknown as Env,
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function api(env: Env, path: string) {
  return worker.fetch(
    new Request(`https://metraphuong.com${path}`),
    env,
    {} as ExecutionContext,
  );
}

function insertProduct(
  database: DatabaseSync,
  index: number,
  options: {
    id?: string;
    name?: string;
    slug?: string;
    brandId?: string | null;
    status?: "AVAILABLE" | "OUT_OF_STOCK" | "HIDDEN";
    variantAvailability?: "AVAILABLE" | "OUT_OF_STOCK" | "HIDDEN";
    categoryId?: string;
    minAgeMonths?: number;
    bestSeller?: boolean;
    bestSellerRank?: number | null;
    priceVnd?: number;
    sku?: string;
  } = {},
) {
  const id = options.id ?? `product-${index}`;
  const name = options.name ?? `Sản phẩm ${index}`;
  const slug = options.slug ?? `product-${index}`;
  const status = options.status ?? "AVAILABLE";
  const variantAvailability = options.variantAvailability ?? "AVAILABLE";
  database
    .prepare(
      `INSERT INTO products
        (id, name, slug, brand, brand_id, short_description, description, status,
         featured, sort_order, min_age_months, is_best_seller, best_seller_rank, created_at)
       VALUES (?, ?, ?, ?, ?, '', '', ?, 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      slug,
      options.brandId ? null : "Legacy brand",
      options.brandId ?? null,
      status,
      index,
      options.minAgeMonths ?? 6,
      options.bestSeller ? 1 : 0,
      options.bestSellerRank ?? null,
      `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    );
  database
    .prepare(
      `INSERT INTO product_variants
        (id, product_id, name, sku, price_vnd, availability, sort_order)
       VALUES (?, ?, 'Gói 100g', ?, ?, ?, 1)`,
    )
    .run(
      `variant-${index}`,
      id,
      options.sku ?? `SKU-${index}`,
      options.priceVnd ?? 100000 + index,
      variantAvailability,
    );
  database
    .prepare(
      "INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)",
    )
    .run(id, options.categoryId ?? "cat-cereal");
  return id;
}

function addTag(database: DatabaseSync, productId: string, tagId = "tag-organic") {
  database
    .prepare("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)")
    .run(productId, tagId);
}

async function jsonBody(response: Response) {
  return (await response.json()) as {
    data: Array<Record<string, unknown>>;
    pagination?: {
      page: number;
      limit: number;
      totalItems: number;
      totalPages: number;
      hasPrevious: boolean;
      hasNext: boolean;
    };
  };
}

describe("Shared pagination primitives", () => {
  it.each([
    [0, 1, 24, 0, false, false],
    [1, 1, 24, 1, false, false],
    [23, 1, 24, 1, false, false],
    [24, 1, 24, 1, false, false],
    [25, 1, 24, 2, false, true],
    [47, 2, 24, 2, true, false],
    [48, 2, 24, 2, true, false],
    [49, 3, 24, 3, true, false],
  ])(
    "tính metadata cho %i items",
    (totalItems, requestedPage, limit, totalPages, hasPrevious, hasNext) => {
      expect(
        buildPaginationMeta({ totalItems, requestedPage, limit }),
      ).toMatchObject({
        page: requestedPage === 0 ? 1 : Math.min(requestedPage, totalPages || 1),
        limit,
        totalItems,
        totalPages,
        hasPrevious,
        hasNext,
      });
    },
  );

  it("clamp page và không tạo số trang trùng hoặc ngoài range", () => {
    expect(getPaginationItems(1, 20)).toEqual([1, 2, 3, "ellipsis", 20]);
    expect(getPaginationItems(10, 20)).toEqual([
      1,
      "ellipsis",
      9,
      10,
      11,
      "ellipsis",
      20,
    ]);
    expect(getPaginationItems(20, 20)).toEqual([
      1,
      "ellipsis",
      18,
      19,
      20,
    ]);
    const pages = getPaginationItems(999, 3).filter(
      (item): item is number => typeof item === "number",
    );
    expect(new Set(pages).size).toBe(pages.length);
    expect(pages.every((page) => page >= 1 && page <= 3)).toBe(true);
  });
});

describe("Authoritative public product pagination", () => {
  it("count, page size, boundary và page clamp đều lấy từ D1", async () => {
    const { database, env } = createEnv();
    for (let index = 1; index <= 49; index += 1) insertProduct(database, index);

    const first = await jsonBody(await api(env, "/api/products?limit=24&page=1"));
    expect(first.data).toHaveLength(24);
    expect(first.pagination).toEqual({
      page: 1,
      limit: 24,
      totalItems: 49,
      totalPages: 3,
      hasPrevious: false,
      hasNext: true,
    });

    const second = await jsonBody(await api(env, "/api/products?limit=24&page=2"));
    expect(second.data).toHaveLength(24);
    expect(second.pagination).toMatchObject({
      page: 2,
      totalItems: 49,
      totalPages: 3,
      hasPrevious: true,
      hasNext: true,
    });

    const clamped = await jsonBody(await api(env, "/api/products?limit=24&page=999"));
    expect(clamped.data).toHaveLength(1);
    expect(clamped.pagination).toMatchObject({
      page: 3,
      totalItems: 49,
      totalPages: 3,
      hasPrevious: true,
      hasNext: false,
    });

    for (const invalidPage of ["0", "-10", "abc"] as const) {
      const body = await jsonBody(
        await api(env, `/api/products?limit=24&page=${invalidPage}`),
      );
      expect(body.pagination?.page).toBe(1);
    }
  });

  it("áp dụng category, brand, age, best seller, tag, availability và search trước COUNT", async () => {
    const { database, env } = createEnv();
    const categoryProduct = insertProduct(database, 1, {
      brandId: "brand-gerber",
      categoryId: "cat-snack",
      minAgeMonths: 6,
      bestSeller: true,
      bestSellerRank: 1,
      sku: "CATEGORY-SKU",
      name: "Tên sản phẩm theo danh mục",
    });
    addTag(database, categoryProduct);
    const secondCategory = insertProduct(database, 2, {
      brandId: "brand-heinz",
      categoryId: "cat-cereal",
      minAgeMonths: 12,
      priceVnd: 50000,
      name: "Tên sản phẩm khác",
    });
    const availableProduct = insertProduct(database, 3, {
      brandId: "brand-gerber",
      categoryId: "cat-cereal",
      variantAvailability: "OUT_OF_STOCK",
      name: "Gerber hết hàng",
      sku: "OOS-SKU",
    });
    insertProduct(database, 4, {
      brandId: "brand-gerber",
      categoryId: "cat-cereal",
      name: "Sản phẩm tìm theo SKU",
      sku: "SEARCH-ONLY-SKU",
    });
    insertProduct(database, 5, {
      brandId: "brand-gerber",
      categoryId: "cat-cereal",
      status: "HIDDEN",
      name: "Sản phẩm hidden",
    });

    const category = await jsonBody(
      await api(env, "/api/products?category=banh-an-dam"),
    );
    expect(category.pagination).toMatchObject({ totalItems: 1, totalPages: 1 });
    expect(category.data[0]?.id).toBe(categoryProduct);

    const brand = await jsonBody(await api(env, "/api/products?brand=gerber"));
    expect(brand.pagination?.totalItems).toBe(3);

    const age = await jsonBody(await api(env, "/api/products?age=6"));
    expect(age.pagination?.totalItems).toBe(3);

    const bestSeller = await jsonBody(
      await api(env, "/api/products?bestSeller=1&sort=best_seller"),
    );
    expect(bestSeller.pagination).toMatchObject({ totalItems: 1, totalPages: 1 });
    expect(bestSeller.data[0]?.id).toBe(categoryProduct);

    const tag = await jsonBody(await api(env, "/api/products?tag=huu-co"));
    expect(tag.pagination).toMatchObject({ totalItems: 1, totalPages: 1 });
    expect(tag.data[0]).toMatchObject({ id: categoryProduct, tagSlugs: ["huu-co"] });

    const available = await jsonBody(
      await api(env, "/api/products?available=1"),
    );
    expect(available.pagination?.totalItems).toBe(3);
    expect(available.data.some((product) => product.id === availableProduct)).toBe(
      false,
    );

    const search = await jsonBody(
      await api(env, "/api/products?q=SEARCH-ONLY-SKU"),
    );
    expect(search.pagination).toMatchObject({ totalItems: 1, totalPages: 1 });
    expect(search.data[0]?.id).toBe("product-4");

    const malformed = await jsonBody(
      await api(env, "/api/products?sort=not-a-sort&limit=999999"),
    );
    expect(malformed.pagination?.limit).toBe(24);
    expect(malformed.pagination?.totalItems).toBe(4);

    database
      .prepare(
        "INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)",
      )
      .run(secondCategory, "cat-snack");
    const orCategory = await jsonBody(
      await api(env, "/api/products?category=banh-an-dam,bot-an-dam"),
    );
    expect(orCategory.pagination?.totalItems).toBe(4);
    expect(new Set(orCategory.data.map((product) => product.id)).size).toBe(
      orCategory.data.length,
    );
  });

  it("sort ổn định khi giá bằng nhau và detail lấy đúng product ngoài page đầu", async () => {
    const { database, env } = createEnv();
    for (let index = 1; index <= 25; index += 1)
      insertProduct(database, index, {
        id: `tie-${String(index).padStart(2, "0")}`,
        slug: `tie-${String(index).padStart(2, "0")}`,
        priceVnd: 100000,
      });
    const pageTwo = await jsonBody(await api(env, "/api/products?page=2"));
    expect(pageTwo.data).toHaveLength(1);
    expect(pageTwo.data[0]?.slug).toBe("tie-25");

    const detail = await jsonBody(
      await api(env, "/api/products/tie-25"),
    );
    expect(detail.data).toMatchObject({ id: "tie-25", slug: "tie-25" });
    expect((await api(env, "/api/products/not-existing-product")).status).toBe(404);
  });
});

describe("Authoritative admin product pagination", () => {
  it("lọc status trước pagination và trả count chính xác", async () => {
    const { database, env } = createEnv();
    for (let index = 1; index <= 50; index += 1) {
      const status = index <= 10 ? "HIDDEN" : index <= 25 ? "OUT_OF_STOCK" : "AVAILABLE";
      insertProduct(database, index, {
        status,
        variantAvailability: status === "AVAILABLE" ? "AVAILABLE" : "OUT_OF_STOCK",
        name: status === "HIDDEN" && index === 1 ? "Gerber hidden" : undefined,
      });
    }

    for (const [status, totalItems] of [
      ["HIDDEN", 10],
      ["OUT_OF_STOCK", 15],
      ["AVAILABLE", 25],
    ] as const) {
      const body = await jsonBody(
        await api(env, `/api/admin/products?status=${status}&limit=24&page=1`),
      );
      expect(body.pagination).toMatchObject({
        page: 1,
        totalItems,
        totalPages: Math.ceil(totalItems / 24),
        hasNext: totalItems > 24,
      });
      expect(body.data.every((product) => product.status === status)).toBe(true);
    }

    const hiddenSearch = await jsonBody(
      await api(env, "/api/admin/products?status=HIDDEN&q=Gerber"),
    );
    expect(hiddenSearch.pagination).toMatchObject({ totalItems: 1, totalPages: 1 });
    expect(hiddenSearch.data[0]?.name).toBe("Gerber hidden");

    const invalid = await jsonBody(
      await api(env, "/api/admin/products?status=UNKNOWN&page=999"),
    );
    expect(invalid.pagination).toMatchObject({
      page: 3,
      totalItems: 50,
      totalPages: 3,
      hasPrevious: true,
      hasNext: false,
    });
  });
});
