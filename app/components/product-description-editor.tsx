import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import {
  normalizeProductDescriptionDocument,
  PRODUCT_DESCRIPTION_COLOR_TOKENS,
  PRODUCT_DESCRIPTION_FONT_SIZES,
  type ProductDescriptionAsset,
  type ProductDescriptionColorToken,
  type ProductDescriptionDocument,
  type ProductDescriptionFontSize,
} from "../../shared/product-description";
import {
  MAX_SOURCE_IMAGE_BYTES,
  MAX_STORED_IMAGE_BYTES,
  isAllowedImageType,
} from "../../shared/images";
import { optimizeProductImage } from "../lib/image-optimizer";
import {
  ProductDescriptionImage,
  ProductDescriptionImageNodeContext,
} from "./product-description-image-node";
import { Icon } from "./ui";

const ProductDescriptionSemanticTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      fontSize: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-font-size"),
        renderHTML: (attributes: { fontSize?: string | null }) =>
          attributes.fontSize
            ? { "data-font-size": attributes.fontSize }
            : {},
      },
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-color"),
        renderHTML: (attributes: { color?: string | null }) =>
          attributes.color ? { "data-color": attributes.color } : {},
      },
    };
  },
});

const PRODUCT_DESCRIPTION_EDITOR_EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: { levels: [2, 3, 4] },
    horizontalRule: false,
    link: false,
    strike: false,
    trailingNode: false,
    underline: false,
  }),
  Underline,
  ProductDescriptionSemanticTextStyle,
  TextAlign.configure({
    types: ["heading", "paragraph"],
    alignments: ["left", "center", "right", "justify"],
    defaultAlignment: "left",
  }),
  Placeholder.configure({
    placeholder: "Nhập nội dung chi tiết cho sản phẩm...",
  }),
  ProductDescriptionImage,
];

export type ProductDescriptionEditorProps = {
  value: ProductDescriptionDocument;
  productId?: string;
  uploadSessionId: string;
  assets: ProductDescriptionAsset[];
  onChange: (document: ProductDescriptionDocument) => void;
  onAsset: (asset: ProductDescriptionAsset) => void;
};

function editorDocument(value: ProductDescriptionDocument) {
  return { type: value.type, content: value.content };
}

function comparableDocumentValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparableDocumentValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, comparableDocumentValue(nested)]),
  );
}

function isSameDocument(
  editorJson: unknown,
  value: ProductDescriptionDocument,
) {
  return (
    JSON.stringify(comparableDocumentValue(editorJson)) ===
    JSON.stringify(comparableDocumentValue(editorDocument(value)))
  );
}

function isSameDescriptionDocument(
  left: ProductDescriptionDocument,
  right: ProductDescriptionDocument,
) {
  return isSameDocument(editorDocument(left), right);
}

function getErrorMessage(value: unknown) {
  if (!value || typeof value !== "object") return "Không thể tải ảnh lên.";
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string"
    ? error.message
    : "Không thể tải ảnh lên. Vui lòng thử lại.";
}

type ProductDescriptionSelectionSnapshot = {
  from: number;
  to: number;
};

type ProductDescriptionFontSizeControlValue =
  | ProductDescriptionFontSize
  | "mixed";

function isProductDescriptionFontSize(
  value: unknown,
): value is ProductDescriptionFontSize {
  return (
    typeof value === "string" &&
    PRODUCT_DESCRIPTION_FONT_SIZES.includes(value as ProductDescriptionFontSize)
  );
}

export function ProductDescriptionEditor({
  value,
  productId,
  uploadSessionId,
  assets,
  onChange,
  onAsset,
}: ProductDescriptionEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");
  const selectionRef = useRef<ProductDescriptionSelectionSnapshot | null>(null);
  const appliedTextStyleSelectionRef = useRef<ProductDescriptionSelectionSnapshot | null>(null);
  const locallyEmittedDocumentRef = useRef<ProductDescriptionDocument | null>(null);
  const assetMap = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: PRODUCT_DESCRIPTION_EDITOR_EXTENSIONS,
    content: editorDocument(value),
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      const { from, to } = updatedEditor.state.selection;
      selectionRef.current = { from, to };
      const appliedSelection = appliedTextStyleSelectionRef.current;
      if (
        appliedSelection &&
        (appliedSelection.from !== from || appliedSelection.to !== to)
      ) {
        appliedTextStyleSelectionRef.current = null;
      }
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const { from, to } = updatedEditor.state.selection;
      selectionRef.current = { from, to };
      const normalized = normalizeProductDescriptionDocument({
        version: 1,
        ...updatedEditor.getJSON(),
      });
      if (normalized.ok) {
        locallyEmittedDocumentRef.current = normalized.document;
        onChange(normalized.document);
      }
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (
      locallyEmittedDocumentRef.current &&
      isSameDescriptionDocument(locallyEmittedDocumentRef.current, value)
    ) {
      return;
    }
    if (isSameDocument(editor.getJSON(), value)) return;
    locallyEmittedDocumentRef.current = null;
    editor.commands.command(({ tr }) => {
      const nextDocument = editor.schema.nodeFromJSON(editorDocument(value));
      tr
        .replaceWith(0, tr.doc.content.size, nextDocument.content)
        .setMeta("preventUpdate", true)
        .setMeta("addToHistory", false);
      return true;
    });
  }, [editor, value]);

  const uploadImage = useCallback(
    async (file: File, replacePosition?: number) => {
      if (!isAllowedImageType(file.type.toLowerCase())) {
        setStatus("Chỉ hỗ trợ ảnh JPEG, PNG và WebP.");
        return;
      }
      if (file.size > MAX_SOURCE_IMAGE_BYTES) {
        setStatus("Ảnh vượt quá giới hạn 30 MB. Vui lòng chọn ảnh khác.");
        return;
      }
      const replacementAlt =
        replacePosition !== undefined && editor
          ? String(editor.state.doc.nodeAt(replacePosition)?.attrs.alt ?? "")
          : undefined;
      setUploading(true);
      setStatus("Đang tải ảnh lên...");
      try {
        const optimized = await optimizeProductImage(file);
        if (optimized.optimizedBytes > MAX_STORED_IMAGE_BYTES)
          throw new Error("Ảnh sau tối ưu vẫn vượt quá giới hạn lưu trữ 1.5 MB.");
        const headers = new Headers({
          "content-type": optimized.mimeType,
          "x-upload-session-id": uploadSessionId,
          "x-alt-text": "",
        });
        if (productId) headers.set("x-product-id", productId);
        const response = await fetch("/api/admin/product-description-assets", {
          method: "POST",
          headers,
          body: optimized.blob,
        });
        const body = (await response.json()) as {
          asset?: ProductDescriptionAsset;
        };
        if (!response.ok || !body.asset?.id || !body.asset.url)
          throw new Error(getErrorMessage(body));
        onAsset(body.asset);
        if (editor) {
          if (replacePosition === undefined) {
            editor
              .chain()
              .focus()
              .insertContent({
                type: "productDescriptionImage",
                attrs: {
                  assetId: body.asset.id,
                  alignment: "center",
                  size: "large",
                  alt: body.asset.altText,
                },
              })
              .run();
          } else {
            editor.commands.setNodeSelection(replacePosition);
            editor.commands.updateAttributes("productDescriptionImage", {
              assetId: body.asset.id,
              alt: replacementAlt ?? body.asset.altText,
            });
            editor.commands.setNodeSelection(replacePosition);
            window.requestAnimationFrame(() => {
              editor.commands.setNodeSelection(replacePosition);
            });
          }
        }
        setStatus("Đã tải ảnh lên. Hãy lưu sản phẩm để hoàn tất liên kết.");
      } catch (caught) {
        setStatus(
          caught instanceof Error
            ? caught.message
            : "Không thể tải ảnh lên. Vui lòng thử lại.",
        );
      } finally {
        setUploading(false);
      }
    },
    [editor, onAsset, productId, uploadSessionId],
  );

  const nodeContext = useMemo(
    () => ({
      assets: assetMap,
      replaceImage: (position: number, file: File) => {
        void uploadImage(file, position);
      },
    }),
    [assetMap, uploadImage],
  );

  const applyTextStyle = (attrs: {
    fontSize?: ProductDescriptionFontSize | null;
    color?: ProductDescriptionColorToken | null;
  }) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    const currentSelection = editor.state.selection;
    let domSelectionSnapshot: ProductDescriptionSelectionSnapshot | null = null;
    const domSelection = editor.view.dom.ownerDocument.getSelection();
    if (
      domSelection?.anchorNode &&
      domSelection.focusNode &&
      editor.view.dom.contains(domSelection.anchorNode) &&
      editor.view.dom.contains(domSelection.focusNode)
    ) {
      try {
        const anchor = editor.view.posAtDOM(
          domSelection.anchorNode,
          domSelection.anchorOffset,
        );
        const focus = editor.view.posAtDOM(
          domSelection.focusNode,
          domSelection.focusOffset,
        );
        domSelectionSnapshot = {
          from: Math.min(anchor, focus),
          to: Math.max(anchor, focus),
        };
      } catch {
        domSelectionSnapshot = null;
      }
    }
    const savedSelection =
      domSelectionSnapshot ??
      (currentSelection.empty && selectionRef.current
        ? {
            from: currentSelection.from,
            to: currentSelection.to,
          }
        : selectionRef.current ?? {
            from: currentSelection.from,
            to: currentSelection.to,
          });
    const documentSize = editor.state.doc.content.size;
    if (
      savedSelection &&
      savedSelection.from >= 0 &&
      savedSelection.to <= documentSize
    ) {
      chain.setTextSelection(savedSelection);
    }
    chain.setMark("textStyle", attrs);
    if (savedSelection.from !== savedSelection.to || attrs.fontSize === null) {
      chain.removeEmptyTextStyle();
    }
    chain.run();
    appliedTextStyleSelectionRef.current = savedSelection;
    if (savedSelection.from !== savedSelection.to) {
      window.requestAnimationFrame(() => {
        const currentDocumentSize = editor.state.doc.content.size;
        if (
          savedSelection.from >= 0 &&
          savedSelection.to <= currentDocumentSize
        ) {
          editor
            .chain()
            .focus()
            .setTextSelection(savedSelection)
            .run();
        }
      });
    }
  };

  const setFontSize = (fontSize: ProductDescriptionFontSize) => {
    applyTextStyle({ fontSize: fontSize === "normal" ? null : fontSize });
  };
  const setColor = (color: ProductDescriptionColorToken | null) => {
    applyTextStyle({ color });
  };
  const currentHeading = [2, 3, 4].find((level) =>
    editor?.isActive("heading", { level }),
  );
  const currentColor = editor?.getAttributes("textStyle").color as
    | ProductDescriptionColorToken
    | undefined;
  const currentFontSize: ProductDescriptionFontSizeControlValue = (() => {
    if (!editor) return "normal";
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const appliedSelection = appliedTextStyleSelectionRef.current;
      const marks =
        appliedSelection &&
        appliedSelection.from === from &&
        appliedSelection.to === to
          ? editor.state.storedMarks ?? editor.state.selection.$head.marks()
          : editor.state.selection.$head.marks();
      const fontSize = marks.find((mark) => mark.type.name === "textStyle")?.attrs
        .fontSize;
      return isProductDescriptionFontSize(fontSize) ? fontSize : "normal";
    }
    let resolved: ProductDescriptionFontSize | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      const fontSize = node.marks.find(
        (mark) => mark.type.name === "textStyle",
      )?.attrs.fontSize;
      const normalized = isProductDescriptionFontSize(fontSize)
        ? fontSize
        : "normal";
      if (resolved === undefined) resolved = normalized;
      else if (resolved !== normalized) mixed = true;
    });
    return mixed ? "mixed" : resolved ?? "normal";
  })();

  return (
    <div className="product-description-editor">
      <div className="product-description-toolbar" aria-label="Thanh công cụ mô tả chi tiết">
        <label className="product-description-toolbar-select">
          <span className="sr-only">Kiểu đoạn</span>
          <select
            aria-label="Kiểu đoạn"
            value={currentHeading ? String(currentHeading) : "paragraph"}
            disabled={!editor}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "paragraph") editor?.chain().focus().setParagraph().run();
              else editor?.chain().focus().toggleHeading({ level: Number(value) as 2 | 3 | 4 }).run();
            }}
          >
            <option value="paragraph">Đoạn văn</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
            <option value="4">Heading 4</option>
          </select>
        </label>
        <div className="product-description-toolbar-group" aria-label="Định dạng chữ">
          <button type="button" aria-label="Đậm" aria-pressed={editor?.isActive("bold")} disabled={!editor} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
          <button type="button" aria-label="Nghiêng" aria-pressed={editor?.isActive("italic")} disabled={!editor} onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
          <button type="button" aria-label="Gạch chân" aria-pressed={editor?.isActive("underline")} disabled={!editor} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
        </div>
        <label className="product-description-toolbar-select">
          <span className="sr-only">Kích thước chữ</span>
          <select
            aria-label="Kích thước chữ"
            value={currentFontSize ?? "normal"}
            disabled={!editor}
            onChange={(event) => setFontSize(event.target.value as ProductDescriptionFontSize)}
          >
            {currentFontSize === "mixed" && (
              <option value="mixed" disabled>
                Nhiều kích thước
              </option>
            )}
            {PRODUCT_DESCRIPTION_FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size === "small" ? "Chữ nhỏ" : size === "normal" ? "Chữ thường" : size === "large" ? "Chữ lớn" : "Chữ rất lớn"}
              </option>
            ))}
          </select>
        </label>
        <div className="product-description-color-menu" aria-label="Màu chữ">
          <span className="sr-only">Màu chữ</span>
          <button type="button" aria-label="Màu mặc định" aria-pressed={!currentColor} disabled={!editor} onClick={() => setColor(null)}>A</button>
          {PRODUCT_DESCRIPTION_COLOR_TOKENS.map((color) => (
            <button key={color} type="button" className={`color-${color}`} aria-label={`Màu ${color}`} aria-pressed={currentColor === color} disabled={!editor} onClick={() => setColor(color)}>{color === "primary" ? "Nâu" : color === "muted" ? "Nhạt" : color === "dark" ? "Đậm" : "Nhấn"}</button>
          ))}
        </div>
        <div className="product-description-toolbar-group" aria-label="Căn chỉnh">
          {(["left", "center", "right", "justify"] as const).map((alignment) => (
            <button key={alignment} type="button" aria-label={`Căn ${alignment === "left" ? "trái" : alignment === "center" ? "giữa" : alignment === "right" ? "phải" : "đều"}`} aria-pressed={editor?.isActive({ textAlign: alignment })} disabled={!editor} onClick={() => editor?.chain().focus().setTextAlign(alignment).run()}>
              {alignment === "left" ? "←" : alignment === "center" ? "↔" : alignment === "right" ? "→" : "☷"}
            </button>
          ))}
        </div>
        <div className="product-description-toolbar-group" aria-label="Danh sách">
          <button type="button" aria-label="Danh sách dấu đầu dòng" aria-pressed={editor?.isActive("bulletList")} disabled={!editor} onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</button>
          <button type="button" aria-label="Danh sách đánh số" aria-pressed={editor?.isActive("orderedList")} disabled={!editor} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</button>
        </div>
        <label className="product-description-upload-button">
          <Icon>image</Icon>
          <span>Thêm ảnh</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Thêm ảnh vào mô tả"
            disabled={!editor || uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadImage(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <div className="product-description-toolbar-spacer" />
        <button type="button" aria-label="Hoàn tác" disabled={!editor?.can().undo() || uploading} onClick={() => {
          if (!editor) return;
          editor.commands.undo();
          window.requestAnimationFrame(() => editor.commands.focus());
        }}><Icon>undo</Icon></button>
        <button type="button" aria-label="Làm lại" disabled={!editor?.can().redo() || uploading} onClick={() => {
          if (!editor) return;
          editor.commands.redo();
          window.requestAnimationFrame(() => editor.commands.focus());
        }}><Icon>redo</Icon></button>
      </div>
      <ProductDescriptionImageNodeContext.Provider value={nodeContext}>
        <EditorContent editor={editor} className="product-description-content" />
      </ProductDescriptionImageNodeContext.Provider>
      <p className="product-description-editor-status" aria-live="polite">
        {uploading ? "Đang tải ảnh lên..." : status}
      </p>
    </div>
  );
}
