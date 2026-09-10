import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeLegacyTagOptions,
  normalizeProductListParams,
  normalizeStorefrontFilterOptions,
  selectStorefrontFilterGroups,
} from "../app/lib/catalog-context";

describe("Storefront product filters", () => {
  it("chuẩn hóa option hợp lệ, loại giá trị rỗng và loại duplicate", () => {
    expect(
      normalizeStorefrontFilterOptions([
        null,
        undefined,
        "",
        "   ",
        { id: "inactive", name: "Ẩn", slug: "an", groupId: "age", isActive: false },
        { id: "", name: "Sai", slug: "invalid", groupId: "group" },
        {
          id: "tag-age-6",
          name: " 6 tháng ",
          displayName: " 6 tháng ",
          slug: " age-6 ",
          groupId: " age ",
        },
        {
          id: "duplicate-id",
          name: "6 tháng",
          slug: "AGE-6",
          groupId: "age",
        },
        {
          id: "tag-organic",
          name: " Hữu cơ ",
          slug: " huu-co ",
          groupId: "attributes",
        },
      ]),
    ).toEqual([
      {
        id: "tag-age-6",
        name: "6 tháng",
        displayName: "6 tháng",
        slug: "age-6",
        groupId: "age",
      },
      {
        id: "tag-organic",
        name: "Hữu cơ",
        displayName: "Hữu cơ",
        slug: "huu-co",
        groupId: "attributes",
      },
    ]);
  });

  it("chỉ chọn group Độ tuổi và Đặc điểm, không render group khác", () => {
    const selected = selectStorefrontFilterGroups([
      {
        id: "tag-group-age",
        name: "Độ tuổi",
        slug: "do-tuoi",
        systemKey: "age",
        displayName: "Độ tuổi",
        isActive: true,
        isFilterable: true,
        tags: [
          {
            id: "tag-age-6",
            name: "6 tháng",
            slug: "6-thang",
            groupId: "tag-group-age",
          },
          {
            id: "wrong-group",
            name: "Sai nhóm",
            slug: "sai-nhom",
            groupId: "tag-group-other",
          },
        ],
      },
      {
        id: "tag-group-attributes",
        name: "Đặc điểm",
        slug: "dac-diem",
        displayName: "Đặc điểm",
        isActive: true,
        isFilterable: true,
        tags: [
          {
            id: "tag-organic",
            name: "Hữu cơ",
            slug: "huu-co",
            groupId: "tag-group-attributes",
          },
        ],
      },
      {
        id: "tag-group-custom",
        name: "Màu sắc",
        slug: "mau-sac",
        displayName: "Màu sắc",
        isActive: true,
        isFilterable: true,
        tags: [
          {
            id: "tag-red",
            name: "Đỏ",
            slug: "do",
            groupId: "tag-group-custom",
          },
        ],
      },
    ]);

    expect(selected.ageGroup?.tags.map((tag) => tag.id)).toEqual([
      "tag-age-6",
    ]);
    expect(selected.characteristicGroup?.tags.map((tag) => tag.id)).toEqual([
      "tag-organic",
    ]);
  });

  it.each([[], null, undefined])(
    "không trả về section Đặc điểm khi dữ liệu là %s",
    (value) => {
      const selected = selectStorefrontFilterGroups([
        {
          id: "tag-group-attributes",
          name: "Đặc điểm",
          slug: "dac-diem",
          displayName: "Đặc điểm",
          isActive: true,
          isFilterable: true,
          tags: value,
        },
      ]);
      expect(selected.characteristicGroup).toBeNull();
    },
  );

  it("legacy characteristic cũng loại option rỗng và duplicate", () => {
    expect(
      normalizeLegacyTagOptions([
        { name: " Hữu cơ ", slug: " huu-co " },
        { name: "Hữu cơ lần hai", slug: "HUu-co" },
        { name: " ", slug: "blank" },
        { name: "Đã ẩn", slug: "da-an", isActive: false },
        null,
      ]),
    ).toEqual([{ name: "Hữu cơ", slug: "huu-co" }]);
  });

  it("loại state brand, availability, Best seller và tag group không được hỗ trợ", () => {
    const normalized = normalizeProductListParams(
      new URLSearchParams(
        "page=4&q=Gerber&category=banh-an-dam&brand=heinz&available=1&bestSeller=1&tagIds=tag-age-6,hidden,tag-organic&age=6&tag=huu-co&sort=price_asc",
      ),
      {
        filterGroupsReady: true,
        tagGroupsSupported: true,
        allowedTagIds: new Set(["tag-age-6", "tag-organic"]),
      },
    );

    expect([...normalized.entries()]).toEqual([
      ["page", "4"],
      ["q", "Gerber"],
      ["category", "banh-an-dam"],
      ["tagIds", "tag-age-6,tag-organic"],
      ["sort", "price_asc"],
    ]);
  });

  it("giữ category route context nhưng loại category query khi đã có route ép", () => {
    const normalized = normalizeProductListParams(
      new URLSearchParams("category=banh-an-dam&brand=heinz"),
      { forcedCategory: "banh-an-dam", filterGroupsReady: true },
    );
    expect(normalized.has("category")).toBe(false);
    expect(normalized.has("brand")).toBe(false);
  });

  it("ProductListPage chỉ chứa hai section filter được phép", () => {
    const source = readFileSync("app/components/public-pages.tsx", "utf8");
    const listingSource = source.slice(
      source.indexOf("export function ProductListPage"),
      source.indexOf("export function CategoriesPage"),
    );
    expect(listingSource).toContain("age-filter-section");
    expect(listingSource).toContain("characteristic-filter-section");
    expect(listingSource).not.toContain('<h3>Danh mục</h3>');
    expect(listingSource).not.toContain('<h3>Thương hiệu</h3>');
    expect(listingSource).not.toContain("Tình trạng");
    expect(listingSource).not.toContain("mobile-category-chips");
    expect(listingSource).not.toContain('params.get("brand")');
    expect(listingSource).not.toContain('params.get("available")');
  });
});
