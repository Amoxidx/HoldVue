# HoldVue Ledger Design System

Ledger is HoldVue's cross-platform interface system. It keeps financial information primary, interaction states explicit, and the complete UI visually identical in principle on macOS and Windows.

## Design pod

The design pod owns four review lanes. A change is complete only when all four agree:

1. **Product/UI:** hierarchy, density, responsive behavior and component consistency.
2. **Icon/Brand:** icon geometry, optical sizing, app-icon exports and asset provenance.
3. **Interaction/Accessibility:** names, keyboard operation, focus, target size, state and forced colors.
4. **Visual QA:** dark/light, German/English, empty/populated/error, 480/720/980/1280 px and packaged Electron output.

## Principles

- Portfolio value, daily movement and data confidence are the primary hierarchy.
- Gold communicates HoldVue brand, primary actions and selected state.
- Green and red are reserved for financial movement and success/error semantics.
- Warning, stale and partial states use amber; unavailable and paused states stay neutral.
- No essential value, price or provider information disappears at a narrow window size.
- Native window controls remain native. Product controls use Ledger components.
- Every visible state also has text or semantics; color never carries meaning alone.

## Foundations

### Spacing

`4, 8, 12, 16, 20, 24, 32, 40, 48 px`. Components should use the closest token instead of introducing intermediate values.

### Radius

- Control: `10 px`
- Nested surface: `12 px`
- Card: `18 px`
- Dialog: `20 px`
- Pill: `999 px`

### Type

- Caption: `12/16`
- Metadata: `13/18`
- Body: `15/22`
- Small title: `18/24`
- Section title: `24/30`
- Display: `36/40`
- Portfolio value: `48/52`

Use weights `400, 500, 600, 700`. Financial values always use tabular figures.

## UI icons

The inline sprite in `src/renderer/index.html` is the only UI-icon source. Dynamic markup uses the typed `iconMarkup` helper.

- Grid: `20 × 20`
- Stroke: `1.75 px`
- Caps and joins: round
- Standard visible size: `18 px`
- Compact visible size: `15–16 px`
- Icon-button target: `40 × 40 px`, or `44 × 44 px` for coarse pointers
- Color: `currentColor`
- Decorative SVG: `aria-hidden="true"`, `focusable="false"`
- Icon-only control: localized, contextual `aria-label`; `title` is a supplementary pointer hint
- No Unicode glyphs for close, check, disclosure, add, remove or selection
- Red hover is allowed only for irreversible delete actions; hide/restore remains neutral or gold

The current catalog covers settings, synchronization, add, close, check, scanning and detection states, trash, hide/restore, disclosure, copy, edit, search, wallet, chart and external link.

## App icon

Branding has two versioned SVG sources:

- `holdvue-icon.svg` for 64–1024 px
- `holdvue-icon-small.svg` with optically reinforced geometry for 16–48 px

The build produces RGBA PNGs, full macOS ICNS and a Windows ICO with 16/20/24/32/40/48/64/96/128/256 px entries. `icon-build.json` fingerprints both SVG sources so stale platform binaries cannot silently ship.

Renderer roles are intentionally separate:

- Favicon: 32 px
- In-app brand mark: 64 px
- BrowserWindow/Windows runtime: 256 px
- Packaged macOS: ICNS
- Packaged Windows: ICO

## Interaction states

Every interactive control supports rest, hover where a pointer exists, active, focus-visible, disabled and destructive states. Asynchronous controls additionally expose busy status and prevent duplicate activation where appropriate.

The top status indicator distinguishes:

- Ready/saved/success: green
- Synchronizing: gold pulse
- Partial/rate-limited: warning amber
- Empty/unconfigured: neutral
- Error: red

Wallet detection uses distinct scan, loader, check-circle and alert-circle icons instead of color-only feedback.

## Responsive behavior

- Asset cards turn into labeled metric cells below the table breakpoint.
- Unit price, 24-hour movement and position value remain visible at every supported width.
- Expanded assets stack chart before account detail when horizontal room is insufficient.
- Dialog actions remain reachable with sticky, opaque headers and footers.
- Touch/coarse-pointer targets increase without scaling the visual glyph.

## Quality gates

- TypeScript typecheck
- Behavioral DOM suite in both locales and all major states
- 100% statements, branches, functions and lines for instrumented production TypeScript
- Static icon-system audit
- App-icon fingerprint, size, alpha-corner, ICO-entry and ICNS-header audit
- Electron package bridge smoke test and public-package privacy audit
- Visual review matrix: dark/light, German/English, empty/populated/error, dialogs and expanded assets at 480/720/980/1280 px
