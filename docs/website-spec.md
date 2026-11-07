# ninearches.ai: landing page spec

**For:** whoever builds the marketing site (a developer, Codex, or a design tool fed this file).
**Owner:** the product owner of Nine Arches. They make all scope decisions; ask them before you change anything in the story, copy or structure.
**Status:** v1 spec, 2026-11-07.

This file is the whole brief. It covers the story, the art direction, the design tokens, every component, every section (layout, copy, animation, scroll behaviour) and how the page should behave on small screens, with reduced motion, and under a performance budget. Build exactly this. Where it gives you a choice, it says so.

---

## 0. Read this first

### 0.1 What Nine Arches is (one paragraph)

Nine Arches lets architects, builders and their clients test a building before it is built. You draw or trace a floor plan, fill it with simulated people, and watch them live a day in it: arriving, queuing, meeting, crowding a corridor when a bell rings, finding (or not finding) a step-free route, leaving in an evacuation. You see where the layout causes problems, and you ask **Ella**, the built-in AI, to fix them. She changes the plan in front of you and the people try it again.

### 0.2 Hard rules

1. **Any building.** The site talks about buildings in general: homes, schools, clinics, hospitals, offices, shops and malls, libraries, hotels, stations, factories, stadiums. **Never** say or imply the product is limited to particular building types, and never list "offices and malls" as the only examples together.
2. **Ella is a person-like character, not a chatbot widget.** She has her own section, appears in the hero demo, and is always named "Ella". She is never called "the assistant", "the AI", "the bot" or "Copilot". She is never pictured as a face, avatar or robot. Her mark is the Nine Arches symbol, the same one used in the product.
3. **Honesty.** No made-up customers, logos, testimonials, star ratings, user counts or percentage claims. Demo numbers are labelled "Illustrative". Where the page describes results, it says they are **estimates you check**, not predictions. When real quotes and logos exist, there is a section ready for them (§6.11). Until then it stays hidden.
4. **The bridge story is told as history plus legend.** Use the facts and wording in §1.2 exactly. Legends stay worded as legends.
5. **No stock photography.** Every image is either a pencil-style sketch (§3) or a real product screenshot or recording.
6. **One accent of motion at a time.** Animations take turns. Never run two attention-grabbing animations in the same viewport at once.

### 0.3 The feeling

An architect's sketchbook that comes to life. Warm paper, graphite lines, a little watercolour, and then, quietly, the lines start to move: a train crosses the bridge, people walk the corridors of a plan, a wall slides across when Ella suggests it. It should feel careful, crafted and calm, and quietly confident, the way the bridge is. It should not feel like a neon AI startup.

**Reference feelings (do not copy):** the restraint of an Apple product page, the hand-made warmth of a Moleskine sketch, the scroll storytelling of the best long-form journalism.

---

## 1. Story

### 1.1 The narrative arc (the page tells this, top to bottom)

1. **A promise.** Know how your building feels before it's built. *(Hero)*
2. **Where the name comes from.** A bridge in the hills of Sri Lanka, built with care for the people who'd use it, still carrying trains a century later. *(The bridge)*
3. **The problem.** Most buildings only meet their people on opening day, and by then the mistakes are concrete. *(Opening day)*
4. **The idea.** Let the people in early. Draw it, fill it, watch it, fix it. *(How it works)*
5. **Ella.** You don't need to be a simulation expert. Tell Ella what's wrong and watch her change it. *(Ella)*
6. **What you'll see.** Flow, crowding, evacuation, step-free access, light, noise, sun and shade. *(What you can see)*
7. **Any building.** From a house to a stadium. *(Any building)*
8. **On its real site.** On the real map, among its real neighbours, under the real sun. *(On site)*
9. **Who it's for.** Architects, builders, clients, all looking at the same thing. *(Who it's for)*
10. **The principle.** Careful design, skilled hands, honest numbers. *(Principles)*
11. **The invitation.** The train is leaving the station. *(Final call to action)*

### 1.2 The bridge: approved facts and wording

Use this text; it was checked against sources when the product was renamed. Keep the legend worded as a legend.

> The Nine Arches Bridge near Ella carries the hill-country railway in a tight curve high above a tea-covered valley. Completed in 1919, it was built by local workers under British engineers from concrete, stone and brick: about 91 metres long and 24 metres high, and still carrying trains more than a century later. Local legend says it was built without steel, and credits a village builder, P. K. Appuhami. Whatever the full story, the bridge shows what careful design and skilled hands can do together: a structure that works beautifully for the people who use it.

**Short forms you may use elsewhere:**
- "A bridge built with care, still carrying people after a hundred years."
- "Completed in 1919. About 91 m long, 24 m high. Nine arches. Still in service."
- "Ella" (the AI) is named after the hill town where the bridge stands. Say this once, in the Ella section (§6.5), as a small aside.

**Don't:** claim the bridge was designed by a specific named engineer, give exact construction costs, or state the no-steel story as fact.

### 1.3 Voice

- Plain English, short sentences, warm and concrete. Write the way a good architect explains a drawing to a client.
- Talk about **people**, not "agents" or "users". Say "people", "visitors", "students", "patients", "shoppers", "staff", "residents".
- Verbs over nouns: "watch people find the stairs", not "pedestrian flow visualisation".
- No hype words: avoid "revolutionary", "game-changing", "supercharge", "unlock", "seamless", "cutting-edge", "next-gen", "magic".
- British/Sri Lankan spelling: "colour", "metres", "centre", "neighbour".
- Numbers: "4 minutes", "24 m", "1919". Durations never show zero parts ("10 min", not "10 min 0 s").

---

## 2. Design tokens

Put all of these in one file (`tokens.css`) as CSS custom properties. Every value in this spec refers to a token by name. Don't introduce new raw values.

### 2.1 Colour

The page has two moods: **Paper** (default, warm daylight) and **Night** (two places only: the evacuation card inside §6.6, which switches on its own, and the final call to action, §6.12, which switches the whole page). There is **no** site-wide dark mode toggle in v1. On Night sections, swap the tokens listed in 2.1.3.

#### 2.1.1 Paper

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F7F4EE` | Page background (warm off-white sketchbook paper) |
| `--paper-2` | `#EFEAE0` | Alternate section background, card wells |
| `--paper-edge` | `#E3DCCF` | Hairlines on paper, card borders |
| `--card` | `#FFFDF9` | Raised cards, chat bubbles from Ella |
| `--graphite` | `#1E2430` | Primary text and sketch lines |
| `--graphite-2` | `#4A5263` | Secondary text |
| `--graphite-3` | `#7A8090` | Captions, annotations, disabled |
| `--pencil` | `#9AA0AC` | Light construction lines in sketches (guides, hatching) |
| `--navy` | `#082856` | Brand ink: logo wordmark, headings on hero |
| `--accent` | `#245DC6` | Links, primary buttons, Ella's highlights |
| `--accent-ink` | `#1C4BA3` | Accent pressed / hover |
| `--accent-wash` | `#E6EEFC` | Accent tint behind chips and focus areas |
| `--tea` | `#5E8C61` | Tea-hill green (landscape washes, "good" state) |
| `--tea-wash` | `#E4EEDF` | |
| `--train` | `#2F5DA8` | The train's carriage blue |
| `--train-red` | `#B8433A` | Train trim, sparingly |
| `--stone` | `#B9A68C` | Bridge stone wash |
| `--brick` | `#C27C5A` | Bridge brick wash, warm accents |
| `--sun` | `#F2B45A` | Sunlight, sun path, warm highlight |
| `--heat-1` … `--heat-5` | `#FBE3A9`, `#F6C177`, `#EE9A5A`, `#DE6B48`, `#B8433A` | Crowding heatmap, low → high |
| `--good` | `#2F7D55` | Positive change in metrics |
| `--attention` | `#B8433A` | Problem markers (same as `--train-red`) |

**Splash colours** (from the product's opening animation; used *only* in the preloader and once in the Ella section as soft blurred light): `#4F8FF0`, `#9B7CF6`, `#2FC7C0`, `#FFB38A`, `#7CC4FF`, `#F58FBF`.

#### 2.1.2 Contrast

- Body text `--graphite` on `--paper`: must be ≥ 7:1 (it is about 14:1).
- `--graphite-2` on `--paper`: ≥ 4.5:1. `--graphite-3` is only for text ≥ 14 px or non-essential captions.
- Buttons: text on `--accent` must be ≥ 4.5:1 (white on `#245DC6` passes).

##### 2.1.3 Night (two places only)

| Token | Night value |
|---|---|
| `--paper` | `#0F1626` (deep indigo night) |
| `--paper-2` | `#162036` |
| `--paper-edge` | `#26314A` |
| `--card` | `#1B2640` |
| `--graphite` | `#EEF2F8` |
| `--graphite-2` | `#B5BED0` |
| `--graphite-3` | `#8590A6` |
| `--pencil` | `#4A5773` |
| `--accent` | `#7CA7F5` |

The transition into and out of Night is a 600 ms background crossfade, triggered by the section's top crossing 60% of the viewport height (§5.3).

### 2.2 Typography

Load from Google Fonts, `display=swap`, Latin subset only.

| Role | Family | Weights | Notes |
|---|---|---|---|
| Display | **Fraunces** (variable, optical size axis) | 400, 600 | Headlines. `font-variation-settings: "opsz" 144, "SOFT" 50;` for sizes ≥ 48 px, `"opsz" 48` below. Slightly soft serif = crafted, architectural. |
| Text / UI | **Inter** (variable) | 400, 500, 600 | Body, buttons, navigation, the product UI mock-ups. `font-feature-settings: "ss01", "cv11";` Tabular numbers in metrics: `font-variant-numeric: tabular-nums`. |
| Annotation | **Caveat** | 500, 600 | Hand-written notes on sketches only (arrows, labels like "too narrow?", "1919"). Never for paragraphs, buttons or navigation. Maximum six words per annotation. |

#### Type scale (desktop ≥ 1200 px / mobile < 640 px; interpolate with `clamp()` between)

| Token | Desktop | Mobile | Line height | Letter spacing | Family / weight |
|---|---|---|---|---|---|
| `--t-hero` | 96 px | 48 px | 1.02 | −0.025em | Fraunces 400 |
| `--t-h1` | 64 px | 38 px | 1.06 | −0.02em | Fraunces 400 |
| `--t-h2` | 44 px | 30 px | 1.12 | −0.015em | Fraunces 400 |
| `--t-h3` | 26 px | 22 px | 1.25 | −0.01em | Fraunces 600 |
| `--t-lead` | 22 px | 18 px | 1.5 | −0.005em | Inter 400 |
| `--t-body` | 17 px | 16 px | 1.65 | 0 | Inter 400 |
| `--t-small` | 14 px | 14 px | 1.5 | 0 | Inter 400/500 |
| `--t-eyebrow` | 13 px | 12 px | 1.2 | 0.14em, uppercase | Inter 600 |
| `--t-caption` | 12 px | 12 px | 1.45 | 0.01em | Inter 500 |
| `--t-note` | 26 px | 22 px | 1.1 | 0 | Caveat 500 |
| `--t-metric` | 56 px | 40 px | 1 | −0.02em | Inter 600, tabular |

Example: `--t-h1: clamp(38px, 2.2rem + 2.6vw, 64px);`

**Measure:** paragraphs max **62 ch**; leads max **44 ch**; headlines max **18 ch** (use `text-wrap: balance` on headings and `text-wrap: pretty` on paragraphs).

**Emphasis in headlines:** one word or phrase per headline may be set in Fraunces *italic* (`font-style: italic; "SOFT" 100`) in `--accent` or `--navy`. Never bold inside a headline.

### 2.3 Spacing

Base unit **4 px**. Tokens:

| Token | px |
|---|---|
| `--s-1` | 4 |
| `--s-2` | 8 |
| `--s-3` | 12 |
| `--s-4` | 16 |
| `--s-5` | 24 |
| `--s-6` | 32 |
| `--s-7` | 48 |
| `--s-8` | 64 |
| `--s-9` | 96 |
| `--s-10` | 128 |
| `--s-11` | 160 |
| `--s-12` | 200 |

**Section rhythm:**
- Vertical padding of a standard section: `--s-11` (160) top and bottom on desktop; `--s-9` (96) on tablet; `--s-8` (64) on mobile.
- Eyebrow → headline: `--s-4` (16).
- Headline → lead: `--s-5` (24).
- Lead → content block: `--s-8` (64) desktop, `--s-7` (48) mobile.
- Between cards in a grid: `--s-5` (24) desktop, `--s-4` (16) mobile.
- Inside cards: `--s-6` (32) desktop, `--s-5` (24) mobile.

### 2.4 Layout grid

- **Max content width:** 1200 px. **Wide** content (sketch panoramas, the Ella demo stage): 1440 px. **Full bleed** where noted.
- **Columns:** 12 columns, 24 px gutters on desktop (≥ 1200); 8 columns, 20 px gutters on tablet (640–1199); 4 columns, 16 px gutters on mobile (< 640).
- **Side margin:** `max(24px, (100vw − 1200px) / 2)` desktop; 20 px tablet; 16 px mobile. No horizontal scrolling at any width ≥ 320 px.
- **Breakpoints:** `sm` 640, `md` 900, `lg` 1200, `xl` 1440.

### 2.5 Radius, borders, shadows

| Token | Value | Use |
|---|---|---|
| `--r-1` | 6 px | Chips, small inputs |
| `--r-2` | 10 px | Buttons |
| `--r-3` | 16 px | Cards |
| `--r-4` | 24 px | Big panels, the Ella stage, product frames |
| `--r-pill` | 999 px | Ella's message bubbles' outer corners, tags |
| `--hair` | `1px solid var(--paper-edge)` | |
| `--shadow-1` | `0 1px 2px rgb(30 36 48 / .06)` | Resting cards |
| `--shadow-2` | `0 1px 2px rgb(30 36 48 / .06), 0 12px 32px -8px rgb(30 36 48 / .14)` | Hovered cards, chat window |
| `--shadow-3` | `0 2px 4px rgb(30 36 48 / .06), 0 32px 64px -16px rgb(30 36 48 / .22)` | Product frame, the Ella stage |

Shadows are warm and soft, never black. On Night sections, multiply the alpha by 2.5.

### 2.6 Paper texture

A single tiling paper-grain texture over the whole page: a 256×256 px noise PNG (or an inline SVG `feTurbulence` filter, baseFrequency 0.9, numOctaves 2), at **4% opacity**, `mix-blend-mode: multiply`, on a `position: fixed; inset: 0; pointer-events: none; z-index: 1` layer. It must not scroll (it's the paper, not the drawing). Disable it on Night sections (`opacity: 0` with a 600 ms transition).

### 2.7 Motion tokens

| Token | Value |
|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` (most UI) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` (things travelling: the train, walls sliding) |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` (small pops: chips, check marks; max overshoot 6%) |
| `--d-1` | 120 ms (hover, press) |
| `--d-2` | 240 ms (small reveals) |
| `--d-3` | 480 ms (section reveals) |
| `--d-4` | 900 ms (sketch line draws per stroke group) |
| `--d-5` | 1600 ms (big story moments) |

**Default reveal** (used everywhere unless a section says otherwise): element starts `opacity: 0; transform: translateY(16px)`, ends at `opacity: 1; transform: none`, `--d-3`, `--ease-out`. It triggers when the element's top passes 85% of the viewport height, and runs once (no reverse on scroll up). Siblings stagger by 60 ms, maximum 6 staggered items. After that, the rest appear together.

---

## 3. Art direction: the sketchbook

### 3.1 The sketch style

Everything illustrated looks drawn with a **0.5 mm graphite pencil on warm paper**, with occasional **flat watercolour washes**. Think of a site sketch an architect makes on the train to Ella.

- **Line:** `stroke: var(--graphite)`, `stroke-width: 1.5` at 1× (scale with viewBox), `stroke-linecap: round`, `stroke-linejoin: round`. Slight wobble: generate lines with **Rough.js** (`roughness: 0.6`, `bowing: 0.8`, seeded so the drawing is identical on every load), or hand-draw in a vector tool and export SVG paths.
- **Construction lines:** `stroke: var(--pencil)`, `stroke-width: 0.75`, overshooting corners by 6–12 px, as in real architectural sketching. Use them on plans and the bridge's elevation.
- **Hatching:** 45° parallel lines, 6 px apart, `--pencil`, for shadow and cut stone.
- **Washes:** flat fills at 35–55% opacity with a soft irregular edge (an SVG mask with a turbulence-displaced edge, displacement scale 6). Colours: `--tea` and `--tea-wash` for hills, `--stone` and `--brick` for the bridge, `--sky` tint (use `--accent-wash`) for sky, `--sun` for light.
- **Annotations:** Caveat in `--graphite-2`, with a hand-drawn arrow (a Rough.js curve plus a 2-stroke arrowhead). Examples: "9 arches", "24 m", "1919", "the bell rings here", "too narrow?", "2nd stair".
- **People in sketches:** simple filled circles (head) on a short tapered line (body), 6–10 px tall at 1×, in `--graphite`. In plan views they become **dots** (radius 3.5 px) coloured by state, just like the product.

### 3.2 Drawing-on animation (used everywhere)

Sketches don't fade in; they are **drawn**.
- Each SVG path gets `pathLength="1"`, `stroke-dasharray: 1`, `stroke-dashoffset: 1` and animates to `0`.
- Order: construction lines first (fast, 400 ms), then main outlines (`--d-4` per group), then hatching (300 ms), then washes fade in (opacity 0 → target over 700 ms, starting 200 ms before outlines finish), then annotations write on (Caveat text revealed with a left-to-right `clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)` over 500 ms, arrow drawn after).
- Within a group, stagger strokes by 40 ms, sorted left to right.
- Scroll-linked drawings (the bridge, §6.2) tie `stroke-dashoffset` to scroll progress instead of time.

### 3.3 The key illustrations (assets to produce)

All SVG, optimised (SVGO), grouped with ids that match the animation steps. Sizes are the viewBox.

| ID | Subject | viewBox | Notes |
|---|---|---|---|
| `ill-hero-valley` | Panorama: tea-covered hills, the Nine Arches Bridge curving across the valley at about the middle third, mist in the low valley, a few trees, distant hills in lighter pencil | 2880×1200 | Five depth layers as separate `<g>`s for parallax: `sky`, `far-hills`, `mid-hills`, `bridge`, `near-tea`. The bridge sits on a gentle curve, nine arches clearly countable. |
| `ill-train` | The train in side elevation: a locomotive and 4 carriages in `--train` blue with `--train-red` trim, windows as small rectangles, a soft smoke/steam puff set (3 shapes) | 1400×160 | Separate `<g>` per carriage so they can follow a curved path with small rotations. |
| `ill-bridge-elevation` | Straight-on elevation of the bridge: the nine arches, piers, deck, rail, stone/brick texture lines | 2400×700 | For the scroll-built story (§6.2). Groups: `ground`, `scaffold` (timber centring under each arch), `pier-1..10`, `arch-1..9`, `deck`, `rail`, `annotations`. |
| `ill-plan-school` | Floor plan for the Ella demo (§6.5): a small two-floor school block (see the exact layout in §6.5.3) | 1200×800 | Walls as thick strokes (4 px), doors as quarter-arcs, stair as hatched rectangle, room labels in Inter 12 px caps. |
| `ill-buildings-*` | 10 small sketches for "Any building" (§6.7): house, school, clinic, hospital, office tower, shopping street / mall, library, hotel, railway station, stadium | 480×360 each | Same pencil style, each with 1 wash colour. |
| `ill-site-map` | Pencil rendition of a city block seen from above, streets, neighbouring footprints, north arrow, a sun-path arc | 1600×1000 | For §6.8. |
| `ill-hands` | Two hands over a drawing: one holding a pencil, one pointing (simple line art) | 900×600 | Optional, for "Who it's for" (§6.9). |

### 3.4 Photography and product imagery

- **Product shots:** real screenshots or screen recordings of the Nine Arches app, at 2× density, framed in the **product frame** component (§4.8). Use the light theme for product shots on Paper sections and the dark theme on Night sections.
- **No photos of the bridge.** The bridge only appears as a sketch, which keeps the site cohesive and avoids image-rights questions.

---

## 4. Components

Each component lists its anatomy, sizes, states and motion. Build them once and reuse.

### 4.1 Navigation bar

- **Position:** `position: fixed; top: 0; left: 0; right: 0; z-index: 50`.
- **Height:** 72 px at the top of the page; it shrinks to 60 px once the page has scrolled 80 px (transition `--d-2`).
- **Background:** transparent at the very top (over the hero sky); after 80 px of scroll it becomes `color-mix(in srgb, var(--paper) 82%, transparent)` with `backdrop-filter: saturate(1.4) blur(14px)` and a bottom `--hair`. Crossfade `--d-2`.
- **Inner:** max width 1200, side margin as §2.4. Flex, `align-items: center`, `justify-content: space-between`.
- **Left:** the Nine Arches logo (symbol + wordmark), height 28 px (24 px when shrunk). It links to top.
- **Centre** (≥ 900 px): links `Story` · `How it works` · `Ella` · `Any building` · `On site`. Inter 15 px/500, `--graphite-2`, gap `--s-6`. Hover: colour `--graphite`, and a hand-drawn underline draws under the word (a Rough.js line, 2 px, `--accent`, drawn left to right over 220 ms; erased right to left on leave over 160 ms). The link for the section in view shows the underline permanently (scroll-spy with IntersectionObserver, threshold 0.5).
- **Right:** secondary button "Talk to us" (ghost) and primary button "Try Nine Arches" (§4.2), gap `--s-3`.
- **Mobile (< 900 px):** logo left; right side shows the primary button (compact, 40 px tall) and a menu button (44×44, two pencil lines that morph into an × over 240 ms). The menu opens a full-screen sheet on `--paper` with links at `--t-h2` in Fraunces, stacked with `--s-5` gaps, each sliding in from 12 px below with 50 ms stagger, plus both buttons at the bottom. Close with ×, Escape, or any link.
- **Hide on scroll down / show on scroll up:** after the hero, the nav slides up out of view (`translateY(-100%)`, `--d-2`) when the user scrolls down more than 8 px, and slides back when they scroll up by 8 px. It is always visible while the mobile menu is open, and while focus is inside it.

### 4.2 Buttons

| Variant | Height | Padding X | Font | Background | Text | Border |
|---|---|---|---|---|---|---|
| Primary (L) | 52 px | 24 px | Inter 16/600 | `--accent` | white | none |
| Primary (M) | 44 px | 20 px | Inter 15/600 | `--accent` | white | none |
| Ghost (M) | 44 px | 18 px | Inter 15/500 | transparent | `--graphite` | `1px solid color-mix(in srgb, var(--graphite) 22%, transparent)` |
| Text link | auto | 0 | Inter inherits/500 | none | `--accent` | none; underline offset 4 px, thickness 1 px; on hover thickness 2 px |

- Radius `--r-2`. Icon (optional) 18 px, gap 8 px; a trailing arrow "→" moves 3 px right on hover (`--d-1`).
- Primary: inner highlight `inset 0 1px 0 rgb(255 255 255 / .18)`, shadow `0 1px 2px rgb(36 93 198 / .25), 0 6px 16px -6px rgb(36 93 198 / .45)`. Hover: background `--accent-ink`, lift `translateY(-1px)`, shadow grows 20%. Press: `translateY(0)`, scale .985. Focus-visible: `0 0 0 3px var(--paper), 0 0 0 5px var(--accent)`.
- Ghost hover: background `color-mix(in srgb, var(--graphite) 5%, transparent)`.
- **The pencil underline accent (Primary L only):** on hover, a hand-drawn squiggle (Rough.js, `--sun`, 2 px) draws under the button, 6 px below its bottom edge, over 300 ms, and erases on leave. This is the site's one playful button flourish; use it only on the hero and final call to action buttons.

### 4.3 Eyebrow + headline + lead (section header)

- Eyebrow: `--t-eyebrow`, `--accent`, preceded by a 24 px hand-drawn dash (Rough.js line) with an 8 px gap.
- Headline: `--t-h1` or `--t-h2` as specified per section, `--graphite`, one optional italic accent phrase.
- Lead: `--t-lead`, `--graphite-2`, max 44 ch.
- Alignment: left by default; centred where the section says so.
- Motion: default reveal (§2.7), with the eyebrow, headline and lead staggered by 80 ms. The eyebrow dash draws (200 ms) as the eyebrow appears.

### 4.4 Cards

- Background `--card`, border `--hair`, radius `--r-3`, padding `--s-6`, `--shadow-1`.
- Hover (interactive cards only): `translateY(-3px)`, `--shadow-2`, border colour `color-mix(in srgb, var(--graphite) 14%, transparent)`, `--d-2 --ease-out`. Sketch inside the card redraws (dashoffset 1 → 0, 600 ms) on first hover only.
- Card title `--t-h3`; body `--t-body` in `--graphite-2`; 12 px gap.

### 4.5 Chips / tags

- Height 28 px, padding 0 12 px, radius `--r-pill`, Inter 13/500.
- Neutral: background `--paper-2`, text `--graphite-2`. Accent: background `--accent-wash`, text `--accent-ink`. Good: `--tea-wash` / `--good`. Attention: `#F6E1DD` / `--attention`.
- "Illustrative" tag (used on every demo with numbers): neutral chip with a small pencil icon, `title="Numbers in this demo are illustrative"`.

### 4.6 Ella chat components

Used in the hero mini-demo (§6.1) and the Ella stage (§6.5). They look like the product's chat, warmed up for the site.

**Chat window**
- Width 380 px (desktop), full width minus 32 px (mobile). Radius `--r-4`. Background `--card`. `--shadow-3`. Border `--hair`.
- **Title bar:** 52 px tall, padding 0 16 px; the Nine Arches symbol (20 px) + "Ella" (Inter 15/600) + a status dot (8 px, `--tea`) with "here to help" (Inter 12, `--graphite-3`). Right: a non-functional "dock" icon in `--graphite-3`.
- **Body:** padding 16 px, gap 12 px between messages, max height 420 px; it scrolls internally when long, with a 24 px fade mask at the top.
- **Composer:** 56 px, top `--hair`, a pill input (radius `--r-pill`, background `--paper-2`, placeholder "Ask Ella to change something…", Inter 14) and a 36 px round send button in `--accent` with an up-arrow.

**Message bubbles**
- **You (the user):** aligned right, background `--accent`, white text, Inter 15/1.5, padding 10 px 14 px, radius 18 px with the bottom-right corner 6 px, max width 85%.
- **Ella:** aligned left, background `--paper-2`, text `--graphite`, same type and padding, radius 18 px with the bottom-left corner 6 px, max width 90%. Preceded (first message in a run) by a 20 px Ella symbol sitting 4 px left of the bubble's bottom.
- **Ella's change summary:** a card inside her message, background `--card`, border `--hair`, radius 12 px, padding 12 px. A list of changes, each row 28 px: a 16 px icon in `--accent` (wall, door, stair, toilet, plus, minus), a label in Inter 14 ("Added a second stair by the west classrooms"), and, on hover, the matching element in the plan pulses (§6.5.4). At the bottom, two small buttons: "Apply" (primary M, 36 px tall) and "Undo" (ghost, 36 px tall).

**Ella is thinking**
- Replaces her bubble while she works. Her 22 px symbol slowly "breathes" (scale 1 → 1.06 → 1, 1.6 s loop, `--ease-in-out`), its three faces shift through the brand blues (a hue rotate of 0 → 20° → 0), and to its right a line of shimmer text cycles through steps: "Reading the plan" → "Watching the bell at 10:30" → "Trying a second stair" → "Checking step-free routes". Each step shows for 900 ms; the text has a moving highlight (a background-clip text gradient sweeping left to right, 1.4 s loop). After the first step, three 4 px dots pulse after it in sequence (opacity .3 → 1, 140 ms offsets).

**Typing animation (for the scripted demos)**
- User messages "type" into the composer at 32 ms per character, with ±12 ms random jitter (seeded) and a 180 ms pause after commas and full stops. The send button pulses once (scale 1 → .92 → 1, 160 ms) and the message flies from the composer into the chat: it translates up 24 px and scales .96 → 1 over 280 ms `--ease-out`.
- Ella's messages stream in word by word: 28 ms per word, each word fading from opacity 0 to 1 over 120 ms.

### 4.7 Metric tile

- For before/after numbers in demos. Label (`--t-caption`, uppercase, `--graphite-3`), value (`--t-metric`, tabular), unit (Inter 18/500, `--graphite-2`), a delta chip (Good or Attention).
- **Number change animation:** counts from old to new over 900 ms `--ease-out`, using tabular numerals so the width doesn't jitter. Durations count in whole seconds and display like "4 min 10 s" → "1 min 50 s".
- Always paired with an "Illustrative" chip in the demo.

### 4.8 Product frame

- For real screenshots and recordings. Radius `--r-4`, `--shadow-3`, a 1 px inner border `rgb(30 36 48 / .08)`, and a 36 px tall window bar in `--paper-2` with three 10 px dots in `--paper-edge` (not traffic-light colours) and the page title "Nine Arches" centred in Inter 12 `--graphite-3`.
- Video: `muted autoplay loop playsinline`, poster frame required, loads only when within 1.5 viewports of view; it plays only while visible (IntersectionObserver) and pauses when off screen.

### 4.9 Plan player (the animated floor plan engine for the site)

A small, self-contained SVG/Canvas component that the hero, "How it works" and the Ella stage all reuse. It is **not** the real simulation; it plays pre-recorded paths so it is light and deterministic.

- **Input:** a plan SVG (walls, doors, stairs, rooms with ids), a JSON of people tracks (`[{id, kind, points: [[t, x, y, floor], …]}]`, sampled at 2 Hz and interpolated), an optional heat grid per time step, and a list of plan edits keyed by time (`{t, op: "add"|"remove"|"move", targetId, to}`).
- **Rendering:** walls in the sketch style; people as 3.5 px dots with a 1.5 px `--paper` ring, coloured by state (walking `--accent`, waiting `--sun`, at a desk / seated `--graphite-2`, in trouble `--attention`); a short 6-frame fading trail behind walking dots (opacity .25 → 0).
- **Heat:** a grid of 1 m cells drawn as soft rounded squares in `--heat-1..5`, with a 6 px blur filter, at 70% opacity, blended `multiply`; the grid crossfades over 400 ms when it changes.
- **Edits:** a wall being added draws on as a pencil line (500 ms) and then thickens to a wall (200 ms); a wall being removed is crossed out with two quick pencil strokes (180 ms each) and then fades out (300 ms); a door swings open as its arc draws (300 ms); a moved wall slides with `--ease-in-out` over 700 ms, and nearby dots reroute smoothly.
- **Performance:** at most 400 dots on desktop and 150 on mobile (drop every other track on mobile). Use canvas for the dots and heat; SVG for walls and labels. Run at 60 fps on a 2020 laptop. Pause when off screen.

### 4.10 Footer

- Background `--paper-2`, top `--hair`, padding `--s-9` top, `--s-7` bottom.
- Grid: 4 columns on desktop (logo + one-line description + small bridge sketch 160×48; Product; Company; Legal), 2 on tablet, 1 on mobile.
- Column title `--t-eyebrow` `--graphite-3`; links Inter 15 `--graphite-2`, 12 px apart, hover `--graphite` with the pencil underline.
- **Bottom row:** "© 2026 Nine Arches" · "Named for a bridge near Ella, Sri Lanka" · the domain ninearches.ai. Inter 13 `--graphite-3`.
- **Easter egg:** hovering the small footer bridge sketch sends a tiny train across it (1.8 s), at most once per 10 s.

---

## 5. Global behaviour

### 5.1 Smooth scrolling

Use **Lenis** (`lerp: 0.1`, `wheelMultiplier: 1`, `smoothTouch: false`) for smooth wheel scrolling on desktop, synced with GSAP ScrollTrigger (`lenis.on('scroll', ScrollTrigger.update)`). Native scrolling on touch devices. Disabled when `prefers-reduced-motion: reduce`.

### 5.2 Scroll animation engine

**GSAP 3 + ScrollTrigger** for all scroll-linked animation. Rules:
- `scrub: 0.6` for scroll-linked drawings (a little smoothing, never laggy).
- Pinned sections use `pin: true, anticipatePin: 1`. Pinned scroll length is specified per section, in viewport heights (vh).
- Every timeline is built inside `gsap.matchMedia()` with separate desktop, mobile and reduced-motion branches.
- No scroll-jacking that stops the user scrolling. Pins always progress with the scroll and never trap it.

### 5.3 Night transitions

When a Night section's top crosses 60% of the viewport, add `data-mood="night"` to `<body>`. The token swap (§2.1.3) animates through `transition: background-color 600ms, color 600ms` on the elements that use those tokens. Remove it when the section's bottom goes above 40%.

### 5.4 Cursor

Default system cursor. Over sketches that react to the cursor (the hero, §6.1), there's no custom cursor; the reaction happens in the drawing. **No custom cursor dots or blobs anywhere.**

### 5.5 Section anchors and progress

- Each major section has an id matching the nav (`#story`, `#how`, `#ella`, `#buildings`, `#site`).
- **Railway progress line:** on desktop ≥ 1200 px, a thin vertical "track" runs on the far left at `left: 24px`, from 120 px below the top of the viewport to 120 px above the bottom. It's two parallel 1 px lines, 6 px apart, in `--pencil`, with sleepers (4 px ticks) every 24 px. A small train icon (14×28 px, `--train`) moves down it as the page scrolls (position = scroll progress), and small station dots mark each section. Hovering a dot shows the section name in a tooltip; clicking it scrolls there. The line is hidden in the hero (fades in after the hero leaves) and on Night sections it turns `--accent` at 40% opacity.

---

## 6. Sections, in order

Each section lists: **Purpose · Layout · Copy · Visuals · Motion · Scroll · Mobile · Reduced motion.**

---

### 6.0 Preloader (only on a first visit in the session)

**Purpose:** the brand moment, and a cover while fonts and the hero SVG load.

- **Layout:** a full-screen `--paper` (white `#FFFFFF` is acceptable here to match the product's opening screen) layer, `position: fixed; z-index: 100`. The logo sits centred: the symbol 72 px tall, the wordmark 28 px tall beneath it with a 16 px gap.
- **Animation:** the product's "controlled explosion".
  1. 0–600 ms: six blurred colour blobs (the splash colours, each 220–320 px, `filter: blur(48px)`, opacity .55) bloom from the centre outwards to random-but-seeded positions within a 360 px radius, scaling 0.2 → 1, `--ease-out`.
  2. 200–900 ms: two thin rings (1 px, `--accent` at 30%) expand from 0 to 260 px and 420 px and fade out. Fourteen 3 px sparks fly 80–200 px outward and fade.
  3. 400–1100 ms: the logo's three faces assemble: the left face slides in from −12 px x, the top from −12 px y, the right from +12 px x, each fading in, staggered 90 ms, `--ease-spring`.
  4. 1100–1500 ms: the wordmark reveals left to right (`clip-path`), followed by a soft shimmer line passing across it once.
  5. Exit (after at least 1900 ms and once the hero assets are ready, with a hard cap of 3500 ms): the layer fades to opacity 0, blurs 8 px and scales to 1.04 over 600 ms. The blobs keep drifting outward as it fades, so the colour seems to settle into the hero's sky.
- **Repeat visits** in the same session (sessionStorage flag): no preloader.
- **Reduced motion:** the logo is shown still for 400 ms, then fades out over 200 ms.

---

### 6.1 Hero: "Know how your building feels before it's built."

**Purpose:** say what it is in one look, set the art direction, and show Ella in action within 10 seconds.

**Layout (desktop ≥ 1200):**
- Full viewport height (`min-height: 100svh`, minimum 760 px), full bleed.
- **Background:** the `ill-hero-valley` panorama fills the bottom 62% of the hero, anchored to the bottom, `width: 100vw`, cropped at the sides as needed (the bridge must always be visible: keep it in the centre 60% of the width). The sky above it is `--paper` with a very faint wash of `--accent-wash` at the top fading to transparent at 40%.
- **Text block:** left column (columns 1–6), top padding 168 px (below the 72 px nav).
  - Eyebrow: "Building simulation, with Ella".
  - Headline (`--t-hero`, 3 lines max, `--navy`): "Know how your building *feels* before it's built." ("feels" in Fraunces italic, `--accent`.)
  - Lead (`--t-lead`, 24 px below, max 40 ch): "Draw a floor plan, fill it with people, and watch them live a day in it. When something doesn't work, tell Ella. She'll change the plan while you watch."
  - Buttons (40 px below): Primary L "Try Nine Arches →" + Ghost M "Watch Ella work" (smooth-scrolls to `#ella`). Gap 12 px.
  - Under the buttons (20 px): a caption in `--t-caption` `--graphite-3`: "For architects, builders and the people they build for."
- **Right column (7–12): the hero mini-demo.** A small chat window (§4.6, width 360 px) overlapping a sketched floor plan card (a 520×360 card, rotated −1.5°, like a sheet of paper on a desk, with a 2 px pencil border and a slight `--shadow-2`). The chat window overlaps the plan's bottom-right corner by 80 px, rotated +1°.

**The mini-demo loop (≈ 14 s, plays once on load, then loops while in view):**
1. 0.0 s: the plan (a small library reading room with one narrow entrance) draws on (§3.2, 1.2 s total). 40 people dots appear at the entrance one by one (30 ms apart) and stream in.
2. 2.0 s: the dots bunch at the narrow entrance; a heat patch grows there (`--heat-3` → `--heat-5` over 800 ms). A Caveat annotation writes on beside it: "queue at the door".
3. 3.4 s: in the chat, the user message types: "People queue at the entrance. Can you widen it?"
4. 5.4 s: Ella thinking (1.4 s, two steps: "Watching the entrance" → "Trying a wider door").
5. 6.8 s: Ella streams: "Done. I widened the entrance to 1.8 m and moved the returns desk out of the way." A change card with two rows (door icon "Entrance 0.9 m → 1.8 m"; move icon "Returns desk moved 2 m east").
6. 7.6 s: in the plan, the entrance's door arc redraws wider (500 ms) and the desk slides east (700 ms `--ease-in-out`). The dots flow through freely; the heat patch fades `--heat-5` → `--heat-1` over 1.2 s; the annotation is crossed out with one pencil stroke and a new one writes: "flows now".
7. 9.5 s: a tiny metric strip slides up under the plan card (32 px tall): "Wait at the door 1 min 40 s → 10 s" with a Good delta chip and an "Illustrative" chip.
8. 12.5 s: everything fades to the start state over 800 ms and the loop restarts. Only the plan's dots and heat reset; the drawing stays drawn.

**The train:** the hero's signature moment. A train (`ill-train`) crosses the bridge.
- **On load:** after the preloader exits, the hero valley draws on in layers over 1.6 s (far hills → mid hills → bridge → near tea). Then the train enters from the left edge of the bridge and crosses it over 7 s `linear`, following an SVG motion path along the bridge deck (GSAP MotionPathPlugin, `autoRotate: true`). Each carriage follows the same path with an offset, so it bends naturally around the curve. A small steam puff trail (three circles that scale 0.6 → 1.4 and fade, every 600 ms) rises from the locomotive.
- **On scroll:** the train's progress across the bridge is then **tied to scroll** for the hero's height (scrub 0.6). Scrolling down pushes it onward and off to the right; scrolling back brings it back. The handover from the timed crossing to the scroll-linked one is seamless: the scroll timeline starts from wherever the timed animation got to.
- **Parallax** (scroll-linked, across the hero's height): `far-hills` moves at 0.15× scroll, `mid-hills` 0.3×, `bridge` 0.45×, `near-tea` 0.7×. The text block moves up at 1× and fades to 0 between 40% and 80% of the hero's height scrolled.
- **Pointer reaction (desktop, fine pointers only):** moving the pointer shifts the landscape layers horizontally by up to ±8 px (far) to ±20 px (near), eased with a lerp of 0.08 per frame. No vertical movement. Disabled while the user is scrolling.

**Mobile (< 900 px):**
- Order: text block (centred, top padding 112 px) → mini-demo (plan card full width minus 32 px, no rotation; the chat window below it, overlapping it by 40 px) → the valley at the bottom (height 46vh, the bridge centred).
- The train crosses on load (6 s) but isn't scroll-linked. No pointer parallax.

**Reduced motion:** the valley and plan appear fully drawn; the train is parked in the middle of the bridge; the mini-demo shows its final "after" state with the chat already complete, plus a "Replay" text button that plays it once if the user asks.

---

### 6.2 The bridge (id `story`): "Built with care. Still carrying people."

**Purpose:** the origin of the name, and the brand's values, told through the bridge being drawn as you scroll.

**Layout:** a pinned scrollytelling section. Desktop scroll length: **300vh** (pinned for 300vh, then released).
- The stage is the full viewport. The `ill-bridge-elevation` drawing sits in the lower 55%, full bleed, centred.
- A text column sits top-left (columns 1–5, top 120 px): eyebrow "Why Nine Arches", then a sequence of four short "chapters" that replace each other in the same place (crossfade 300 ms plus a 12 px upward drift).

**Scroll timeline (progress 0 → 1 over the pin):**

| Progress | Drawing | Text chapter | Annotation (Caveat) |
|---|---|---|---|
| 0.00–0.10 | Ground line and valley contour draw on | **Chapter 1:** headline `--t-h2`: "In the hills near Ella, a railway needed to cross a valley." Body: "The line curves high above the tea, where a bridge would have to be strong, beautiful and right for the people riding over it." | "the valley" |
| 0.10–0.35 | Timber scaffolding (centring) draws under each arch position, left to right; then the 10 piers rise (each pier's outline draws bottom-up, 0.02 progress each) | **Chapter 2:** "Completed in 1919, it was built by local workers under British engineers, from concrete, stone and brick." | "stone + brick" with an arrow to a pier; "1919" by the first pier |
| 0.35–0.65 | The nine arches draw one by one, left to right (each arch: construction arc in `--pencil`, then the stone line in `--graphite`, then hatching); a counter in the corner ticks 1 → 9 in Caveat | **Chapter 3:** "Local legend says it was built without steel, and credits a village builder, P. K. Appuhami." Small note under it in `--t-caption`: "Told in Ella as a legend; the full history is debated." | "no steel?" with a question mark; a "9" circled when the ninth arch completes |
| 0.65–0.80 | The deck and rail draw across; the scaffolding fades out (opacity 1 → 0); stone and brick washes fade in | **Chapter 4:** "About 91 metres long and 24 metres high, it's still carrying trains more than a century later." | "91 m" dimension line with ticks across the whole bridge; "24 m" vertical dimension line at one pier |
| 0.80–1.00 | The train (`ill-train`, scaled to fit the elevation) enters from the left and runs across the deck, tied to scroll | **Closing line**, set larger (`--t-h2`, italic accent): "Careful design and skilled hands, for the people who use it. *That's what we're building for.*" | none |

- **After the pin releases,** a short paragraph block (centred, max 62 ch, 96 px below) states the link plainly: "Nine Arches tests a building with the people who will use it, before it's built, so it can work as well on opening day as that bridge still does today."

**Mobile:** no pin. The drawing is split into four stacked panels (one per chapter), each about 70vh tall, with the drawing portion drawing on as it enters (time-based, 1.2 s) and the chapter text below it. The train runs across the final panel when it enters.

**Reduced motion:** a static, fully drawn elevation with the four chapters as a simple vertical list beside it (desktop) or below it (mobile).

---

### 6.3 Opening day: "Most buildings meet their people on opening day."

**Purpose:** the problem, felt rather than explained.

**Layout:** standard section, `--paper-2` background. A centred section header, then a three-panel horizontal "film strip" of sketches.
- Header (centred): eyebrow "The problem"; headline `--t-h1`: "Most buildings meet their people on *opening day*."; lead: "By then, the corridor that jams at the bell, the toilet nobody can reach without steps, the exit everyone walks past… they're built in concrete. Fixing them costs months, money, or both."
- **Film strip:** three cards in a row (each 4 columns wide, aspect 4:3), sketches with a red pencil problem marker:
  1. **"The bell rings."** A school corridor sketch; dots pour out of classrooms into a corridor that's too narrow; a red-circled bottleneck at the stair. Caption: "Corridors that jam at break time."
  2. **"Which way out?"** A floor plan with an exit arrow ignored: dots walking the long way to the main entrance while a side exit sits unused. Caption: "Exits people don't find."
  3. **"Step-free?"** A clinic entrance with two steps and no ramp; a wheelchair symbol with a dashed route that dead-ends. Caption: "Routes that stop at a step."
- Each card: the sketch draws on as it enters (stagger 200 ms between cards). Then the problem marker draws: a hand-drawn red circle (Rough.js ellipse, `--attention`, 2 px) around the problem, taking 400 ms, followed by a Caveat note ("too narrow", "nobody goes here", "2 steps").
- **Scroll effect:** as the section scrolls through the viewport, the three cards translate horizontally in opposite directions a little (card 1: −24 px → 0, card 3: +24 px → 0) for depth (scrub).

**Mobile:** cards stack vertically, full width, 16 px apart; same draw-on effect per card.

---

### 6.4 How it works (id `how`): "Let the people in early."

**Purpose:** the four-step method, shown on one plan that evolves.

**Layout:** pinned on desktop, scroll length **400vh**. Left column (columns 1–5): a vertical list of 4 steps. Right column (6–12): one large plan player (§4.9) inside a product-style frame (§4.8), 680×520.

**The four steps** (each: a number in Caveat 40 px `--accent`, a title `--t-h3`, body `--t-body`):
1. **Draw it, or trace it.** "Sketch walls on a blank page, trace a photo or PDF of an existing plan, or import a CAD drawing. Or just describe it to Ella."
2. **Fill it with people.** "Say who uses the building and when: staff, students, patients, visitors, residents. Each one is a little different: walking speed, how well they know the place, how much crowding they'll put up with."
3. **Watch a day happen.** "Press play. People arrive, move, wait, meet and leave. Heatmaps show where they crowd, how long they wait, and where it's loud, dim or glary."
4. **Fix it, and try again.** "Move a wall, add a door, or ask Ella. Run the day again and compare before and after, side by side."

**Behaviour:** the active step is at full opacity with an `--accent` 3 px bar on its left (height animates to the step's height over 300 ms); the others are at 40% opacity. Clicking a step scrolls to its point in the pin.

**Plan player per step (progress quarters):**
1. **0.00–0.25:** the blank frame shows a pencil cursor drawing walls (a scripted path, the walls drawing on in sequence), then door arcs, then room labels typing in. In the frame's corner, a "Trace a plan image" chip lights up briefly to hint at tracing.
2. **0.25–0.50:** people dots pop in at their places (`--ease-spring` scale 0 → 1, staggered 8 ms), colour-coded by kind, with a small legend chip row above the plan (Staff · Visitors · Step-free). A "120 people" counter ticks up.
3. **0.50–0.75:** time runs (a clock chip shows 08:00 → 17:00, scroll-linked). The dots move along their tracks; the heat layer builds up; a bottleneck turns red near a stair.
4. **0.75–1.00:** a wall slides, a second door draws on, and the heat cools. A split "Before | After" divider wipes across the plan from left to right (scroll-linked), showing the old heat on the left and the new on the right, with a metric tile pair below ("Longest wait 9 min → 2 min", Illustrative).

**Mobile:** no pin. Each step is a block: the text, then a 16:11 plan player clip that plays its step's animation once when 50% visible (time-based, 3 s).

---

### 6.5 Ella (id `ella`): the spotlight

**Purpose:** the heart of the page. Show that the hard parts are handled by Ella, in a live-feeling demo where chatting changes a building in real time.

#### 6.5.1 Intro block

- Background: `--paper`, with **one soft burst of the splash colours** behind the section header only: three blurred blobs (`#4F8FF0`, `#9B7CF6`, `#2FC7C0`) at 20% opacity, 480 px, `blur(80px)`, drifting very slowly (a 20 s loop each, ±30 px). It's the only colourful glow on the page, so Ella feels special.
- Header (centred): eyebrow "Meet Ella"; headline `--t-h1`: "Tell Ella what's wrong. *Watch her fix it.*"; lead: "You don't need to know how a simulation works. Describe the problem in your own words. Ella reads the plan, watches the people, proposes a change, and shows you exactly what she did, before anything is applied."
- Under the lead, a small aside in Caveat (`--t-note`, `--graphite-2`), rotated −2°, with a hand-drawn arrow pointing at the word "Ella" in the headline: "named after the town by the bridge".

#### 6.5.2 The Ella stage (layout)

- **Wide container** (max 1440 px), radius `--r-4`, background `--card`, `--shadow-3`, border `--hair`, height 720 px (desktop).
- Inside, two panes: **left** the building (plan player, about 62% width); **right** the Ella chat (about 38%, a chat window per §4.6 without its own shadow, separated by a `--hair` vertical line).
- **Above the plan:** a slim toolbar (48 px): building name "Hillside School · Block B" (Inter 14/600), floor tabs "Ground" / "First" (a segmented control, §4.5 style), a clock chip "10:28", and on the right a "2D / 3D" icon toggle (plan icon, cube icon). The 3D toggle is decorative in v1. It shows a tooltip "3D walk-through in the app".
- **Below the plan:** a metric strip (64 px) with three metric tiles in a row: "Time to clear the corridor", "Longest wait at the stair", "Step-free routes", each with its own Illustrative chip collapsed into one strip-level chip at the right.

#### 6.5.3 The demo building (exact layout for `ill-plan-school`)

A two-floor school block, 36 m × 14 m.
- **Ground floor:** entrance hall centre-south (6 m wide) with the main entrance doors (2 × 0.9 m); a corridor running east–west (1.8 m wide) along the north of four classrooms (each 8 m × 7 m) on the south side, two either side of the hall; a stair at the east end of the corridor (one stair, 1.2 m wide); toilets at the west end (one block, with **no accessible toilet**); a small staff room north of the corridor. There are **2 steps** at the main entrance and no ramp.
- **First floor:** the same corridor and four classrooms above; the only way down is the east stair.
- **Problem at 10:30 (break bell):** about 200 students leave eight classrooms at once; upstairs students all funnel to the single east stair; heat goes red at the stair head and down the corridor.

#### 6.5.4 The scripted conversation (scroll-driven on desktop)

The stage is **pinned for 500vh**. The conversation advances with scroll in five beats; each beat plays its own timed animations once its scroll threshold is passed (they don't scrub backwards mid-beat; scrolling back above a beat's threshold rewinds that beat to its start state over 300 ms). A small beat indicator (five 6 px dots, active dot 18 px wide pill in `--accent`) sits under the stage.

**Beat 1 (progress 0.00): the problem appears.**
- The plan draws on (1.2 s). The clock chip runs 10:20 → 10:30 (2 s). At 10:30 a small bell icon shakes (rotate ±12°, 3 cycles, 400 ms) beside the clock.
- 200 dots pour from the classroom doors; upstairs dots stream east to the single stair, bunching at the stair head. Heat builds to `--heat-5` there and along the corridor. A red Rough.js circle draws around the stair head, with the Caveat note "everyone, one stair".
- Metric strip: "Time to clear the corridor **6 min 20 s**", "Longest wait at the stair **3 min 40 s**", "Step-free routes **2 of 4**", each value counting up from 0 (900 ms).
- In the chat, Ella's first message (already present when the beat starts): "Hi, I'm Ella. I watched a school day in Block B. The break at 10:30 is the hard moment: everyone upstairs uses the east stair."

**Beat 2 (0.20): you ask.**
- The composer types: "The stair jams at break. Can you fix it without losing a classroom?" (typing per §4.6), sends, and the message flies in.
- Ella thinking (2.4 s; steps: "Reading the plan" → "Watching the bell at 10:30" → "Trying a second stair" → "Checking the classrooms").
- **While she thinks, the plan shows her trying things:** ghosted pencil sketches appear and disappear on the plan, like someone testing ideas: a dashed stair outline at the west end (holds 600 ms), a dashed widening of the east stair (600 ms), a dashed corridor shortcut (600 ms). Each is drawn in `--accent` at 50% opacity, 1 px dashed (4/4), and erased with a quick fade. This is the "AI is thinking with the building" moment, and the most important animation on the page.

**Beat 3 (0.40): Ella proposes, and the building changes.**
- Ella streams: "Here's what I'd do. I've put a second stair at the west end, in the space beside the toilets, and widened the east stair to 1.6 m. No classroom is lost. Want me to apply it?"
- Her change card appears with three rows, each with a "+" or "↔" icon: "Added a stair at the west end (1.4 m)", "Widened the east stair 1.2 m → 1.6 m", "Moved the cleaner's store 3 m north".
- **The plan updates live**, one change per row, in sync with each row appearing (400 ms apart): the west stair draws on (pencil outline 500 ms → hatching 300 ms → label "Stair 2" types in); the east stair's side wall slides outward (700 ms `--ease-in-out`); the store's walls slide north. Each change gets an `--accent` glow pulse (a 2 px outline at 60% opacity that scales 1 → 1.04 and fades, 700 ms) as it lands. **Proposed changes are drawn in `--accent`** (as in the product) until applied.
- Hovering a change row on desktop pulses its element in the plan again.

**Beat 4 (0.60): apply, and the people try again.**
- The "Apply" button in the change card gets a pressed state (a scale .97 press, 140 ms) as if clicked, and the accent lines turn graphite (ink drying: a 500 ms colour transition with a slight 1 px stroke thickening).
- The clock rewinds 10:30 → 10:28 with a quick reverse-blur flicker (120 ms), then runs again. The bell shakes. Dots now split between both stairs; the heat stays at `--heat-2` to `--heat-3`. The red circle at the old stair head is crossed out with two pencil strokes and a Caveat "✓ two ways down" writes on.
- Metrics count down: "Time to clear the corridor 6 min 20 s → **2 min 10 s**", "Longest wait at the stair 3 min 40 s → **35 s**", each with a Good delta chip ("−4 min 10 s", "−3 min 5 s").
- Ella: "Done. Break now clears in about 2 minutes. I'd still check the stair widths against your local fire code. These are estimates to check, not guarantees."

**Beat 5 (0.80): a second request, to show breadth.**
- The composer types: "And make the entrance step-free, with an accessible toilet."
- Shorter thinking (1.4 s: "Checking routes from the gate" → "Finding space for a toilet").
- Ella: "Added a 1:12 ramp beside the entrance steps and turned the west toilet store into an accessible toilet. Every room now has a step-free route." Change card: "Ramp at the main entrance", "Accessible toilet (west)".
- Plan: a ramp draws beside the steps (with a Caveat note "1:12"); a wheelchair-route dashed line in `--tea` traces from the entrance to every classroom on the ground floor, then to the toilet (a 1.6 s draw); the toilet's door swings and a small accessible symbol stamps in (scale .6 → 1, spring).
- Metric: "Step-free routes 2 of 4 → **4 of 4**", Good chip.
- **End state:** at 1.00, the pin releases. The stage stays in its final state as the page moves on.

**Under the stage** (64 px below), three short points in a 3-column row, each with a small sketch icon (a pencil, an eye, a hand on an undo arrow):
- **"You stay in charge."** "Ella proposes; you apply. Every change is listed and can be undone."
- **"She shows her work."** "You see what she changed on the plan, and how the people respond."
- **"She's honest about limits."** "Ella tells you what's an estimate, and what to check with an engineer or local code."

**Mobile:** no pin. The stage stacks: chat on top (full width, 440 px tall), plan below (aspect 4:3). Each beat plays automatically, in sequence, once the stage is 60% visible (total about 34 s), with the beat dots tappable to jump between beats. The beats pause when the stage leaves the viewport and resume when it returns. A "Replay" button appears at the end.

**Reduced motion:** the stage shows Beat 4's final state with the full conversation visible (no typing, no streaming, no ghost sketches), plus a "Step through" control (previous/next buttons) that switches between beat states instantly.

**Accessibility:** the chat is real HTML text (not baked into a video), in an `aria-live="off"` region (so screen readers aren't flooded during the animation), and a visually hidden summary precedes the stage: "Demo: Ella adds a second stair and a step-free entrance to a school block; break-time clearing drops from about 6 minutes to about 2 minutes (illustrative)."

---

### 6.6 What you can see: "Every way a building can work, or not."

**Purpose:** the breadth of what's simulated, shown not listed.

**Layout:** standard section. Header left-aligned: eyebrow "What you can see"; headline `--t-h2`: "Every way a building can work, *or not*."; lead: "Watch the day as it happens, then look at it through different lenses."

Below: a **bento grid** (12 columns, 3 rows, gap 24 px, row height 280 px desktop). Each tile is a card (§4.4) with a title, one sentence, and a small looping animation in the sketch style (CSS/SVG, 4–6 s loops, playing only while visible).

| Tile | Span | Title | Sentence | Loop animation |
|---|---|---|---|---|
| A | 7 cols × 2 rows | **People moving** | "Every person walks their own way, at their own pace, to the places their day takes them." | The plan player with ~120 dots on a library floor, trails visible, continuous. |
| B | 5 × 1 | **Crowding** | "See where it gets tight, and when." | A heat grid pulsing from cool to hot and back around a doorway. |
| C | 5 × 1 | **Waiting** | "Queues at lifts, counters, toilets and doors." | Dots forming a queue line at a counter, each dot shuffling forward. |
| D | 4 × 1 | **Step-free access** | "Who can get where, without a step." | A dashed `--tea` route tracing room to room; one route hits a step and turns red, then a ramp draws and it turns green. |
| E | 4 × 1 | **Light and glare** | "Where it's dim, and where the sun is in someone's eyes." | A window with a sun ray sweeping across a room; desk areas tint from dim grey to warm. |
| F | 4 × 1 | **Noise** | "Where it's loud enough to make focus hard." | Concentric sketch arcs ripple out from a busy area; nearby rooms tint. |

**Evacuation tile (full width, a Night moment):** below the grid, a full-width card (height 420 px) titled **"When the alarm sounds."** with the sentence "Watch everyone leave, see which exits they choose, and how long the last person takes." When this card is 50% in view, it switches to the Night mood (set `data-mood="night"` on the card itself, not on `<body>`; the rest of the page stays Paper): its background turns to the Night `--paper` over 600 ms, the plan inside shows dots heading to green exit signs (small glowing `#4ADE80` squares with a 12 px glow), an "Alarm" chip pulses red, and a counter "Everyone out in 3 min 40 s" (Illustrative) counts up. When it leaves view, it returns to Paper.

**Hover:** each tile lifts (§4.4) and its loop speeds up to 1.5× while hovered.

**Mobile:** a single column; tile A's aspect is 4:3; the others are 16:10.

---

### 6.7 Any building (id `buildings`): "From a house to a stadium."

**Purpose:** make it unmistakable that Nine Arches is for any type of building.

**Layout:** full-bleed section, `--paper-2`. Header centred: eyebrow "Any building"; headline `--t-h1`: "From a house to a *stadium*."; lead: "If people use it, you can test it. Homes, schools, clinics, hospitals, offices, shops, libraries, hotels, stations, factories, stadiums… draw it, fill it with the people who'll use it, and watch."

**The sketch parade:** a horizontal row of the 10 `ill-buildings-*` sketches (each on a 320×260 card with the building name in Fraunces 22 px below the sketch and a one-line "what you'd test" in `--t-small` `--graphite-2`):

| Building | What you'd test |
|---|---|
| Home | "Morning rush in a small kitchen" |
| School | "Break time on the stairs" |
| Clinic | "Waiting room at the busiest hour" |
| Hospital | "A stretcher route to theatre" |
| Office | "Lunch queues and quiet rooms" |
| Shops & malls | "Saturday crowds at the escalators" |
| Library | "Finding the way to the stacks" |
| Hotel | "Check-in at 2 pm" |
| Station | "A train arriving at a busy platform" |
| Stadium | "Everyone leaving at the final whistle" |

**Scroll behaviour (desktop):** the row is pinned for 200vh and scrolls horizontally as you scroll vertically (`x` from 0 to `−(rowWidth − viewportWidth + 2 × margin)`, scrub 0.6). As each card crosses the viewport's centre, its sketch draws on (if it hasn't already) and a few dots start walking in it (a 4 s loop, about 12 dots).
- **The train runs along the bottom** of this section as the parade scrolls: a thin pencil rail line spans the full width beneath the cards, and the train moves along it at 1.2× the cards' speed, so it overtakes them. A touch of fun that ties back to the bridge.

**Mobile:** no pin. A native horizontal scroll-snap carousel (`scroll-snap-type: x mandatory`, cards 78vw wide, 16 px gap, `scroll-padding: 16px`), with pagination dots below. Each sketch draws on when it's 60% visible.

**Reduced motion:** a static 5 × 2 grid (desktop) or a vertical list (mobile), all fully drawn.

---

### 6.8 On its real site (id `site`): "On the real map, under the real sun."

**Purpose:** show the outside view: placement among real neighbours, sun and shadow, weather.

**Layout:** two columns on desktop: left (1–5) the text; right (6–12) a visual.
- Eyebrow "On site". Headline `--t-h2`: "On the real map, under the *real sun*." Lead: "Pin your building on the map. Nine Arches brings in the streets and neighbouring buildings around it, so you can move and turn it into place, see what it replaces, and watch the shadows cross it through the day and the year."
- Three small feature rows (icon 20 px + bold label + one line):
  - **Neighbours, live.** "Move your building and the ones it would replace step aside, in real time."
  - **Sun and shade.** "The sun's real path for that place and date, with shadows from the buildings around you."
  - **Real weather.** "Typical cloud, temperature and rain for the site, from historical records."
- **Visual:** the `ill-site-map` sketch (map from above). Scroll-linked (scrub, as the section moves from 80% to 20% of the viewport):
  1. The streets and neighbouring footprints draw on.
  2. Your building's footprint (in `--accent`) slides in from off-map to its site and rotates 18° to align with the street. As it overlaps two neighbour footprints, they get crossed out with a pencil × and fade to 20%; a Caveat note: "replaced".
  3. A sun-path arc draws over the map from east to west; a small sun icon travels along it; shadows (hatched polygons) swing around each building, following the sun (computed from simple angles, not realistic data).
  4. A small chip row at the bottom-right of the visual: "Sun 07:00 → 18:00" as the sun moves; "21 March" date chip.
- A real product screenshot (Place on site screen, light theme, in a product frame, 560 px wide) overlaps the bottom-left of the sketch by 80 px, rotated −1°, to show "it's real".

**Mobile:** text, then the sketch (aspect 16:10), then the screenshot below it (no overlap).

---

### 6.9 Who it's for: "Everyone looking at the same building."

**Layout:** standard section. Header centred: eyebrow "Who it's for"; headline `--t-h2`: "Everyone looking at the *same* building."; lead: "Drawings mean different things to different people. A day of people moving through a plan means the same thing to everyone."

Three cards (4 columns each), each with a sketch at the top (240×160), a title and two lines:
- **Architects.** "Test ideas while they're still lines. Show clients why a corridor needs to be wider, not just tell them."
- **Builders and developers.** "Catch the expensive problems before they're poured. Compare options with the same people, side by side."
- **Clients and the people who'll use it.** "See your building working before you've paid for it. No training needed: press play, ask Ella."

Motion: the default reveal, and each card's sketch draws on as it enters.

`ill-hands` (optional) can sit centred between the header and the cards at 360×240, drawing on as it enters.

---

### 6.10 Principles: "Careful design, honest numbers."

**Purpose:** trust. Echo the bridge's values; set expectations about estimates.

**Layout:** a narrow centred column (max 760 px). A large Fraunces pull quote, then three principle rows separated by hand-drawn hairlines (Rough.js lines, `--pencil`).
- Pull quote (`--t-h2`, italic, `--navy`, with a large Caveat opening quote mark in `--sun` at 80 px): "A building should work beautifully for the people who use it. We'd like you to know it does, before it's built."
- Rows (each: a title in Inter 18/600 + body `--t-body` `--graphite-2`, 32 px vertical padding):
  - **Estimates you can check.** "People's behaviour, light and sound are modelled, not measured. We tell you what each number assumes, so you can check it, and we never dress estimates up as predictions."
  - **The same result every time.** "Run the same day twice and you get the same day. Change one thing, and you see exactly what that change did."
  - **Ella proposes; you decide.** "Nothing changes in your building until you apply it, and anything applied can be undone."
- Motion: the quote reveals word by word (each word fading up 8 px, 30 ms stagger) once 60% visible; the hairlines draw left to right as each row enters.

---

### 6.11 Proof (hidden in v1)

A ready-but-hidden section for real customer quotes and logos. **Do not fill it with placeholder people or companies.** Build the components (a quote card with a sketch portrait slot and a logo row) behind a `SHOW_PROOF = false` flag.

---

### 6.12 Final call to action (Night): "The train is leaving."

**Purpose:** the closing moment, an emotional echo of the hero.

**Layout:** full viewport height, full bleed, **Night** mood (body `data-mood="night"` while in view, per §5.3).
- **Background:** the same valley and bridge as the hero, but drawn at night: lines in `--graphite` (Night, so light lines on dark), washes much darker (hills `#1A2A2A` at 60%), a crescent moon, and about 40 small 1–2 px stars that twinkle (opacity 0.3 ↔ 1, random durations 2–5 s, seeded). The train's windows glow warm (`--sun` at 80%, with a 6 px glow), and a soft headlight cone shines ahead of the locomotive.
- **Centre text:** eyebrow "Ready when you are"; headline `--t-h1` (centred, max 14 ch): "Test your next building with the people who'll use it."; buttons: Primary L "Try Nine Arches →" (on Night, background `--accent` Night value `#7CA7F5` with text `#0F1626`) + Ghost "Talk to us".
- **Animation:** as the section scrolls in (scrub, from 100% to 30% of the viewport), the night train crosses the bridge left to right; its window lights flicker on one by one as it enters. When the user reaches the centre of the section, a short whistle puff of steam rises (one-off). **No sound.**
- After the section, the page transitions back to Paper for the footer (the footer is always Paper).

**Mobile:** same, but the train is time-based (crosses once over 6 s when the section is 50% visible).

**Reduced motion:** a static night scene, the train in the middle of the bridge with lit windows.

---

## 7. Copy deck (all headings and buttons in one place)

| Location | Text |
|---|---|
| `<title>` | Nine Arches · Know how your building feels before it's built |
| Meta description | Draw a floor plan, fill it with people and watch them live a day in it. When something doesn't work, ask Ella to fix it. Building simulation for architects, builders and clients. |
| Nav links | Story · How it works · Ella · Any building · On site |
| Nav buttons | Talk to us · Try Nine Arches |
| Hero eyebrow | Building simulation, with Ella |
| Hero H1 | Know how your building *feels* before it's built. |
| Hero lead | Draw a floor plan, fill it with people, and watch them live a day in it. When something doesn't work, tell Ella. She'll change the plan while you watch. |
| Hero buttons | Try Nine Arches → · Watch Ella work |
| Hero caption | For architects, builders and the people they build for. |
| Story eyebrow | Why Nine Arches |
| Problem H1 | Most buildings meet their people on *opening day*. |
| How H1 | Let the people in *early*. |
| Ella H1 | Tell Ella what's wrong. *Watch her fix it.* |
| See H2 | Every way a building can work, *or not*. |
| Buildings H1 | From a house to a *stadium*. |
| Site H2 | On the real map, under the *real sun*. |
| Who H2 | Everyone looking at the *same* building. |
| Final H1 | Test your next building with the people who'll use it. |

(The "How it works" section header, above the pinned steps: eyebrow "How it works"; headline `--t-h1` "Let the people in *early*."; lead "Four steps, one plan, and a day of people telling you what works.")

**Links:** "Try Nine Arches" → the app URL (placeholder `https://app.ninearches.ai`, confirm with the owner). "Talk to us" → a `mailto:` or contact form (the owner to confirm the address; do not invent one; use a visible placeholder `TODO_CONTACT` that fails the build check in §11).

---

## 8. Responsive behaviour summary

| Feature | Desktop ≥ 1200 | Tablet 640–1199 | Mobile < 640 |
|---|---|---|---|
| Nav | Full links | Links hidden < 900; menu sheet | Menu sheet |
| Hero | 2 columns, train on scroll, pointer parallax | 2 columns ≥ 900, else stacked; train timed | Stacked; train timed |
| Bridge story | Pinned 300vh | Pinned 240vh ≥ 900; else panels | Stacked panels |
| How it works | Pinned 400vh | Pinned ≥ 900; else blocks | Blocks |
| Ella stage | Pinned 500vh, side by side | Pinned ≥ 900 (chat 42%); else stacked auto-play | Stacked auto-play |
| Bento | 12-col bento | 2-col | 1-col |
| Any building | Horizontal pin 200vh | Horizontal pin ≥ 900; else carousel | Snap carousel |
| Railway progress line | Yes | No | No |
| Dots in plan player | ≤ 400 | ≤ 250 | ≤ 150 |

Test at 320, 375, 414, 768, 1024, 1280, 1440 and 1920 px widths. No horizontal page scroll at any of them. Tap targets are ≥ 44 × 44 px on touch devices.

---

## 9. Accessibility

- WCAG 2.2 AA throughout.
- **Reduced motion** (`prefers-reduced-motion: reduce`): no smooth scroll, no pins, no parallax, no scroll-scrubbed drawing. Every sketch is shown fully drawn, every demo shows its final state with a "Step through" or "Replay" control, and the train is parked. All information is still present.
- **Pause control:** a small "Pause animations" toggle in the footer (and in the nav's mobile sheet) that sets the same state as reduced motion, remembered in localStorage.
- All sketches are `role="img"` with an `aria-label` summarising them; purely decorative ones are `aria-hidden="true"`.
- Headings follow a strict outline: one H1 (the hero), H2 per section, H3 for cards and steps. (Visual sizes above are independent of the heading level.)
- Focus styles are visible everywhere (§4.2 focus ring). The skip link "Skip to content" appears on first Tab press, top-left, 44 px tall.
- Pinned sections must remain fully keyboard-navigable: focusable content inside a pin scrolls the pin to the right point when focused.
- Demo text (the chat) is real text, selectable and translatable.
- Colour is never the only signal: problem markers also have Caveat labels, and metric deltas have "+/−" signs and words.

---

## 10. Technical notes

- **Stack (recommended):** Astro (static output) with a few interactive islands (React or vanilla TS), or Next.js with static export. **Vanilla CSS with custom properties** (the tokens file), no CSS framework required. GSAP 3 + ScrollTrigger + MotionPathPlugin; Lenis; Rough.js (for generated sketch lines, run at build time where possible and saved as SVG paths, so no runtime cost).
- **Performance budget (mobile, 4G, mid-range Android):** LCP ≤ 2.0 s (the hero headline is the LCP element: render it server-side, visible under the preloader for crawlers), CLS ≤ 0.02, INP ≤ 150 ms, total JS ≤ 160 KB gzipped on first load (GSAP and Lenis included; load section scripts lazily as they approach), hero SVG ≤ 120 KB gzipped, fonts ≤ 140 KB (subset Fraunces and Caveat to the characters used where possible).
- **Animation performance:** animate only `transform`, `opacity`, `stroke-dashoffset` and `clip-path`. Use `will-change` only during animation. Pause every loop and canvas when off screen. Cap the plan player's devicePixelRatio at 2.
- **Data for demos:** pre-record the plan player's tracks and heat grids from the real Nine Arches engine where possible (export JSON from the app), so the dots move like real simulated people. Store them as compact JSON (quantised coordinates, 0.1 m resolution) ≤ 150 KB per demo, loaded when the section approaches.
- **SEO and sharing:** Open Graph image 1200×630: the hero valley sketch with the bridge and train, the logo top-left and the H1 in Fraunces. `og:title` "Nine Arches", `og:description` as the meta description. Structured data: `SoftwareApplication` (name Nine Arches, applicationCategory "DesignApplication", no fake ratings).
- **Analytics:** privacy-friendly (Plausible or similar), no cookie banner needed if no cookies are set. Track: CTA clicks, the Ella demo reaching beat 3 and beat 5, and "Watch Ella work" clicks.
- **Browser support:** the last two versions of Chrome, Edge, Safari (macOS and iOS) and Firefox. Everything degrades to the reduced-motion version if JavaScript fails.

---

## 11. Acceptance checklist

The site is done when every box is ticked.

**Story and content**
- [ ] The page never implies Nine Arches is limited to particular building types; "Any building" lists ten types.
- [ ] Ella is named in the hero demo, has her own section, and is never called "the assistant", "the AI" or "the bot" in visible copy.
- [ ] The bridge facts match §1.2 word for word where quoted; the legend is worded as a legend.
- [ ] Every number in a demo carries an "Illustrative" chip.
- [ ] No placeholder customers, logos, quotes or ratings appear; §6.11 is hidden.
- [ ] `TODO_CONTACT` and the app URL have been replaced with confirmed values (a build check fails while `TODO_` remains).

**Design**
- [ ] All colours, sizes, spacing, radii, shadows and durations come from the tokens file.
- [ ] Sketches use the pencil style (§3.1) and draw on (§3.2); none simply fade in.
- [ ] The paper texture is fixed, 4% opacity, and absent on Night areas.
- [ ] Only the Ella section uses the colourful glow; only the preloader uses the full splash palette.

**Motion**
- [ ] The hero train crosses on load, then continues with scroll without a jump.
- [ ] The bridge builds pier by pier and arch by arch with scroll, then the train crosses.
- [ ] In the Ella stage, the ghost "trying ideas" sketches appear while Ella thinks, and each change lands in the plan in sync with its row in her change card.
- [ ] The final section's night train crosses with lit windows.
- [ ] No two attention-grabbing animations run in the same viewport at the same time.
- [ ] Reduced motion and the "Pause animations" toggle remove all movement and keep all information.

**Quality**
- [ ] Lighthouse mobile: Performance ≥ 90, Accessibility 100, Best Practices ≥ 95, SEO 100.
- [ ] Core Web Vitals within the §10 budget.
- [ ] Tested at every width in §8 with no horizontal scroll, and in each browser in §10.
- [ ] Keyboard-only walk-through of the whole page works, including inside pinned sections.

---

## 12. Open questions for the product owner

1. The app link for "Try Nine Arches", and whether it's open sign-up, a waitlist or "book a demo".
2. The contact address for "Talk to us".
3. Whether to show real product recordings in v1 (recommended for §6.8, and optionally a 20 s clip after the Ella stage).
4. Legal pages (privacy, terms) and the company name for the footer.
