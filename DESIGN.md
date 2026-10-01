# Weave Design System

현재 운영 중인 로고·심볼·브랜드 설명을 빠르게 찾으려면 먼저 [`brand-guidelines.md`](brand-guidelines.md)를 확인한다. 이 문서는 색·타이포그래피·화면 적용의 상세 계약이다.

## Visual coherence implementation · 2026-08-12

- Page archetypes: `editorial` for About, `utility` by default for discovery/task pages, `gate` for authentication/loading orientation and `recovery` for errors or missing routes
- Surface modes: quiet Canvas `#F7FAF9`, one open Mint field where brand context is useful, and Navy reverse only for deliberate high-emphasis scenes; no global mint or navy wash
- Shared badge families: format, access, provenance, workflow, classification and identity
- Badge density: one primary and at most two secondary badges per row/card; remaining facts stay plain metadata
- Format mappings: PDF red, PPTX orange, DOCX blue, HWP/HWPX violet, XLSX green and LINK cyan
- Workflow mappings: pending, working, warning/held, success, danger and rejected remain distinct from brand selection Mint
- Every functional color keeps a text label plus border, icon, abbreviation or state attribute
- Title roles: brand 60–64px, page/recovery 48–56px, gate 40–48px desktop, with 34–40px mobile equivalents and restrained line-height/letter-spacing
- Containers use 8px controls, 10–12px cards/rows and 14–16px panels by default; shadows are absent except meaningful hover/overlay elevation
- OT01, official youth assets and provider assets remain byte-identical and visually separate

## Status

This is the root design contract for the Cool Neutral full-site redesign. It governs visual and editorial integration without changing product behavior, permissions, information architecture or deployment state.

## Brand architecture

- Product brand: `Weave` is the archive, discovery, contribution and pseudonymous community product
- Institutional endorsement: Won Buddhism Youth Association is the operator and trust anchor; its official mark remains unmodified and visually separate from Weave
- Naming asset: the exact final `OT01 Open Crest` wordmark represents `청년들이 만드는 새로운 물결`
- Compact identifier: product-owner selection override dated 2026-08-12 approves exact Signature W SHA-256 `183e35ffdc297bb79cc936081df8781e0a186b781ea7a5efffb85e936d7e2c7f` for the narrow mobile header at `760px` and below, favicon and selectively branded empty/CTA states only; desktop and tablet headers use the full exact OT01
- Product meaning: records, people, places and next actions gain meaning through visible relationships, not through decorative symbolism alone

## Visual thesis

An editorial living archive on a clean cool-neutral field. The site should feel active, precise and contemporary, with actual records and people carrying the atmosphere. It must not read as a beige lifestyle page, a legacy portal or a religious brochure.

## Color system

### Primitive palette

| Role | Value | Use |
| --- | --- | --- |
| Cool Neutral Canvas | `#F7FAF9` | Default page field; beige, ivory and yellow-cast fields are prohibited |
| Surface | `#FFFFFF` | Cards, dialogs, controls and raised reading surfaces |
| Navy | `#143957` | Headings, primary actions, dark reverse surfaces and product identity |
| Ink | `#243946` | Body text |
| Muted | `#566B75` | Secondary text that still meets contrast on Canvas |
| Border | `#DCE5E2` | Dividers, field borders and quiet structure |
| Mint | `#BFE9DF` | One identity field, selected state or relationship moment |
| Youth Yellow | `#F2CA52` | Rare new/current micro-signal |
| Info Blue | `#146FA8` | Links and informational state, never a second brand primary |
| Error | `#B42318` | Error and destructive state only |
| Success | `#2F6F5E` | Confirmed success state only |

### Distribution

- Neutral Canvas and white surfaces: about 70%
- Navy structure, type and primary actions: about 20%
- Mint identity fields and selected moments: about 8%
- Yellow micro-signals: no more than about 2%
- Info, success, error and provider colors are semantic exceptions, not decorative area targets
- Evaluate the ratio by scene and hierarchy, not as a raw pixel quota

### Contrast floor

- Navy / Canvas: `11.41:1`
- Navy / Mint: `9.09:1`
- Navy / Yellow: `7.61:1`
- Muted / Canvas: `5.32:1`
- Info / Canvas: `5.17:1`
- White / Navy: `11.98:1`

Normal text must meet `4.5:1`; large text and essential UI boundaries must meet `3:1`. Color never carries meaning alone.

## Token architecture

`assets/design-tokens.json` and `assets/design-tokens.css` are the machine-readable root tokens.

```text
primitive value → semantic role → component decision
```

- Primitive tokens contain raw values only
- Semantic tokens name purpose such as Canvas, heading, link, selected and danger
- Component tokens reference semantic tokens only; components do not jump directly to raw colors
- Application code should consume semantic or component tokens rather than hard-coded hex values
- Provider identities and established file-type colors may remain scoped exceptions when they cannot be confused with Weave brand colors

## Typography

- Display and headings: `SUITE Variable`, with system fallbacks
- UI, body and long-form reading: `SUIT Variable`, with system fallbacks
- OT01 is artwork, not live-font construction; never recreate or typeset the wordmark with SUITE or SUIT
- Body text remains at least `16px`; controls remain at least `44px`
- Korean uses `word-break: keep-all`; key display lines are authored in meaningful phrase groups and checked at 375px and 1440px
- Avoid thin weights below 400 for reading text and avoid justified paragraphs

## OT01 naming asset

### Frozen sources

| State | SHA-256 | Authorized surface |
| --- | --- | --- |
| Primary | `b23955c97eec89882800b786e13f48f4761f6ca426736b4b6992b460cd6007f3` | Canvas or white |
| Reverse | `1c15b434ac20d9c3dd98de7325166cc24b6d5e169e38d548d7f44616c06fb2bc` | Navy `#143957` |
| Monochrome | `76a14d8a6f9cd639b128ae450fffc6b48baa2011c03c619e8f3707094459ec6b` | Canvas or white |

### Usage

- Use the complete exact asset with proportional scaling
- Primary, reverse and mono masters require at least `56px` displayed height
- A supplied responsive micro asset is required at `24–55px`; do not crop a master
- Clear space on every side is at least one quarter of displayed logo height
- Never place primary OT01 on mint, detach the crest, crop the W, isolate a letter or use any part as a symbol or app icon
- Never recolor, redraw, stretch, rotate, mask, outline, shadow or add a gradient
- The official youth mark and OT01 may share a composition only as clearly separated product identity and institutional endorsement; never fuse them into one logo
- Replacing public assets is an application-owner integration action and does not alter the frozen sources

## Imagery and record graphics

Actual activity photography, documented materials, people and places take priority. Respect rights, visibility and reserved image dimensions.

An existing orbit, circle or gradient treatment is retained only when it directly explains at least one of these:

- a relationship among people, records, materials or places
- passage of time, sequence or progress
- a selected state, route transition or spatial connection
- the singular OT01 mint wave in an authorized brand setting

Replace it when it is wallpaper, repeats without new meaning, competes with content, resembles an unsupported logo, lowers readability, or substitutes for available real imagery. When photography is unavailable, use a restrained record graphic based on actual metadata, labels, timestamps, lines or frames. Replacement is evidence-led, not a blanket removal of circles or gradients.

## Product experience principles

- Preserve the core journey `interest → activity → material or outcome → question or next action`
- Preserve public, authenticated member and operator boundaries
- Keep `관심 주제` separate from `활동 형식`
- Keep calendar discovery ordered by `지역 | 교당·주최 | 행사 내용`
- Present community participation through opinions, experiences and know-how; explain pseudonymity as the privacy method, not the product proposition
- Make discovery generous through readable metadata, visible relationships and one primary action per screen
- Do not alter rights, visibility, review, moderation, audit or account-linkage meaning for visual convenience

## Editorial authenticity

Punctuation follows the role of the text.

- Titles, navigation, tabs, buttons, labels, card titles, bullets, fragments and large display copy omit terminal periods
- Complete body sentences use normal punctuation, including a period after `~입니다.`
- A title or large display line that happens to end in `~입니다` still omits the terminal period
- Preserve meaning, facts, names, service terms and the register appropriate to each audience
- Avoid repeated translation-like phrasing, mechanical three-part lists, repeated `X: Y` headings, excessive conjunctions, quotation marks, parentheses, English pairing and bold emphasis
- Avoid abstract overclaiming, uniform sentence length and identical endings across adjacent copy
- Remove decorative micro-English that does not improve comprehension
- Do not force every fragment into a full sentence merely to normalize punctuation

This is an editorial review rule, not permission to rewrite policy, security or product meaning.

## Motion architecture

Motion expresses state, connection and time. Route transitions, shared media, filter reflow and responsive transformations should preserve spatial context. GSAP is reserved for one high-impact scroll narrative or a purposeful SVG transformation and must not animate the same DOM element as Motion.

- Micro-feedback: `150–250ms`
- Shared layout: `250–400ms`
- Prefer transform and opacity over layout-triggering animation
- Each viewport has one dominant motion idea
- `prefers-reduced-motion` removes pinning, parallax, stagger and spectacle while retaining all information and basic feedback
- No cursor trails, decorative text scrambling or autoplay motion that competes with reading

## Responsive and accessibility floor

- 375px: single-column discovery and no hover dependency
- 768px: two-column material and metadata layouts where useful
- 1440px: editorial content grid; never a dense portal dashboard
- No horizontal overflow with long Korean titles, organizer names, filenames or policy text
- Visible focus, sequential headings, labelled controls, Escape and focus return where applicable
- Loading, empty, error, retry, denied and signed-out states retain readable brand surfaces and clear next actions

## Integration boundaries

- This contract does not authorize deployment, dependency changes, Firebase changes or source-geometry edits
- Signature W keeps exact geometry and may appear only as the selective compact identifier in the approved web contexts, including the narrow mobile header at `760px` and below; it is never adjacent to full OT01 and never replaces a file, format, function, provider or workflow/status icon
- Full OT01 is the primary name-bearing asset for desktop and tablet headers, footer, About and other wide naming contexts
- The current public `weave-logo-final*` selected-kitsch assets are legacy integration inputs, not the approved OT01 source
- Production integration must verify copied OT01 bytes against the frozen hashes and preserve the official youth assets unchanged
