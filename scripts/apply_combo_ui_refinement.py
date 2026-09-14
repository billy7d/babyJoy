from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


def append_once(path: str, marker: str, addition: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if marker in text:
        raise RuntimeError(f"Marker already exists in {path}: {marker}")
    file.write_text(text.rstrip() + "\n\n" + addition.strip() + "\n", encoding="utf-8")


replace_once(
    "shared/combos.ts",
    '''function errorText(message: string) {\n  return message.trim() || "Cấu hình Combo chưa hợp lệ.";\n}\n''',
    '''function errorText(message: string) {\n  return message.trim() || "Cấu hình Combo chưa hợp lệ.";\n}\n\nexport function formatComboGroupSelectionRule(\n  group: Pick<ComboGroup, "selectionType" | "minSelect" | "maxSelect">,\n) {\n  if (group.selectionType === "FIXED") return "Bắt buộc";\n  if (group.selectionType === "CHOOSE_QUANTITY")\n    return `Tổng số lượng tối thiểu ${group.minSelect} sp / tối đa ${group.maxSelect} sp`;\n  return `Chọn tối thiểu ${group.minSelect} sp / tối đa ${group.maxSelect} sp`;\n}\n\nexport function formatComboGroupSelectionError(\n  group: Pick<ComboGroup, "name" | "maxSelect">,\n) {\n  return `Hãy chọn ${group.maxSelect} sản phẩm trong ${group.name}`;\n}\n''',
)
replace_once(
    "shared/combos.ts",
    '''      errors.push(`Group "${group.name}" yêu cầu ${group.minSelect}-${group.maxSelect} lựa chọn.`);''',
    '''      errors.push(formatComboGroupSelectionError(group));''',
)
replace_once(
    "shared/combos.ts",
    '''        errors.push(`Group "${group.name}" yêu cầu tổng quantity ${group.minSelect}-${group.maxSelect}.`);''',
    '''        errors.push(formatComboGroupSelectionError(group));''',
)

replace_once(
    "app/components/public-pages.tsx",
    '''import {\n  validateComboSelection,\n  type ComboConfig,\n  type ComboGroup,\n  type ComboSelection,\n} from "../../shared/combos";''',
    '''import {\n  formatComboGroupSelectionRule,\n  validateComboSelection,\n  type ComboConfig,\n  type ComboGroup,\n  type ComboSelection,\n} from "../../shared/combos";''',
)
replace_once(
    "app/components/public-pages.tsx",
    '''              <small>\n                {group.selectionType === "FIXED"\n                  ? "Bắt buộc"\n                  : group.selectionType === "CHOOSE_QUANTITY"\n                    ? `Tổng ${group.minSelect}-${group.maxSelect}`\n                    : `Chọn ${group.minSelect}-${group.maxSelect}`}\n              </small>''',
    '''              <small>{formatComboGroupSelectionRule(group)}</small>''',
)
replace_once(
    "app/components/public-pages.tsx",
    '''          {validation.errors.map((error) => <li key={error}>{error}</li>)}''',
    '''          {validation.errors.map((error, index) => (\n            <li key={`${index}-${error}`}>{error}</li>\n          ))}''',
)

replace_once(
    "app/components/combo-admin-pages.tsx",
    '''import type { CatalogTagGroup } from "../../shared/tag-groups";\nimport { ProductImage } from "./product-image";''',
    '''import type { CatalogTagGroup } from "../../shared/tag-groups";\nimport {\n  legacyDescriptionToDocument,\n  type ProductDescriptionAsset,\n  type ProductDescriptionDocument,\n} from "../../shared/product-description";\nimport { ProductDescriptionEditor } from "./product-description-editor";\nimport { ProductImage } from "./product-image";''',
)
replace_once(
    "app/components/combo-admin-pages.tsx",
    '''  const [shortDescription, setShortDescription] = useState("");\n  const [description, setDescription] = useState("");\n  const [status, setStatus] = useState("HIDDEN");''',
    '''  const [shortDescription, setShortDescription] = useState("");\n  const [descriptionContent, setDescriptionContent] =\n    useState<ProductDescriptionDocument>(() => legacyDescriptionToDocument(""));\n  const [descriptionAssets, setDescriptionAssets] = useState<ProductDescriptionAsset[]>([]);\n  const [descriptionUploadSessionId] = useState(() => crypto.randomUUID());\n  const [status, setStatus] = useState("HIDDEN");''',
)
replace_once(
    "app/components/combo-admin-pages.tsx",
    '''        setShortDescription(product.shortDescription ?? "");\n        setDescription(product.description ?? "");\n        setStatus(product.status ?? "HIDDEN");''',
    '''        setShortDescription(product.shortDescription ?? "");\n        setDescriptionContent(\n          product.descriptionContent ??\n            legacyDescriptionToDocument(product.description ?? ""),\n        );\n        setDescriptionAssets(product.descriptionAssets ?? []);\n        setStatus(product.status ?? "HIDDEN");''',
)
replace_once(
    "app/components/combo-admin-pages.tsx",
    '''            shortDescription,\n            description,\n            images: images.map(({ id: imageId, r2Key, altText }, sortOrder) => ({''',
    '''            shortDescription,\n            descriptionContent,\n            descriptionUploadSessionId,\n            images: images.map(({ id: imageId, r2Key, altText }, sortOrder) => ({''',
)
replace_once(
    "app/components/combo-admin-pages.tsx",
    '''                <label>\n                  Mô tả chi tiết\n                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} />\n                </label>''',
    '''                <div>\n                  <span>Mô tả chi tiết</span>\n                  <ProductDescriptionEditor\n                    value={descriptionContent}\n                    productId={id}\n                    uploadSessionId={descriptionUploadSessionId}\n                    assets={descriptionAssets}\n                    onChange={setDescriptionContent}\n                    onAsset={(asset) =>\n                      setDescriptionAssets((current) =>\n                        current.some((item) => item.id === asset.id)\n                          ? current\n                          : [...current, asset],\n                      )\n                    }\n                  />\n                </div>''',
)

append_once(
    "app/combo.css",
    "/* Combo UI refinement: centered card CTA and desktop-only picker readability. */",
    '''/* Combo UI refinement: centered card CTA and desktop-only picker readability. */\n.product-card a.inline-cart-add {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  text-align: center;\n}\n\n@media (min-width: 1024px) {\n  .combo-variant-options > button {\n    grid-template-columns: 48px minmax(150px, 1fr) auto 24px;\n    padding: 10px 12px;\n  }\n\n  .combo-variant-options > button > span {\n    min-width: 0;\n  }\n\n  .combo-variant-options > button b,\n  .combo-variant-options > button small {\n    overflow-wrap: normal;\n    word-break: normal;\n    line-height: 1.35;\n  }\n}\n\n@media (min-width: 1024px) and (max-width: 1199px) {\n  .combo-admin-grid {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .combo-admin-side {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n\n  .combo-variant-picker {\n    position: static;\n    grid-column: 1 / -1;\n  }\n}\n\n@media (min-width: 1200px) {\n  .combo-admin-grid {\n    grid-template-columns: minmax(0, 1fr) minmax(390px, 420px);\n  }\n}''',
)

Path("tests/combo-ui-refinement.test.ts").write_text(
    '''import { describe, expect, it } from "vitest";\nimport {\n  formatComboGroupSelectionRule,\n  validateComboSelection,\n  type ComboConfig,\n  type ComboGroup,\n} from "../shared/combos";\n\nfunction group(\n  id: string,\n  name: string,\n  minSelect: number,\n  maxSelect: number,\n  selectionType: "CHOOSE" | "CHOOSE_QUANTITY" = "CHOOSE",\n): ComboGroup {\n  return {\n    id,\n    comboProductId: "combo-ui",\n    name,\n    description: "",\n    selectionType,\n    minSelect,\n    maxSelect,\n    displayOrder: 0,\n    items: [\n      {\n        id: `${id}-item`,\n        groupId: id,\n        variantId: `${id}-variant`,\n        fixedQuantity: 0,\n        minQuantity: 1,\n        maxQuantity: Math.max(1, maxSelect),\n        priceAdjustment: 0,\n        displayOrder: 0,\n        variantName: "Variant test",\n      },\n    ],\n  };\n}\n\ndescribe("Combo UI refinement copy", () => {\n  it("giải thích min/max rõ ràng thay cho Chọn 1-1", () => {\n    expect(formatComboGroupSelectionRule(group("g1", "Group mới", 1, 1))).toBe(\n      "Chọn tối thiểu 1 sp / tối đa 1 sp",\n    );\n    expect(formatComboGroupSelectionRule(group("g2", "Sữa", 1, 3))).toBe(\n      "Chọn tối thiểu 1 sp / tối đa 3 sp",\n    );\n    expect(\n      formatComboGroupSelectionRule(\n        group("g3", "Snack", 2, 5, "CHOOSE_QUANTITY"),\n      ),\n    ).toBe("Tổng số lượng tối thiểu 2 sp / tối đa 5 sp");\n  });\n\n  it("trả đúng một dòng actionable cho mỗi Group không hợp lệ", () => {\n    const config: ComboConfig = {\n      productId: "combo-ui",\n      groupMode: "ALL_GROUPS",\n      configVersion: 1,\n      groups: [\n        group("g1", "Group A", 1, 1),\n        group("g2", "Group B", 1, 2, "CHOOSE_QUANTITY"),\n      ],\n    };\n    const result = validateComboSelection(config, {\n      configVersion: 1,\n      items: [],\n    });\n    expect(result.errors).toEqual([\n      "Hãy chọn 1 sản phẩm trong Group A",\n      "Hãy chọn 2 sản phẩm trong Group B",\n    ]);\n  });\n});\n''',
    encoding="utf-8",
)

replace_once(
    "tests/combo-hard-delete.e2e.mjs",
    '''    assert(\n      await card.getByRole("link", { name: "Xem Combo" }).count() === 1,\n      `Card Combo thiếu CTA ở ${viewport.width}px`,\n    );\n    await assertNoHorizontalOverflow(page, viewport.width);''',
    '''    const comboCta = card.getByRole("link", { name: "Xem Combo" });\n    assert(\n      await comboCta.count() === 1,\n      `Card Combo thiếu CTA ở ${viewport.width}px`,\n    );\n    const comboCtaLayout = await comboCta.evaluate((element) => {\n      const style = getComputedStyle(element);\n      return {\n        display: style.display,\n        alignItems: style.alignItems,\n        justifyContent: style.justifyContent,\n        textAlign: style.textAlign,\n      };\n    });\n    assert(\n      comboCtaLayout.display === "inline-flex" &&\n        comboCtaLayout.alignItems === "center" &&\n        comboCtaLayout.justifyContent === "center" &&\n        comboCtaLayout.textAlign === "center",\n      `CTA Xem Combo chưa căn giữa ở ${viewport.width}px: ${JSON.stringify(comboCtaLayout)}`,\n    );\n    await assertNoHorizontalOverflow(page, viewport.width);''',
)
replace_once(
    "tests/combo-hard-delete.e2e.mjs",
    '''    assert(await builder.getByText("Món chính").count() >= 1, `Combo detail thiếu Group ở ${viewport.width}px`);\n    const pickerButtons = builder.locator('.combo-item-stepper button[aria-label="Tăng số lượng"]');''',
    '''    assert(await builder.getByText("Món chính").count() >= 1, `Combo detail thiếu Group ở ${viewport.width}px`);\n    assert(\n      (await builder.locator(".field-heading small").first().innerText()) ===\n        "Chọn tối thiểu 1 sp / tối đa 1 sp",\n      `Rule Group chưa rõ nghĩa ở ${viewport.width}px: ${await builder.innerText()}`,\n    );\n    const comboErrors = builder.locator(".combo-errors li");\n    assert(\n      (await comboErrors.count()) === 1 &&\n        (await comboErrors.first().innerText()) === "Hãy chọn 1 sản phẩm trong Món chính",\n      `Alert Combo chưa đúng một dòng/Group ở ${viewport.width}px: ${await builder.innerText()}`,\n    );\n    const pickerButtons = builder.locator('.combo-item-stepper button[aria-label="Tăng số lượng"]');''',
)
replace_once(
    "tests/combo-hard-delete.e2e.mjs",
    '''    await adminPage.goto(`${baseUrl}/admin/combos/${comboProductId}/edit`, { waitUntil: "domcontentloaded" });\n    await adminPage.getByRole("heading", { name: "Sửa Combo" }).waitFor({ state: "visible", timeout: 10000 });\n    const deleteButton = adminPage.getByRole("button", { name: /XÓA VĨNH VIỄN/ });''',
    '''    await adminPage.goto(`${baseUrl}/admin/combos/${comboProductId}/edit`, { waitUntil: "domcontentloaded" });\n    await adminPage.getByRole("heading", { name: "Sửa Combo" }).waitFor({ state: "visible", timeout: 10000 });\n    const richEditor = adminPage.locator(".product-description-editor");\n    await richEditor.waitFor({ state: "visible", timeout: 10000 });\n    assert(\n      await richEditor.getByLabel("Thanh công cụ mô tả chi tiết").count() === 1,\n      "Combo Admin chưa dùng Rich Editor của Product thường.",\n    );\n    const variantSearch = adminPage.getByPlaceholder("Tìm kiếm...");\n    await variantSearch.fill(componentSku);\n    const variantOption = adminPage.locator(".combo-variant-options > button").filter({ hasText: componentName }).first();\n    await variantOption.waitFor({ state: "visible", timeout: 10000 });\n    const optionLayout = await variantOption.evaluate((element) => {\n      const name = element.querySelector("b");\n      const nameStyle = name ? getComputedStyle(name) : null;\n      return {\n        optionWidth: element.getBoundingClientRect().width,\n        nameWidth: name?.getBoundingClientRect().width ?? 0,\n        overflowWrap: nameStyle?.overflowWrap ?? "",\n        wordBreak: nameStyle?.wordBreak ?? "",\n      };\n    });\n    assert(\n      optionLayout.nameWidth >= 140 &&\n        optionLayout.overflowWrap !== "anywhere" &&\n        optionLayout.wordBreak !== "break-all",\n      `Variant Picker desktop vẫn bó chữ theo cột: ${JSON.stringify(optionLayout)}`,\n    );\n    await assertNoHorizontalOverflow(adminPage, 1024);\n    const deleteButton = adminPage.getByRole("button", { name: /XÓA VĨNH VIỄN/ });''',
)

print("Combo UI refinement patch applied successfully.")
