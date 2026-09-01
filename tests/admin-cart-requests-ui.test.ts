import { describe, expect, it } from "vitest";
import {
  buildAdminCartRequestApiUrl,
  buildAdminCartRequestUrl,
  emptyAdminCartRequestAdvancedFilters,
  getAdminCartRequestDateRange,
  getAdminCartRequestFilterChips,
  parseAdminCartRequestUrl,
  removeAdminCartRequestFilter,
} from "../app/lib/admin-cart-requests";

describe("Admin Cart Requests URL state", () => {
  it("khôi phục scope/search/sort/filter/page sau refresh và xây API URL", () => {
    const state = parseAdminCartRequestUrl(
      "?scope=share&page=2&q=%20098%20&sort=subtotal&order=desc&status=CONFIRMED,CANCELLED&checkoutState=EXPIRED&channel=SHARE&messengerDeliveryStatus=FAILED&datePreset=sevenDays&dateFrom=2026-08-25&dateTo=2026-08-31&subtotalMin=100000&subtotalMax=500000&itemCountMin=2&itemCountMax=7",
    );
    expect(state).toMatchObject({
      scope: "share",
      page: 2,
      limit: 20,
      q: "098",
      sort: "subtotal",
      order: "desc",
      datePreset: "sevenDays",
      statuses: ["CONFIRMED", "CANCELLED"],
      checkoutStates: ["EXPIRED"],
      channels: ["SHARE"],
      messengerDeliveryStatuses: ["FAILED"],
      subtotalMin: 100000,
      subtotalMax: 500000,
      itemCountMin: 2,
      itemCountMax: 7,
    });
    const browserUrl = buildAdminCartRequestUrl(state);
    expect(browserUrl).toContain("scope=share");
    expect(browserUrl).toContain("page=2");
    expect(browserUrl).toContain("q=098");
    const apiUrl = buildAdminCartRequestApiUrl(state);
    expect(apiUrl).toContain(
      "/api/admin/cart-requests?scope=share&page=2&limit=20",
    );
    expect(apiUrl).not.toContain("datePreset=");
  });

  it("preset ngày dùng khoảng local và mọi filter chip reset page khi xóa", () => {
    const now = new Date("2026-09-01T05:00:00.000Z");
    expect(getAdminCartRequestDateRange("sevenDays", now)).toEqual({
      dateFrom: "2026-08-26",
      dateTo: "2026-09-01",
    });
    expect(getAdminCartRequestDateRange("lastMonth", now)).toEqual({
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    });
    const state = {
      ...parseAdminCartRequestUrl("?page=3&subtotalMin=100000&subtotalMax=500000"),
      datePreset: "sevenDays" as const,
      dateFrom: "2026-08-26",
      dateTo: "2026-09-01",
    };
    expect(getAdminCartRequestFilterChips(state).map((chip) => chip.key)).toEqual([
      "date",
      "subtotal",
    ]);
    const next = removeAdminCartRequestFilter(state, "date");
    expect(next).toMatchObject({ page: 1, datePreset: null, dateFrom: null, dateTo: null });
    expect(removeAdminCartRequestFilter(next, "subtotal")).toMatchObject({
      page: 1,
      subtotalMin: null,
      subtotalMax: null,
    });
  });

  it("clear advanced filters giữ scope/search/sort nhưng reset page", () => {
    const state = parseAdminCartRequestUrl(
      "?scope=messenger&page=4&q=098&sort=createdAt&order=asc&status=SUBMITTED",
    );
    const cleared = { ...state, ...emptyAdminCartRequestAdvancedFilters(), page: 1 };
    expect(cleared).toMatchObject({
      scope: "messenger",
      q: "098",
      sort: "createdAt",
      order: "asc",
      page: 1,
      statuses: [],
    });
  });
});
