---
name: BabyJoy Nurture
colors:
  surface: '#fbf9f8'
  surface-dim: '#dbdad9'
  surface-bright: '#fbf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f2'
  surface-container: '#efedec'
  surface-container-high: '#e9e8e7'
  surface-container-highest: '#e4e2e1'
  on-surface: '#1b1c1b'
  on-surface-variant: '#54433a'
  inverse-surface: '#303030'
  inverse-on-surface: '#f2f0ef'
  outline: '#877369'
  outline-variant: '#dac2b6'
  surface-tint: '#944a18'
  primary: '#944a18'
  on-primary: '#ffffff'
  primary-container: '#ff9f66'
  on-primary-container: '#773401'
  inverse-primary: '#ffb68d'
  secondary: '#2e6765'
  on-secondary: '#ffffff'
  secondary-container: '#b0eae7'
  on-secondary-container: '#326c69'
  tertiary: '#96454c'
  on-tertiary: '#ffffff'
  tertiary-container: '#ff9aa1'
  on-tertiary-container: '#7a2e37'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbc9'
  primary-fixed-dim: '#ffb68d'
  on-primary-fixed: '#331200'
  on-primary-fixed-variant: '#763300'
  secondary-fixed: '#b3edea'
  secondary-fixed-dim: '#98d1ce'
  on-secondary-fixed: '#00201f'
  on-secondary-fixed-variant: '#0f4f4d'
  tertiary-fixed: '#ffdadb'
  tertiary-fixed-dim: '#ffb2b6'
  on-tertiary-fixed: '#3f020e'
  on-tertiary-fixed-variant: '#792e36'
  background: '#fbf9f8'
  on-background: '#1b1c1b'
  surface-variant: '#e4e2e1'
  apricot-surface: '#ffe0d1'
  seafoam-surface: '#d3ecea'
  warm-gray: '#49454e'
typography:
  headline-lg:
    fontFamily: Quicksand
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: Quicksand
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.3'
  headline-md:
    fontFamily: Quicksand
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.3'
  headline-sm:
    fontFamily: Quicksand
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '500'
    lineHeight: '1.2'
  label-md:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.2'
  price-display:
    fontFamily: Quicksand
    fontSize: 20px
    fontWeight: '700'
    lineHeight: '1.2'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 64px
---

## Brand & Style

The design system centers on a warm, safe, and nurturing environment specifically tailored for infant nutrition and weaning (ăn dặm). The brand personality is gentle and optimistic, aiming to reduce the stress of meal planning for parents while evoking a sense of "joyful nourishment."

The visual direction follows a **Modern Softness** style—a hybrid of high-end minimalism and tactile warmth. It prioritizes clarity and ease of navigation through generous whitespace, soft organic shapes, and a palette that avoids the clinical "sterile" look in favor of a "kitchen-table" warmth. Interaction patterns should feel effortless and forgiving, mirroring the gentle nature of childcare.

## Colors

The palette is anchored by a light cream background (`#fbf9f8`) to ensure a soft visual impact compared to pure white. 

- **Primary (Apricot):** Used for main actions and branding. It is an appetite-stimulating color that conveys energy without the aggression of pure red.
- **Secondary (Pastel Blue/Green):** Used for informational elements, category filtering, and balanced contrast against the primary orange.
- **Tertiary (Soft Rose):** Reserved for highlight moments or specific nutritional categories (e.g., fruits/berries).
- **Neutral:** A range of warm grays is used for text to maintain readability without the harshness of true black.

## Typography

The typography strategy pairs the rounded, friendly geometry of **Quicksand** for headings with the high legibility and contemporary feel of **Be Vietnam Pro** for body content.

- **Headings:** Use Quicksand to reinforce the "soft" brand personality. It should always appear in sentence case.
- **Body:** Be Vietnam Pro provides the necessary clarity for reading long ingredient lists or nutritional instructions.
- **Price Formatting:** Use a bold Quicksand weight for prices (e.g., **89.000 ₫**). Always include the currency symbol with a non-breaking space.

## Layout & Spacing

This design system utilizes a **fluid-to-fixed grid** hybrid. 

- **Mobile:** A 4-column fluid grid with 16px margins and 16px gutters.
- **Tablet:** An 8-column fluid grid with 24px margins.
- **Desktop:** A 12-column fixed-width grid (max-width 1280px) centered in the viewport.

The spacing rhythm is based on an 8px base unit. Internal component padding should prioritize the `md` (16px) and `lg` (24px) units to maintain an airy, uncrowded feel that makes content easily digestible for busy parents.

## Elevation & Depth

To maintain a soft and modern aesthetic, this design system avoids heavy shadows. 

- **Tonal Layers:** Primary depth is created using "Surface-Container" logic—placing white cards on the light cream background (`#fbf9f8`) to create a subtle lift.
- **Soft Ambient Shadows:** Use a single, very diffused shadow for floating elements (like mobile navigation bars or active cards): `0 8px 30px rgba(0, 0, 0, 0.04)`.
- **Low-Contrast Outlines:** Use 1px borders in `outline-variant` (`#cbc4cf`) for input fields and static containers to define boundaries without adding visual weight.

## Shapes

The shape language is "Extra-Soft." Sharp corners are strictly prohibited to maintain a child-friendly atmosphere.

- **Small (8px):** Checkboxes, small tags, and nested components.
- **Medium (12px):** Default for standard buttons and input fields.
- **Large (16px):** Product cards and content modules.
- **Extra Large (24px):** Large hero containers or promotional banners.
- **Pill (Full):** Used for category chips, search bars, and primary "Add to Cart" buttons.

## Components

- **Buttons:** Primary buttons use a Pill shape with the Primary color. Label text should be Quicksand Bold.
- **Food Cards:** Use the `Large (16px)` roundedness. These should feature large imagery, a clear Quicksand heading for the food name, and the price formatted as "89.000 ₫" in the bottom right.
- **Nutritional Chips:** Use Pill-shaped secondary-color containers with `label-md` text to denote "Organic," "No Sugar," or age groups (e.g., "6+ months").
- **Input Fields:** Use `Medium (12px)` roundedness with a soft cream fill and a subtle outline.
- **Lists:** Ingredient lists should use `body-md` with custom checkmark icons in the Secondary color instead of standard bullets.
- **Exclusions:** This system intentionally excludes Profile, Wishlist, Reviews, and Payment flows. Focus exclusively on product discovery, nutritional information display, and dietary selection.