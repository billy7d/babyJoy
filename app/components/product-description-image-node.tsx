import { createContext, useContext, useState, type MouseEvent } from "react";
import { Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import type {
  ProductDescriptionAsset,
  ProductDescriptionImageAlignment,
  ProductDescriptionImageSize,
} from "../../shared/product-description";
import { Icon } from "./ui";

export type ProductDescriptionImageNodeContextValue = {
  assets: Map<string, ProductDescriptionAsset>;
  replaceImage: (position: number, file: File) => void;
};

export const ProductDescriptionImageNodeContext = createContext<
  ProductDescriptionImageNodeContextValue | undefined
>(undefined);

function moveImageNode(
  editor: NodeViewProps["editor"],
  position: number,
  offset: -1 | 1,
) {
  const resolved = editor.state.doc.resolve(position);
  const parent = resolved.parent;
  const index = resolved.index();
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= parent.childCount) return;
  const parentStart = resolved.start();
  const nodeStart = (childIndex: number) => {
    let cursor = parentStart;
    for (let index = 0; index < childIndex; index += 1)
      cursor += parent.child(index).nodeSize;
    return cursor;
  };
  const current = parent.child(index);
  const adjacent = parent.child(targetIndex);
  const currentStart = nodeStart(index);
  const adjacentStart = nodeStart(targetIndex);
  const currentEnd = currentStart + current.nodeSize;
  const adjacentEnd = adjacentStart + adjacent.nodeSize;
  const ordered = offset < 0 ? [current, adjacent] : [adjacent, current];
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(
        Math.min(currentStart, adjacentStart),
        Math.max(currentEnd, adjacentEnd),
        ordered,
      );
      return true;
    })
    .run();
}

export function ProductDescriptionImageNodeView({
  editor,
  node,
  updateAttributes,
  deleteNode,
  getPos,
  selected,
}: NodeViewProps) {
  const context = useContext(ProductDescriptionImageNodeContext);
  const [showControls, setShowControls] = useState(false);
  const rawPosition = getPos();
  const position = typeof rawPosition === "number" ? rawPosition : 0;
  const asset = context?.assets.get(String(node.attrs.assetId));
  const alignment = node.attrs.alignment as ProductDescriptionImageAlignment;
  const size = node.attrs.size as ProductDescriptionImageSize;
  const alt = String(node.attrs.alt ?? asset?.altText ?? "");
  const controlsVisible = selected || showControls;
  return (
    <NodeViewWrapper
      className={`product-description-image-node${selected ? " is-selected" : ""}`}
      data-align={alignment}
      data-size={size}
      data-asset-id={String(node.attrs.assetId ?? "")}
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        setShowControls(true);
        editor.commands.setNodeSelection(position);
      }}
    >
      <div className="product-description-image-preview">
        {asset ? (
          <img src={asset.url} alt={alt} />
        ) : (
          <span role="status">Ảnh mô tả chưa sẵn sàng</span>
        )}
      </div>
      {controlsVisible && (
        <div className="product-description-image-controls" aria-label="Điều khiển ảnh mô tả">
          <div className="product-description-image-control-group">
            <span>Căn ảnh</span>
            {(["left", "center", "right"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`Căn ảnh ${value === "left" ? "trái" : value === "center" ? "giữa" : "phải"}`}
                aria-pressed={alignment === value}
                onClick={() => updateAttributes({ alignment: value })}
              >
                {value === "left" ? "Trái" : value === "center" ? "Giữa" : "Phải"}
              </button>
            ))}
          </div>
          <div className="product-description-image-control-group">
            <span>Kích thước</span>
            {(["small", "medium", "large", "full"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`Kích thước ảnh ${value}`}
                aria-pressed={size === value}
                onClick={() => updateAttributes({ size: value })}
              >
                {value === "small"
                  ? "Nhỏ"
                  : value === "medium"
                    ? "Vừa"
                    : value === "large"
                      ? "Lớn"
                      : "Toàn chiều rộng"}
              </button>
            ))}
          </div>
          <label>
            Alt text
            <input
              value={alt}
              maxLength={250}
              onChange={(event) => updateAttributes({ alt: event.target.value })}
            />
          </label>
          <div className="product-description-image-control-actions">
            <button
              type="button"
              aria-label="Đưa ảnh lên"
              onClick={() => moveImageNode(editor, position, -1)}
            >
              <Icon>arrow_upward</Icon> Đưa lên
            </button>
            <button
              type="button"
              aria-label="Đưa ảnh xuống"
              onClick={() => moveImageNode(editor, position, 1)}
            >
              <Icon>arrow_downward</Icon> Đưa xuống
            </button>
            <label className="product-description-image-replace">
              <span className="sr-only">Thay ảnh</span>
              <Icon>sync</Icon> Thay ảnh
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Thay ảnh mô tả"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file && context) context.replaceImage(position, file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button type="button" aria-label="Xóa ảnh" onClick={deleteNode}>
              <Icon>delete</Icon> Xóa ảnh
            </button>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const ProductDescriptionImage = Node.create({
  name: "productDescriptionImage",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      assetId: { default: "" },
      alignment: { default: "center" },
      size: { default: "large" },
      alt: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-product-description-image]" }];
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        "data-product-description-image": "true",
        "data-asset-id": node.attrs.assetId,
        "data-align": node.attrs.alignment,
        "data-size": node.attrs.size,
        "data-alt": node.attrs.alt,
      },
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ProductDescriptionImageNodeView);
  },
});
