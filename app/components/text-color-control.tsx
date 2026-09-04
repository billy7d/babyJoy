import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  addProductDescriptionRecentColor,
  normalizeProductDescriptionColor,
  normalizeProductDescriptionHexColor,
  normalizeProductDescriptionRecentColors,
  productDescriptionColorToHex,
  PRODUCT_DESCRIPTION_COLOR_TOKENS,
  PRODUCT_DESCRIPTION_DEFAULT_COLOR,
  PRODUCT_DESCRIPTION_RECENT_COLORS_STORAGE_KEY,
  PRODUCT_DESCRIPTION_SUGGESTED_COLORS,
  type ProductDescriptionColorToken,
  type ProductDescriptionHexColor,
  type ProductDescriptionColorValue,
} from "../../shared/product-description";
import { Icon } from "./ui";

export type TextColorControlCurrentColor =
  | ProductDescriptionColorValue
  | "mixed"
  | null;

export type TextColorControlProps = {
  currentColor: TextColorControlCurrentColor;
  disabled?: boolean;
  onApply: (color: ProductDescriptionColorValue) => void;
  onReset: () => void;
};

type HsvColor = {
  hue: number;
  saturation: number;
  value: number;
};

const MIXED_SWATCH_BACKGROUND =
  "linear-gradient(135deg, #7A4B2A 0 25%, #FFFFFF 25% 50%, #2E6765 50% 75%, #CC4422 75%)";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isLegacyColorToken(
  value: ProductDescriptionColorValue,
): value is ProductDescriptionColorToken {
  return PRODUCT_DESCRIPTION_COLOR_TOKENS.includes(
    value as ProductDescriptionColorToken,
  );
}

function hexToHsv(value: string): HsvColor {
  const normalized = normalizeProductDescriptionHexColor(value) ?? "#3B2B22";
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

function hsvToHex({ hue, saturation, value }: HsvColor): ProductDescriptionHexColor {
  const chroma = value * saturation;
  const normalizedHue = ((hue % 360) + 360) % 360;
  const x = chroma * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (normalizedHue < 60) [red, green, blue] = [chroma, x, 0];
  else if (normalizedHue < 120) [red, green, blue] = [x, chroma, 0];
  else if (normalizedHue < 180) [red, green, blue] = [0, chroma, x];
  else if (normalizedHue < 240) [red, green, blue] = [0, x, chroma];
  else if (normalizedHue < 300) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function relativeLuminance(value: string) {
  const normalized = normalizeProductDescriptionHexColor(value);
  if (!normalized) return 0;
  const channels = [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function hasLowContrast(value: string) {
  const foreground = relativeLuminance(value);
  const background = relativeLuminance("#FFFFFF");
  const ratio =
    (Math.max(foreground, background) + 0.05) /
    (Math.min(foreground, background) + 0.05);
  return ratio < 3;
}

function recentColorsFromStorage() {
  if (typeof window === "undefined") return [];
  try {
    return normalizeProductDescriptionRecentColors(
      JSON.parse(
        window.localStorage.getItem(PRODUCT_DESCRIPTION_RECENT_COLORS_STORAGE_KEY) ??
          "[]",
      ),
    );
  } catch {
    return [];
  }
}

export function TextColorControl({
  currentColor,
  disabled = false,
  onApply,
  onReset,
}: TextColorControlProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const currentHex =
    currentColor && currentColor !== "mixed"
      ? productDescriptionColorToHex(currentColor)
      : null;
  const triggerHex = currentHex ?? PRODUCT_DESCRIPTION_DEFAULT_COLOR;
  const [open, setOpen] = useState(false);
  const [recentColors, setRecentColors] = useState(() => recentColorsFromStorage());
  const [draftHex, setDraftHex] = useState<string>(triggerHex);
  const [invalid, setInvalid] = useState(false);
  const [hsv, setHsv] = useState(() => hexToHsv(triggerHex));
  const hsvRef = useRef(hsv);
  const lastValidHexRef = useRef(triggerHex);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PRODUCT_DESCRIPTION_RECENT_COLORS_STORAGE_KEY) return;
      setRecentColors(recentColorsFromStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!open) return;
    const nextHex = currentHex ?? PRODUCT_DESCRIPTION_DEFAULT_COLOR;
    const nextHsv = hexToHsv(nextHex);
    setDraftHex(nextHex);
    setInvalid(false);
    setHsv(nextHsv);
    hsvRef.current = nextHsv;
    lastValidHexRef.current = nextHex;
  }, [currentHex]);

  const rememberRecentColor = (value: string) => {
    const next = addProductDescriptionRecentColor(recentColors, value);
    setRecentColors(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          PRODUCT_DESCRIPTION_RECENT_COLORS_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // localStorage có thể bị chặn; recent colors vẫn hoạt động trong phiên hiện tại.
      }
    }
  };

  const applyColor = (value: ProductDescriptionColorValue, close = true) => {
    const normalized = normalizeProductDescriptionColor(value);
    if (!normalized) return false;
    if (!isLegacyColorToken(normalized)) rememberRecentColor(normalized);
    const nextHex = productDescriptionColorToHex(normalized);
    if (nextHex) {
      const nextHsv = hexToHsv(nextHex);
      setDraftHex(nextHex);
      setInvalid(false);
      setHsv(nextHsv);
      hsvRef.current = nextHsv;
      lastValidHexRef.current = nextHex;
    }
    onApply(normalized);
    if (close) setOpen(false);
    return true;
  };

  const commitDraft = (close = true) => {
    const normalized = normalizeProductDescriptionHexColor(draftHex);
    if (!normalized) {
      setInvalid(true);
      return false;
    }
    return applyColor(normalized, close);
  };

  const commitPickerColor = () => {
    applyColor(hsvToHex(hsvRef.current), false);
  };

  const updatePickerHsv = (next: HsvColor) => {
    const clamped = {
      hue: clamp(next.hue, 0, 360),
      saturation: clamp(next.saturation, 0, 1),
      value: clamp(next.value, 0, 1),
    };
    hsvRef.current = clamped;
    setHsv(clamped);
    setDraftHex(hsvToHex(clamped));
    setInvalid(false);
  };

  const updateSaturationValue = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    updatePickerHsv({
      ...hsvRef.current,
      saturation: (event.clientX - rect.left) / rect.width,
      value: 1 - (event.clientY - rect.top) / rect.height,
    });
  };

  const updateHue = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    updatePickerHsv({
      ...hsvRef.current,
      hue: ((event.clientX - rect.left) / rect.width) * 360,
    });
  };

  const preventEditorFocus = (event: ReactMouseEvent<HTMLButtonElement>) => {
    // Không để click toolbar làm mất selection ProseMirror trước khi apply mark.
    event.preventDefault();
  };

  const handleSaturationKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    let next = hsvRef.current;
    if (event.key === "ArrowLeft") next = { ...next, saturation: next.saturation - step };
    else if (event.key === "ArrowRight") next = { ...next, saturation: next.saturation + step };
    else if (event.key === "ArrowUp") next = { ...next, value: next.value + step };
    else if (event.key === "ArrowDown") next = { ...next, value: next.value - step };
    else return;
    event.preventDefault();
    updatePickerHsv(next);
    commitPickerColor();
  };

  const handleHueKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 2;
    updatePickerHsv({
      ...hsvRef.current,
      hue: hsvRef.current.hue + (event.key === "ArrowRight" ? amount : -amount),
    });
    commitPickerColor();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      setInvalid(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [draftHex, open]);

  const previewHex = normalizeProductDescriptionHexColor(draftHex) ?? hsvToHex(hsv);
  const triggerStyle =
    currentColor === "mixed"
      ? { background: MIXED_SWATCH_BACKGROUND }
      : { backgroundColor: triggerHex };
  const saturationStyle = {
    background: `linear-gradient(to top, #000000, transparent), linear-gradient(to right, #FFFFFF, hsl(${hsv.hue} 100% 50%))`,
  };

  return (
    <div
      ref={rootRef}
      className="product-description-text-color-control"
      data-color-state={currentColor === "mixed" ? "mixed" : currentColor ?? "default"}
    >
      <button
        type="button"
        className="product-description-text-color-trigger"
        aria-label="Màu chữ"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="product-description-text-color-popover"
        title="Màu chữ"
        disabled={disabled}
        onMouseDown={preventEditorFocus}
        onClick={() => {
          const nextOpen = !open;
          if (nextOpen) {
            // Đồng bộ draft ngay trong click để input không bị effect ghi đè khi vừa mở popover.
            const nextHex = currentHex ?? PRODUCT_DESCRIPTION_DEFAULT_COLOR;
            const nextHsv = hexToHsv(nextHex);
            setDraftHex(nextHex);
            setInvalid(false);
            setHsv(nextHsv);
            hsvRef.current = nextHsv;
            lastValidHexRef.current = nextHex;
          }
          setOpen(nextOpen);
        }}
      >
        <span className="product-description-text-color-letter">A</span>
        <span
          className="product-description-text-color-swatch"
          style={triggerStyle}
          aria-hidden="true"
        />
        <Icon>expand_more</Icon>
      </button>
      {open && (
        <div
          id="product-description-text-color-popover"
          className="product-description-text-color-popover"
          role="dialog"
          aria-label="Màu chữ"
        >
          <div className="product-description-text-color-popover-heading">
            <strong>Màu chữ</strong>
            <button
              type="button"
              className="product-description-text-color-close"
              aria-label="Đóng bảng chọn màu"
              title="Đóng"
              onMouseDown={preventEditorFocus}
              onClick={() => setOpen(false)}
            >
              <Icon>close</Icon>
            </button>
          </div>

          <section className="product-description-text-color-section">
            <h3>Màu gợi ý</h3>
            <div className="product-description-text-color-grid">
              {PRODUCT_DESCRIPTION_SUGGESTED_COLORS.map((color) => {
                const active =
                  currentColor !== "mixed" &&
                  currentColor !== null &&
                  (currentColor === color.value || currentHex === color.hex);
                return (
                  <button
                    key={color.id}
                    type="button"
                    className={`product-description-text-color-swatch-button${active ? " is-active" : ""}`}
                    aria-label={`Màu ${color.label}`}
                    aria-pressed={active}
                    title={`${color.label} ${color.hex}`}
                    style={{ backgroundColor: color.hex }}
                    onMouseDown={preventEditorFocus}
                    onClick={() => applyColor(color.value)}
                  >
                    <span aria-hidden="true">{active ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {recentColors.length > 0 && (
            <section className="product-description-text-color-section">
              <h3>Màu gần đây</h3>
              <div className="product-description-text-color-grid product-description-text-color-recent-grid">
                {recentColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="product-description-text-color-swatch-button"
                    aria-label={`Màu gần đây ${color}`}
                    title={`Màu gần đây ${color}`}
                    style={{ backgroundColor: color }}
                    onMouseDown={preventEditorFocus}
                    onClick={() => applyColor(color)}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="product-description-text-color-section">
            <h3>Tùy chỉnh</h3>
            <div
              className="product-description-text-color-saturation"
              role="slider"
              tabIndex={0}
              aria-label="Độ bão hòa và độ sáng"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(hsv.saturation * 100)}
              aria-valuetext={previewHex}
              style={saturationStyle}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                updateSaturationValue(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  updateSaturationValue(event);
              }}
              onPointerUp={(event) => {
                updateSaturationValue(event);
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                commitPickerColor();
              }}
              onPointerCancel={() => commitPickerColor()}
              onKeyDown={handleSaturationKeyDown}
            >
              <span
                className="product-description-text-color-picker-handle"
                style={{
                  left: `${hsv.saturation * 100}%`,
                  top: `${(1 - hsv.value) * 100}%`,
                }}
                aria-hidden="true"
              />
            </div>
            <div
              className="product-description-text-color-hue"
              role="slider"
              tabIndex={0}
              aria-label="Sắc màu"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(hsv.hue)}
              aria-valuetext={previewHex}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                updateHue(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) updateHue(event);
              }}
              onPointerUp={(event) => {
                updateHue(event);
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                commitPickerColor();
              }}
              onPointerCancel={() => commitPickerColor()}
              onKeyDown={handleHueKeyDown}
            >
              <span
                className="product-description-text-color-picker-handle"
                style={{ left: `${(hsv.hue / 360) * 100}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="product-description-text-color-preview-row">
              <span
                className="product-description-text-color-preview"
                style={{ backgroundColor: previewHex }}
                aria-label={`Màu xem trước ${previewHex}`}
              />
              <span>{previewHex}</span>
            </div>
            <label className="product-description-text-color-hex-label">
              <span>HEX</span>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                aria-label="Mã màu HEX"
                aria-invalid={invalid}
                value={draftHex}
                onChange={(event) => {
                  const next = event.target.value;
                  setDraftHex(next);
                  const normalized = normalizeProductDescriptionHexColor(next);
                  if (normalized) {
                    setInvalid(false);
                    const nextHsv = hexToHsv(normalized);
                    hsvRef.current = nextHsv;
                    setHsv(nextHsv);
                    lastValidHexRef.current = normalized;
                  } else {
                    setInvalid(Boolean(next.trim()));
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitDraft();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setDraftHex(lastValidHexRef.current);
                    setInvalid(false);
                    setOpen(false);
                  }
                }}
                onBlur={() => {
                  if (normalizeProductDescriptionHexColor(draftHex)) commitDraft(false);
                }}
              />
            </label>
            {invalid && (
              <p className="product-description-text-color-error" role="alert">
                Mã màu không hợp lệ
              </p>
            )}
            {hasLowContrast(previewHex) && (
              <p className="product-description-text-color-warning" role="status">
                Màu này có độ tương phản thấp trên nền hiện tại.
              </p>
            )}
            <div className="product-description-text-color-actions">
              <button
                type="button"
                className="product-description-text-color-reset"
                aria-label="Mặc định / Xóa màu"
                onMouseDown={preventEditorFocus}
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
              >
                Mặc định / Xóa màu
              </button>
              <button
                type="button"
                className="product-description-text-color-apply"
                aria-label="Áp dụng màu"
                onMouseDown={preventEditorFocus}
                onClick={() => commitDraft()}
              >
                Áp dụng
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
