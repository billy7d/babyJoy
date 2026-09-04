import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readProjectFile(relativePath: string) {
  return fs.readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

describe("Product rich description Word-like formatting", () => {
  it("supports semantic H1-H4 end-to-end", () => {
    const editor = readProjectFile("app/components/product-description-editor.tsx");
    const renderer = readProjectFile("app/components/product-rich-description.tsx");
    const css = readProjectFile("app/product-description-heading.css");

    expect(editor).toContain("heading: { levels: [1, 2, 3, 4] }");
    expect(editor).toContain('<option value="1">Heading 1</option>');
    expect(renderer).toContain('if (node.attrs.level === 1) return <h1 {...props} />;');
    expect(css).toContain(".product-description-content .ProseMirror h1");
    expect(css).toContain(".product-rich-heading-1");
  });

  it("offers Microsoft Word-style point presets instead of semantic-only size labels", () => {
    const editor = readProjectFile("app/components/product-description-editor.tsx");
    const shared = readProjectFile("shared/product-description.ts");

    expect(shared).toContain("PRODUCT_DESCRIPTION_FONT_SIZE_PRESETS");
    for (const size of [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]) {
      expect(shared).toContain(`  ${size},`);
    }
    expect(editor).toContain('title="Kích thước chữ theo point (pt)"');
    expect(editor).toContain('value={`${points}pt`}');
    expect(editor).toContain("{points} pt");
  });

  it("renders point sizes as safe inline CSS in both editor and storefront", () => {
    const editor = readProjectFile("app/components/product-description-editor.tsx");
    const renderer = readProjectFile("app/components/product-rich-description.tsx");

    expect(editor).toContain('style: `font-size: ${pointSize}pt;`');
    expect(renderer).toContain('{ fontSize: `${pointSize}pt` }');
    expect(renderer).toContain('data-font-size={attrs?.fontSize ?? undefined}');
  });

  it("keeps legacy semantic size tokens for backward compatibility", () => {
    const editor = readProjectFile("app/components/product-description-editor.tsx");
    const shared = readProjectFile("shared/product-description.ts");

    expect(shared).toContain('"small"');
    expect(shared).toContain('"normal"');
    expect(shared).toContain('"large"');
    expect(shared).toContain('"extraLarge"');
    expect(editor).toContain('key={`legacy-${size}`}');
    expect(editor).toContain("hidden");
  });
});
