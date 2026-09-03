import { describe, expect, it } from "vitest";
import {
  extractProductDescriptionText,
  normalizeProductDescriptionDocument,
  type ProductDescriptionDocument,
} from "../shared/product-description";

const validImageId = "pda_123e4567-e89b-12d3-a456-426614174000";

describe("Product rich description validator", () => {
  it("chấp nhận document rỗng và heading H2-H4", () => {
    expect(
      normalizeProductDescriptionDocument({
        version: 1,
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H2" }] },
          { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "H3" }] },
          { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "H4" }] },
        ],
      }).ok,
    ).toBe(true);
    expect(normalizeProductDescriptionDocument({ version: 1, type: "doc", content: [] }).ok).toBe(true);
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

  it("từ chối version, node và mark không thuộc whitelist", () => {
    const result = normalizeProductDescriptionDocument({
      version: 100,
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Không được" }] },
        { type: "script", attrs: { html: "alert(1)" } },
        { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(["INVALID_VERSION", "INVALID_HEADING", "UNKNOWN_NODE", "UNKNOWN_MARK"]),
      );
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
                  { type: "textStyle", attrs: { fontSize: "large", color: "primary" } },
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
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Tiêu đề" }] },
        { type: "paragraph", content: [{ type: "text", text: "Đoạn văn" }, { type: "hardBreak" }, { type: "text", text: "tiếp" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Táo" }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Cà rốt" }] }] }] },
        { type: "productDescriptionImage", attrs: { assetId: validImageId, alignment: "center", size: "medium", alt: "Không đưa alt vào text" } },
      ],
    };
    expect(extractProductDescriptionText(document)).toBe("Tiêu đề\nĐoạn văn\ntiếp\nTáo\nCà rốt");
  });
});
