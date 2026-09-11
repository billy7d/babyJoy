import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_COMPRESSION_QUALITIES,
  IMAGE_RESIZE_EDGES,
  MAX_OPTIMIZATION_ATTEMPTS,
  buildImageCompressionPlan,
  calculateResizedDimensions,
  optimizeProductImage,
  validateProductImageSource,
} from "../app/lib/image-optimizer";
import {
  MAX_IMAGE_LONG_EDGE,
  MAX_SOURCE_IMAGE_BYTES,
  MAX_STORED_IMAGE_BYTES,
  TARGET_IMAGE_BYTES,
} from "../shared/images";

describe("giới hạn source và object ảnh", () => {
  it("chấp nhận các mốc source từ 1 MiB đến đúng 30 MiB", () => {
    for (const [size, type] of [
      [1 * 1024 * 1024, "image/jpeg"],
      [5 * 1024 * 1024, "image/png"],
      [10 * 1024 * 1024, "image/webp"],
      [20 * 1024 * 1024, "image/jpeg"],
      [MAX_SOURCE_IMAGE_BYTES - 1, "image/png"],
      [MAX_SOURCE_IMAGE_BYTES, "image/webp"],
    ] as const) {
      expect(validateProductImageSource({ size, type })).toBe(type);
    }
  });

  it("từ chối source lớn hơn 30 MiB", () => {
    expect(() =>
      validateProductImageSource({
        size: MAX_SOURCE_IMAGE_BYTES + 1,
        type: "image/jpeg",
      }),
    ).toThrow("30 MB");
  });

  it("tách riêng target 900 KiB và hard cap 1.5 MiB", () => {
    expect(TARGET_IMAGE_BYTES).toBe(900 * 1024);
    expect(MAX_STORED_IMAGE_BYTES).toBe(Math.floor(1.5 * 1024 * 1024));
    expect(MAX_SOURCE_IMAGE_BYTES).toBe(30 * 1024 * 1024);
  });
});

describe("optimizer output", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("đưa source 6 MiB về output WebP dưới hard cap và giữ aspect ratio", async () => {
    let closedBitmaps = 0;
    let decodeOptions: Record<string, unknown> | undefined;
    class FakeImage {
      naturalWidth = 6000;
      naturalHeight = 4000;
      decoding = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}

      getContext() {
        return {
          clearRect() {},
          drawImage() {},
          imageSmoothingEnabled: true,
          imageSmoothingQuality: "high",
        };
      }

      convertToBlob({ type }: { type: string }) {
        return Promise.resolve(
          new Blob([new Uint8Array(1024)], { type }),
        );
      }
    }
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal("createImageBitmap", async (_file: Blob, options: unknown) => {
      decodeOptions = options as Record<string, unknown>;
      return {
        close: () => {
          closedBitmaps += 1;
        },
      };
    });

    const source = new File(
      [new Uint8Array(6 * 1024 * 1024)],
      "large.jpg",
      { type: "image/jpeg" },
    );
    const result = await optimizeProductImage(source);

    expect(result.mimeType).toBe("image/webp");
    expect(result.optimizedBytes).toBeLessThanOrEqual(MAX_STORED_IMAGE_BYTES);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1067);
    expect(closedBitmaps).toBe(1);
    expect(decodeOptions).toMatchObject({
      resizeWidth: 1600,
      resizeHeight: 1067,
      resizeQuality: "high",
      imageOrientation: "from-image",
    });
  });
});
describe("tính kích thước resize giữ aspect ratio", () => {
  it("resize ảnh ngang 6000x4000 thành 1600x1067", () => {
    expect(calculateResizedDimensions(6000, 4000)).toEqual({
      width: 1600,
      height: 1067,
    });
  });

  it("resize ảnh dọc 4000x6000 thành 1067x1600", () => {
    expect(calculateResizedDimensions(4000, 6000)).toEqual({
      width: 1067,
      height: 1600,
    });
  });

  it("không upscale ảnh đã nhỏ hơn long edge", () => {
    expect(calculateResizedDimensions(1200, 900)).toEqual({
      width: 1200,
      height: 900,
    });
  });
});

describe("chính sách compression adaptive", () => {
  it("thử đủ quality và fallback resolution theo thứ tự đã khóa", () => {
    expect(IMAGE_COMPRESSION_QUALITIES).toEqual([
      0.82,
      0.78,
      0.74,
      0.7,
      0.64,
      0.58,
      0.5,
    ]);
    expect(IMAGE_RESIZE_EDGES).toEqual([MAX_IMAGE_LONG_EDGE, 1400, 1200, 1000, 800]);
    expect(buildImageCompressionPlan()).toHaveLength(35);
    expect(MAX_OPTIMIZATION_ATTEMPTS).toBe(35);
    expect(buildImageCompressionPlan()[0]).toEqual({
      maxLongEdge: 1600,
      quality: 0.82,
    });
    expect(buildImageCompressionPlan().at(-1)).toEqual({
      maxLongEdge: 800,
      quality: 0.5,
    });
  });

  it("không dừng ở hard cap đầu tiên nếu vẫn còn dimension nhỏ hơn để đạt target", async () => {
    const canvasWidths: number[] = [];
    class FakeImage {
      naturalWidth = 6000;
      naturalHeight = 4000;
      decoding = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {
        canvasWidths.push(width);
      }

      getContext() {
        return {
          clearRect() {},
          drawImage() {},
          imageSmoothingEnabled: true,
          imageSmoothingQuality: "high",
        };
      }

      convertToBlob({ type }: { type: string }) {
        const bytes = this.width > 1000 ? 1200 * 1024 : 800 * 1024;
        return Promise.resolve(new Blob([new Uint8Array(bytes)], { type }));
      }
    }
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));

    const source = new File(
      [new Uint8Array(6 * 1024 * 1024)],
      "large.jpg",
      { type: "image/jpeg" },
    );
    const result = await optimizeProductImage(source);

    expect(result.optimizedBytes).toBe(800 * 1024);
    expect(result.width).toBe(1000);
    expect(canvasWidths).toEqual([1600, 1400, 1200, 1000]);
  });

  it("bỏ qua MIME giả từ encoder và fallback theo Blob MIME thực tế", async () => {
    class FakeImage {
      naturalWidth = 2400;
      naturalHeight = 1600;
      decoding = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}

      getContext() {
        return {
          clearRect() {},
          drawImage() {},
          imageSmoothingEnabled: true,
          imageSmoothingQuality: "high",
        };
      }

      convertToBlob({ type }: { type: string }) {
        return Promise.resolve(
          new Blob([new Uint8Array(1024)], {
            type: type === "image/webp" ? "image/png" : type,
          }),
        );
      }
    }
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));

    const result = await optimizeProductImage(
      new File([new Uint8Array(2 * 1024 * 1024)], "photo.jpg", {
        type: "image/jpeg",
      }),
    );

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.blob.type).toBe("image/jpeg");

    const pngResult = await optimizeProductImage(
      new File([new Uint8Array(2 * 1024 * 1024)], "alpha.png", {
        type: "image/png",
      }),
    );
    expect(pngResult.mimeType).toBe("image/png");
    expect(pngResult.blob.type).toBe("image/png");
  });

  it("trả lỗi có kiểm soát khi không có encoder khả dụng", async () => {
    class FakeImage {
      naturalWidth = 2400;
      naturalHeight = 1600;
      decoding = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}

      getContext() {
        return {
          clearRect() {},
          drawImage() {},
          imageSmoothingEnabled: true,
          imageSmoothingQuality: "high",
        };
      }

      convertToBlob() {
        return Promise.resolve(null);
      }
    }
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));

    await expect(
      optimizeProductImage(
        new File([new Uint8Array(2 * 1024 * 1024)], "photo.jpg", {
          type: "image/jpeg",
        }),
      ),
    ).rejects.toThrow("Trình duyệt hiện tại không thể tối ưu ảnh");
  });
});
