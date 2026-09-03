import { useCallback, useEffect, useMemo, useState } from "react";
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

function isSameDocument(
  editorJson: unknown,
  value: ProductDescriptionDocument,
) {
  return JSON.stringify(editorJson) === JSON.stringify(editorDocument(value));
}

function getErrorMessage(value: unknown) {
  if (!value || typeof value !== "object") return "Không thể tải ảnh lên.";
  const error = (value as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string"
    ? error.message
    : "Không thể tải ảnh lên. Vui lòng thử lại.";
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
  const assetMap = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: PRODUCT_DESCRIPTION_EDITOR_EXTENSIONS,
    content: editorDocument(value),
    onUpdate: ({ editor: updatedEditor }) => {
      const normalized = normalizeProductDescriptionDocument({
        version: 1,
        ...updatedEditor.getJSON(),
      });
      if (normalized.ok) onChange(normalized.document);
    },
  });

  useEffect(() => {
    if (!editor || isSameDocument(editor.getJSON(), value)) return;
    editor.commands.setContent(editorDocument(value), { emitUpdate: false });
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
              alt: body.asset.altText,
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

  const setFontSize = (fontSize: ProductDescriptionFontSize) => {
    editor?.chain().focus().setMark("textStyle", { fontSize }).run();
  };
  const setColor = (color: ProductDescriptionColorToken | null) => {
    editor?.chain().focus().setMark("textStyle", { color }).run();
  };
  const currentHeading = [2, 3, 4].find((level) =>
    editor?.isActive("heading", { level }),
  );
  const currentColor = editor?.getAttributes("textStyle").color as
    | ProductDescriptionColorToken
    | undefined;
  const currentFontSize = editor?.getAttributes("textStyle").fontSize as
    | ProductDescriptionFontSize
    | undefined;

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
        <button type="button" aria-label="Hoàn tác" disabled={!editor?.can().undo() || uploading} onClick={() => editor?.chain().focus().undo().run()}><Icon>undo</Icon></button>
        <button type="button" aria-label="Làm lại" disabled={!editor?.can().redo() || uploading} onClick={() => editor?.chain().focus().redo().run()}><Icon>redo</Icon></button>
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
