# UI_RULES.md — Universal UI Design Standard

> **Status:** Approved design baseline · **Scope:** New projects and maintenance of existing projects · **Edition:** 2.0 (project-neutral)
>
> **Purpose:** Define a reusable, compact, desktop-first UI design system and a safe implementation contract for coding agents. This file is self-contained: it does **not** rely on any existing application, repository, named feature, module, file structure, or UI framework.

## 0. Read This First — Rules of Adoption

### 0.1. What this file is (and is not)

- **Visual standard:** exact existing color, typography, spacing, geometry, icon, theme, responsive, and feedback decisions.
- **Conditional component standard:** apply table, filter, pagination, progress, log, navigation, and other patterns **only when the product actually needs them**.
- **Desktop layout profile:** an optional compact workspace/shell composition for applications that use a top bar, sidebar, content area, and/or two-panel workspace. A new project may have different functional architecture without changing the adopted visual roles.
- **Agent process:** instructions for safely introducing, maintaining, validating, and documenting UI.
- **Not a feature specification:** do not invent data columns, pages, actions, runtime architecture, backend state machines, persistence, or empty sections to imitate an example.
- **Not a mandatory technology choice:** apply the same visual semantics in a browser, desktop webview, or another compatible UI toolkit. Do not create a host/iframe split or adopt a particular framework merely because an example uses such terminology.
- **Not a mobile design system:** the dimensions below describe a compact desktop-first UI. A truly mobile layout requires a separately approved profile; do not silently substitute guessed mobile values.

### 0.2. Normative language

- **MUST / MUST NOT:** required or prohibited for every applicable role. A documented technical limitation does not silently waive a visual rule.
- **SHOULD / SHOULD NOT:** preferred default; use a different implementation only for a documented, justified need, without changing a locked visual value.
- **MAY:** optional implementation choice that does not alter the established design.
- **APPLICABLE:** the product contains the described component/role. If it does not, that component's rules are **not applicable**, not a request to build it.
- **EXCEPTION:** an explicitly approved, traceable deviation with scope and verification; ordinary code comments or agent assumptions are not approval.

### 0.3. STYLE LOCK — preserve the existing design

**All specified visual values and treatments in this document are locked.** In new projects, use these values for the visual roles you adopt. In existing projects, do not modify any established appearance outside an expressly approved design change.

**MUST NOT without explicit approval:**

- Replace, round, normalize, interpolate, or re-scale a defined CSS value (for example, do not convert `11px` to `12px`, `14px` to `16px`, or a defined color to a close alternative).
- Change palette, light/dark geometry, type scale, font weights, letter spacing, control height, padding, gap, borders, radius, icon dimensions/stroke, hover/focus/disabled states, breakpoints, panel proportions, scrolling, or column-resize policy.
- Introduce gradients, ornamental shadows, effects, uncontrolled animation, emoji toolbar icons, a second icon style, or a different component library's default styles.
- Interpret "modernize," "clean up," "refactor," "make consistent," or "reuse in another project" as permission to redesign.
- Use optional examples as compulsory screen structures, feature requirements, naming conventions, table schemas, or hard-coded business rules.

**MUST:**

1. Use the **exact role-specific metric** where defined; a numerically similar neighboring token is not interchangeable.
2. Separate **design values** (locked) from **business configuration** (project-specific, e.g., field names, data columns, states, routes, actions).
3. Preserve existing behavior, accessible semantics, events, async work, state, and persistence when a task concerns only appearance or component reuse.
4. Report a missing or conflicting design specification instead of inventing a visually different value and presenting it as established.
5. Obtain explicit approval, register the exception, and update related checks before intentionally changing a locked value.

### 0.4. Order of authority

1. **Explicitly approved change** identifying the exact affected value/role and scope.
2. **Canonical values and component behaviors in this file.**
3. **Chosen layout profile:** adopt desktop shell and workspace recipes only if that composition exists.
4. **Project-owned behavior:** data, navigation, authorization, tasks, reset, persistence, and user interactions are not dictated by design tokens.
5. **Implementation examples:** illustrations and optional table-width presets are informative, not overrides.

If two applicable rules conflict, stop the conflicting alteration, inspect the computed UI where possible, and document the ambiguity. Do not resolve it by personal aesthetic preference.

### 0.5. One-time onboarding for a new project

Identify and record the following in the project's own documentation. **Do not add application-specific details to this shared file.**

| Field | What to record |
| --- | --- |
| Standard | Edition/commit of this `UI_RULES.md` |
| Platform | Actual rendering stack and any CSS/host boundaries |
| Adopted roles | Which components and optional layout profile the product really uses |
| Token owner | Canonical stylesheet/theme/component token entry points, if applicable |
| Functional contracts | Navigation, persistence, processing, selection, data, and reset behavior |
| Business configuration | Actual statuses, column definitions, labels, routes, and commands |
| Verification | Relevant sizes, themes, states, checks, and test tools |
| Approved exceptions | ID, scope, rationale, owner approval; default is **none** |

A new project may have its own architecture and workflows. The file names, component IDs, routes, labels, and domain data of another product must never be carried over by inference.

---

## 1. Visual Philosophy

- Compact, task-oriented desktop presentation, near-white canvas in light mode and charcoal surfaces in dark mode.
- Hierarchy comes from typography, **1px** hairlines, restrained surface changes, and one blue accent family.
- Ordinary panels remain flat. Shadows are reserved for floating overlays, not normal sections.
- Primary content and activity/log views use remaining space and scroll internally where appropriate.
- Preserve all genuine product features. Visual consistency is not permission to remove actions or alter workflows.
- Every interactive role needs keyboard focus feedback and usable light/dark behavior.

## 2. Layout Roles and Ownership

Use roles, not prescribed directory names or CSS selectors:

```text
Application (when applicable)
├── Optional host shell
│   ├── Top bar / global actions
│   ├── Optional sidebar / navigation
│   └── Content viewport
└── Screen or workflow view
    ├── Optional header
    ├── Setup/form area
    ├── Optional secondary settings
    ├── Optional processing/progress area
    └── Flexible workspace
        ├── Main content / data region
        └── Optional activity / details region
```

- A host shell owns **global** layout/navigation. A screen owns **its own** content and interactions. Neither should style the other's internals using uncontrolled selectors.
- A screen may be standalone, hosted in a route, or embedded. These are implementation possibilities, not mandatory architecture.
- Render only needed regions: a simple form, viewer, or single-column process may have neither table nor activity panel.
- A **CSS form grid** (layout of controls) and a **data grid** (tabular records) are different roles. Never treat their rules as interchangeable.
- Where a header or global navigation is provided by a host, do not duplicate it within the screen.

## 3. Optional Compact Desktop Shell Profile

**Applicability:** only a product that adopts the corresponding shell roles. These are visual measurements, not a demand to add a sidebar or a top bar.

| Role | Baseline | Responsive / exception |
| --- | --- | --- |
| Top bar height | **58px** | **50px** at height `≤700px` |
| Top bar horizontal padding | **22px** | unchanged |
| Sidebar width | **207px** | **171px** at width `≤1040px` |
| Host content padding | **22px** | **14px** at width `≤1040px`; **11px 22px** at height `≤700px` |
| Embedded content/frame radius | **8px** | unchanged |
| Embedded content/frame border | **1px** hairline | unchanged |
| Optional shell branding size | **25px** | shell-brand role only |
| Optional large navigation tile/icon size | **50px** | shell navigation role only |

Shell-specific decoration does **not** replace the separate screen-header or form-control standards.

## 4. Content Layout Recipes

**Preferred composition (only where relevant):** setup controls → optional additional settings → optional processing → flexible main workspace.

| Role | Desktop geometry | Narrow behavior |
| --- | --- | --- |
| Setup form grid | **Three `minmax(0, 1fr)` fields** plus content-aware utility controls and actions | At width `≤1040px`, **two equal columns**; paired action group spans both |
| Secondary options grid | **Three `minmax(0, 1fr)` columns** plus a `minmax(200px, 1.2fr)` note/help region | Reflow needed content without overlap |
| Standard dual-panel workspace | `minmax(0, 4fr) minmax(240px, 1fr)` | Stack at width `≤1040px` |
| Main / activity panel gap | **12px** | Standard short-height overrides apply |

- The workspace is a nominal **80% / 20%** split; `minmax(240px, 1fr)` can make the activity side larger than exactly 20% when space is limited. Do not force percentage arithmetic that violates its minimum width.
- Hidden conditional settings must be removed from the layout (for example with the platform's proper hidden semantics), not left as empty placeholders.
- Use `min-width: 0` and `min-height: 0` on shrinkable descendants to prevent content from expanding containers.
- Avoid an artificial data table, sidebar, second panel, or processing area solely for symmetry.

## 5. Canonical Design Tokens

These are approved **resolved** values. A project may select its own variable names, but MUST resolve to the same role values.

| Role | Locked value |
| --- | --- |
| Screen outer padding | **12px 16px** |
| Screen outer gap | **12px** |
| Short-height outer padding | **8px 12px** |
| Short-height outer gap | **8px** |
| Standard panel padding | **16px** |
| Standard panel gap | **12px** |
| Short-height panel padding / gap | **12px / 8px** |
| Processing panel padding | **11px 14px** |
| Processing internal gap | **7px** |
| Processing action gap | **11px** |
| Label-to-field gap | **7px** |
| Full-size field/control height | **40px** |
| Large action height | **40px** |
| Standard button height | **32px** |
| Compact control/action height | **29px** |
| Micro panel action height | **25px** |
| Icon-only button box | **32×32px** |
| Data table header / row height | **36px** |
| Condensed table header / row height | **30px** |
| Progress track height | **7px** |
| Base / body text | **15px** |
| Standard field / button text | **13px** |
| Data table body text | **14px** |
| Caption / label text | **12px** |
| Picker icon | **18px** |
| Large action icon | **16px** |
| Standard action icon | **14px** |
| Control / panel radius | **8px** |
| Button / pagination / progress radius | **980px** |
| Hairline / divider | **1px** |
| Interaction transition duration | **150ms** |

**Existing spacing alias scale** (do not auto-normalize to a generic 4/8/12/16 scale):

```css
--space-1: 4px;
--space-2: 7px;
--space-3: 11px;
--space-4: 14px;
--space-5: 18px;
--space-6: 22px;
--space-10: 36px;
--space-12: 43px;
--space-14: 50px;
```

**Critical distinction:** explicit **12px** screen/panel gap and **16px** panel padding are not synonyms for `--space-3: 11px` or `--space-4: 14px`. Use the correct value by **role**, not nearest alias.

## 6. Spacing and Padding

| Context | Locked measure | Special rule |
| --- | --- | --- |
| Screen interior | `padding: 12px 16px; gap: 12px` | At height `≤700px`: `8px 12px` and `8px` |
| Table/activity panel | `padding: 16px; gap: 12px` | At height `≤700px`: `12px` and `8px` |
| Data table cell | `padding-inline: 16px` | Narrow content-specific columns may use less with a documented reason |
| Icon/label on standard action | `7px` | Log tools use `8px` |
| Form label to field | `7px` | No arbitrary `6px` replacement |
| Dual-panel workspace | `12px` | Not a draggable splitter gutter |

- `gap` spaces siblings, `padding` spaces component interiors, and `margin` is reserved for deliberate external separation.
- Do not simultaneously use gap and margin for the same relationship.
- Do not change panel density by copying values from unrelated components.

## 7. Typography

**System font stack (exact order):**

```css
-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

| Visual role | Size | Weight | Letter spacing | Line height |
| --- | --- | --- | --- | --- |
| Screen title | **19px** | **600** | **-0.105px** | `normal` |
| Panel title | **15px** | **600** | **-0.272px** | `normal` |
| Large action label | **15px** | **400** | **-0.272px** | `normal` |
| Body copy | **15px** | **400** | **-0.272px** | `normal` |
| Standard field/button | **13px** | **400** | **-0.224px** | `normal` / button may use `1` |
| Table body | **14px** | **400** | **-0.224px** | `normal` |
| Labels/table header | **12px** | **600** | **-0.264px** | `normal` |
| Log body | **12px** | **400** | **-0.264px** | **1.6** |

- Standard UI uses weights **400** and **600** only.
- Use tabular numerals for times, durations, rates, percentages, page numbers, quantities, and counters.
- Paths, compact values, and table content use one line and ellipsis; full values remain accessible through a title, detail view, or equivalent.
- Log content may preserve intentional line breaks and wrap anywhere.
- Do not replace the font stack or tracking during a "responsive density" adjustment.

## 8. Icons

- Use **inline SVG** with `currentColor`. Do not mix emoji icons, bitmap toolbar icons, or unrelated icon families.
- Picker icons **18px**; large action icons **16px**; regular, micro, and Clear-action icons **14px**; theme icon **16px** inside a **32px** circular control.
- Outline stroke about **1.5–1.8** with round line caps/joins; filled play triangles may use `fill: currentColor`.
- Decorative brand marks take the approved decorative accent; command icons inherit action color.
- No icon is required for an action that never had one. Do not add decorative icons just to force equal widths.
- Preserve meaningful icon orientation, accessible action name, disabled rendering, and theme behavior.

## 9. Buttons and Actions

| Variant | Height | Horizontal padding | Font | Icon | Shape / treatment |
| --- | --- | --- | --- | --- | --- |
| Large primary | **40px** | **22px** | **15px/400** | **16px** when present | Pill, accent fill |
| Large secondary | **40px** | **22px** | **15px/400** | **16px** when present | Pill, accent outline |
| Standard | **32px** | **14px** | **13px/400** | **14px** | Role-specific |
| Compact row action | **29px** | **7px** | **13px/400** | **14px** | Neutral or outline |
| Micro panel tool | **25px** | **11px** | **12px** | **14px** | Neutral outline |
| Icon-only | **32×32px** | **0** | n/a | **16px** | Circle and hairline |

- Buttons use centered inline-flex, no wrapping, a **980px** pill radius for text buttons, and **no hover movement/scale**.
- Primary hover: theme accent-hover token. Secondary hover: accent-outline fill and on-accent text.
- Cancel/destructive actions may use neutral outline at rest; semantic danger is appropriate for confirmation or error feedback rather than a forced permanent danger fill.
- Disabled primary: disabled fill and text. Disabled outline: hairline remains; disabled text applies.
- Keyboard focus: **2px accent outline**, **2px offset**; preserve accessibility semantics.
- Keep button labels and width stable during loading; show progress/disabled feedback separately.

**Equal-width peer actions (only when a design actually pairs them):**

- Both share **40px** height, **22px** horizontal padding, **15px/400** font, **7px** content gap, pill shape, centered inline-flex.
- Both use `flex: 1 1 0; min-width: 0` in a shared action group. This gives equal rendered widths without hard-coded guesses.
- One may be outlined and another filled; this **does not** mean they must be recolored identically or given the same action callback.

## 10. Form Controls

| Control | Height | Padding | Typography | Visual notes |
| --- | --- | --- | --- | --- |
| Text input / select / picker | **40px** | `0 14px` | **13px** | **1px** border, **8px** radius |
| Compact select / input | **29px** | `0 7px` | **12px** | Filter and pagination roles |
| Checkbox | **18×18px** | n/a | Native | Theme accent-color |
| Multiline textarea | Content-dependent; minimum **40px** | `10px 12px` | **13px**, **1.35** line height | Retains multiline layout |

- Labels: **12px/600** with a **7px** label-to-control gap.
- File/folder pickers invoke the platform's real picker; path display is single-line and ellipsized.
- Select wrapper may use a **12–14px** chevron, reserving appropriate trailing space.
- Hover changes the border color only. Focus uses the common accent ring. Disabled uses disabled-control surface, disabled text, and not-allowed cursor.
- Numeric input uses tabular figures. Center only short page/count-style fields.
- Conditional controls that are hidden must be removed from layout and keyboard navigation.
- Do not lose native validation, input semantics, picker behavior, or event handlers when restyling.

## 11. Data Tables and Grids

**Applicability:** only actual tabular data. CSS grid-based form layouts follow sections 4 and 6 instead.

| Role | Required style / behavior |
| --- | --- |
| Scroll container | Flex-growing; both axes `auto`; stable scrollbar gutter; **1px** hairline; **8px** radius |
| Table element | Semantic single table for header/body; `table-layout: fixed`; width configurable by **data-specific** CSS tokens; `min-width: 100%` |
| Header | Sticky `top: 0`, `z-index: 1`, surface background, **36px** height |
| Body rows | **36px**, reduced to **30px** at height `≤700px` |
| Cells | **16px** inline padding, **14px** body, one line/ellipsis |
| Header typography | **12px/600** |
| Alignment | Identifiers, short statuses, actions centered when appropriate; prose left; numbers tabular |
| Hover | Subtle canvas-surface treatment |
| Empty/loading | Centered, non-collapsing viewport states; no fake data rows or column jumps |
| Scroll | Horizontal scrolling instead of hiding, wrapping, or desynchronizing columns |
| Column widths | CSS/configuration owned; header and body use the same effective widths |
| Manual column resizing | **Prohibited** |

**Non-resizable means:**

- No drag handles, `col-resize` cursor, user resize listeners (pointer or keyboard), user-width state, or persisted custom column widths.
- Automatic responsive sizing or geometry measurement is permitted; it is **not** permission to reintroduce user-controlled widths.
- Reuse one semantic table (or accessibility-equivalent grid implementation) so header and body horizontal positions cannot diverge.
- Only the product defines columns, column names, minimum total width, selection, sorting, and actions. **Do not copy numeric column presets from an unrelated table.**
- Long values require truncation plus a way to obtain their complete accessible text.
- Keep selection and existing row actions functional. A header "select page" checkbox targets the **visible derived page** unless that product expressly defines another meaning.
- A selected-row visual state is **not mandatory** when the product has no selection feature.
- Theme switching must not change geometry, overflow, or column width.

**Optional historical geometry presets** are preserved in Appendix A solely as non-binding numerical references. They are **not** a schema, column contract, or default for every future table.

## 12. Status Filter Pattern

**Applicability:** a table/list that genuinely has statuses and needs a filter.

| Element | Locked style / required behavior |
| --- | --- |
| Position | Trailing edge of content-panel header, beside title |
| Structure | Visible `Status` label, relative select wrapper, native select, **12px** chevron |
| Height | **29px** |
| Horizontal padding | **14px** start, **28px** end; chevron **10px** from trailing edge |
| Font | Select **12px/400**; label **12px/600**; tracking **-0.264px** |
| Shape | **1px** theme hairline, **8px** radius, control surface |
| Label/select gap | **7px** |
| Default | `All` |
| Hover/focus | Hover border token only; **2px** accent focus outline with **2px** offset |
| Disabled | Disabled-control surface/text and not-allowed cursor |

- The filter is a **view** control; it never changes source records, job states, or underlying workflow.
- Available choices come from the **actual product status domain**. Never inherit unrelated product statuses.
- Normalize equivalent backend aliases before filtering; expose one user-facing option per semantic state.
- Changing the filter resets the current page to **1**, then rerenders the derived view.
- Show `N of M` when filtered; `M total` for `All`. Empty-after-filter message must differ from source-empty message and identify the selected filter.
- Live status updates recompute the derived view without resetting unrelated sort, page-size, selection, or control state.
- Maintain identical light/dark geometry.

## 13. Derived Data Views and Sorting

**Data transformation order (when corresponding features exist):**

```text
Source Data → Applicable Filter(s) → Sort → Pagination → Render
```

- Each stage derives a view without mutating the source dataset.
- A user-initiated filter or sort change resets Current Page to **1**; background data/status refresh keeps it if valid.
- Sort the full filtered result **before** paginating.
- Sortable headings are keyboard-accessible and expose `aria-sort` or a platform-equivalent semantic.
- Clamp Current Page to legal range before slicing whenever row count changes.
- Patch a live row directly only if its filter inclusion and sort position are unchanged; otherwise rerun derivation.
- Sorting, filtering, and pagination never change domain status, queue order, actual processing order, or selection unless explicitly required by the product.

## 14. Pagination

**Applicability:** a list/table for which pagination is part of the product. The footer has three logical regions: start page-size, centered navigation, end Go to. Reflow without overlap.

| Role | Locked style / behavior |
| --- | --- |
| Logical region gap | **14px** |
| Page-size label | `Show [select] per page` (localizable without altering geometry rules) |
| Options | `Auto`, `10`, `20`, `50`, `100` |
| Page-size / other compact controls | **29px** tall; filter-style select |
| Navigation gap | **7px** |
| Numbered page control | **29px** height and minimum width, **7px** inline padding, pill radius |
| Page typography | **13px**, tabular figures |
| Active page | Accent fill / on-accent text; `aria-current="page"` |
| Disabled navigation | Disabled text, default cursor, native `disabled` |
| Go to input | **52×29px**, **7px** inline padding, centered **12px** tabular, **8px** radius |
| Page window | Maximum **5 consecutive page numbers**; first/last shortcuts and ellipsis as needed |
| Nav commands | First `«`, Previous `‹`, Next `›`, Last `»`; accessible names required |

- `Total Pages = max(1, ceil(filteredItemCount / effectivePageSize))`.
- Always clamp `Current Page` to `[1, Total Pages]` **before slicing**. Do not render an out-of-range blank page.
- Changing page size resets page to **1**. `Auto` shows the number of whole body rows that fit below the table header, minimum **1**.
- A resize/geometry observer may recompute `Auto` after layout change; this is **automatic** capacity calculation, not a manual grid resize tool.
- Empty view uses page **1 of 1** with disabled First/Previous/Next/Last; a one-page view retains the same footer layout.
- Go to: accept decimal digits only while editing (temporarily empty is allowed); reject signs, separators, decimals, exponent forms, and unrelated characters.
- Input is numeric with `min=1`, `step=1`, suitable numeric keyboard hint, and hidden native spinner buttons without breaking native semantics.
- On Enter or change, commit the manually entered integer after clamping it to valid range.
- During deletion, creation, clear/reset, or live updates, retain current page if still valid, otherwise clamp.
- View-only pagination cannot alter persisted records or active operations.

## 15. Processing and Progress

- Use a bordered surface, **8px** radius; process status/progress content grows while actions keep intrinsic sizes.
- Processing surface padding **11px 14px**; internal content gap **7px**; action gap **11px**.
- Status and progress percentage text **13px**; percentages and elapsed time use tabular figures.
- Progress track full width, **7px** height, no border, pill radius; track uses disabled fill and completed value uses accent.
- Actions can wrap to another line but must not shrink into unreadable labels. At width `≤1040px`, actions may occupy a full row.
- Idle, running, complete, failure, pause, canceling, and retry states change **semantic text/color/progress/disabled state**, not panel geometry.
- Do not refactor cancellation, background processing, retry, or resume behavior as a side effect of styling.

## 16. Activity Log and Console

**Applicability:** when the product exposes activity/log messages; do not manufacture a console for a product that has none.

| Role | Locked value / treatment |
| --- | --- |
| Panel padding / gap | **16px / 12px**; at height `≤700px`: **12px / 8px** |
| Header title | **14px/600**, tracking **-0.224px** |
| Clear action | **25px** tall, **14px** trash icon, **8px** icon-label gap |
| Scroll viewport | Flex-growing, `min-height: 0`, **16px** padding, vertical auto overflow, stable gutter, **1px** border, **8px** radius |
| Log text | System sans, **12px/400**, line-height **1.6** |
| Timestamp | Muted/disabled token, tabular numerals |
| Normal/success/warning/error | Primary text / matching semantic color tokens |
| Empty state | Visible without collapsing log viewport |

- Use monospace **only** for genuinely alignment-sensitive command/code output, not all activity messages.
- Preserve line breaks when intended, use `overflow-wrap: anywhere` for long messages.
- Auto-scroll only if the user was already near the bottom; do not override their reading position.
- A Clear command retains its product-defined scope and callback. Visual consistency must not unexpectedly delete persisted logs or task history.

## 17. Screen Headers and Navigation

**Screen header** (only when not already supplied by host):

- Centered horizontal flex; **11px** gap, **11px** bottom padding, **1px** bottom hairline.
- Brand mark **22×22px**; title **19px/600**; optional subtitle **12px** muted with one-line ellipsis.
- Trailing global action aligns through `margin-inline-start: auto` or equivalent.
- Theme action **32×32px** with **16px** icon.

**Host navigation** (only if a host includes navigation):

- Row height **40px**, icon **18px**, radius **8px**.
- Active row uses accent fill and on-accent text; inactive icons may use accent.
- Disabled navigation remains visibly disabled and does not navigate.
- Existing guards against navigation during unsafe/active operations, if any, must remain intact. The design file does not invent or remove guard requirements.

## 18. Colors and Themes — Exact Palette

| Semantic role | Light | Dark |
| --- | --- | --- |
| App canvas | `#f5f5f7` | `#1d1d1f` |
| Surface/control | `#ffffff` | `#2c2c2e` |
| Subtle hover | `#f5f5f7` | `#1d1d1f` |
| Disabled fill | `#e2e2e5` | `#3a3a3c` |
| Primary text | `#1d1d1f` | `#f5f5f7` |
| Secondary text | `#474747` | `#b8b8bd` |
| Muted text | `#707070` | `#a1a1a6` |
| Disabled text | `#858585` | `#6e6e73` |
| Hairline | `#d2d2d7` | `#48484a` |
| Border hover | `#707070` | `#a1a1a6` |
| Accent | `#0071e3` | `#2997ff` |
| Accent hover | `#0077ed` | `#3aa0ff` |
| Accent outline | `#0066cc` | `#66b3ff` |
| Success | `#1d7a3e` | `#32d74b` |
| Warning | `#a16207` | `#eab308` |
| Error | `#d70015` | `#ff453a` |

- Set native `color-scheme` at the root (or platform equivalent) for native form/scrollbar parity.
- Switch **semantic color values**, never component geometry, selectors, border thickness, spacing, or display behavior.
- Theme storage strategy/key ownership is product-specific; ensure independent contexts do not accidentally overwrite each other's preferences.
- **On-accent foreground** is a semantic role used by filled actions/navigation/pagination. The original visual baseline does not supply a separate hex value for it. Reuse an actually verified approved implementation value when available; otherwise request a one-time approved mapping rather than inventing a supposedly pre-existing color.
- Check readable contrast and do not communicate statuses by color alone.

## 19. Border, Radius, Divider, and Shadow

- All ordinary borders/dividers are **1px** solid hairline.
- Inputs, panels, tables, log viewports, and small number fields have **8px** radius.
- Text buttons, pagination pills, and progress tracks have **980px** radius.
- Ordinary panels have **no ornamental shadow**; floating overlay treatment is separate and requires an approved role.
- Do not insert divider bars, draggable splitters, cursor tracks, or leftover handle spacing between data and activity panels.
- Avoid nested borders except when the child forms a real scroll viewport (table or log).

## 20. Scroll, Overflow, and Text Truncation

- Prefer native scrollbars and root color-scheme. Do not hard-code scrollbar colors.
- Flex/grid descendants that must shrink use `min-width: 0; min-height: 0` as appropriate.
- Wide desktop shells/workspaces may hide overflow at their outer level; **content** tables and logs own the scrollbars.
- Tables scroll both axes with stable gutter; logs scroll vertically with stable gutter.
- Paths, titles, statuses, and cells truncate with ellipsis while leaving full content accessible. Logs wrap anywhere.
- Do not fix overflow by hiding required controls, data columns, selection, progress actions, or feature settings.
- Test horizontal and vertical scrolling independently; scrollbars must not cover inaccessible final cells or block action buttons.

## 21. Responsive Profile and Window Measurements

**Reference testing viewport:** **1180×780px**. **Compact standalone desktop viewport:** **900×650px**. These are design/QA profile measurements, not a requirement to hard-code every new application's native minimum window size.

**Width `>1040px`:**

- Form grids use wide geometry from section 4.
- A dual-panel workspace uses `minmax(0, 4fr) minmax(240px, 1fr)` and **12px** gap.

**Width `≤1040px`:**

- Applicable main/activity workspaces stack into one column.
- Main data panel minimum height **400px**; activity panel minimum height **320px**.
- Setup forms reflow; action groups may span columns and keep peer widths.
- All required setup actions and controls stay available; do not hide business functions just to fit.

**Height `≤700px`:**

- Screen padding changes to **8px 12px**; screen gap **8px**.
- Panel padding **12px**, panel gap **8px**.
- Table header/body rows **30px**.
- **Do not** shrink font sizes/control heights or hide functional areas as an unauthorized density shortcut.

**Correct breakpoint context:** a CSS media query evaluates its viewport, which may differ from the **actual content width** inside a host/sidebar/embedded view. Use the appropriate existing container-query or responsive implementation strategy so the *applicable content* reflows correctly, while keeping **1040px** and **700px** thresholds unchanged for the adopted desktop profile. Do not automatically apply a host-size breakpoint to every nested component without verifying its real rendered width.

**Dual-panel resize ban:**

1. No draggable splitter or manually adjustable main/activity panel widths.
2. No handle, resize cursor, separator track, resize input listeners, or saved user-selected ratios.
3. Panels resize automatically with the window, share available row height in wide mode, and never overflow their parent.
4. Preserve their spacing, panel borders, surfaces, and radii across themes.

## 22. Component States and Accessibility

| State | Required visual/interaction contract |
| --- | --- |
| Hover | Border or surface token change; no movement |
| Active/pressed | Same semantic family as hover; no jump or scale |
| Keyboard focus | **2px** accent outline, **2px** offset |
| Disabled | Disabled text/surface and appropriate non-interactive semantics |
| Loading | Stable action width; progress/status feedback or `aria-busy` equivalent |
| Success | Success semantic text token |
| Warning | Warning semantic text token |
| Error | Error semantic text token and intelligible message |
| Empty | Muted centered explanation; viewport does not collapse |
| Selected | Only when selection exists; native checkbox or accessible selected state |

- Dynamic log/status announcements should use polite live semantics where appropriate.
- Provide visible text or accessible names for icon-only controls and pagination navigation.
- Preserve native tab order, keyboard activation, dialog focus handling, and appropriate disabled behavior.
- Do not rely solely on color to indicate status or success/failure.
- Accessibility fixes should preserve existing approved metrics. If meeting a requirement genuinely needs a changed locked visual value, document the conflict and seek approval rather than silently altering it.

## 23. Shared Components and Implementation Boundaries

- Prefer one logical **token source** per rendering/styling context. Separate frames or independent rendering roots may require duplicate declarations; **their resolved semantic values must match**.
- Prefer role-based variants (`primary`, `secondary`, `ghost`, `danger`, `compact`, `large`, `micro`) over repeated operation-specific style forks.
- Use shared primitives for buttons, text fields, pickers, selects, panels, progress tracks, tables, and logs **where they exist**.
- Namespace style rules or scope them to the component/renderer. Do not let global resets leak across unrelated views or host boundaries.
- Inline styles are for genuinely dynamic values (e.g. current progress or measurable geometry). Static palette, spacing, panel ratios, and table widths belong to system-owned style rules/tokens.
- Avoid adding new UI frameworks, icon libraries, CSS-in-JS layers, or dependencies solely to accomplish a visual refactor when existing infrastructure suffices.
- Do not change event handlers, domain state, active work, navigation policies, persistence, file I/O, queue semantics, or error treatment unless the task expressly requires a behavioral change.
- Never presume any particular folder layout, file extension, file name beyond this standard, CSS selector, component ID, backend language, or embedded-frame architecture.

## 24. Source of Truth and Conflict Handling

1. Read this file and identify which visual roles **actually apply** to the current feature.
2. Inspect existing source, relevant themes, component styles, selectors, responsive queries, and calculated runtime style where feasible.
3. For an existing project, distinguish **approved design baseline** from accidental implementation drift. Restore approved visual values only when within the authorized task scope; otherwise report them.
4. For a fresh project, implement only the adopted roles, using the locked values and project-owned business configuration. Never inherit another project's field list or function set.
5. If an approved value is **not specified** for a genuinely new role, propose a minimal new semantic role and obtain approval; do not fill the gap with an arbitrary library default.
6. If source or runtime evidence is missing, state what could not be checked. Never claim pixel-perfect parity without verification.

**Visual equivalence covers:** theme colors, geometry, typography, SVG treatment, borders, radii, breakpoints, hover/focus/disabled/loading states, overflow, scrollbars, and intrinsic content handling—not just the palette.

## 25. Generic UI Quality Assurance Checklist

Only tick items applicable to the product; do not create unnecessary features to satisfy a test list.

### 25.1. Visual conformance

- [ ] All adopted roles match sections 3–10 and 15–22 without value substitution.
- [ ] Light and dark themes use the exact palette and equal geometry.
- [ ] Buttons use correct **40/32/29/25px** roles; equal-width action pairs keep their individual color/callback roles.
- [ ] Standard screen spacing **12px 16px / 12px**, panel spacing **16px / 12px**, and short-height alternatives match.
- [ ] Typography, tracking, icon dimensions, border widths, focus rings, and radii match approved values.
- [ ] Hover never introduces layout motion, scaling, or unapproved effects.

### 25.2. Layout and data

- [ ] At relevant `1180×780`, `900×650`, `≤1040px`, `≤700px`, and breakpoint-neighboring sizes, no functionality clips or overlaps.
- [ ] Content views own their scrolling; long labels, file paths, status strings, and logs remain accessible.
- [ ] If a table exists, header/body align, horizontal scroll works, rows measure **36px** or **30px** as applicable.
- [ ] No user-driven table column resizing, drag handles, `col-resize` cursors, or persisted column widths are introduced.
- [ ] If a dual workspace exists, no draggable main/activity divider or saved split ratio exists.
- [ ] Empty/loading/populated states do not collapse required regions or change table column geometry.

### 25.3. Interactions and accessibility

- [ ] Status filters use real product statuses, correct counts, contextual empty states, and page reset.
- [ ] Derived views follow filter → sort → paginate; sorting and live updates preserve source records and valid selection.
- [ ] Where pagination exists, `Auto/10/20/50/100`, clamping, manual Go to, and empty/one-page/multi-page states work.
- [ ] Native pickers, keyboard focus, icon action names, disabled/loading states, announcements, and dialog semantics work.
- [ ] Processing controls, cancellation/retry, log clear, navigation guards, and persistence retain their original documented behavior **when present**.
- [ ] Both themes maintain readable state feedback without relying on color alone.

### 25.4. Code and evidence

- [ ] No accidental global-style leakage, duplicate conflicting tokens, undocumented inline visual values, or dead resize code.
- [ ] No unrelated changes to workflow, events, data, backend, file paths, or dependency configuration.
- [ ] Static checks/tests and available runtime UI checks ran; results and skipped checks are reported accurately.
- [ ] Before/after screenshots or computed-style comparisons are attached when available; absence is explicitly disclosed.

## 26. Required Coding-Agent Workflow

For **every** new UI feature, maintenance change, component standardization, or layout refactor:

1. **Discover:** read this entire file; inspect the project's actual architecture, UI files, token/style owner, rendering boundaries, and product requirements.
2. **Classify:** list applicable role standards, optional profiles, preserved product behaviors, and any proposed exception. Do not copy another application's UI tree or schema.
3. **Baseline:** inspect current computed visuals, interactions, and states when a UI already exists; record relevant viewport/theme evidence.
4. **Plan minimally:** prefer existing semantic tokens and shared role primitives; avoid unrelated cleanup, framework switches, and backend changes.
5. **Implement:** write the minimum maintainable change. Preserve actions, keyboard behavior, status handling, sorting/selection/pagination, async tasks, theme behavior, and storage where applicable.
6. **Verify:** run lint/build/tests where available and real viewport/theme/state checks from section 25; separate automated checks from manual checks.
7. **Diff audit:** search for unintended changes to numbers/colors, typography, breakpoint thresholds, radii, SVG sizes, resize behaviors, callbacks, and persistence.
8. **Report:** list actual files edited, affected roles, tests run/results, checks not performed and why, and unresolved discrepancies. Do not claim screenshots or runtime verification you did not perform.

**Stop-and-report:** if a requirement can only be met by changing a protected design value, removing functionality, or inventing a new unapproved visual role, preserve the baseline for that conflict and present the specific proposed deviation for approval. Continue any independent safe changes within the task when feasible.

## 27. Exceptions, Versioning, and Maintenance

**Default is zero exceptions.** The shared design standard must not absorb project-specific names, routes, data domains, directories, UI component IDs, or workflow implementations.

**Every proposed exception records:**

| Field | Required information |
| --- | --- |
| Exception ID | Stable unique identifier |
| Role / section | Exact affected component and rule |
| Reason | Actual product/accessibility/platform need; not personal aesthetic preference |
| Scope | Which product/view/platform/viewport is impacted |
| Existing value | Exact original token, metric, or behavior |
| Proposed value | Exact difference and its visual impact |
| Owner approval | Explicit approval and its reference |
| Implementation | Where the exception will live; avoid rewriting unrelated core rules |
| Verification | Theme, responsive, state, keyboard, and functional regressions |
| Lifecycle | Proposed / approved / rejected / retired |

**Maintenance rules:**

- Editorial clarification may improve wording and structure but **must not change** locked semantics or numbers.
- Add a new component by mapping it to the closest existing role. New visual roles need explicit approval, token definition, and test coverage.
- Change an existing visual value only with approval; update its canonical definition and all impacted rules/checks in one reviewed change.
- Treat screenshots, source, and this document as distinct evidence; do not silently overwrite approved values to match unverified runtime drift.
- Keep a changelog in the consuming project's established workflow; record shared-standard changes separately when approved.
- Do not create multiple conflicting design-rule forks inside one project.

## 28. Reusable Task Instruction for Coding Agents

When assigning a new UI task, provide this file alongside the actual product requirement and use the following contract:

> Read `UI_RULES.md` completely before editing UI. This is the approved, project-independent visual contract. Identify only the sections and desktop profile applicable to the actual product. Preserve exact existing design metrics (palette, typography, sizes, spacing, borders, radii, icons, breakpoints, themes, and interaction states); do not redesign or import assumptions about another project's features, names, modules, tables, or architecture. Inspect the real source and preserve existing business logic, handlers, async jobs, data/state, accessibility, and persistence. Reuse semantic tokens/components where feasible, make the smallest maintainable change, validate relevant responsive/theme/state/keyboard behavior, audit the diff for visual drift, and report exact files modified, checks performed, checks not run, and any design change requiring approval. Do not present an unverified visual or behavior change as a harmless refactor.

**Definition of done:** (a) required feature/function works; (b) every applicable locked style is preserved; (c) existing functional contracts remain intact; (d) tests and verification gaps are disclosed truthfully; (e) no unrelated product-specific assumptions entered this shared standard.

---

## Appendix A. Optional Numeric Table-Width Presets (Non-Normative)

These numerical distributions are preserved as **examples of coherent CSS-owned fixed-layout tables**. They are **not** tied to any industry, product, feature, label, or column meaning. They **must not** be copied into a new table unless its actual data layout justifies the same distribution. All global table behaviors from section 11 still apply.

| Optional preset | Total configured width | Example ordered column widths |
| --- | --- | --- |
| Six-column preset A | **1042px** | **64 / 290 / 300 / 88 / 120 / 180px** |
| Six-column preset B | **1034px** | **64 / 280 / 290 / 120 / 120 / 160px** |
| Nine-column preset | **1050px** | **56 / 88 / 280 / 116 / 96 / 104 / 108 / 80 / 122px** |

**Invariant:** any chosen table layout must use its *own* data-appropriate widths, coherent fixed header/body geometry, CSS-owned sizing, and horizontal scrolling; it must not expose manual column resizing.

## Appendix B. Fast Integrity Checklist for This Shared Rule File

Before distributing an edited edition:

1. Search for product names, team names, brand references, unique feature names, source paths, CSS IDs, API names, URLs, and unrelated table headers. **Expected: none.**
2. Compare defined palette values, token aliases, font metrics, action sizes, table row heights, border/radius values, breakpoint values, and responsive layouts against the approved edition. **Expected: exact preservation unless explicitly approved.**
3. Check that role-level rules do not accidentally require new projects to create a table, activity log, sidebar, processing panel, pagination, or framework integration.
4. Check that optional numeric examples are clearly non-normative and do not embed another product's schemas or workflows.
5. Check that no existing prohibition (manual table resizing, manual main/activity resizing, unapproved restyling) has been weakened.
6. Check that agent instructions preserve behavior, require evidence, and prohibit invented verification claims.

