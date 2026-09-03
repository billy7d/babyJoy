export const PRODUCT_DESCRIPTION_VERSION = 1 as const;
export const PRODUCT_DESCRIPTION_MAX_BYTES = 256 * 1024;
export const PRODUCT_DESCRIPTION_MAX_NODES = 500;
export const PRODUCT_DESCRIPTION_MAX_TEXT_LENGTH = 100_000;
export const PRODUCT_DESCRIPTION_MAX_IMAGES = 30;

export const PRODUCT_DESCRIPTION_FONT_SIZES = [
  "small",
  "normal",
  "large",
  "extraLarge",
] as const;
export type ProductDescriptionFontSize =
  (typeof PRODUCT_DESCRIPTION_FONT_SIZES)[number];

export const PRODUCT_DESCRIPTION_COLOR_TOKENS = [
  "primary",
  "muted",
  "dark",
  "accent",
] as const;
export type ProductDescriptionColorToken =
  (typeof PRODUCT_DESCRIPTION_COLOR_TOKENS)[number];

export const PRODUCT_DESCRIPTION_TEXT_ALIGNMENTS = [
  "left",
  "center",
  "right",
  "justify",
] as const;
export type ProductDescriptionTextAlignment =
  (typeof PRODUCT_DESCRIPTION_TEXT_ALIGNMENTS)[number];

export const PRODUCT_DESCRIPTION_IMAGE_ALIGNMENTS = [
  "left",
  "center",
  "right",
] as const;
export type ProductDescriptionImageAlignment =
  (typeof PRODUCT_DESCRIPTION_IMAGE_ALIGNMENTS)[number];

export const PRODUCT_DESCRIPTION_IMAGE_SIZES = [
  "small",
  "medium",
  "large",
  "full",
] as const;
export type ProductDescriptionImageSize =
  (typeof PRODUCT_DESCRIPTION_IMAGE_SIZES)[number];

export type ProductDescriptionTextStyleAttributes = {
  fontSize?: ProductDescriptionFontSize;
  color?: string;
};

export type ProductDescriptionTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "textStyle"; attrs?: ProductDescriptionTextStyleAttributes };

export type ProductDescriptionTextNode = {
  type: "text";
  text: string;
  marks?: ProductDescriptionTextMark[];
};

export type ProductDescriptionHardBreakNode = { type: "hardBreak" };
export type ProductDescriptionInlineNode =
  | ProductDescriptionTextNode
  | ProductDescriptionHardBreakNode;

export type ProductDescriptionTextBlockAttrs = {
  textAlign?: ProductDescriptionTextAlignment;
};

export type ProductDescriptionParagraphNode = {
  type: "paragraph";
  attrs?: ProductDescriptionTextBlockAttrs;
  content?: ProductDescriptionInlineNode[];
};

export type ProductDescriptionHeadingNode = {
  type: "heading";
  attrs: ProductDescriptionTextBlockAttrs & { level: 2 | 3 | 4 };
  content?: ProductDescriptionInlineNode[];
};

export type ProductDescriptionListItemNode = {
  type: "listItem";
  content: ProductDescriptionBlockNode[];
};

export type ProductDescriptionBulletListNode = {
  type: "bulletList";
  content: ProductDescriptionListItemNode[];
};

export type ProductDescriptionOrderedListNode = {
  type: "orderedList";
  attrs?: { start?: number };
  content: ProductDescriptionListItemNode[];
};

export type ProductDescriptionImageNode = {
  type: "productDescriptionImage";
  attrs: {
    assetId: string;
    alignment: ProductDescriptionImageAlignment;
    size: ProductDescriptionImageSize;
    alt: string;
  };
};

export type ProductDescriptionBlockNode =
  | ProductDescriptionParagraphNode
  | ProductDescriptionHeadingNode
  | ProductDescriptionBulletListNode
  | ProductDescriptionOrderedListNode
  | ProductDescriptionImageNode;

export type ProductDescriptionDocument = {
  version: typeof PRODUCT_DESCRIPTION_VERSION;
  type: "doc";
  content: ProductDescriptionBlockNode[];
};

export type ProductDescriptionAsset = {
  id: string;
  r2Key: string;
  altText: string;
  url: string;
};

export type ProductDescriptionValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ProductDescriptionValidationResult =
  | { ok: true; document: ProductDescriptionDocument }
  | { ok: false; issues: ProductDescriptionValidationIssue[] };

export type ProductDescriptionValidationOptions = {
  assetIds?: ReadonlySet<string>;
};

type RecordValue = Record<string, unknown>;
type ValidationState = {
  nodeCount: number;
  textLength: number;
  imageCount: number;
  options: ProductDescriptionValidationOptions;
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: RecordValue, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function addIssue(
  issues: ProductDescriptionValidationIssue[],
  path: string,
  code: string,
  message: string,
) {
  issues.push({ path, code, message });
}

function isSafeColor(value: string) {
  return (
    PRODUCT_DESCRIPTION_COLOR_TOKENS.includes(
      value as ProductDescriptionColorToken,
    ) || /^#[0-9a-f]{3,4}(?:[0-9a-f]{2})?$/i.test(value)
  );
}

function isSafeAssetId(value: string) {
  return /^pda_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function validateTextBlockAttrs(
  value: unknown,
  path: string,
  issues: ProductDescriptionValidationIssue[],
  extraKeys: readonly string[] = [],
): ProductDescriptionTextBlockAttrs | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    addIssue(issues, path, "INVALID_ATTRIBUTES", "Thuộc tính block không hợp lệ.");
    return undefined;
  }
  if (!hasOnlyKeys(value, ["textAlign", ...extraKeys])) {
    addIssue(issues, path, "UNKNOWN_ATTRIBUTE", "Block chứa thuộc tính không được phép.");
  }
  const rawAlignment = value.textAlign;
  if (rawAlignment === undefined || rawAlignment === null) return undefined;
  if (
    typeof rawAlignment !== "string" ||
    !PRODUCT_DESCRIPTION_TEXT_ALIGNMENTS.includes(
      rawAlignment as ProductDescriptionTextAlignment,
    )
  ) {
    addIssue(issues, `${path}.textAlign`, "INVALID_ALIGNMENT", "Căn chỉnh văn bản không hợp lệ.");
    return undefined;
  }
  return { textAlign: rawAlignment as ProductDescriptionTextAlignment };
}

function validateMarks(
  value: unknown,
  path: string,
  issues: ProductDescriptionValidationIssue[],
): ProductDescriptionTextMark[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    addIssue(issues, path, "INVALID_MARKS", "Định dạng văn bản không hợp lệ.");
    return undefined;
  }
  const marks: ProductDescriptionTextMark[] = [];
  value.forEach((rawMark, index) => {
    const markPath = `${path}[${index}]`;
    if (!isRecord(rawMark) || typeof rawMark.type !== "string") {
      addIssue(issues, markPath, "INVALID_MARK", "Định dạng văn bản không hợp lệ.");
      return;
    }
    if (rawMark.type === "bold" || rawMark.type === "italic" || rawMark.type === "underline") {
      if (!hasOnlyKeys(rawMark, ["type"])) {
        addIssue(issues, markPath, "UNKNOWN_ATTRIBUTE", "Định dạng văn bản chứa thuộc tính không được phép.");
      }
      marks.push({ type: rawMark.type });
      return;
    }
    if (rawMark.type !== "textStyle") {
      addIssue(issues, `${markPath}.type`, "UNKNOWN_MARK", "Định dạng văn bản không được phép.");
      return;
    }
    if (!hasOnlyKeys(rawMark, ["type", "attrs"])) {
      addIssue(issues, markPath, "UNKNOWN_ATTRIBUTE", "Định dạng văn bản chứa thuộc tính không được phép.");
    }
    const attrs = rawMark.attrs;
    if (attrs !== undefined && !isRecord(attrs)) {
      addIssue(issues, `${markPath}.attrs`, "INVALID_ATTRIBUTES", "Thuộc tính văn bản không hợp lệ.");
      return;
    }
    if (attrs && !hasOnlyKeys(attrs, ["fontSize", "color"])) {
      addIssue(issues, `${markPath}.attrs`, "UNKNOWN_ATTRIBUTE", "Thuộc tính văn bản không được phép.");
    }
    const normalized: ProductDescriptionTextStyleAttributes = {};
    const rawFontSize = attrs?.fontSize;
    if (rawFontSize !== undefined && rawFontSize !== null) {
      if (
        typeof rawFontSize !== "string" ||
        !PRODUCT_DESCRIPTION_FONT_SIZES.includes(
          rawFontSize as ProductDescriptionFontSize,
        )
      ) {
        addIssue(issues, `${markPath}.attrs.fontSize`, "INVALID_FONT_SIZE", "Kích thước chữ không hợp lệ.");
      } else {
        normalized.fontSize = rawFontSize as ProductDescriptionFontSize;
      }
    }
    const rawColor = attrs?.color;
    if (rawColor !== undefined && rawColor !== null) {
      if (typeof rawColor !== "string" || !isSafeColor(rawColor)) {
        addIssue(issues, `${markPath}.attrs.color`, "INVALID_COLOR", "Màu chữ không hợp lệ.");
      } else {
        normalized.color = rawColor;
      }
    }
    if (normalized.fontSize || normalized.color) marks.push({ type: "textStyle", attrs: normalized });
  });
  return marks.length ? marks : undefined;
}

function validateInlineNodes(
  value: unknown,
  path: string,
  issues: ProductDescriptionValidationIssue[],
  state: ValidationState,
): ProductDescriptionInlineNode[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "INVALID_CONTENT", "Nội dung inline không hợp lệ.");
    return [];
  }
  const normalizedNodes: ProductDescriptionInlineNode[] = [];
  value.forEach((rawNode, index) => {
    const nodePath = `${path}[${index}]`;
    state.nodeCount += 1;
    if (!isRecord(rawNode) || typeof rawNode.type !== "string") {
      addIssue(issues, nodePath, "INVALID_NODE", "Node mô tả không hợp lệ.");
      return;
    }
    if (rawNode.type === "hardBreak") {
      if (!hasOnlyKeys(rawNode, ["type"])) addIssue(issues, nodePath, "UNKNOWN_ATTRIBUTE", "Node xuống dòng không hợp lệ.");
      normalizedNodes.push({ type: "hardBreak" });
      return;
    }
    if (rawNode.type !== "text") {
      addIssue(issues, `${nodePath}.type`, "UNKNOWN_NODE", "Node inline không được phép.");
      return;
    }
    if (!hasOnlyKeys(rawNode, ["type", "text", "marks"])) addIssue(issues, nodePath, "UNKNOWN_ATTRIBUTE", "Node text chứa thuộc tính không được phép.");
    if (typeof rawNode.text !== "string" || !rawNode.text.length) {
      addIssue(issues, `${nodePath}.text`, "INVALID_TEXT", "Node text không hợp lệ.");
      return;
    }
    state.textLength += rawNode.text.length;
    normalizedNodes.push({
      type: "text",
      text: rawNode.text,
      marks: validateMarks(rawNode.marks, `${nodePath}.marks`, issues),
    });
  });
  return normalizedNodes;
}

function validateBlockNode(
  value: unknown,
  path: string,
  issues: ProductDescriptionValidationIssue[],
  state: ValidationState,
): ProductDescriptionBlockNode | null {
  state.nodeCount += 1;
  if (!isRecord(value) || typeof value.type !== "string") {
    addIssue(issues, path, "INVALID_NODE", "Node mô tả không hợp lệ.");
    return null;
  }
  if (value.type === "paragraph") {
    if (!hasOnlyKeys(value, ["type", "attrs", "content"])) addIssue(issues, path, "UNKNOWN_ATTRIBUTE", "Paragraph chứa thuộc tính không được phép.");
    return {
      type: "paragraph",
      attrs: validateTextBlockAttrs(value.attrs, `${path}.attrs`, issues),
      content: value.content === undefined ? undefined : validateInlineNodes(value.content, `${path}.content`, issues, state),
    };
  }
  if (value.type === "heading") {
    if (!hasOnlyKeys(value, ["type", "attrs", "content"])) addIssue(issues, path, "UNKNOWN_ATTRIBUTE", "Heading chứa thuộc tính không được phép.");
    if (!isRecord(value.attrs)) {
      addIssue(issues, `${path}.attrs`, "INVALID_HEADING", "Heading phải có level H2, H3 hoặc H4.");
      return null;
    }
    const attrs = validateTextBlockAttrs(
      value.attrs,
      `${path}.attrs`,
      issues,
      ["level"],
    );
    const rawLevel = value.attrs.level;
    if (rawLevel !== 2 && rawLevel !== 3 && rawLevel !== 4) {
      addIssue(issues, `${path}.attrs.level`, "INVALID_HEADING", "Heading chỉ hỗ trợ H2, H3 hoặc H4.");
      return null;
    }
    return {
      type: "heading",
      attrs: { level: rawLevel, ...attrs },
      content: value.content === undefined ? undefined : validateInlineNodes(value.content, `${path}.content`, issues, state),
    };
  }
  if (value.type === "bulletList" || value.type === "orderedList") {
    if (!hasOnlyKeys(value, ["type", "attrs", "content"])) addIssue(issues, path, "UNKNOWN_ATTRIBUTE", "List chứa thuộc tính không được phép.");
    let attrs: { start?: number } | undefined;
    if (value.type === "orderedList") {
      if (value.attrs !== undefined && value.attrs !== null) {
        if (!isRecord(value.attrs) || !hasOnlyKeys(value.attrs, ["start", "type"])) {
          addIssue(issues, `${path}.attrs`, "INVALID_ATTRIBUTES", "Thuộc tính numbered list không hợp lệ.");
        } else if (value.attrs.type !== undefined && value.attrs.type !== null) {
          addIssue(issues, `${path}.attrs.type`, "INVALID_ATTRIBUTES", "Thuộc tính numbered list không hợp lệ.");
        } else if (value.attrs.start !== undefined && value.attrs.start !== null) {
          const start = typeof value.attrs.start === "number" ? value.attrs.start : Number.NaN;
          if (!Number.isSafeInteger(start) || start < 1) addIssue(issues, `${path}.attrs.start`, "INVALID_LIST_START", "Thứ tự numbered list không hợp lệ.");
          else attrs = { start };
        }
      }
    } else if (value.attrs !== undefined && value.attrs !== null) {
      if (!isRecord(value.attrs) || !hasOnlyKeys(value.attrs, ["type"])) {
        addIssue(issues, `${path}.attrs`, "INVALID_ATTRIBUTES", "Thuộc tính bullet list không hợp lệ.");
      } else if (value.attrs.type !== undefined && value.attrs.type !== null) {
        addIssue(issues, `${path}.attrs.type`, "INVALID_ATTRIBUTES", "Thuộc tính bullet list không hợp lệ.");
      }
    }
    if (!Array.isArray(value.content)) {
      addIssue(issues, `${path}.content`, "INVALID_CONTENT", "Danh sách không hợp lệ.");
      return null;
    }
    const content: ProductDescriptionListItemNode[] = value.content.flatMap((rawItem, index) => {
      const itemPath = `${path}.content[${index}]`;
      state.nodeCount += 1;
      if (!isRecord(rawItem) || rawItem.type !== "listItem" || !hasOnlyKeys(rawItem, ["type", "content"])) {
        addIssue(issues, itemPath, "INVALID_LIST_ITEM", "Phần tử danh sách không hợp lệ.");
        return [];
      }
      if (!Array.isArray(rawItem.content)) {
        addIssue(issues, `${itemPath}.content`, "INVALID_CONTENT", "Nội dung phần tử danh sách không hợp lệ.");
        return [];
      }
      const childContent = rawItem.content.flatMap((child, childIndex) => {
        const node = validateBlockNode(child, `${itemPath}.content[${childIndex}]`, issues, state);
        return node ? [node] : [];
      });
      return [{ type: "listItem" as const, content: childContent }];
    });
    return value.type === "bulletList"
      ? { type: "bulletList", content }
      : { type: "orderedList", attrs, content };
  }
  if (value.type === "productDescriptionImage") {
    if (!hasOnlyKeys(value, ["type", "attrs"]) || !isRecord(value.attrs)) {
      addIssue(issues, `${path}.attrs`, "INVALID_IMAGE", "Ảnh mô tả không hợp lệ.");
      return null;
    }
    if (!hasOnlyKeys(value.attrs, ["assetId", "alignment", "size", "alt"])) addIssue(issues, `${path}.attrs`, "UNKNOWN_ATTRIBUTE", "Ảnh mô tả chứa thuộc tính không được phép.");
    const assetId = value.attrs.assetId;
    const alignment = value.attrs.alignment;
    const size = value.attrs.size;
    const alt = value.attrs.alt;
    if (typeof assetId !== "string" || !isSafeAssetId(assetId)) addIssue(issues, `${path}.attrs.assetId`, "INVALID_ASSET_ID", "Asset ảnh mô tả không hợp lệ.");
    if (state.options.assetIds && typeof assetId === "string" && !state.options.assetIds.has(assetId)) addIssue(issues, `${path}.attrs.assetId`, "MISSING_ASSET", "Không tìm thấy asset ảnh mô tả.");
    if (typeof alignment !== "string" || !PRODUCT_DESCRIPTION_IMAGE_ALIGNMENTS.includes(alignment as ProductDescriptionImageAlignment)) addIssue(issues, `${path}.attrs.alignment`, "INVALID_ALIGNMENT", "Căn chỉnh ảnh không hợp lệ.");
    if (typeof size !== "string" || !PRODUCT_DESCRIPTION_IMAGE_SIZES.includes(size as ProductDescriptionImageSize)) addIssue(issues, `${path}.attrs.size`, "INVALID_IMAGE_SIZE", "Kích thước ảnh không hợp lệ.");
    if (typeof alt !== "string" || alt.length > 250 || /[\u0000-\u001f\u007f]/.test(alt)) addIssue(issues, `${path}.attrs.alt`, "INVALID_ALT_TEXT", "Alt text không hợp lệ.");
    state.imageCount += 1;
    return {
      type: "productDescriptionImage",
      attrs: {
        assetId: typeof assetId === "string" ? assetId : "pda_invalid",
        alignment: alignment as ProductDescriptionImageAlignment,
        size: size as ProductDescriptionImageSize,
        alt: typeof alt === "string" ? alt : "",
      },
    };
  }
  addIssue(issues, `${path}.type`, "UNKNOWN_NODE", "Node mô tả không được phép.");
  return null;
}

export function normalizeProductDescriptionDocument(
  value: unknown,
  options: ProductDescriptionValidationOptions = {},
): ProductDescriptionValidationResult {
  const issues: ProductDescriptionValidationIssue[] = [];
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "type", "content"])) {
    addIssue(issues, "$", "INVALID_DOCUMENT", "Tài liệu mô tả không hợp lệ.");
    return { ok: false, issues };
  }
  if (value.version !== PRODUCT_DESCRIPTION_VERSION)
    addIssue(issues, "$.version", "INVALID_VERSION", "Phiên bản tài liệu không được hỗ trợ.");
  if (value.type !== "doc") addIssue(issues, "$.type", "INVALID_DOCUMENT", "Kiểu tài liệu không hợp lệ.");
  const state: ValidationState = { nodeCount: 1, textLength: 0, imageCount: 0, options };
  const content = Array.isArray(value.content)
    ? value.content.flatMap((node, index) => {
        const normalized = validateBlockNode(node, `$.content[${index}]`, issues, state);
        return normalized ? [normalized] : [];
      })
    : (addIssue(issues, "$.content", "INVALID_CONTENT", "Nội dung tài liệu không hợp lệ."), []);
  if (state.nodeCount > PRODUCT_DESCRIPTION_MAX_NODES) addIssue(issues, "$.content", "TOO_MANY_NODES", "Tài liệu có quá nhiều block.");
  if (state.textLength > PRODUCT_DESCRIPTION_MAX_TEXT_LENGTH) addIssue(issues, "$.content", "TEXT_TOO_LONG", "Tổng nội dung text vượt giới hạn.");
  if (state.imageCount > PRODUCT_DESCRIPTION_MAX_IMAGES) addIssue(issues, "$.content", "TOO_MANY_IMAGES", "Tài liệu có quá nhiều ảnh.");
  const document: ProductDescriptionDocument = {
    version: PRODUCT_DESCRIPTION_VERSION,
    type: "doc",
    content,
  };
  const serialized = JSON.stringify(document);
  if (new TextEncoder().encode(serialized).byteLength > PRODUCT_DESCRIPTION_MAX_BYTES) addIssue(issues, "$", "DOCUMENT_TOO_LARGE", "Tài liệu mô tả vượt giới hạn lưu trữ.");
  return issues.length ? { ok: false, issues } : { ok: true, document };
}

export function isProductDescriptionDocument(
  value: unknown,
): value is ProductDescriptionDocument {
  return normalizeProductDescriptionDocument(value).ok;
}

export function parseProductDescriptionContent(
  value: unknown,
  options: ProductDescriptionValidationOptions = {},
): ProductDescriptionDocument | null {
  if (value === null || value === undefined) return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const result = normalizeProductDescriptionDocument(parsed, options);
  return result.ok ? result.document : null;
}

export function legacyDescriptionToDocument(
  description: string | null | undefined,
): ProductDescriptionDocument {
  const lines = (description ?? "").split(/\r?\n/);
  return {
    version: PRODUCT_DESCRIPTION_VERSION,
    type: "doc",
    content: lines.map((text) => ({
      type: "paragraph" as const,
      ...(text ? { content: [{ type: "text" as const, text }] } : {}),
    })),
  };
}

export function getProductDescriptionImageNodes(
  document: ProductDescriptionDocument,
): ProductDescriptionImageNode[] {
  const images: ProductDescriptionImageNode[] = [];
  const visit = (node: ProductDescriptionBlockNode) => {
    if (node.type === "productDescriptionImage") {
      images.push(node);
      return;
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      node.content.forEach((item) => item.content.forEach(visit));
    }
  };
  document.content.forEach(visit);
  return images;
}

export function getProductDescriptionImageAssetIds(
  document: ProductDescriptionDocument,
) {
  return getProductDescriptionImageNodes(document).map(
    (node) => node.attrs.assetId,
  );
}

function extractInlineText(nodes: ProductDescriptionInlineNode[]) {
  return nodes
    .map((node) => (node.type === "text" ? node.text : "\n"))
    .join("");
}

function extractBlockText(node: ProductDescriptionBlockNode): string {
  if (node.type === "paragraph" || node.type === "heading")
    return extractInlineText(node.content ?? []);
  if (node.type === "productDescriptionImage") return "";
  return node.content
    .map((item) => item.content.map(extractBlockText).filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n");
}

export function extractProductDescriptionText(
  document: ProductDescriptionDocument,
) {
  return document.content
    .map(extractBlockText)
    .filter(Boolean)
    .join("\n")
    .trim();
}
