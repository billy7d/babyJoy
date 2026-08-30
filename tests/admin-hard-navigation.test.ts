import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isAdminHtmlPath,
  isStorefrontProtectedApiPath,
  isStorefrontProtectedHtmlPath,
} from "../workers/storefront-access";

const siteSource = readFileSync(
  new URL("../app/routes/site.tsx", import.meta.url),
  "utf8",
);
const workerSource = readFileSync(
  new URL("../workers/app.ts", import.meta.url),
  "utf8",
);
const rootSource = readFileSync(
  new URL("../app/root.tsx", import.meta.url),
  "utf8",
);

describe("admin hard navigation với storefront gate", () => {
  it("cho phép React Router lấy manifest và giữ storefront API bị khóa", () => {
    expect(isStorefrontProtectedHtmlPath("/__manifest")).toBe(false);
    expect(isStorefrontProtectedHtmlPath("/")).toBe(true);
    expect(isStorefrontProtectedApiPath("/api/products")).toBe(true);
  });

  it("giữ admin ngoài provider storefront và redirect /admin ở SSR", () => {
    expect(isAdminHtmlPath("/admin/products")).toBe(true);
    expect(isAdminHtmlPath("/admin/access-links")).toBe(true);
    expect(siteSource).toContain('import { redirect, useLocation, useParams }');
    expect(siteSource).toContain("export function loader({ request }: Route.LoaderArgs)");
    expect(siteSource).toContain('redirect("/admin/products")');
    expect(siteSource).toContain("if (noCatalogProvider) return <RoutedContent />;");
    expect(siteSource).not.toContain('<Navigate to="/admin/products" replace />');
  });

  it("đánh dấu admin HTML là private và có log lỗi an toàn", () => {
    expect(workerSource).toContain("isAdminHtmlPath(url.pathname) || protectedHtml");
    expect(workerSource).toContain('headers.set("cache-control", "private, no-store")');
    expect(rootSource).toContain('message: "route render error"');
    expect(rootSource).toContain("redactedRouteErrorPath");
    expect(rootSource).toContain("errorType");
  });
});
