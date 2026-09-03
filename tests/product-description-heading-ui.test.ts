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
  it("keeps semantic H2-H4 enabled in the editor and storefront renderer", () => {
    const editor = readProjectFile("app/components/product-description-editor.tsx");
    const renderer = readProjectFile("app/components/product-rich-description.tsx");

    expect(editor).toContain("heading: { levels: [2, 3, 4] }");
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

  it("makes H2-H4 visually larger than body text in both editor and storefront", () => {
    const css = readProjectFile("app/product-description-heading.css");

    expect(css).toContain("font-size: clamp(1.75rem, 3vw, 2.25rem);");
    expect(css).toContain("font-size: clamp(1.45rem, 2.5vw, 1.8rem);");
    expect(css).toContain("font-size: clamp(1.2rem, 2vw, 1.45rem);");
    expect(css).toContain("font-weight: 800;");
    expect(css).toContain("font-size: 1rem;");
  });

  it("prevents inline font-size marks from shrinking semantic headings", () => {
    const css = readProjectFile("app/product-description-heading.css");

    expect(css).toContain(
      ".product-description-content .ProseMirror h2 [data-font-size]",
    );
    expect(css).toContain(
      ".product-rich-heading .product-rich-font-extraLarge",
    );
    expect(css.match(/font-size: inherit;/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
