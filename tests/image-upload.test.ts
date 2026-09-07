import { afterEach, describe, expect, it, vi } from "vitest";
import {
  optimizeAndUploadProductImage,
  processProductImageFilesSequentially,
  validateProductImageFiles,
} from "../app/lib/image-upload";
import {
  MAX_SOURCE_IMAGE_BYTES,
  MAX_STORED_IMAGE_BYTES,
} from "../shared/images";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pipeline upload ảnh dùng chung", () => {
  it("preflight dùng đúng shared source limit và MIME validation", () => {
    expect(() =>
      validateProductImageFiles([
        { size: MAX_SOURCE_IMAGE_BYTES, type: "image/jpeg" },
      ]),
    ).not.toThrow();
    expect(() =>
      validateProductImageFiles([
        { size: MAX_SOURCE_IMAGE_BYTES + 1, type: "image/jpeg" },
      ]),
    ).toThrow("30 MB");
    expect(() =>
      validateProductImageFiles([{ size: 1, type: "image/gif" }]),
    ).toThrow("JPEG, PNG và WebP");
  });

  it("xử lý nhiều file tuần tự và giữ thứ tự kết quả", async () => {
    const files = [
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
      new File(["c"], "c.jpg", { type: "image/jpeg" }),
    ];
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const results = await processProductImageFilesSequentially(
      files,
      async (file, index, total) => {
        events.push(`start:${index}/${total}:${file.name}`);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 1));
        active -= 1;
        events.push(`end:${index}`);
        return file.name;
      },
    );

    expect(results).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(events).toEqual([
      "start:0/3:a.jpg",
      "end:0",
      "start:1/3:b.jpg",
      "end:1",
      "start:2/3:c.jpg",
      "end:2",
    ]);
    expect(maxActive).toBe(1);
  });

  it("chỉ upload blob đã tối ưu và giữ header owner/session", async () => {
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
          new Blob([new Uint8Array(1200)], { type }),
        );
      }
    }
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init;
      return new Response(JSON.stringify({ key: "products/test.webp" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const phases: string[] = [];
    const source = new File(
      [new Uint8Array(6 * 1024 * 1024)],
      "large.jpg",
      { type: "image/jpeg" },
    );

    const { optimized } = await optimizeAndUploadProductImage(source, {
      endpoint: "/api/admin/product-description-assets",
      headers: { "x-upload-session-id": "session-1" },
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["optimizing", "uploading"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers).get("content-type")).toBe(
      "image/webp",
    );
    expect(new Headers(requestInit?.headers).get("x-upload-session-id")).toBe(
      "session-1",
    );
    expect(requestInit?.body).toBeInstanceOf(Blob);
    expect((requestInit?.body as Blob).size).toBe(optimized.optimizedBytes);
    expect(optimized.optimizedBytes).toBeLessThanOrEqual(MAX_STORED_IMAGE_BYTES);
  });
});
