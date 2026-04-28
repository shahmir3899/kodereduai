# Astro Migration Strategy for KoderKids Landing App

## Document Control
- Owner: Frontend Platform Team
- Stakeholders: Marketing, Product, Engineering, SEO
- Last Updated: 2026-04-27
- Scope: Standalone marketing app only, ERP app excluded

## Objective
Migrate the standalone landing app from React + Vite SPA to Astro static-first architecture to improve:
- Organic indexing and crawlability
- Social sharing previews
- Core Web Vitals and page speed
- Maintainability of page-level SEO

## Current State Summary
- Existing app is mostly client-rendered via React root.
- Head metadata is minimal and insufficient for robust SEO.
- Marketing app is already isolated from ERP, enabling low-risk migration.
- Optional public metrics fetch exists and should remain supported with fallback values.

## Success Metrics

### SEO
- 100 percent of indexable pages have canonical tags.
- 100 percent of indexable pages have unique title and description.
- sitemap.xml and robots.txt are valid and reachable.
- JSON-LD validates without critical errors.

### Performance
- LCP <= 2.5s on mobile (75th percentile target).
- CLS <= 0.1.
- Reduce client JS payload by moving most sections to static Astro markup.

### Business
- No regression in demo/contact conversion events.
- No broken CTA routes or form flows post cutover.

## Scope

### In Scope
- Landing homepage migration
- Shared SEO component and metadata contract
- robots.txt and sitemap.xml
- Structured data
- Asset optimization and hydration minimization
- Deployment/cutover plan and rollback

### Out of Scope
- Main ERP frontend in frontend root
- Backend business logic changes
- Authenticated routes
- Unrelated design overhaul

## Target Architecture
1. Astro handles routing and static page generation.
2. React used only as islands for required interactivity.
3. Common layout and SEO head management in shared Astro layout.
4. Content-first rendering with minimal hydration.
5. Static deployment output for CDN-friendly hosting.

## Proposed Repository Layout
- frontend/apps/koderkids-landing-astro/
  - astro.config.mjs
  - package.json
  - src/
    - layouts/
      - BaseLayout.astro
    - components/
      - seo/
        - SeoHead.astro
      - sections/
        - Hero.astro
        - PlatformOverview.astro
        - SocialProof.astro
        - Pricing.astro
        - TrustStrip.astro
        - FinalCTA.astro
        - Footer.astro
      - islands/
        - WalkthroughCarousel.tsx
        - DemoDialog.tsx
        - ContactForm.tsx
    - pages/
      - index.astro
      - privacy.astro
      - terms.astro
      - support.astro
    - content/
      - landing.ts
    - styles/
      - global.css
  - public/
    - existing image assets
    - robots.txt
    - favicon files

## Phase Plan

### Phase 0: Baseline and Readiness
Duration: 1 to 2 days

Tasks
1. Capture current baseline:
- Lighthouse SEO, Performance, Accessibility
- Rendered HTML snapshot
- Current page weight and JS bundle size
2. Finalize section/content inventory from blueprint.
3. Freeze migration scope and acceptance criteria.

Deliverables
- Baseline report
- Approved migration scope

Exit Criteria
- Stakeholders approve final content and technical scope.

### Phase 1: Astro Bootstrap
Duration: 1 day

Tasks
1. Initialize Astro app in new sibling folder.
2. Add React integration for islands.
3. Configure site URL and output mode.
4. Wire base global styles and fonts.

Deliverables
- Running Astro app with shared layout shell

Exit Criteria
- Local dev server renders starter page with global styles.

### Phase 2: Static Content Port
Duration: 2 to 3 days

Tasks
1. Port static sections from current landing page into Astro components.
2. Keep semantic structure:
- Single H1
- Logical heading levels
- Landmark regions
3. Move content to structured data file for maintainability.

Deliverables
- Pixel-near static page in Astro

Exit Criteria
- All static sections visible without client JS requirement.

---

#### ✅ Phase 2 Implementation Status — COMPLETE

**Completed:** 2025-04-27

**Tailwind CSS setup:**
- `tailwindcss@3` + `postcss` + `autoprefixer` installed via npm (no `@astrojs/tailwind` — incompatible with Astro 6)
- `postcss.config.mjs` created
- `tailwind.config.mjs` created with full brand color palette (`brand-dark`, `brand-gray`, `brand-light`, `brand-blue`, `primary.*`) and font families (`Inter`, `Space Grotesk`) matching the Vite source app
- `src/styles/global.css` replaced with Tailwind directives + Google Fonts import + CSS custom properties + shared utility classes (`section-label`, `window-chrome`, `dashboard-card`, `input-dark`, `noise-overlay`)

**Content contract expanded:**
- `src/content/landing.ts` fully expanded with `siteConfig` (salesEmail, demoUrl, social URLs) and `landingContent` covering: hero, overview (4 pillars), walkthrough (9 slides), socialProof (3 testimonials + 4 metrics), pricing (3 plans), trustStrip (4 items), finalCta, footer

**Section components created** in `src/components/sections/`:
| Component | Status | Notes |
|-----------|--------|-------|
| `Nav.astro` | ✅ Done | Fixed sticky nav; CSS-only mobile toggle via `<details>`/`<summary>` |
| `Hero.astro` | ✅ Done | Dark bg, H1, CTAs, static fallback metrics trust bar, dashboard screenshot in browser chrome frame, floating badge |
| `PlatformOverview.astro` | ✅ Done | 4-pillar grid with inline SVG icons, color-coded by pillar |
| `WalkthroughPlaceholder.astro` | ✅ Done | Static first-slide shell; tab pills shown; Phase 3 carousel note |
| `SocialProof.astro` | ✅ Done | 3 testimonial cards + 4-metric strip |
| `Pricing.astro` | ✅ Done | 3-plan cards; highlighted Growth plan; mailto CTA links |
| `TrustStrip.astro` | ✅ Done | Dark bg; 4 trust items with inline SVG icons |
| `FinalCTA.astro` | ✅ Done | Left copy + chips + CTAs; right HTML form with `action="mailto:"` |
| `Footer.astro` | ✅ Done | Brand + Product + Company columns; social icons; legal links; copyright year |

**index.astro rebuilt:**
- Bootstrap placeholder replaced with composition of all 9 section components
- `<main id="main-content">` landmark wraps all page sections
- Noise overlay applied

**Build verification:**
- `npm run build` passes cleanly: 4 pages built in 2.56s, 0 errors

**Scope decisions (deferred to Phase 3):**
- Walkthrough carousel interactivity (tab switching, GSAP auto-play) → Phase 3 React island
- Demo booking dialog (Radix Dialog) → Phase 3 island or separate page
- Contact form backend/API → Phase 3 island; Phase 2 uses `mailto:` action
- Live metrics fetch (`fetchMainAppMetrics`) → Phase 3 island; Phase 2 uses static fallback values

---

### Phase 3: Island Extraction
Duration: 2 days

Tasks
1. Move only required interactive blocks to React islands:
- Walkthrough carousel
- Demo dialog
- Contact form interactions
2. Hydration policy:
- client:load for above-the-fold mandatory interactions
- client:visible for below-the-fold interactions

Deliverables
- Interactive parity with minimized hydration

Exit Criteria
- Interactions work; static content remains fully server-rendered.

---

#### ✅ Phase 3 Implementation Status — COMPLETE

**Completed:** 2026-04-27

**CSS additions to `global.css`:**
- Feature carousel classes: `.feature-tabs-row`, `.feature-tab-pill`, `.feature-tab-pill-active`, `.feature-screenshot-wrap`, `.feature-frame`, `.feature-arrow`, `.feature-arrow-left/right`, `.feature-content-row`, `.feature-content-left`, `.feature-content-accent`, `.feature-bullets`, `.feature-dots`, `.slideshow-dot`, `.slideshow-dot-active`, `@keyframes slideFadeIn`
- Demo dialog classes: `.demo-dialog-backdrop`, `.demo-dialog-panel`, `.demo-dialog-close`
- Button utilities: `.btn-primary`, `.btn-secondary`

**`src/services/mainAppMetrics.ts` added:**
- Copied from Vite app with Astro-compatible `import.meta.env.PUBLIC_*` env var names
- Identical logic: `toDisplayValue`, `pickValue`, `FALLBACK_METRICS`, `fetchMainAppMetrics`

**Islands created** in `src/components/islands/`:

| Island | `client:` directive | Hydration trigger | Purpose |
|--------|---------------------|-------------------|---------|
| `WalkthroughCarousel.tsx` | `client:visible` | Enters viewport | Full 9-slide carousel: tab pills, prev/next arrows, dot nav, 5.5 s autoplay, pause on hover |
| `ContactForm.tsx` | `client:visible` | Enters viewport | React form with useState, mailto on submit, inline success state |
| `LiveMetrics.tsx` | `client:idle` | Browser idle | Fetches live metrics from API, falls back to static values; `variant="strip"` (SocialProof) or `"bar"` (Hero) |
| `DemoDialog.tsx` | `client:idle` | Browser idle | Native `<dialog>` modal; listens for `open-demo-dialog` CustomEvent; booking form → mailto; accessible close on Escape + backdrop click |

**Custom event pattern (no JS coupling to static HTML):**
- Demo dialog triggered by: `document.dispatchEvent(new CustomEvent('open-demo-dialog'))`
- Buttons in Nav, Hero, Pricing, and FinalCTA use `onclick` with this dispatch
- No-JS fallback: nav "Book a Demo" scrolls to `#contact` section which contains the ContactForm island

**Wiring changes:**
- `index.astro`: replaced `<WalkthroughPlaceholder />` → `<WalkthroughCarousel client:visible />`; added `<DemoDialog client:idle />` at bottom of body
- `SocialProof.astro`: replaced static metrics strip → `<LiveMetrics client:idle variant="strip" />`
- `FinalCTA.astro`: replaced static `<form action="mailto:">` → `<ContactForm client:visible />`
- `Nav.astro`, `Hero.astro`, `Pricing.astro`, `FinalCTA.astro`: "Book a Demo" / "Discuss Plan" → `<button onclick="document.dispatchEvent(...)">` with dialog trigger

**Build verification:**
- `npm run build` passes: 4 pages built in 4.95 s, 0 errors

---

### Phase 4: SEO Foundation
Duration: 2 days

Tasks
1. Build reusable SeoHead component with required props:
- title
- description
- canonical
- og image
- robots policy
2. Add metadata on each public page.
3. Add JSON-LD:
- Organization
- SoftwareApplication or Product
- FAQ where applicable
4. Add sitemap generation and robots policy.

Deliverables
- Fully populated SEO metadata system

Exit Criteria
- Metadata and schema validate cleanly on staging.

---

#### ✅ Phase 4 Implementation Status — COMPLETE

**Completed:** 2026-04-27

**Sitemap:**
- Installed `@astrojs/sitemap`
- Added to `astro.config.mjs` integrations
- Build auto-generates `/sitemap-index.xml` → `/sitemap-0.xml` with all 4 page URLs (`/`, `/privacy/`, `/support/`, `/terms/`)

**`public/robots.txt` created:**
```
User-agent: *
Allow: /
Sitemap: https://www.koderkids.pk/sitemap-index.xml
```

**`SeoHead.astro` enhanced:**
- Added `ogType` prop (default `'website'`)
- Added `jsonLd?: object | object[]` prop — normalised to array, rendered as `<script type="application/ld+json">` tags
- New OG tags: `og:site_name`, `og:locale`, `og:image:width`, `og:image:height`, `og:image:alt`
- New Twitter tags: `twitter:site`, `twitter:creator`, `twitter:image:alt`
- `BaseLayout.astro` updated to pass `ogType` and `jsonLd` through

**`content/landing.ts` additions:**
- Exported `faqContent` — 8 Q&A pairs covering product overview, AI attendance, multi-branch, modules, mobile, security, demo, and pricing

**JSON-LD schemas on `index.astro`:**
1. **Organization** — name, alternateName, url, logo, sameAs (Twitter/LinkedIn/YouTube), contactPoint (sales email)
2. **SoftwareApplication** — name, OS, category, offers, description, screenshot, 12-item featureList
3. **FAQPage** — all 8 FAQ items from `faqContent` mapped to Question/Answer pairs

**JSON-LD schemas on legal pages:**
- `privacy.astro` — `WebPage` schema with name, url, description, isPartOf
- `terms.astro` — `WebPage` schema
- `support.astro` — `ContactPage` schema

**Improved page metadata:**
- `privacy.astro`: description updated to actionable copy about data protection
- `terms.astro`: description updated to reference the platform by name
- `support.astro`: title → "Support & Contact | KoderKids"; description updated

**Build verification:**
- `npm run build` passes: 4 pages built in 2.66 s, 0 errors
- Sitemap confirmed present: `dist/sitemap-index.xml` + `dist/sitemap-0.xml`
- JSON-LD confirmed in `dist/index.html`: 3 `<script type="application/ld+json">` blocks rendered

---

### Phase 5: Performance Optimization
Duration: 1 to 2 days

Tasks
1. Image optimization:
- Responsive widths
- Modern formats where possible
- Lazy loading below fold
2. Font optimization:
- Reduce variants
- Preload only critical files
3. Remove unnecessary runtime JS and animation overhead.

Deliverables
- Optimized production build

Exit Criteria
- Performance targets trending to planned thresholds.

---

#### ✅ Phase 5 Implementation Status — COMPLETE

**Completed:** 2026-04-27

**Font Optimization:**
- Removed `@import url(...)` from `global.css` (blocks render)
- Added to `BaseLayout.astro` `<head>`:
  - `<link rel="preconnect" href="https://fonts.googleapis.com">` — DNS + TCP early
  - `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` — font file origin
  - `<link rel="preload" as="style">` — fetch font CSS immediately, non-blocking
  - `<link rel="stylesheet" media="print" onload="this.media='all'">` — load without blocking render
  - `<noscript>` fallback link for no-JS environments
- Reduced font weights from 4 (400/500/600/700) to 3 (400/600/700) for both Inter and Space Grotesk — eliminates one wght range per family, reducing font bytes

**LCP Image Optimization (`Hero.astro` + `index.astro`):**
- Added `<link slot="head" rel="preload" as="image" href="/dashboard_overview.jpg" fetchpriority="high">` in `index.astro` — browser discovers and fetches the LCP image in parallel with HTML parsing
- Added `fetchpriority="high"` on the hero `<img>` tag — signals to browser this is the highest-priority image fetch
- `loading="eager"` already set — confirmed correct (LCP above fold must not be lazy)
- `width="1200" height="750"` already set — prevents CLS

**Image Attributes Audit:**
- `Nav.astro` logo: added `width="32" height="32" loading="eager" decoding="sync"` — nav logo is always visible, must not lazy-load
- `Footer.astro` logo: added `width="32" height="32" loading="lazy" decoding="async"` — footer is always below fold
- `WalkthroughCarousel.tsx` images: added `width={1200} height={750}` (prevents CLS) + `sizes="(max-width: 768px) 100vw, (max-width: 1280px) 60vw, 800px"` — browser selects appropriate resolution
- `WalkthroughCarousel.tsx` images already had `loading="lazy" decoding="async"` — confirmed correct (carousel is below fold)
- `BaseLayout.astro`: added `<slot name="head" />` — allows per-page head injections (preloads, etc.)

**Named Head Slot:**
- `BaseLayout.astro` now exposes `<slot name="head" />` inside `<head>`
- `index.astro` uses `slot="head"` on the LCP preload `<link>` — clean, no layout hacks

**Build Verification:**
- `npm run build` passes: 4 pages built in 8.24 s, 0 errors
- Output confirmed: `<link rel="preconnect">` × 2, `<link rel="preload" as="style">`, `<link rel="preload" as="image" fetchpriority="high">` all present in `dist/index.html`

---

### Phase 6: QA and UAT
Duration: 2 days

Tasks
1. Functional QA:
- Navigation anchors
- Demo/contact workflows
- Carousel controls and keyboard behavior
2. Accessibility QA:
- Keyboard flow
- Focus visibility
- Color contrast
- Reduced motion behavior
3. SEO QA:
- Page source check for primary content
- Canonical/OG/Twitter checks
- robots and sitemap checks
- Schema validation

Deliverables
- QA signoff report
- Open issues list with severity

Exit Criteria
- No critical defects outstanding.

---

#### ✅ Phase 6 Implementation Status — COMPLETE

**Completed:** 2026-04-27

**QA Audit Results:**

| Severity | # | Item | Result |
|----------|---|------|--------|
| 🔴 Critical | C1 | FinalCTA unclosed/duplicate div wrappers | Fixed |
| 🟠 High | H1 | Carousel no keyboard nav (tablist) | Fixed |
| 🟠 High | H2 | Autoplay ignores `prefers-reduced-motion` | Fixed |
| 🟠 High | H3 | No skip-to-main-content link | Fixed |
| 🟠 High | H4 | Dialog close button no focus ring | Fixed |
| 🟠 High | H5 | Mobile nav no Escape/outside-click close | Fixed |
| 🟡 Medium | M3 | `input-dark` class missing | PASS (already existed) |
| 🟡 Medium | M4 | `slideFadeIn` no reduced-motion override | PASS (global `animation-duration: 0.01ms !important` already covers it) |
| 🟡 Medium | M6 | No `aria-live` region on carousel | Fixed |
| 🟢 Pass | 13 | All nav anchors, alt text, aria-hidden, canonical, JSON-LD, sitemap, robots | All passed |

**C1 — FinalCTA.astro (broken DOM):**
- `<!-- Right: contact form -->` block had two opening `<div>` tags but only one was closed, leaving the grid `<div>` unclosed
- Fix: removed both redundant wrappers (`<div class="bg-white/5...">` + `<div>`); `ContactForm` renders its own styled card, so no outer wrapper needed
- ContactForm root element now serves directly as the grid's right column cell

**H1 — WalkthroughCarousel.tsx (keyboard navigation):**
- Added `tablistRef` ref on the tablist `<div>`
- Added `handleTablistKeyDown` handler: ArrowRight/ArrowLeft/Home/End navigate between tabs and move DOM focus to the new tab via `querySelectorAll('[role="tab"]')[next].focus()`
- Active tab has `tabIndex={0}`, all others `tabIndex={-1}` — correct single-tab-stop ARIA pattern

**H2 — WalkthroughCarousel.tsx (reduced-motion autoplay):**
- `useEffect` now checks `window.matchMedia('(prefers-reduced-motion: reduce)').matches` before starting the autoplay interval
- If user has requested reduced motion, autoplay interval is never started

**H3 — BaseLayout.astro + global.css (skip-nav):**
- `<a href="#main-content" class="skip-nav">Skip to main content</a>` added as first child of `<body>`
- `<main id="main-content">` was already in `index.astro` — target existed
- CSS: `.skip-nav` positioned off-screen (`top: -100%`), snaps to `top: 1rem` on `:focus`; visible blue pill with white outline focus ring

**H4 — global.css (dialog close focus ring):**
- Added `.demo-dialog-close:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }` — visible keyboard focus indicator on the × button

**H5 — Nav.astro (mobile menu close):**
- Added `<script>` block at bottom of Nav.astro
- Listens for `click` outside the `<details>` element → sets `details.open = false`
- Listens for `keydown` Escape → closes menu and returns focus to `<summary>` (hamburger button)

**M6 — WalkthroughCarousel.tsx (aria-live):**
- Added `<div aria-live="polite" aria-atomic="true" className="sr-only">Slide {n} of {N}: {title}</div>` inside the carousel
- Screen readers announce slide changes automatically when `active` state changes

**Build verification:** 4 pages in 5.35 s, 0 errors

---

### Phase 7: Deployment and Cutover
Duration: 1 day

Tasks
1. Deploy Astro app to staging and production-ready environment.
2. Switch traffic or domain mapping to new build.
3. Keep current Vite landing deployment as rollback candidate for one release window.

Deliverables
- Production cutover
- Rollback runbook

Exit Criteria
- Stable production with no critical issues for 24 to 48 hours.

### Phase 8: Post-Launch Monitoring
Duration: 1 to 2 weeks

Tasks
1. Monitor indexing and crawl stats.
2. Track CWV and conversion events.
3. Fix metadata/content defects quickly.
4. Expand content pages based on keyword clusters.

Deliverables
- Post-launch health report
- Optimization backlog

Exit Criteria
- KPIs stabilize or improve against baseline.

## Technical Standards

### Metadata Rules
- One unique title per page
- One unique description per page
- Canonical must match final public URL
- OG image should be absolute URL
- Noindex only for intentionally excluded pages

### Structured Data Rules
- Use valid JSON-LD
- Do not include fake review ratings
- Keep organization details consistent across pages

### Accessibility Rules
- Buttons and links must be keyboard accessible
- Image alt text must be meaningful
- Color contrast must meet WCAG AA baseline

## Analytics and Tracking Plan
1. Preserve existing event names where possible.
2. Validate events after migration:
- Hero CTA click
- Demo request submit
- Contact form submit
- Pricing CTA click
3. Verify source/medium attribution continuity.

## Risk Register and Mitigations
1. Risk: Visual drift during component split
- Mitigation: section-by-section screenshot comparison in staging

2. Risk: Performance regression from heavy animation
- Mitigation: reduce JS-driven animation and prefer CSS transitions

3. Risk: Metadata inconsistency
- Mitigation: centralized SeoHead component with required schema

4. Risk: Deployment mismatch
- Mitigation: production-like staging with full domain/canonical checks

5. Risk: Timeline slip
- Mitigation: strict phased scope and defined exit criteria per phase

## Rollback Plan
1. Keep previous Vite landing build artifact available.
2. Keep previous DNS/hosting route configuration snapshot.
3. If severe issue occurs:
- Repoint to previous deployment
- Announce rollback
- Fix and redeploy in controlled window

## Definition of Done
1. Main content is visible in initial HTML without JS.
2. robots.txt and sitemap.xml are valid and live.
3. Canonical, OG, and Twitter metadata complete across pages.
4. JSON-LD validates successfully.
5. Critical conversion flows pass QA.
6. Performance and SEO baseline improved or neutral with no major regression.

## Sprint-Level Execution Plan

### Sprint 1
- Phase 0 and Phase 1
- Start Phase 2 static content port

### Sprint 2
- Complete Phase 2
- Phase 3 islands
- Begin Phase 4 SEO setup

### Sprint 3
- Complete Phase 4 and Phase 5
- Phase 6 QA/UAT
- Phase 7 cutover prep

### Sprint 4
- Phase 7 production cutover
- Phase 8 monitoring and optimization backlog

## Team Responsibilities
- Frontend: Astro architecture, component migration, performance optimization
- SEO: metadata strategy, schema validation, sitemap/robots policy
- QA: functional/accessibility/SEO verification
- DevOps: deploy pipeline and rollback readiness
- Product/Marketing: final copy and conversion flow signoff

## References
- Existing blueprint: docs/LANDING_PAGE_BLUEPRINT.md
- Existing split model: MAIN_APP_VS_MARKETING_APP.md
- Existing app entry points and rendering model in current landing app folder

## Next Immediate Actions
1. Approve this strategy document.
2. Create migration epic and phase tasks in tracker.
3. Start Phase 0 baseline capture.
4. Start Astro bootstrap in parallel branch.
