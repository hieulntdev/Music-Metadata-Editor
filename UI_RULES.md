# UI Architecture & Design Rules

This document is the standalone UI specification for compact desktop utility applications. It defines the visual language, component metrics, interaction states, responsive behavior, and implementation boundaries required to reproduce the design without any other reference.

Normative terms:

- **Must**: required for visual and behavioral consistency.
- **Should**: preferred unless the product has a concrete usability reason to differ.
- **Optional extension**: the baseline has no existing example of this state or component; the rule describes the least disruptive way to add it.

## 1. Design Philosophy

- Use a near-white canvas in light mode and a charcoal canvas in dark mode.
- Build hierarchy with typography, 1px hairlines, and small surface shifts. Keep the interface flat.
- Use one blue family for primary actions, selected states, progress, focus, and outlined actions. Do not introduce additional brand accents.
- Keep controls compact but usable: 44px for primary form controls, 36px for standard action buttons, and 32px for dense/table controls.
- Use restrained rounded rectangles for inputs and panels, and full pills for buttons and pagination.
- Favor dense, task-oriented desktop layouts. Let data areas and logs absorb remaining space and scroll internally.
- Keep decoration subordinate to content. Do not use gradients, glass effects, large shadows, oversized headings, or ornamental imagery.
- Every component must work in both themes and expose keyboard focus.

## 2. Design Tokens

Use semantic tokens in components. The aliases below are the canonical contract; components must not consume literal colors or invent local spacing values.

```css
:root,
:root[data-theme="light"] {
  color-scheme: light;

  /* Surfaces */
  --bg-app: #f5f5f7;
  --bg-surface: #ffffff;
  --bg-wash: #f4f8fb;
  --bg-control: #ffffff;
  --bg-hover-subtle: #f5f5f7;
  --bg-hover-strong: #e2e2e5;
  --bg-disabled-control: #f5f5f7;
  --bg-disabled-fill: #e2e2e5;

  /* Text */
  --text-primary: #1d1d1f;
  --text-secondary: #474747;
  --text-muted: #707070;
  --text-disabled: #858585;
  --text-on-accent: #f4f8fb;
  --text-strongest: #000000;
  --text-neutral-reserved: #333333;

  /* Borders and accent */
  --border-primary: #d2d2d7;
  --border-hover: #707070;
  --accent: #0071e3;
  --accent-hover: #0077ed;
  --accent-outline: #0066cc;
  --accent-decorative: #2997ff;

  /* Semantic status */
  --status-success: #1d7a3e;
  --status-warning: #a16207;
  --status-danger: #d70015;

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text",
    "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "SF Mono", ui-monospace, "Cascadia Code", Consolas,
    "Courier New", monospace;
  --font-size-caption: 12px;
  --font-size-control: 14px;
  --font-size-body: 17px;
  --font-size-title: 21px;
  --font-size-heading-sm: 28px;
  --tracking-caption: -0.264px;
  --tracking-control: -0.224px;
  --tracking-body: -0.272px;
  --tracking-title: -0.105px;

  /* 4px-based spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-10: 40px;
  --space-12: 48px;
  --space-14: 56px;

  /* Shape */
  --radius-control: 8px;
  --radius-panel: 8px;
  --radius-pill: 980px;

  /* Component metrics */
  --height-control: 44px;
  --height-button: 36px;
  --height-compact: 32px;
  --height-button-micro: 28px;
  --size-icon-button: 36px;
  --height-table-row: 36px;
  --height-table-row-condensed: 30px;
  --height-progress: 8px;
  --duration-interaction: 150ms;

  /* Defined only for true floating overlays; not for panels or buttons */
  --shadow-overlay: 0 8px 24px rgba(0, 0, 0, 0.12);
}

:root[data-theme="dark"] {
  color-scheme: dark;

  --bg-app: #1d1d1f;
  --bg-surface: #2c2c2e;
  --bg-wash: #26262a;
  --bg-control: #2c2c2e;
  --bg-hover-subtle: #1d1d1f;
  --bg-hover-strong: #3a3a3c;
  --bg-disabled-control: #1d1d1f;
  --bg-disabled-fill: #3a3a3c;

  --text-primary: #f5f5f7;
  --text-secondary: #b8b8bd;
  --text-muted: #a1a1a6;
  --text-disabled: #6e6e73;
  --text-on-accent: #ffffff;
  --text-strongest: #ffffff;
  --text-neutral-reserved: #d2d2d7;

  --border-primary: #48484a;
  --border-hover: #a1a1a6;
  --accent: #2997ff;
  --accent-hover: #3aa0ff;
  --accent-outline: #66b3ff;
  --accent-decorative: #2997ff;

  --status-success: #32d74b;
  --status-warning: #eab308;
  --status-danger: #ff453a;

  --shadow-overlay: 0 8px 24px rgba(0, 0, 0, 0.5);
}
```

`--bg-wash`, `--text-strongest`, `--text-neutral-reserved`, `--font-mono`, and `--shadow-overlay` are reserved tokens. Their existence does not require their use. In particular, the standard Activity Log uses the sans stack, and ordinary panels use no shadow.

## 3. Color System

### Light Theme

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Application canvas | `--bg-app` | `#f5f5f7` | Window/body and subtle row hover |
| Panel/control surface | `--bg-surface`, `--bg-control` | `#ffffff` | Panels, table, inputs, selects, log |
| Soft wash | `--bg-wash` | `#f4f8fb` | Reserved low-contrast surface |
| Strong neutral hover/fill | `--bg-hover-strong` | `#e2e2e5` | Icon buttons, pagination hover, disabled filled buttons |
| Primary text | `--text-primary` | `#1d1d1f` | Titles, values, table content |
| Secondary text | `--text-secondary` | `#474747` | Filter and compact labels |
| Muted text | `--text-muted` | `#707070` | Placeholders, status copy, descriptions |
| Disabled text | `--text-disabled` | `#858585` | Disabled controls and pagination |
| Hairline | `--border-primary` | `#d2d2d7` | All standard borders and separators |
| Primary accent | `--accent` | `#0071e3` | Filled action, selected page, focus, progress |
| Outline accent | `--accent-outline` | `#0066cc` | Secondary action border/text |
| Decorative accent | `--accent-decorative` | `#2997ff` | Brand mark only; not a second action color |

### Dark Theme

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Application canvas | `--bg-app` | `#1d1d1f` | Window/body and subtle row hover |
| Panel/control surface | `--bg-surface`, `--bg-control` | `#2c2c2e` | Panels, table, controls, log |
| Soft wash | `--bg-wash` | `#26262a` | Reserved low-contrast surface |
| Strong neutral hover/fill | `--bg-hover-strong` | `#3a3a3c` | Hover and disabled fill |
| Primary text | `--text-primary` | `#f5f5f7` | Titles, values, table content |
| Secondary text | `--text-secondary` | `#b8b8bd` | Compact labels |
| Muted text | `--text-muted` | `#a1a1a6` | Placeholders, status copy, descriptions |
| Disabled text | `--text-disabled` | `#6e6e73` | Disabled controls and pagination |
| Hairline | `--border-primary` | `#48484a` | Borders and separators |
| Primary accent | `--accent` | `#2997ff` | Filled action, selected page, focus, progress |
| Outline accent | `--accent-outline` | `#66b3ff` | Secondary action border/text |

Semantic colors are signals, not decoration. Use success, warning, and danger only for status text, validation feedback, or error log lines. Do not tint whole panels or ordinary buttons with them.

No custom scrollbar color is part of either palette. Native scrollbars must remain readable through `color-scheme`.

## 4. Typography

Use the system sans stack so the interface feels native and requires no downloaded font. Apply antialiasing and optimized legibility at the body level. Controls must inherit the application font.

| Role | Size | Weight | Tracking | Line height | Color |
| --- | ---: | ---: | ---: | ---: | --- |
| Application title | 21px | 600 | -0.105px | `normal` | Primary |
| Panel/section title | 17px | 600 | -0.272px | `normal` | Primary |
| Body/default | 17px | 400 | -0.272px | `normal` | Primary |
| Primary button | 17px | 400 | -0.272px | Control-centered | On accent |
| Control/input/table body | 14px | 400 | -0.224px | `normal` | Primary |
| Secondary/status text | 14px | 400 | -0.224px | `normal` | Muted or primary by role |
| Form/filter/table label | 12px | 600 | -0.264px | `normal` | Primary or secondary |
| Compact control/button | 12px | 400 | -0.264px | Control-centered | By variant |
| Supporting note | 12px | 400 | -0.264px | 1.35 | Muted |
| Activity Log | 12px | 400 | inherited | 1.6 | Muted; per-part overrides |
| Empty state | 14px | 400 | -0.224px | `normal` | Muted |

Rules:

- Use weights 400 and 600. Do not add bold 700 to standard application chrome.
- Use tabular numerals for time, duration, counters, percentages, page numbers, and numeric table columns.
- Use ellipsis and a single line for paths, compact status text, and flexible table cells.
- `28px` exists as a reserved small-heading step but is not required in dense desktop views.
- Do not default logs to monospace. Use `--font-mono` only when displaying code, command output, or alignment-sensitive data.

## 5. Spacing

Use only the canonical scale: `4, 8, 12, 16, 20, 24, 40, 48, 56px`.

| Context | Spacing |
| --- | ---: |
| Micro separation | 4px |
| Icon-to-label, label-to-control, compact toolbar gap | 8px |
| Default component, header, grid, and action gap | 12px |
| Panel padding, table cell horizontal padding, log padding | 16px |
| Reserved medium separation | 20px |
| Horizontal page padding and large button padding | 24px |
| Major content separation | 40/48/56px only when a larger composition needs it |

The canonical icon/text gap is 8px. Existing 6px micro-gaps are normalized to 8px in new components so all spacing stays on the 4px grid.

## 6. Sizing

| Element | Canonical metric | Behavior |
| --- | ---: | --- |
| Main text input/select/file picker | 44px high | Full width of its grid cell |
| Primary/large secondary action | 44px high | Intrinsic width; may share available width in narrow layouts |
| Standard secondary/destructive button | 36px high | Intrinsic width; never compress label |
| Icon-only button | 36×36px | Fixed, circular, no shrink |
| Compact select/input/pagination/action | 32px high | Fixed height; width content-specific |
| Micro action | 28px high | Use only for low-priority panel tools |
| Checkbox | 18×18px | Native square control |
| Default table header/row | 36px high | Fixed for predictable density |
| Condensed table row | 30px high | Only when viewport height is 700px or less |
| Progress bar | 8px high | Full width |
| Panel resize hit area | 16px wide | Visible rule remains 1px/2px |
| Panel minimum width | 320px | Canonical runtime minimum before stacking |
| Narrow stacked panel minimum height | 320px | Processing/log-style panel |

The panel minimum is standardized at 320px. This resolves the older split between a 280px CSS fallback and a 320px runtime resize clamp.

## 7. Borders & Radius

- Standard border and separator: `1px solid var(--border-primary)`.
- Hovering an outlined neutral control changes the border to `--border-hover`.
- Inputs, selects, panels, table containers, log containers, and compact number inputs use `8px` radius.
- Text buttons, compact row actions, pagination buttons, and progress tracks use `--radius-pill` (`980px`).
- A square icon button becomes circular only when width equals height; use `50%` or the pill token consistently.
- Do not nest multiple decorative borders. Nested borders are allowed when the child is a functional scroll viewport, such as a table or log.
- Dividers are 1px hairlines. An interactive splitter expands visually to 2px on hover, focus, and drag while keeping a 16px hit target.

## 8. Shadows

The interface is flat. Panels, cards, inputs, buttons, headers, tables, and navigation must not have decorative shadows. Use borders and surface contrast instead.

`--shadow-overlay` is reserved for genuinely floating content such as a detached menu or popover. It must not be used to make ordinary panels look elevated. No standard component requires this shadow.

## 9. Application Layout

### Universal Rules

- The document and application shell fill the window and use `min-width: 0` / `min-height: 0` on flex or grid descendants that must shrink.
- The outer shell is a column flex layout with `12px` gap and `12px 24px` padding.
- Header and setup controls remain intrinsic-height. The main workspace grows to consume all remaining height.
- Data tables and logs scroll inside their own containers. Avoid making the whole application scroll at normal desktop width.
- Flexible text fields and data columns may grow. Buttons, icons, timestamps, percentages, and compact selectors must not shrink.
- Use `overflow: hidden` at the shell/workspace level and explicit `auto` overflow on intended scroll regions.

### Recommended Layout Pattern

```text
Application shell
├── Header: brand/title + global actions
├── Primary setup grid
├── Optional secondary settings grid
└── Flexible workspace
    ├── Primary data panel (default weight 3)
    ├── Accessible 16px splitter
    └── Secondary activity/detail panel (default weight 1)
```

At wide sizes, the workspace uses a horizontal flex split with a default 3:1 ratio. If user resizing is useful, persist a ratio rather than pixels, clamp both panels to 320px, support pointer dragging and Left/Right Arrow changes in 24px steps, and hide the splitter after the layout stacks.

This is a recommended utility-app pattern, not a requirement that every application have two panels. A single-panel application must retain the same shell padding, surfaces, control density, and scroll ownership.

## 10. Header

- Use a horizontal flex row, vertically centered, with a 12px gap.
- Do not force a fixed header height. Its minimum visual height comes from the 36px global action.
- Add `12px` bottom padding and a 1px bottom hairline.
- Brand mark: 22×22px, fixed size, minimal line SVG, decorative accent color.
- Application title: 21px/600 with title tracking and primary text color.
- Place global actions at the trailing edge using `margin-inline-start: auto`.
- Theme toggle: 36×36px circular icon button, 16px icon, transparent background, 1px hairline.
- Do not add a subtitle unless product context requires one. If used, style it as 12px or 14px muted text rather than a second heading.

## 11. Controls

All controls inherit the application font and text color. Use an 8px label-to-control gap. Standard labels are 12px/600 in primary text.

### Text Input

- Height: 44px; compact numeric variant: 32px.
- Width: `100%` within its grid cell; add `min-width: 0` to the field and parent.
- Padding: `0 16px`; compact variant `0 8px`.
- Border/background/radius: 1px hairline, control surface, 8px.
- Text: 14px for standard fields; 12px for compact fields.
- Placeholder: muted text. Entered text: primary text.
- Hover: border becomes `--border-hover`.
- Focus: global 2px accent ring with 2px offset; keep the border.
- Active/editing: same visual treatment as focus; do not add a filled background or inset shadow.
- Disabled: disabled-control background, disabled text, `not-allowed` cursor.
- Numeric values should use tabular numerals and centered alignment only for short page/count fields.
- **Optional error extension:** use `--status-danger` for the border and a 12px danger message below the field. Keep the standard focus ring so keyboard focus remains visible. Do not fill the entire field red.

### File Picker

- Implement as a real button that opens a native file dialog, not as a fake editable path input.
- Use the standard 44px control shell, 16px horizontal padding, 12px internal gap, and left alignment.
- Leading file/media icon: 18px, fixed size, muted color.
- Empty prompt/path: muted, single line, ellipsized. Selected path: primary text.
- The control fills its grid cell and clips long paths with `min-width: 0`, `overflow: hidden`, and `text-overflow: ellipsis`.
- Hover, focus, disabled, and error behavior follows Text Input.
- Active/pressed uses the hover border without movement, scale, or inset shadow.

### Folder Picker

- Use the same shell and states as File Picker; only the icon, accessible label, and native dialog mode differ.
- The native dialog should allow directory creation when the platform supports it.
- Display the selected path as a single ellipsized line. Never place browse and path controls at mismatched heights.
- Hover, focus, active, disabled, and optional error behavior is identical to File Picker.

### Select / Combobox

- Standard wrapper height: 44px; compact wrapper height: 32px.
- The select fills the wrapper and uses `0 16px` padding plus 36px reserved at the trailing edge for the chevron.
- Remove the native arrow only when supplying the standard SVG chevron.
- Chevron: 14px standard or 12px compact, positioned 14px or 10px from the trailing edge; `pointer-events: none`.
- Use 14px control text; compact selects use 12px.
- Border, background, radius, hover, focus, and disabled states match Text Input.
- While the native menu is open, retain the focus treatment on the closed control; the popup itself follows platform behavior.
- Long selected values must not expand the grid. Constrain the wrapper and allow text clipping.
- **Optional error extension:** use the same restrained danger border/message treatment as Text Input.

### Checkbox

- Use a native 18×18px checkbox with a real associated label.
- Wrap checkbox and text in a 44px-high flex row with an 8px gap.
- Label text: 14px, primary color, non-selectable, pointer cursor.
- Disabled label and control use disabled text and `not-allowed` cursor.
- Keep native platform rendering; do not replace it with an unrelated custom icon set.
- Focus must remain visible through the global focus rule.
- Hover adds no custom container fill; active/checked feedback remains native and must respect `color-scheme`.
- **Optional error extension:** keep the checkbox itself native and place a 12px danger message beneath the group. Do not turn the full 44px row red.

## 12. Buttons

Shared rules for text buttons:

- Inline flex; center content on both axes.
- Full-pill radius, no shadow, no label wrapping.
- Icon/text gap: 8px.
- Transition only background, border, and text color for 150ms ease.
- Never animate scale, position, or shadow on press.
- `:focus-visible` always uses the global 2px accent ring and 2px offset.
- Disabled state uses explicit colors and `not-allowed`; do not reduce the whole control with opacity.

### Primary

| Property | Value |
| --- | --- |
| Height | 44px |
| Padding | `0 24px` |
| Type | 17px/400 |
| Icon | 16px |
| Border | none |
| Default | accent background, on-accent text |
| Hover | accent-hover background |
| Active | same palette as hover; no movement or scale |
| Disabled | disabled-fill background, disabled text |

Use one filled primary action per action group. Do not place two equally weighted filled actions side by side.

### Secondary

| Property | Standard | Large paired action |
| --- | ---: | ---: |
| Height | 36px | 44px |
| Padding | `0 16px` | `0 24px` |
| Type | 14px/400 | 17px/400 |
| Icon | 14px | 16px |

Default is transparent with an accent-outline border and text. Hover/active fills with accent-outline and switches text to on-accent. Disabled uses a hairline border and disabled text.

### Ghost / Tertiary

Use for low-priority panel and row tools.

- Standard neutral ghost: transparent, hairline border, primary or muted text.
- Height: 32px for row tools; 28px for micro panel tools.
- Padding: `0 8px` at 32px; `0 12px` at 28px.
- Text: 14px at 32px; 12px at 28px.
- Hover/active: subtle-hover background, hover border, primary text.
- An accent-outline ghost may be used for a positive inline action; on hover it fills with accent-outline.

### Destructive

Destructive/cancel actions are intentionally restrained rather than red-filled:

- Use the standard 36px neutral outlined pill: hairline border, transparent background, primary text.
- Hover/active: hover border plus subtle-hover background.
- Disabled: hairline border plus disabled text.
- Communicate danger through wording, confirmation, and nearby status feedback. Reserve danger red for error/status signals.

### Icon Button

- Size: 36×36px; fixed and circular.
- Icon: 16px; provide an accessible name; decorative SVG uses `aria-hidden="true"`.
- Default: transparent, hairline border, primary icon.
- Hover/active: strong neutral hover background and hover border.
- Disabled: disabled icon and hairline border.

### Loading

The baseline communicates long-running work in a dedicated status/progress area and disables conflicting controls. Do not replace the button label with unexplained motion. If an inline loading indicator is necessary, treat it as an optional extension: use one 16px line spinner, retain a text label, set `aria-busy="true"`, and preserve the button width.

## 13. Panels

- Panel shell: surface background, 1px hairline, 8px radius, 16px padding.
- Internal layout: column flex, 12px gap, `min-width: 0`, `min-height: 0`, `overflow: hidden`.
- At viewport height 700px or less, reduce panel padding to 12px and internal gap to 8px.
- Panel header: horizontal flex, center or baseline aligned as content requires, `justify-content: space-between`, 12px gap.
- Panel title: 17px/600 primary text. A nested subsection title may use 14px/600.
- Keep panel actions at the trailing edge. Allow action rows to wrap with 12px gaps.
- Use a divider only to separate meaningful regions; do not add separators between every control.
- Functional nested scrollports may have their own 1px border and 8px radius.
- Do not add shadow, gradient, translucent blur, or radius larger than 8px to panels.

## 14. Tables

### Container and Structure

- Wrap the table in a flex-growing scroll container with both axes set to `auto`.
- Container: surface background, 1px hairline, 8px radius, `min-height: 0`.
- Table: width 100%, fixed layout, collapsed borders, left-aligned by default.
- Header is sticky at `top: 0`, z-index 1, and uses the same surface as the table.

### Header and Rows

| Property | Header | Body row |
| --- | --- | --- |
| Height | 36px | 36px; 30px in short-height mode |
| Horizontal cell padding | 16px | 16px |
| Font | 12px/600 | 14px/400 |
| Tracking | Caption | Control |
| Text color | Primary | Primary, unless semantic status |
| Bottom border | 1px hairline | 1px hairline; omit on final row |
| Background | Surface | Surface; app-canvas color on hover |

### Column Rules

- Flexible prose/path column: `width: auto`, single line, ellipsis.
- Small identifier column: about 64px, centered, tabular numerals.
- Short numeric column: about 88px, no wrap, tabular numerals.
- Status column: about 120px, centered, ellipsized.
- Action column: about 180px, centered; use a flex group with 8px gaps.
- Wide fixed metadata may use about 290px when its format must remain readable. Treat these widths as starting points and adjust only for the data type, not ad hoc visual preference.
- Align prose left, actions/status/identifiers center, and numeric measures consistently. Right alignment is acceptable for quantities when the whole column uses it.

### Row States

- Hover: use `--bg-hover-subtle` only; no lift or shadow.
- Status text: success, warning, danger, or muted tokens according to state.
- The baseline has no selected-row treatment. Do not imply row selection unless the product supports it. If added as an optional extension, define a dedicated accessible selected state and verify both themes rather than borrowing an error/status color.
- Row action buttons are 32px pills. Disable unavailable actions rather than hiding them when stable column geometry is valuable.

### Empty and Overflow Behavior

- When no rows exist, let the empty state flex-grow inside the table container and center it in both directions.
- Keep the header visible during vertical scroll.
- Never force long cell text to widen the application; use ellipsis and expose full content through an accessible detail mechanism if needed.

## 15. Pagination

Use a three-region footer:

```text
[rows-per-page]        [first previous pages next last]        [go-to / total]
```

- Footer: flex row, center aligned, space-between, 16px gap.
- Left and right regions each use `flex: 1 1 0`; the page navigation remains centered.
- Compact labels: 12px/600 secondary text. Region gaps: 8px.
- Rows-per-page selector: 32px compact select. “Auto” may size the page from the visible table height; fixed values are product-dependent.
- Page and navigation buttons: minimum 32×32px, 8px horizontal padding, pill radius, 14px text, tabular numerals.
- Navigation order: first, previous, numeric pages, next, last.
- Show up to five nearby numeric pages. Include first/last page and ellipses when the full range does not fit.
- Hover: strong neutral hover background. Active page: accent background and on-accent text. Disabled: disabled text, default cursor.
- Active page uses `aria-current="page"`; icon/symbol controls require explicit accessible labels.
- Go-to input: 52×32px, 8px horizontal padding, 8px radius, 12px centered tabular text. Clamp entered values to the valid range on change or Enter.
- In Auto mode, calculate visible rows from `(scrollport height - header height) / row height`, floor the result, and recompute with a resize observer.

## 16. Progress

- Status row: horizontal flex, space-between, 12px gap.
- Status label: 14px muted, single-line ellipsis, flexible width.
- Percentage: 14px primary, tabular numerals, fixed width behavior.
- Track: full width, 8px high, full-pill radius, disabled-fill/neutral track background.
- Fill: accent color and full-pill radius. Implement both WebKit and Mozilla progress pseudo-elements when using native `<progress>`.
- Clamp values to 0–100. Display percentage with one decimal when precise progress is available.
- Idle: value 0 with concise ready text.
- Processing: accent fill plus live status text; an elapsed timer may use 14px tabular numerals.
- Completed: value 100 and success wording. Keep the standard accent fill; do not recolor the entire bar green.
- Error/canceled: preserve the last meaningful value and change the adjacent status/log message. Do not turn the whole track into a danger surface.
- Use `role="status"`/`aria-live="polite"` for changing status and an accessible label on the progress element.

## 17. Activity Log

- Structure: panel subsection header, trailing Clear action, then a flex-growing scroll container.
- Subsection header gets an 8px top margin when following progress.
- Title: 14px/600 primary text.
- Clear action: 28px neutral ghost pill, `0 12px` padding, 12px type, 14px icon.
- Log viewport: `flex: 1 1 auto`, `min-height: 0`, vertical auto-scroll, 16px padding, surface background, 1px hairline, 8px radius.
- Font: 12px system sans, line-height 1.6, muted default color. Use mono only for genuinely code-like output.
- Timestamp: disabled text; normal message: primary text; error message: danger text.
- Preserve multi-line reports with `white-space: pre-wrap`; allow long tokens to break with `overflow-wrap: anywhere`.
- Append safely as text, never as untrusted HTML. Auto-scroll to the newest entry.
- Bound retained rows; 500 is the standard maximum before removing the oldest entries.
- Empty state should be one quiet muted line, such as “No activity yet.” Do not add a large illustration.
- Use `role="log"` and `aria-live="polite"`. Clearing should add one short confirmation row or update an accessible status.

## 18. Empty States

- Center horizontally and vertically in the available content region.
- Use 14px/400 muted text with control tracking and centered alignment.
- Add 16px horizontal padding so copy does not touch the container edge.
- Keep copy short, specific, and action-oriented. One sentence is preferred.
- An icon is optional; if used, make it a muted 18–22px line icon with 8px spacing.
- Do not use a card inside the empty area, a large illustration, accent-colored headline, or primary action unless the absence cannot be resolved elsewhere.

## 19. Status

| State | Presentation |
| --- | --- |
| Ready/idle | 14px muted text |
| Processing | 14px muted text, optional ellipsis, progress displayed separately |
| Success | Success-colored text; no mandatory badge |
| Warning/timing issue | Warning-colored text |
| Failed/error | Danger-colored text and an explanatory log/detail message |
| Skipped/neutral | Muted text |
| Disabled | Disabled text and explicit disabled control surface/border |

Prefer plain status text over filled badges. If a badge is required as an optional extension, use a 12px label, full-pill radius, and a very restrained semantic tint that passes contrast in both themes. Do not make every state a badge.

Never rely on color alone: include a clear word, icon with accessible text, or nearby explanation.

## 20. Icons

- Use one coherent family of minimal SVG icons. Inline SVG or a single line-icon library is acceptable.
- Standard sizes: 10px inside very dense row actions, 12px compact chevron, 14px standard secondary action, 16px primary/icon button, 18px control-leading icon, 22px brand mark.
- Standard strokes: 1.5–2px, round caps and joins. Filled geometry is acceptable for simple play/theme glyphs.
- Use `currentColor` for stroke/fill so theme and state tokens propagate.
- Mark decorative icons `aria-hidden="true"`. Icon-only controls require an accessible name.
- Keep icons fixed-size with `flex: 0 0 auto`; vertically center them with text.
- Do not use emoji as UI icons.
- Do not mix outlined, cartoon, photorealistic, and unrelated icon families.
- Do not use the decorative blue to make every icon look actionable. Neutral controls use muted or primary icon color.

## 21. Interaction States

| State | Required behavior |
| --- | --- |
| Default | Semantic tokens, standard border/surface, no shadow |
| Hover | 150ms color/border change; only enabled pointer targets respond |
| Focus | 2px solid accent outline, 2px offset, visible only for focus-visible behavior |
| Active/pressed | Keep hover palette; no translation, scale, or new shadow |
| Selected | Accent fill with on-accent text for discrete selections such as active pages |
| Disabled | Explicit disabled colors, no opacity filter, `not-allowed` for controls; default cursor for inert pagination |
| Loading | Lock conflicting controls; show progress/status in a stable area; use `aria-busy` if inline |
| Error | Danger text and concise explanation; danger border only for invalid fields |
| Success | Success text; avoid large green fills |

Additional rules:

- Use `:hover:not(:disabled)` where a hover fill would otherwise make disabled controls appear active.
- Do not remove outlines globally. Suppress mouse-focus outlines only when `:focus-visible` remains intact.
- Dynamic regions must not jump in size when a state changes. Preserve button width and table column geometry.
- Use `hidden` for conditional regions so they leave layout and accessibility flow together.

## 22. Light/Dark Theme

- Theme all components exclusively through semantic tokens. Component selectors must not contain light- or dark-specific literal colors.
- Set `data-theme="light"` or `data-theme="dark"` on the document root and set the matching `color-scheme`.
- Light is the default when there is no saved user choice.
- Persist explicit user selection in local storage or equivalent local preferences.
- Update the theme toggle icon and accessible label to describe the action (for example, “Switch to dark mode”), not the current state.
- The baseline does not automatically follow system preference. System-following may be added as an optional third preference (`system`), but explicit user choice must win and both themes must use this exact palette.
- Use 150ms transitions on interactive controls only. Do not apply a global transition to every element, which causes flashes and expensive repaints.
- All status, hover, selected, disabled, focus, progress, table, log, and scrollbar behavior must be reviewed in both themes.
- Set the native window startup background to the default app canvas. If the framework can read the stored theme before showing the window, synchronize it to prevent a startup flash.

## 23. Responsive Desktop Layout

Baseline window: 1180×780px. Enforce a minimum of 900×650px in both the desktop shell and document CSS.

### Wide Mode: above 1040px

- Setup controls use a grid. Flexible fields use `minmax(0, 1fr)`; compact options/actions use content-aware minimums.
- Main workspace is horizontal and consumes remaining height.
- Default primary/secondary panel ratio is 3:1; splitter is visible.
- Application, workspace, panels, table scrollport, and log must all use correct `min-height: 0` so internal scrolling works.

### Narrow Desktop Mode: 1040px and below

- Application shell permits vertical scrolling.
- Primary setup grid becomes two equal columns.
- The primary action group spans both columns and fills the row; paired actions share width with `flex: 1 1 0`.
- Main workspace stacks vertically.
- Remove inline widths/flex bases left by resizing and hide the splitter.
- Secondary activity/log panel gets at least 320px height.
- Keep secondary settings usable in their grid; allow product-specific groups to hide when not applicable.

### Short-height Mode: 700px and below

- Keep shell padding at 12px vertical / 24px horizontal.
- Reduce panel padding from 16px to 12px and panel gap from 12px to 8px.
- Reduce table row/header height from 36px to 30px.
- Do not shrink form controls or text below their standard metrics.

### General Resize Rules

- Paths, status text, and flexible cells ellipsize instead of overflowing.
- Action groups may wrap; individual buttons must not shrink into unreadable shapes.
- Tables scroll horizontally when required. Logs scroll vertically within their panel.
- Never hard-code layout to a screenshot resolution.
- Persist resizable panel widths as a ratio and re-clamp them when the window changes size.

## 24. Scrollbars

Use native platform scrollbars. Do not add custom width, thumb, track, corner, or hover styling.

- Declare `color-scheme` for correct native light/dark rendering.
- Table viewport: `overflow-x: auto; overflow-y: auto`.
- Activity Log: `overflow-y: auto`.
- Normal wide shell/workspace: hidden overflow with scrolling delegated to internal regions.
- Narrow stacked shell: vertical auto-scroll.
- Keep keyboard focus available on complex scrollports when keyboard scrolling is needed.

## 25. UI Code Architecture

### Token and Style Rules

- Keep global tokens in one theme file or theme layer. Dark mode overrides values, not component structure.
- Components consume semantic aliases such as `--text-primary`; palette names must not leak into component CSS.
- Build shared primitives for Button, IconButton, FieldShell, Select, Panel, Table, Pagination, Progress, ActivityLog, and EmptyState.
- Express size and intent through variants (`primary`, `secondary`, `neutral`, `danger`, `compact`, `large`) rather than copied selectors.
- Keep reset/base, tokens, layout, primitives, components, states, and responsive overrides in a predictable order.
- Use semantic class/component names. Do not name styles after a specific data model or one screen's business operation.
- Avoid inline styles except truly dynamic geometry, such as a user-adjusted flex basis or progress value.
- Do not duplicate literal color, radius, height, or spacing values inside reusable components.

### Behavior and Accessibility Rules

- Keep application data/state separate from styling. A state reducer/controller determines semantic state; CSS determines its appearance.
- Centralize enable/disable decisions so controls cannot disagree about whether work is locked.
- Render user/backend text with text APIs, not HTML injection.
- Every field has a real label. Every icon-only action has an accessible name.
- Use semantic elements: buttons for actions, selects for choices, progress for progress, nav for pagination, table markup for tabular data.
- Dynamic status/log regions use polite live announcements. Destructive exits require native or accessible confirmation when work would be lost.
- Keyboard support must include normal tab order, visible focus, Enter for applicable compact inputs, and Arrow keys for splitters.

### Recommended Primitive Shape

```text
AppShell
├── AppHeader
├── FormGrid
│   ├── FieldLabel + FieldShell variants
│   └── ActionGroup + Button variants
└── Workspace
    ├── Panel
    │   └── DataTable + Pagination + EmptyState
    ├── Splitter (optional)
    └── Panel
        └── Progress + ActivityLog + ActionGroup
```

The framework may differ, but do not create parallel token systems, separate button implementations, or component-specific copies of shared interaction states.

## 26. Electron UI Rules

- Create the main window at 1180×780px with a 900×650px minimum unless the product demonstrably needs more room.
- Use the light canvas (`#f5f5f7`) as the startup window background; synchronize a persisted dark preference before reveal when practical.
- Hide the application menu bar when it is not part of the product UI and show the window only after `ready-to-show` to avoid partial rendering.
- Keep renderer isolation enabled: `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Expose a narrow, named preload API. UI code must not access Node.js, the filesystem, or child processes directly.
- Open file and folder pickers through native dialogs in the main process. Apply relevant file filters and return cancellation as a neutral result.
- Use the renderer only to display selected paths and state; validate paths and permissions again at the trusted main-process boundary.
- Run long work outside the renderer. Send structured progress/status events to the renderer and keep UI updates non-blocking.
- Deny unexpected new windows and external navigation unless explicitly supported.
- Use native confirmation before closing when an operation is active and closing would discard or interrupt work.
- Native dialogs follow platform styling and do not need to mimic the custom panel/control CSS.
- Keep renderer theme preferences local and namespaced. Store resizable panel geometry as a ratio, not absolute pixels.

## 27. Do / Don't

### Do

- Reuse semantic design tokens everywhere.
- Preserve the 44/36/32px control hierarchy.
- Use the 4px spacing scale and 8px/pill radius system.
- Keep panels flat with 1px hairlines.
- Use shared field, button, panel, table, pagination, progress, and log primitives.
- Implement hover, focus, active, selected, disabled, loading, error, and success behavior where applicable.
- Maintain complete light/dark parity.
- Use one coherent SVG icon language.
- Keep tables and logs internally scrollable.
- Test at default, minimum, narrow, and short-height window sizes.
- Preserve keyboard access and semantic HTML.

### Don't

- Hard-code colors inside components.
- Choose arbitrary font sizes, spacing, heights, or radii.
- Add gradients, glassmorphism, oversized shadows, or decorative elevation.
- Use two filled primary actions in one action group.
- Turn destructive actions into bright red fills without a new product-level design decision.
- Use emoji as icons or mix unrelated icon families.
- Shrink buttons until labels wrap or paths force layout overflow.
- Color entire panels for status when status text is sufficient.
- Replace native desktop dialogs with fragile custom file-system UI.
- Put filesystem access or long-running work in the renderer.
- Create one-off CSS when a shared primitive or variant already fits.
- Depend on a reference screenshot or another project's source to fill gaps in this specification.

## 28. UI Implementation Checklist

### Foundation

- [ ] Global semantic tokens are defined once and used by all components.
- [ ] Light and dark palettes exactly match the token tables.
- [ ] The system font stack, sizes, weights, tracking, and tabular numerals follow the typography rules.
- [ ] Spacing uses only the canonical 4px-based scale.
- [ ] No component contains duplicated literal theme colors.
- [ ] No ordinary panel, button, input, header, or table uses a shadow.

### Components

- [ ] Standard controls are 44px high; standard actions 36px; compact controls 32px.
- [ ] Inputs, selects, file/folder pickers, and checkboxes follow the shared control rules.
- [ ] Buttons use primary, secondary, ghost/tertiary, destructive, or icon variants.
- [ ] Panels use the surface, 1px border, 8px radius, and standard padding/gap.
- [ ] Tables use sticky headers, fixed row metrics, ellipsis, semantic status text, and internal scrolling.
- [ ] Pagination includes page-size, first/previous/pages/next/last, disabled/current states, and go-to behavior where needed.
- [ ] Progress uses an 8px neutral track, accent fill, status text, and accessible value/label.
- [ ] Activity Log follows the typography, semantic line colors, 500-row bound, safe text rendering, and auto-scroll rules.
- [ ] Empty states are centered, muted, concise, and visually quiet.
- [ ] Icons use one consistent SVG family, size scale, and stroke weight.

### States and Themes

- [ ] Default, hover, focus-visible, active, selected, and disabled states are implemented where applicable.
- [ ] Loading, error, success, warning, and idle states use the specified restrained feedback.
- [ ] Focus is a 2px accent ring with 2px offset and is never globally removed.
- [ ] Disabled controls use explicit colors rather than component opacity.
- [ ] Every component state has been checked in both themes.
- [ ] Theme choice persists, and the toggle label describes the action.

### Layout and Desktop Behavior

- [ ] The default window works at 1180×780px and the UI remains usable at 900×650px.
- [ ] The layout stacks correctly at 1040px and condenses rows/panels at 700px height.
- [ ] Flexible children use `min-width: 0` and `min-height: 0` where required.
- [ ] Long text ellipsizes; buttons do not collapse; action groups wrap safely.
- [ ] Table and log scrolling remain internal in wide mode.
- [ ] Resizable panels are keyboard accessible, ratio-persisted, clamped, and hidden when stacked.
- [ ] Native scrollbars remain usable in light and dark themes.

### Architecture and Accessibility

- [ ] Reusable primitives replace duplicated component-specific CSS.
- [ ] Styling is separate from business state and long-running work.
- [ ] File/folder selection uses native dialogs behind a secure bridge.
- [ ] Electron renderer isolation and the narrow preload API are preserved.
- [ ] Labels, accessible names, semantic elements, live regions, and keyboard behavior are present.
- [ ] Dynamic or external text is inserted safely as text, not untrusted HTML.
- [ ] The implementation can be completed from this document alone without external screenshots or legacy source.
