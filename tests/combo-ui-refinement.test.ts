import { describe, expect, it } from "vitest";
import {
  formatComboGroupSelectionRule,
  validateComboSelection,
  type ComboConfig,
  type ComboGroup,
} from "../shared/combos";

function group(
  id: string,
  name: string,
  minSelect: number,
  maxSelect: number,
  selectionType: "CHOOSE" | "CHOOSE_QUANTITY" = "CHOOSE",
): ComboGroup {
  return {
    id,
    comboProductId: "combo-ui",
    name,
    description: "",
    selectionType,
    minSelect,
    maxSelect,
    displayOrder: 0,
    items: [
      {
        id: `${id}-item`,
        groupId: id,
        variantId: `${id}-variant`,
        fixedQuantity: 0,
        minQuantity: 1,
        maxQuantity: Math.max(1, maxSelect),
        priceAdjustment: 0,
        displayOrder: 0,
        variantName: "Variant test",
      },
    ],
  };
}

describe("Combo UI refinement copy", () => {
  it("giải thích min/max rõ ràng thay cho Chọn 1-1", () => {
    expect(formatComboGroupSelectionRule(group("g1", "Group mới", 1, 1))).toBe(
      "Chọn tối thiểu 1 sp / tối đa 1 sp",
    );
    expect(formatComboGroupSelectionRule(group("g2", "Sữa", 1, 3))).toBe(
      "Chọn tối thiểu 1 sp / tối đa 3 sp",
    );
    expect(
      formatComboGroupSelectionRule(
        group("g3", "Snack", 2, 5, "CHOOSE_QUANTITY"),
      ),
    ).toBe("Tổng số lượng tối thiểu 2 sp / tối đa 5 sp");
  });

  it("trả đúng một dòng actionable cho mỗi Group không hợp lệ", () => {
    const config: ComboConfig = {
      productId: "combo-ui",
      groupMode: "ALL_GROUPS",
      configVersion: 1,
      groups: [
        group("g1", "Group A", 1, 1),
        group("g2", "Group B", 1, 2, "CHOOSE_QUANTITY"),
      ],
    };
    const result = validateComboSelection(config, {
      configVersion: 1,
      items: [],
    });
    expect(result.errors).toEqual([
      "Hãy chọn 1 sản phẩm trong Group A",
      "Hãy chọn 2 sản phẩm trong Group B",
    ]);
  });
});
