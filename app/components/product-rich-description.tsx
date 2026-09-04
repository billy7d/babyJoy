import type {
  ProductDescriptionAsset,
  ProductDescriptionBlockNode,
  ProductDescriptionDocument,
  ProductDescriptionInlineNode,
  ProductDescriptionTextMark,
  ProductDescriptionTextStyleAttributes,
} from "../../shared/product-description";
import {
  normalizeProductDescriptionDocument,
  parseProductDescriptionPointFontSize,
  PRODUCT_DESCRIPTION_COLOR_TOKENS,
} from "../../shared/product-description";

type ProductRichDescriptionProps = {
  content?: ProductDescriptionDocument | null;
  assets?: ProductDescriptionAsset[];
  fallback: string;
};

const colorValues: Record<string, string> = {
  primary: "#7a4b2a",
  muted: "#8d8178",
  dark: "#2e241f",
  accent: "#d27c48",
};

function isSafeHexColor(value: string) {
  return /^#[0-9a-f]{3,4}(?:[0-9a-f]{2})?$/i.test(value);
}

function textStyleClass(attrs: ProductDescriptionTextStyleAttributes | undefined) {
  if (!attrs) return "";
  const classes = [];
  if (attrs.fontSize) classes.push(`product-rich-font-${attrs.fontSize}`);
  if (attrs.color && PRODUCT_DESCRIPTION_COLOR_TOKENS.includes(attrs.color as never))
    classes.push(`product-rich-color-${attrs.color}`);
  return classes.join(" ");
}

function markText(
  value: React.ReactNode,
  mark: ProductDescriptionTextMark,
  key: string,
) {
  if (mark.type === "bold") return <strong key={key}>{value}</strong>;
  if (mark.type === "italic") return <em key={key}>{value}</em>;
  if (mark.type === "underline") return <u key={key}>{value}</u>;
  const attrs = mark.attrs;
  const color = attrs?.color;
  const safeColor = color
    ? colorValues[color] ?? (isSafeHexColor(color) ? color : undefined)
    : undefined;
  const pointSize = attrs?.fontSize
    ? parseProductDescriptionPointFontSize(attrs.fontSize)
    : null;
  const style =
    safeColor || pointSize !== null
      ? {
          ...(safeColor ? { color: safeColor } : {}),
          ...(pointSize !== null ? { fontSize: `${pointSize}pt` } : {}),
        }
      : undefined;
  return (
    <span
      key={key}
      className={textStyleClass(attrs)}
      data-color={color ?? undefined}
      data-font-size={attrs?.fontSize ?? undefined}
      style={style}
    >
      {value}
    </span>
  );
}

function renderInline(nodes: ProductDescriptionInlineNode[], prefix: string) {
  return nodes.map((node, index) => {
    const key = `${prefix}-${index}`;
    if (node.type === "hardBreak") return <br key={key} />;
    const marked = (node.marks ?? []).reduce(
      (value, mark, markIndex) => markText(value, mark, `${key}-${markIndex}`),
      node.text as React.ReactNode,
    );
    return <span key={key}>{marked}</span>;
  });
}

function blockAlignmentStyle(alignment: string | undefined) {
  return alignment
    ? ({ textAlign: alignment } as React.CSSProperties)
    : undefined;
}

function RichBlock({
  node,
  assets,
  prefix,
}: {
  node: ProductDescriptionBlockNode;
  assets: Map<string, ProductDescriptionAsset>;
  prefix: string;
}) {
  if (node.type === "paragraph")
    return (
      <p
        className="product-rich-paragraph"
        style={blockAlignmentStyle(node.attrs?.textAlign)}
      >
        {renderInline(node.content ?? [], prefix)}
      </p>
    );
  if (node.type === "heading") {
    const props = {
      className: `product-rich-heading product-rich-heading-${node.attrs.level}`,
      style: blockAlignmentStyle(node.attrs.textAlign),
      children: renderInline(node.content ?? [], prefix),
    };
    if (node.attrs.level === 1) return <h1 {...props} />;
    if (node.attrs.level === 2) return <h2 {...props} />;
    if (node.attrs.level === 3) return <h3 {...props} />;
    return <h4 {...props} />;
  }
  if (node.type === "bulletList")
    return (
      <ul className="product-rich-list product-rich-bullet-list">
        {node.content.map((item, index) => (
          <li key={`${prefix}-item-${index}`}>
            {item.content.map((child, childIndex) => (
              <RichBlock
                key={`${prefix}-item-${index}-${childIndex}`}
                node={child}
                assets={assets}
                prefix={`${prefix}-item-${index}-${childIndex}`}
              />
            ))}
          </li>
        ))}
      </ul>
    );
  if (node.type === "orderedList")
    return (
      <ol
        className="product-rich-list product-rich-ordered-list"
        start={node.attrs?.start}
      >
        {node.content.map((item, index) => (
          <li key={`${prefix}-item-${index}`}>
            {item.content.map((child, childIndex) => (
              <RichBlock
                key={`${prefix}-item-${index}-${childIndex}`}
                node={child}
                assets={assets}
                prefix={`${prefix}-item-${index}-${childIndex}`}
              />
            ))}
          </li>
        ))}
      </ol>
    );
  const asset = assets.get(node.attrs.assetId);
  if (!asset) return null;
  return (
    <figure
      className="product-rich-image"
      data-align={node.attrs.alignment}
      data-size={node.attrs.size}
      data-asset-id={node.attrs.assetId}
    >
      <img src={asset.url} alt={node.attrs.alt || asset.altText} />
    </figure>
  );
}

function LegacyDescription({ value }: { value: string }) {
  return (
    <div className="product-rich-description product-rich-description-legacy">
      {value.split(/\r?\n/).map((line, index) => (
        <p className="product-rich-paragraph" key={`legacy-${index}`}>
          {line}
        </p>
      ))}
    </div>
  );
}

export function ProductRichDescription({
  content,
  assets = [],
  fallback,
}: ProductRichDescriptionProps) {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const normalized = content
    ? normalizeProductDescriptionDocument(content, {
        assetIds: new Set(assetMap.keys()),
      })
    : { ok: false as const, issues: [] };
  if (!normalized.ok) return <LegacyDescription value={fallback} />;
  return (
    <div className="product-rich-description" data-version={normalized.document.version}>
      {normalized.document.content.map((node, index) => (
        <RichBlock
          key={`product-rich-block-${index}`}
          node={node}
          assets={assetMap}
          prefix={`product-rich-block-${index}`}
        />
      ))}
    </div>
  );
}
