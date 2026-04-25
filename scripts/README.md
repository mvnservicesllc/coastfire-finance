# scripts/

## Quick reference

| Script | What it does | When to run |
|---|---|---|
| `generate-pseo.js` | Generate 100 SEO landing pages | After content updates, quarterly for `lastmod` refresh |
| `ping-search-engines.js` | Notify Bing/IndexNow of new URLs | After deploying new pages |

The **SEO Health Dashboard** lives at `/admin/seo-dashboard.html` (browser-only, paste GSC export to analyze).

---

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

---

## ping-search-engines.js

Notifies search engines of new/updated URLs so they get crawled faster than waiting for natural discovery.

### What it pings
- **IndexNow** (Bing, Yandex, Seznam, Naver) — instant indexing protocol; URLs typically indexed within minutes.
- **Bing sitemap ping** — direct sitemap notification, still supported.
- **Google** — sadly Google deprecated their sitemap ping endpoint. The only reliable path is manual submission via GSC (the script reminds you).

### One-time setup (5 minutes)
1. Generate an IndexNow key at https://www.bing.com/indexnow
2. Save the key to a file at the site root: `<your-key>.txt` (just the key as plain text)
3. Set the env var: `export INDEXNOW_KEY="your-key-here"` (or edit the placeholder in the script)
4. Push the key file along with your next deploy

### Run
```bash
# Default: ping all /coastfire/* URLs (the new SEO landing pages)
node scripts/ping-search-engines.js

# All URLs in sitemap
node scripts/ping-search-engines.js --all

# Specific URLs
node scripts/ping-search-engines.js https://coastfirefinance.com/coastfire/age-30-income-100k.html
```

### When to run
- After running `generate-pseo.js` and pushing new pages
- After publishing a new blog post
- After significantly updating the calculator (notify of root URL refresh)

---

## SEO Health Dashboard

A browser-only dashboard at `/admin/seo-dashboard.html`. No backend, no auth — just paste a Google Search Console CSV export and get:

- **Overview** — total clicks, impressions, CTR, average position with insight callouts
- **Top Performers** — sortable table of pages/queries
- **Quick Wins** — pages with high impressions but low CTR (titles to optimize)
- **Almost-Ranking** — pages at position 11–20 (one push from page 1)
- **Stuck** — pages getting impressions but ranking too low to convert
- **Periodic SEO Tasks** — checklist for weekly/monthly/quarterly habits

The dashboard is `noindex, nofollow` (won't appear in search results) but is still publicly accessible. Don't paste sensitive data — your inputs stay in your browser only (saved to localStorage, never transmitted).

### How to get GSC data
1. Open [Google Search Console](https://search.google.com/search-console)
2. Performance → Search results → set date range (28 days is good)
3. Click "Export" → "Download CSV"
4. Open the ZIP, copy contents of `Pages.csv` or `Queries.csv`
5. Paste into the dashboard and click Analyze
