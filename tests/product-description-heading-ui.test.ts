import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readProjectFile(relativePath: string) {
  return fs.readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

describe("Product rich description heading hierarchy", () => {
  it("keeps semantic H1-H4 enabled in the editor and storefront renderer", () => {
    const editor = readProjectFile("app/components/product-description-editor.tsx");
    const renderer = readProjectFile("app/components/product-rich-description.tsx");

    expect(editor).toContain("heading: { levels: [1, 2, 3, 4] }");
    expect(renderer).toContain('if (node.attrs.level === 1) return <h1 {...props} />;');
    expect(renderer).toContain('if (node.attrs.level === 2) return <h2 {...props} />;');
    expect(renderer).toContain('if (node.attrs.level === 3) return <h3 {...props} />;');
    expect(renderer).toContain("return <h4 {...props} />;");
  });

  it("loads heading overrides after the base rich-description stylesheet", () => {
    const root = readProjectFile("app/root.tsx");
    const baseIndex = root.indexOf('import "./product-description.css";');
    const headingIndex = root.indexOf('import "./product-description-heading.css";');

    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(headingIndex).toBeGreaterThan(baseIndex);
  });

  it("makes H1-H4 visually larger than 12pt body text in both editor and storefront", () => {
    const css = readProjectFile("app/product-description-heading.css");

    expect(css).toContain("font-size: 28pt;");
    expect(css).toContain("font-size: 24pt;");
    expect(css).toContain("font-size: 18pt;");
    expect(css).toContain("font-size: 14pt;");
    expect(css).toContain("font-size: 12pt;");
    expect(css).toContain("font-weight: 800;");
  });

  it("keeps legacy font-size marks from shrinking semantic headings while point overrides can use inline style", () => {
    const css = readProjectFile("app/product-description-heading.css");
    const editor = readProjectFile("app/components/product-description-editor.tsx");

    expect(css).toContain(
      ".product-description-content .ProseMirror h1 [data-font-size]",
    );
    expect(css).toContain(
      ".product-rich-heading .product-rich-font-extraLarge",
    );
    expect(css.match(/font-size: inherit;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(editor).toContain('style: `font-size: ${pointSize}pt;`');
  });
});
