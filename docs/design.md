# Design: bottle green and beige

Light theme. **Bottle green** is the colour of actions and navigation, **warm beige** is the page and the cards, **violet**
is reserved for anything the AI wrote, so a reader can tell machine-written text from the system's own numbers at a glance.
All colours, spacing, type and radii are tokens in `client/src/styles/tokens.css`; components use only tokens.

## Contrast

Measured with the WCAG 2.x formula by `client/scripts/contrast.mjs` (`cd client && npm run contrast` prints this table).
`client/src/styles/contrast.test.ts` runs in `npm test` and fails if a token change drops any pair below its minimum:
4.5:1 for text, 3:1 for focus rings and control borders. The automated axe check (`npm run e2e`) covers the rendered pages.

| Text / element | On | Ratio | Needed | Used for |
|---|---|---|---|---|
| `text` #1a2620 | `bg` #f4efe4 | 13.65 | 4.5 | body text on the page |
| `text` #1a2620 | `surface` #fffdf8 | 15.39 | 4.5 | body text on cards and tables |
| `text-muted` #44524a | `surface` #fffdf8 | 8.10 | 4.5 | secondary text on cards |
| `text-muted` #44524a | `bg` #f4efe4 | 7.18 | 4.5 | secondary text on the page |
| `text-faint` #56635b | `surface` #fffdf8 | 6.20 | 4.5 | captions, table headers |
| `text-faint` #56635b | `bg` #f4efe4 | 5.50 | 4.5 | captions on the page |
| `primary` #0f5a3d | `surface` #fffdf8 | 8.10 | 4.5 | links and text buttons |
| `primary` #0f5a3d | `primary-soft` #e1eee6 | 6.89 | 4.5 | selected tab, soft badge |
| `surface` #fffdf8 | `primary` #0f5a3d | 8.10 | 4.5 | primary button label |
| `surface` #fffdf8 | `primary-hover` #0a4630 | 10.69 | 4.5 | primary button label, hovered |
| `nav-text` #cde0d4 | `nav-bg` #0e3b2c | 9.05 | 4.5 | navigation links |
| `nav-text-strong` #ffffff | `nav-active` #17583f | 8.39 | 4.5 | active navigation link |
| `nav-section` #8fb3a0 | `nav-bg` #0e3b2c | 5.43 | 4.5 | navigation section labels |
| `nav-text-strong` #ffffff | `nav-hover` #14503a | 9.38 | 4.5 | hovered navigation link |
| `on-solid` #ffffff | `ai` #5b32b8 | 8.10 | 4.5 | AI button label |
| `on-solid` #ffffff | `ai-hover` #4a2899 | 10.22 | 4.5 | AI button label, hovered |
| `danger` #b42318 | `danger-soft` #fbe8e3 | 5.56 | 4.5 | error badge and banner |
| `nav-text` #cde0d4 | `nav-active` #17583f | 6.07 | 4.5 | navigation text over the active row |
| `success` #1d6b36 | `success-soft` #e3f1e1 | 5.59 | 4.5 | success badge |
| `warning` #8a5300 | `warning-soft` #fbeccb | 5.41 | 4.5 | warning badge |
| `info` #0b6a8f | `info-soft` #dff0f4 | 5.16 | 4.5 | info badge |
| `neutral-text` #3f4b44 | `neutral-soft` #ece6d6 | 7.32 | 4.5 | neutral badge |
| `banner-warning-text` #6a4000 | `warning-soft` #fbeccb | 7.66 | 4.5 | warning banner text |
| `banner-info-text` #0a4e69 | `info-soft` #dff0f4 | 7.76 | 4.5 | info banner text |
| `banner-danger-text` #861a10 | `danger-soft` #fbe8e3 | 8.19 | 4.5 | error banner text |
| `banner-ai-text` #43268a | `ai-soft` #f1ecf9 | 9.62 | 4.5 | AI banner text |
| `hero-text` #d6e6dc | `hero-bg` #0e3b2c | 9.65 | 4.5 | login panel text |
| `chart-actual` #556259 | `surface` #fffdf8 | 6.30 | 3 | chart line: actual (non-text, 3:1) |
| `chart-baseline` #8a5300 | `surface` #fffdf8 | 6.23 | 3 | chart line: baseline (non-text, 3:1) |
| `chart-ml` #5b32b8 | `surface` #fffdf8 | 7.97 | 3 | chart line: model (non-text, 3:1) |
| `success` #1d6b36 | `surface` #fffdf8 | 6.44 | 4.5 | success text on cards |
| `danger` #b42318 | `surface` #fffdf8 | 6.47 | 4.5 | error text on cards |
| `ai` #5b32b8 | `ai-soft` #f1ecf9 | 6.98 | 4.5 | AI chip, AI explanation text |
| `ai` #5b32b8 | `surface` #fffdf8 | 7.97 | 4.5 | AI text on cards |
| `focus` #1b8a5f | `bg` #f4efe4 | 3.78 | 3 | focus ring against the page (non-text, 3:1) |
| `focus` #1b8a5f | `surface` #fffdf8 | 4.26 | 3 | focus ring against cards (non-text, 3:1) |
| `border-strong` #8f8468 | `surface` #fffdf8 | 3.64 | 3 | input and button borders (non-text, 3:1) |
| `border-strong` #8f8468 | `bg` #f4efe4 | 3.23 | 3 | input borders on the page (non-text, 3:1) |

What this does not cover: axe cannot judge text over images (there are none), and the contrast of the charts' series colours is
checked by eye, with the values also shown in the data table under each chart.

## Fonts and motion

* **No external fonts.** The stack is the system UI font (`--font-sans`); nothing is loaded from Google Fonts or any CDN, and
  the content security policy (`font-src 'self'`) would block it anyway. `e2e/csp.spec.ts` runs against the production build.
* **Animation is CSS only** (no animation library), short (under 250 ms), and switched off for people who set
  "reduce motion" in their system (`prefers-reduced-motion`).
