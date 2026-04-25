# scripts/

## generate-pseo.js

Programmatic SEO landing page generator for CoastFIRE Finance.

### What it does
Generates **100 static HTML pages** in `/coastfire/` targeting long-tail search queries:
- **Age × Income matrix** — 10 ages × 8 incomes = 80 pages (e.g. "CoastFIRE at 30 with $80k income")
- **Single-age guides** — 9 deep-dive pages (e.g. "CoastFIRE at age 30")
- **Profession pages** — 10 career-specific guides (teachers, nurses, engineers, doctors, military, government, freelancers, small-business owners, remote workers, late starters)
- **Hub page** — `/coastfire/index.html` with browsable matrix

Each page is **fully self-contained** (no JS dependencies), has unique content (~800–1,200 words), real CoastFIRE math computed for the specific scenario, FAQPage + Article + BreadcrumbList JSON-LD schema, internal links to adjacent scenarios, and a CTA back to the main calculator.

### Run

```bash
node scripts/generate-pseo.js
```

This will:
1. Regenerate every page in `/coastfire/` (idempotent — overwrites in place).
2. Update `sitemap.xml` with all root + blog + scenario URLs.
3. Print a summary to stdout.

### Re-run when
- Tax limits / contribution caps change in a new year (edit constants in script).
- You want to add new ages, incomes, or professions (edit `AGES`, `INCOMES`, or `PROFESSIONS` arrays at the top).
- You want to refresh `lastmod` dates in the sitemap (signals freshness to Google).

### Tweak content
All content templates are in three functions:
- `renderMatrixPage(age, income)` — age × income pages
- `renderAgePage(age)` — single-age deep dives
- `renderProfessionPage(prof)` — career pages

Math constants (return assumptions, SWR, retirement age) are at the top of the file.

### After regenerating
1. `git add coastfire/ sitemap.xml`
2. `git commit -m "Refresh PSEO pages"`
3. `git push` — Netlify auto-deploys.
4. **(Optional but recommended)** In Google Search Console → Sitemaps → submit `https://coastfirefinance.com/sitemap.xml`. Google will discover the new pages within a few days.

### Why this works for SEO
- **Unique content per page** — each page has different numbers, different recommendations based on age, different FAQ answers. Google does NOT penalize this kind of programmatic content (only thin / duplicate content).
- **Internal linking** — every page links to 4–8 related scenarios, building topic-cluster link equity.
- **Schema markup** — Article + BreadcrumbList + FAQPage helps Google understand and surface rich results.
- **Real user value** — a 32-year-old earning $90k can land directly on `/coastfire/age-32-income-90k.html` and get their answer instantly. That's exactly what Google rewards.

### Future ideas
- **State-specific pages** — `/coastfire/in-california.html` etc. (state income tax matters for retirement spending).
- **Spending-target pages** — "$50k/yr retirement spending" etc. (different on-ramp than income-based).
- **Comparison pages** — "$80k income vs $100k income" (matches comparison search intent).
- **Year-specific pages** — "CoastFIRE in 2026" etc. (refresh annually).
