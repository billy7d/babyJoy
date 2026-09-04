import { describe, expect, it } from "vitest";
import {
  addProductDescriptionRecentColor,
  createProductDescriptionPointFontSize,
  extractProductDescriptionText,
  normalizeProductDescriptionColor,
  normalizeProductDescriptionDocument,
  normalizeProductDescriptionHexColor,
  normalizeProductDescriptionLinkHref,
  parseProductDescriptionPointFontSize,
  productDescriptionFontSizeToPoints,
  type ProductDescriptionDocument,
} from "../shared/product-description";

const validImageId = "pda_123e4567-e89b-12d3-a456-426614174000";

describe("Product rich description validator", () => {
  it("chuẩn hóa HEX cho màu chữ và từ chối giá trị không an toàn", () => {
    expect(normalizeProductDescriptionHexColor("#FFFFFF")).toBe("#FFFFFF");
    expect(normalizeProductDescriptionHexColor("FFFFFF")).toBe("#FFFFFF");
    expect(normalizeProductDescriptionHexColor("#fff")).toBe("#FFFFFF");
    expect(normalizeProductDescriptionHexColor("a45b3d")).toBe("#A45B3D");
    for (const invalidColor of ["#GGGGGG", "12345", "red123", "#FFFFFF80"])
      expect(normalizeProductDescriptionHexColor(invalidColor)).toBeNull();
    expect(normalizeProductDescriptionColor("accent")).toBe("accent");

    const result = normalizeProductDescriptionDocument({
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Màu tùy chỉnh",
              marks: [{ type: "textStyle", attrs: { color: "#b66542" } }],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.document.content[0]).toMatchObject({
        content: [
          {
            marks: [{ type: "textStyle", attrs: { color: "#B66542" } }],
          },
        ],
      });
  });

  it("deduplicate recent colors và giới hạn tám màu mới nhất", () => {
    const current = Array.from({ length: 8 }, (_, index) =>
      `#${String(index + 1).padStart(2, "0")}0000`,
    );
    expect(addProductDescriptionRecentColor(current, "#010000")).toEqual([
      "#010000",
      ...current.slice(1),
    ]);
    expect(addProductDescriptionRecentColor(current, "#A45B3D")).toHaveLength(8);
    expect(addProductDescriptionRecentColor(current, "#GGGGGG")).toEqual(current);
  });

  it("chấp nhận document rỗng và heading H1-H4", () => {
    expect(
      normalizeProductDescriptionDocument({
        version: 1,
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H1" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H2" }] },
          { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "H3" }] },
          { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "H4" }] },
        ],
      }).ok,
    ).toBe(true);
    expect(normalizeProductDescriptionDocument({ version: 1, type: "doc", content: [] }).ok).toBe(true);
  });

  it("hỗ trợ font-size theo point kiểu Word và giữ tương thích token cũ", () => {
    expect(parseProductDescriptionPointFontSize("8pt")).toBe(8);
    expect(parseProductDescriptionPointFontSize("8.5pt")).toBe(8.5);
    expect(parseProductDescriptionPointFontSize("13.5pt")).toBe(13.5);
    expect(parseProductDescriptionPointFontSize("72pt")).toBe(72);
    expect(parseProductDescriptionPointFontSize("7.5pt")).toBeNull();
    expect(parseProductDescriptionPointFontSize("72.5pt")).toBeNull();
    for (const invalidPoint of ["13.25pt", "13.7pt", "13px", "13", "13 pt", "calc(12pt)"])
      expect(parseProductDescriptionPointFontSize(invalidPoint)).toBeNull();
    expect(createProductDescriptionPointFontSize(24)).toBe("24pt");
    expect(createProductDescriptionPointFontSize(24.5)).toBe("24.5pt");
    expect(createProductDescriptionPointFontSize(24.2)).toBeNull();
    expect(productDescriptionFontSizeToPoints("small")).toBe(10.5);
    expect(productDescriptionFontSizeToPoints("normal")).toBe(12);
    expect(productDescriptionFontSizeToPoints("large")).toBe(15);
    expect(productDescriptionFontSizeToPoints("extraLarge")).toBe(18);

    const result = normalizeProductDescriptionDocument({
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Point size",
              marks: [{ type: "textStyle", attrs: { fontSize: "13.5pt" } }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Legacy size",
              marks: [{ type: "textStyle", attrs: { fontSize: "large" } }],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("chuẩn hóa ordered list attrs do Tiptap sinh ra", () => {
    const result = normalizeProductDescriptionDocument({
      version: 1,
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 1, type: null },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Mục một" }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.content[0]).toEqual({
      type: "orderedList",
      attrs: { start: 1 },
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Mục một" }],
            },
          ],
        },
      ],
    });
  });

  it("chuẩn hóa bullet list attrs rỗng do Tiptap sinh ra", () => {
    const listItem = {
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Mục bullet" }],
        },
      ],
    };
    const result = normalizeProductDescriptionDocument({
      version: 1,
      type: "doc",
      content: [
        { type: "bulletList", attrs: { type: null }, content: [listItem] },
        { type: "bulletList", attrs: null, content: [listItem] },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.content).toHaveLength(2);
      for (const node of result.document.content) {
        expect(node).toEqual({
          type: "bulletList",
          content: [listItem],
        });
      }
    }
  });

  it("vẫn từ chối list attrs có giá trị tùy ý", () => {
    const result = normalizeProductDescriptionDocument({
      version: 1,
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { type: "disc" },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Không hợp lệ" }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.map((issue) => issue.code)).toContain("INVALID_ATTRIBUTES");
  });

  it("từ chối version, node và liên kết không an toàn", () => {
    const result = normalizeProductDescriptionDocument({
      version: 100,
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "Không được" }] },
        { type: "script", attrs: { html: "alert(1)" } },
        { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(["INVALID_VERSION", "INVALID_HEADING", "UNKNOWN_NODE", "INVALID_LINK"]),
      );
    expect(normalizeProductDescriptionLinkHref("/\\evil.example")).toBeNull();
  });

  it("chuẩn hóa liên kết an toàn và thêm thuộc tính bảo vệ khi mở tab mới", () => {
    const result = normalizeProductDescriptionDocument({
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Mua hàng",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
            {
              type: "text",
              text: " nội bộ",
              marks: [{ type: "link", attrs: { href: "/shop" } }],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.content[0]).toMatchObject({
        content: [
          { marks: [{ type: "link", attrs: { href: "https://example.com", target: "_blank", rel: "noopener noreferrer" } }] },
          { marks: [{ type: "link", attrs: { href: "/shop" } }] },
        ],
      });
    }
  });

  it("chấp nhận mark semantic và asset reference hợp lệ", () => {
    const result = normalizeProductDescriptionDocument(
      {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [
              {
                type: "text",
                text: "Nội dung tiếng Việt 😀",
                marks: [
                  { type: "bold" },
                  { type: "italic" },
                  { type: "underline" },
                  { type: "textStyle", attrs: { fontSize: "24pt", color: "primary" } },
                ],
              },
            ],
          },
          {
            type: "productDescriptionImage",
            attrs: { assetId: validImageId, alignment: "right", size: "full", alt: "Ảnh sản phẩm" },
          },
        ],
      },
      { assetIds: new Set([validImageId]) },
    );
    expect(result.ok).toBe(true);
  });

  it("đổi và xóa màu mà vẫn giữ bold, italic và link", () => {
    const colored = normalizeProductDescriptionDocument({
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Giữ định dạng",
              marks: [
                { type: "bold" },
                { type: "italic" },
                { type: "link", attrs: { href: "https://example.com" } },
                { type: "textStyle", attrs: { color: "#a45b3d" } },
              ],
            },
          ],
        },
      ],
    });
    expect(colored.ok).toBe(true);
    if (colored.ok)
      expect(colored.document.content[0]).toMatchObject({
        content: [
          {
            marks: [
              { type: "bold" },
              { type: "italic" },
              { type: "link" },
              { type: "textStyle", attrs: { color: "#A45B3D" } },
            ],
          },
        ],
      });

    const reset = normalizeProductDescriptionDocument({
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Bỏ màu",
              marks: [
                { type: "bold" },
                { type: "italic" },
                { type: "link", attrs: { href: "https://example.com" } },
                { type: "textStyle", attrs: { color: null } },
              ],
            },
          ],
        },
      ],
    });
    expect(reset.ok).toBe(true);
    if (reset.ok)
      expect(reset.document.content[0]).toMatchObject({
        content: [
          {
            marks: [{ type: "bold" }, { type: "italic" }, { type: "link" }],
          },
        ],
      });
  });

  it("từ chối màu, cỡ chữ, alignment và asset không an toàn", () => {
    const result = normalizeProductDescriptionDocument({
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "absolute" },
          content: [{ type: "text", text: "x", marks: [{ type: "textStyle", attrs: { fontSize: "42px", color: "url(javascript:alert(1))" } }] }],
        },
        { type: "productDescriptionImage", attrs: { assetId: validImageId, alignment: "justify", size: "42%", alt: "" } },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("extract plain text deterministic và bỏ qua ảnh", () => {
    const document: ProductDescriptionDocument = {
      version: 1,
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Tiêu đề" }] },
        { type: "paragraph", content: [{ type: "text", text: "Đoạn văn" }, { type: "hardBreak" }, { type: "text", text: "tiếp" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Táo" }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Cà rốt" }] }] }] },
        { type: "productDescriptionImage", attrs: { assetId: validImageId, alignment: "center", size: "medium", alt: "Không đưa alt vào text" } },
      ],
    };
    expect(extractProductDescriptionText(document)).toBe("Tiêu đề\nĐoạn văn\ntiếp\nTáo\nCà rốt");
  });
});
