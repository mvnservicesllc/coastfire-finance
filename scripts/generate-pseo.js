#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
 * generate-pseo.js — Programmatic SEO landing page generator for CoastFIRE Finance
 *
 * Generates static HTML pages for long-tail CoastFIRE queries:
 *   /coastfire/age-{age}-income-{k}k.html       (matrix: ages × incomes)
 *   /coastfire/at-age-{age}.html                 (single-age deep dive)
 *   /coastfire/for-{profession}.html             (profession-specific)
 *   /coastfire/index.html                        (hub page listing all)
 *
 * Each page:
 *   • Has unique title, meta description, h1, content (no duplicate-thin-content)
 *   • Computes real CoastFIRE math for the specific scenario
 *   • Has FAQPage + BreadcrumbList JSON-LD schema
 *   • Has internal links to adjacent scenarios (link equity flow)
 *   • Funnels users to the main calculator at /
 *
 * Run: node scripts/generate-pseo.js
 *
 * Updates sitemap.xml in place (preserves existing root + blog entries).
 * ────────────────────────────────────────────────────────────────────────── */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const OUT_DIR    = path.join(ROOT, 'coastfire');
const SITEMAP    = path.join(ROOT, 'sitemap.xml');
const SITE       = 'https://coastfirefinance.com';
const TODAY      = new Date().toISOString().slice(0, 10);
const AUTHOR     = 'Minh';
const PUB_DATE   = '2026-04-25';

// ─── PAGE CONFIG ──────────────────────────────────────────────────────────
// Ages and incomes chosen for highest search volume (long-tail FIRE queries).
const AGES    = [25, 28, 30, 32, 35, 38, 40, 45, 50, 55];
const INCOMES = [50000, 60000, 75000, 100000, 125000, 150000, 200000, 250000];

const SINGLE_AGE_GUIDES = [25, 28, 30, 32, 35, 40, 45, 50, 55];

const PROFESSIONS = [
  { slug:'teachers',   name:'Teachers',
    typIncome:65000, hasPension:true, accountType:'403(b) and 457(b)',
    note:'Most teachers have access to both a pension and a 403(b)/457(b). The pension dramatically lowers your CoastFIRE number — every $1,000/yr of pension income reduces your portfolio target by $25,000 (at a 4% SWR).' },
  { slug:'nurses',     name:'Nurses',
    typIncome:85000, hasPension:false, accountType:'403(b) or 401(k)',
    note:'RNs in hospital systems typically have a 403(b) with employer match. Travel nurses can often save 50%+ of income while housing is covered — perfect for hitting CoastFIRE early.' },
  { slug:'engineers',  name:'Software Engineers',
    typIncome:140000, hasPension:false, accountType:'401(k) with mega-backdoor Roth',
    note:'Tech engineers often have access to mega-backdoor Roth (after-tax 401(k) up to $70k/yr in 2026), which can put CoastFIRE within reach in your early 30s.' },
  { slug:'doctors',    name:'Doctors',
    typIncome:280000, hasPension:false, accountType:'401(k), 457(b), or PSP',
    note:'High-income physicians face a CoastFIRE paradox: huge income but late start (30+ when residency ends) and high spending. The math still works — just compress your saving years.' },
  { slug:'military',   name:'Military Members',
    typIncome:80000, hasPension:true, accountType:'TSP and military pension',
    note:'Active-duty military have the strongest CoastFIRE setup: a vested pension after 20 years, plus tax-advantaged TSP, plus the BAH/BAS that effectively boost your savings rate.' },
  { slug:'government', name:'Government Employees',
    typIncome:75000, hasPension:true, accountType:'TSP and FERS pension',
    note:'Federal employees (FERS) and most state workers have a defined-benefit pension on top of their TSP/457(b). Run your CoastFIRE number with the pension toggle on — it changes everything.' },
  { slug:'freelancers', name:'Freelancers and Self-Employed',
    typIncome:90000, hasPension:false, accountType:'Solo 401(k) or SEP IRA',
    note:'Self-employed CoastFIRE plans hinge on contribution limits. A Solo 401(k) lets you contribute as both employer and employee — up to $70k/yr in 2026 if profits allow.' },
  { slug:'small-business-owners', name:'Small Business Owners',
    typIncome:110000, hasPension:false, accountType:'Solo 401(k), SEP, or Defined Benefit Plan',
    note:'High-earning S-Corp owners can layer a Defined Benefit Plan on top of a Solo 401(k) and shelter $200k+ per year from taxes — a CoastFIRE accelerant most miss.' },
  { slug:'remote-workers', name:'Remote Workers',
    typIncome:95000, hasPension:false, accountType:'401(k) and HSA',
    note:'Geographic arbitrage (high salary, low cost-of-living area) is a CoastFIRE cheat code. Earning Bay Area money in Tennessee can compress your saving years by 40%.' },
  { slug:'late-starters', name:'Late Starters (40+)',
    typIncome:90000, hasPension:false, accountType:'Catch-up contributions in 401(k) and IRA',
    note:'Starting at 40+? You still have 20+ years of compounding. Catch-up contributions ($7,500/yr extra in 401(k), $1,000 in IRA at 50+) plus aggressive savings can still get you to CoastFIRE.' },
];

// ─── COASTFIRE MATH ───────────────────────────────────────────────────────
// Conservative defaults (matches the calculator's central assumptions)
const REAL_RETURN  = 0.05;   // 7% nominal - 3% inflation, real
const NOM_RETURN   = 0.07;   // for "without compounding" reference
const INFLATION    = 0.03;
const SWR          = 0.04;   // 4% safe withdrawal rate
const RETIRE_AGE   = 65;
const SPEND_RATIO  = 0.60;   // assume retirement spending = 60% of pre-retirement income (replacement ratio)

// CoastFIRE today's-dollars target = (annual_spending × 25) discounted by real return
function coastFireToday(annualSpend, currentAge, retireAge = RETIRE_AGE, realRet = REAL_RETURN) {
  const fireNumber = annualSpend / SWR;
  const yrsToRetire = Math.max(0, retireAge - currentAge);
  return fireNumber / Math.pow(1 + realRet, yrsToRetire);
}

// Years to reach a target (today's $) saving `monthly` at real return, starting from `currentBal`
function yearsToTarget(currentBal, target, monthlyContrib, realRet = REAL_RETURN) {
  if (currentBal >= target) return 0;
  const annual = monthlyContrib * 12;
  if (annual <= 0) return Infinity;
  // FV = PV(1+r)^n + PMT × ((1+r)^n - 1)/r  →  solve for n
  // (target + PMT/r) = (PV + PMT/r)(1+r)^n
  const r = realRet;
  const a = target + annual / r;
  const b = currentBal + annual / r;
  if (b <= 0) return Infinity;
  const n = Math.log(a / b) / Math.log(1 + r);
  return Math.max(0, n);
}

// Project a portfolio forward N years with no contribution
function projectForward(balance, years, realRet = REAL_RETURN) {
  return balance * Math.pow(1 + realRet, years);
}

// Estimate "typical" current balance for someone of age X with income Y
// Assumes they started saving at 22 with a 12% savings rate. Conservative.
function typicalBalance(currentAge, income) {
  const yrsSaving = Math.max(0, currentAge - 22);
  const annualSaved = income * 0.12;
  if (yrsSaving === 0) return 0;
  // FV of annuity at real return
  const r = REAL_RETURN;
  return annualSaved * (Math.pow(1 + r, yrsSaving) - 1) / r;
}

// ─── FORMATTING HELPERS ───────────────────────────────────────────────────
const fmt0 = n => '$' + Math.round(n).toLocaleString('en-US');
const fmtK = n => Math.round(n / 1000) + 'k';            // for URL slugs ("75k")
const fmtIncome = n => '$' + Math.round(n).toLocaleString('en-US'); // for display ("$75,000")
const fmtPct = n => (n * 100).toFixed(1) + '%';
const fmtYears = n => !isFinite(n) ? 'never' : n < 1 ? 'less than 1 year' : n.toFixed(1) + ' years';

// ─── HTML TEMPLATE PRIMITIVES ─────────────────────────────────────────────
function head(title, description, canonical, jsonLdBlocks = []) {
  const ld = jsonLdBlocks.map(j =>
    `<script type="application/ld+json">${JSON.stringify(j, null, 2)}</script>`
  ).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="theme-color" content="#c9965c">
<link rel="icon" href="../icon.svg" type="image/svg+xml">
${ld}
<style>
  :root { --bg:#0b1929; --card:#13253e; --border:#2a4060; --text:#e8ecf1; --muted:#8da3b8; --accent:#c9965c; --accent2:#e8c685; --green:#5f9677; --yellow:#e8c685; }
  * { box-sizing: border-box; }
  body { margin:0; padding:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; line-height:1.7; -webkit-font-smoothing:antialiased; }
  .nav { background:var(--card); border-bottom:1px solid var(--border); padding:14px 20px; position:sticky; top:0; z-index:10; display:flex; justify-content:space-between; align-items:center; }
  .nav a { color:var(--accent2); text-decoration:none; font-weight:600; font-size:0.95rem; }
  .nav a:hover { color:var(--accent); }
  .nav .right a { margin-left:18px; }
  .wrap { max-width:760px; margin:0 auto; padding:36px 20px 80px; }
  .crumbs { color:var(--muted); font-size:0.82rem; margin-bottom:20px; }
  .crumbs a { color:var(--muted); text-decoration:none; }
  .crumbs a:hover { color:var(--accent2); }
  h1 { font-family:Georgia,'Times New Roman',Cambria,serif; font-size:2.2rem; line-height:1.2; letter-spacing:-0.01em; margin:0 0 12px; background:linear-gradient(135deg,#c9965c,#e8c685); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
  .meta { color:var(--muted); font-size:0.88rem; margin-bottom:28px; }
  h2 { font-size:1.45rem; margin:40px 0 14px; color:var(--accent2); }
  h3 { font-size:1.15rem; margin:24px 0 10px; }
  p { margin:0 0 16px; }
  .num-callout { background:linear-gradient(135deg,rgba(201,150,92,0.12),rgba(232,198,133,0.04)); border:1px solid rgba(201,150,92,0.3); padding:24px 26px; margin:24px 0; border-radius:10px; text-align:center; }
  .num-callout .lbl { color:var(--muted); font-size:0.78rem; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
  .num-callout .val { font-size:2.4rem; font-weight:700; color:var(--accent2); font-variant-numeric:tabular-nums; line-height:1.1; }
  .num-callout .sub { color:var(--muted); font-size:0.85rem; margin-top:8px; }
  .callout { background:var(--card); border-left:3px solid var(--accent); padding:16px 20px; margin:24px 0; border-radius:6px; font-size:0.96rem; }
  .callout strong { color:var(--accent2); }
  table { width:100%; border-collapse:collapse; margin:18px 0; font-size:0.93rem; }
  th, td { padding:10px 12px; text-align:right; border-bottom:1px solid var(--border); font-variant-numeric:tabular-nums; }
  th { color:var(--muted); font-weight:600; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.5px; text-align:right; }
  th:first-child, td:first-child { text-align:left; }
  tr:hover td { background:rgba(201,150,92,0.04); }
  .cta { display:block; background:linear-gradient(135deg,#c9965c,#e8c685); color:#0b1929; text-align:center; padding:18px 24px; border-radius:10px; text-decoration:none; font-weight:700; margin:28px 0; font-size:1.05rem; box-shadow:0 4px 14px rgba(201,150,92,0.25); }
  .cta:hover { filter:brightness(1.08); transform:translateY(-1px); transition:all 0.15s; }
  ul { padding-left:22px; }
  li { margin-bottom:8px; }
  .related { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:20px 24px; margin:30px 0; }
  .related h3 { margin-top:0; color:var(--accent2); font-size:1.05rem; }
  .related ul { margin:8px 0 0; padding-left:18px; }
  .related a { color:var(--text); text-decoration:none; border-bottom:1px dotted var(--border); }
  .related a:hover { color:var(--accent2); border-bottom-color:var(--accent); }
  .faq { margin:14px 0; }
  .faq summary { cursor:pointer; padding:14px 0; font-weight:600; color:var(--accent2); border-bottom:1px solid var(--border); list-style:none; }
  .faq summary::-webkit-details-marker { display:none; }
  .faq summary::before { content:'+ '; color:var(--accent); font-weight:700; }
  .faq[open] summary::before { content:'– '; }
  .faq[open] summary { color:var(--accent); }
  .faq-body { padding:14px 0 6px; color:var(--text); }
  footer { color:var(--muted); font-size:0.82rem; text-align:center; padding:40px 20px 20px; border-top:1px solid var(--border); margin-top:40px; }
  footer a { color:var(--accent2); text-decoration:none; }
  @media (max-width:500px) {
    h1 { font-size:1.65rem; }
    .wrap { padding:24px 16px 60px; }
    .num-callout .val { font-size:1.9rem; }
    table { font-size:0.85rem; }
    th, td { padding:8px 6px; }
  }
</style>
</head>`;
}

function nav() {
  return `<div class="nav">
  <a href="../index.html">← Back to Calculator</a>
  <span class="right">
    <a href="./index.html">All Scenarios</a>
    <a href="../#blog">Blog</a>
  </span>
</div>`;
}

function footer() {
  return `<footer>
  <p>By <a href="${SITE}/about.html">${AUTHOR}</a> · <a href="${SITE}/about.html">CoastFIRE Finance</a> · This page is for informational purposes only and is not financial advice.</p>
  <p><a href="../privacy.html">Privacy</a> · <a href="../terms.html">Terms</a> · <a href="../about.html">About</a></p>
</footer>`;
}

function breadcrumbsHTML(crumbs) {
  // crumbs: [{name, href}, ...] — last one is current page (no link)
  const parts = crumbs.map((c, i) => {
    const isLast = i === crumbs.length - 1;
    return isLast ? `<span>${c.name}</span>` : `<a href="${c.href}">${c.name}</a> ›`;
  });
  return `<div class="crumbs">${parts.join(' ')}</div>`;
}

function breadcrumbsLD(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.href ? (c.href.startsWith('http') ? c.href : `${SITE}${c.href.replace('..', '')}`) : undefined,
    })),
  };
}

function articleLD(title, description, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    headline: title,
    description: description,
    image: `${SITE}/og-image.png`,
    datePublished: PUB_DATE,
    dateModified: TODAY,
    author: { '@type': 'Person', name: AUTHOR, url: SITE },
    publisher: {
      '@type': 'Organization',
      name: 'CoastFIRE Finance',
      logo: { '@type': 'ImageObject', url: `${SITE}/logo-square.svg` },
    },
  };
}

function faqLD(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '') },
    })),
  };
}

function faqsHTML(faqs) {
  return faqs.map(({ q, a }) => `
<details class="faq">
  <summary>${q}</summary>
  <div class="faq-body">${a}</div>
</details>`).join('\n');
}

// ─── PAGE TYPE A: AGE × INCOME MATRIX ─────────────────────────────────────
function renderMatrixPage(age, income) {
  const slug = `age-${age}-income-${fmtK(income)}.html`;
  const url  = `${SITE}/coastfire/${slug}`;
  const title = `CoastFIRE at Age ${age} with $${fmtK(income)} Income: How Much You Need (${TODAY.slice(0,4)})`;
  const description = `If you're ${age} earning ${fmtIncome(income)}/yr, here's exactly how much you need invested today to coast to retirement at 65 — with the math, monthly savings to get there, and scenario comparisons.`;

  // Math
  const annualSpend  = income * SPEND_RATIO;
  const fireTarget   = annualSpend * 25;
  const yrsToRet     = RETIRE_AGE - age;
  const coastNum     = coastFireToday(annualSpend, age);
  const typBal       = typicalBalance(age, income);
  const gap          = Math.max(0, coastNum - typBal);

  // Multi-spending-level table
  const spendLevels  = [0.50, 0.60, 0.70, 0.80];
  const spendRows    = spendLevels.map(ratio => {
    const sp = income * ratio;
    const cn = coastFireToday(sp, age);
    return { ratio, sp, cn };
  });

  // Years-to-CoastFIRE for various monthly savings amounts
  const monthlyOpts = [500, 1000, 1500, 2000, 3000];
  const monthlyRows = monthlyOpts.map(m => ({
    m,
    yrs: yearsToTarget(typBal, coastNum, m),
    ageAtCoast: age + yearsToTarget(typBal, coastNum, m),
  }));

  // Internal links to adjacent scenarios
  const adjAges = AGES.filter(a => Math.abs(a - age) <= 5 && a !== age).slice(0, 4);
  const adjIncs = INCOMES.filter(i => i !== income && Math.abs(Math.log(i/income)) < 0.6).slice(0, 4);

  const faqs = [
    {
      q: `How much do I need invested at ${age} to coast to retirement at 65?`,
      a: `Assuming you spend roughly 60% of your ${fmtIncome(income)} income in retirement (~${fmt0(annualSpend)}/yr) and earn a 5% real return, you need approximately <strong>${fmt0(coastNum)}</strong> invested today. From there, compound growth alone gets you to a $${fmt0(fireTarget)} portfolio by age 65 — without contributing another dollar.`,
    },
    {
      q: `What if my income is higher or lower than ${fmtIncome(income)}?`,
      a: `Your CoastFIRE number scales with retirement spending, not income. If you save aggressively and live on less than 60% of your salary, your number drops proportionally. Use our <a href="../index.html">CoastFIRE calculator</a> to plug in your actual numbers.`,
    },
    {
      q: `Is age ${age} ${age < 35 ? 'early' : age < 45 ? 'on track' : 'late'} for CoastFIRE?`,
      a: age < 35
        ? `Age ${age} is an excellent position. With ${yrsToRet} years of compounding ahead, every dollar you invest now does roughly ${(Math.pow(1.05, yrsToRet)).toFixed(1)}× the work it would do at 50. Front-loading savings in your 20s and early 30s is the highest-leverage move in personal finance.`
        : age < 45
        ? `Age ${age} is on track if you've been saving consistently. You still have ${yrsToRet} years of compounding — meaningful but not overwhelming. Catch-up is harder but absolutely achievable with a 20–25% savings rate.`
        : `Age ${age} is later than ideal but far from hopeless. With ${yrsToRet} years to retirement, you'll need a higher savings rate (25%+) and possibly delaying retirement to 67+. Catch-up contributions ($7,500/yr extra in 401(k) at 50+) help close the gap.`,
    },
    {
      q: `Does this assume Social Security?`,
      a: `No — the base CoastFIRE number above assumes the portfolio fully funds your retirement. If you include Social Security (typically $1,500–$2,500/mo at full retirement age), your portfolio target drops by roughly $375,000–$625,000 (at a 4% SWR). Use the calculator's Social Security toggle to see the impact.`,
    },
    {
      q: `What return assumption should I use?`,
      a: `This page uses <strong>5% real return</strong> (7% nominal minus 3% inflation), which matches the historical S&P 500 average and is a common conservative planning assumption. If you assume 6% real, your CoastFIRE number drops about 15%; at 4% real, it rises about 18%.`,
    },
  ];

  const ld = [
    articleLD(title, description, url),
    breadcrumbsLD([
      { name: 'Home', href: '/' },
      { name: 'CoastFIRE Scenarios', href: '/coastfire/' },
      { name: `Age ${age}, ${fmtIncome(income)}`, href: `/coastfire/${slug}` },
    ]),
    faqLD(faqs),
  ];

  return `${head(title, description, url, ld)}
<body>

${nav()}

<div class="wrap">

${breadcrumbsHTML([
  { name: 'Home', href: '../index.html' },
  { name: 'CoastFIRE Scenarios', href: './index.html' },
  { name: `Age ${age}, ${fmtIncome(income)}`, href: '' },
])}

<h1>CoastFIRE at Age ${age} with a ${fmtIncome(income)} Income</h1>
<div class="meta">By ${AUTHOR} · Updated ${TODAY} · 4 min read</div>

<p>If you're <strong>${age} years old</strong> earning <strong>${fmtIncome(income)}/year</strong>, this page shows the exact CoastFIRE number that lets you stop saving and let compound growth carry you to retirement at 65. We use a 5% real return (7% nominal, 3% inflation), a 4% safe withdrawal rate, and a baseline assumption that you'll spend about 60% of your current income in retirement.</p>

<div class="num-callout">
  <div class="lbl">Your CoastFIRE Number Today</div>
  <div class="val">${fmt0(coastNum)}</div>
  <div class="sub">Invest this much by age ${age}, never add another dollar, retire at ${RETIRE_AGE} on ${fmt0(annualSpend)}/yr</div>
</div>

<p>Once you hit ${fmt0(coastNum)} invested, you can — in theory — stop contributing entirely. Compound interest does the rest of the work, growing your portfolio to roughly <strong>${fmt0(fireTarget)}</strong> by age ${RETIRE_AGE}. That's enough to fund ${fmt0(annualSpend)}/year in retirement spending under the 4% rule.</p>

<a class="cta" href="../index.html">Calculate Your Exact CoastFIRE Number →</a>

<h2>How CoastFIRE Scales With Spending</h2>

<p>Your CoastFIRE number depends entirely on what you'll spend in retirement — not what you earn now. Here's how the target shifts based on your retirement spending ratio (% of current income):</p>

<table>
  <thead>
    <tr><th>Retirement Spending</th><th>Annual Spend</th><th>FIRE Number</th><th>CoastFIRE Today</th></tr>
  </thead>
  <tbody>
    ${spendRows.map(r => `<tr${r.ratio === SPEND_RATIO ? ' style="background:rgba(201,150,92,0.08)"' : ''}>
      <td>${(r.ratio * 100).toFixed(0)}% of income</td>
      <td>${fmt0(r.sp)}</td>
      <td>${fmt0(r.sp / SWR)}</td>
      <td><strong>${fmt0(r.cn)}</strong></td>
    </tr>`).join('\n    ')}
  </tbody>
</table>

<p class="meta">Highlighted row matches the 60% baseline used at the top of this page.</p>

<h2>How Long Until You Hit CoastFIRE?</h2>

<p>If you're starting from a typical balance for someone your age and income — roughly <strong>${fmt0(typBal)}</strong> based on a 12% savings rate since age 22 — here's how many more years of contributions you need to reach the ${fmt0(coastNum)} target:</p>

<table>
  <thead>
    <tr><th>Save / Month</th><th>Save / Year</th><th>Years to CoastFIRE</th><th>Age at CoastFIRE</th></tr>
  </thead>
  <tbody>
    ${monthlyRows.map(r => `<tr>
      <td>${fmt0(r.m)}</td>
      <td>${fmt0(r.m * 12)}</td>
      <td>${fmtYears(r.yrs)}</td>
      <td>${isFinite(r.ageAtCoast) ? Math.round(r.ageAtCoast) : '—'}</td>
    </tr>`).join('\n    ')}
  </tbody>
</table>

${gap > 0
  ? `<p>You're roughly <strong>${fmt0(gap)}</strong> short of CoastFIRE at your current estimated balance. The table above shows how aggressively you'd need to save to close that gap.</p>`
  : `<div class="callout"><strong>You may already be at or past CoastFIRE.</strong> Based on the typical balance for your age and income, you're at or above the ${fmt0(coastNum)} target. Run the calculator with your actual portfolio to confirm — and consider whether you want to coast or keep building a buffer.</div>`}

<h2>What to Do Next at Age ${age}</h2>

${age < 35
  ? `<p>You're in the highest-leverage decade for compounding. Concrete priorities:</p>
<ul>
  <li><strong>Max your employer match first</strong> — it's a guaranteed 50–100% return.</li>
  <li><strong>Then max a Roth IRA</strong> ($7,000/yr in 2026). Tax-free growth for 35+ years is mathematically extraordinary.</li>
  <li><strong>Then max your 401(k)</strong> ($23,500/yr in 2026). Even partial contributions compound enormously.</li>
  <li><strong>Avoid lifestyle inflation</strong> as raises come in. Banking 50% of every raise gets you to CoastFIRE years earlier.</li>
</ul>`
  : age < 45
  ? `<p>You're in your peak earning years. Concrete priorities:</p>
<ul>
  <li><strong>Aim for a 20–25% total savings rate</strong> across 401(k), IRA, and brokerage.</li>
  <li><strong>Open a brokerage bridge account</strong> if you might retire before 59½ — Roth IRA contributions and brokerage gains let you bridge the gap penalty-free.</li>
  <li><strong>Run a tax-bracket projection</strong>: at ${fmtIncome(income)}/yr, Traditional 401(k) is usually better than Roth for active deductions; Roth conversions in early retirement can clean up tax exposure later.</li>
  <li><strong>Don't neglect HSA contributions</strong> if you're on a high-deductible plan — triple tax-advantaged ($4,300 single / $8,550 family in 2026).</li>
</ul>`
  : `<p>You have ${yrsToRet} years to retirement — every year of high savings now matters disproportionately. Concrete priorities:</p>
<ul>
  <li><strong>Take the catch-up contributions</strong>: 50+ adds $7,500/yr extra to 401(k), $1,000 to IRA. At 60–63, the SECURE 2.0 super catch-up adds even more ($11,250 in 2026).</li>
  <li><strong>Consider working to 67 or 70</strong> — every extra year of work (and Social Security delay) drops your portfolio target by 5–8%.</li>
  <li><strong>Run the numbers with Social Security on</strong>. At ~$24,000/yr expected SS benefit, your portfolio need drops by ${fmt0(24000 / SWR)}.</li>
  <li><strong>Don't get aggressive in equities to "make up time"</strong> — sequence-of-returns risk is brutal for late starters. Stick to a balanced glide path.</li>
</ul>`
}

<h2>The CoastFIRE Math, Spelled Out</h2>

<p>Here's the calculation behind ${fmt0(coastNum)}:</p>

<div class="callout">
  <strong>Step 1.</strong> Annual retirement spending: <strong>${fmtIncome(income)} × 60% = ${fmt0(annualSpend)}/yr</strong><br>
  <strong>Step 2.</strong> FIRE number (4% rule): <strong>${fmt0(annualSpend)} × 25 = ${fmt0(fireTarget)}</strong><br>
  <strong>Step 3.</strong> Discount to today over ${yrsToRet} years at 5% real return:<br>
  &nbsp;&nbsp;&nbsp;&nbsp;<code>${fmt0(fireTarget)} / (1.05)^${yrsToRet} = <strong>${fmt0(coastNum)}</strong></code>
</div>

<p>That's it. Three lines of math. The big assumption is the 5% real return — which roughly matches the long-term S&P 500 average minus inflation, but isn't guaranteed in any given decade. The <a href="../index.html">main calculator</a> lets you stress-test it with Monte Carlo simulations.</p>

<h2>How This Compares to Adjacent Scenarios</h2>

<p>If your situation is different than the headline numbers, here are the closest matches:</p>

<div class="related">
  <h3>Same income (${fmtIncome(income)}), different ages</h3>
  <ul>
    ${adjAges.map(a => `<li><a href="age-${a}-income-${fmtK(income)}.html">CoastFIRE at age ${a} with ${fmtIncome(income)}: ${fmt0(coastFireToday(income * SPEND_RATIO, a))}</a></li>`).join('\n    ')}
  </ul>
</div>

<div class="related">
  <h3>Same age (${age}), different incomes</h3>
  <ul>
    ${adjIncs.map(i => `<li><a href="age-${age}-income-${fmtK(i)}.html">CoastFIRE at age ${age} with ${fmtIncome(i)}: ${fmt0(coastFireToday(i * SPEND_RATIO, age))}</a></li>`).join('\n    ')}
  </ul>
</div>

<a class="cta" href="../index.html">Run Your Own Numbers in the Calculator →</a>

<h2>Frequently Asked Questions</h2>

${faqsHTML(faqs)}

<div class="related" style="margin-top:36px">
  <h3>Read more</h3>
  <ul>
    <li><a href="../blog/what-is-coastfire.html">What Is CoastFIRE? The Complete Beginner's Guide</a></li>
    <li><a href="../blog/coastfire-at-30-vs-40.html">CoastFIRE at 30 vs 40: Why a 10-year head start changes everything</a></li>
    <li><a href="../blog/4-percent-rule-coastfire.html">The 4% Rule and CoastFIRE: How They Work Together</a></li>
    <li><a href="../blog/5-coastfire-mistakes.html">5 CoastFIRE Mistakes to Avoid</a></li>
  </ul>
</div>

</div>

${footer()}

</body>
</html>`;
}

// ─── PAGE TYPE B: SINGLE-AGE DEEP DIVE ────────────────────────────────────
function renderAgePage(age) {
  const slug = `at-age-${age}.html`;
  const url  = `${SITE}/coastfire/${slug}`;
  const title = `CoastFIRE at Age ${age}: Complete Guide & Calculator (${TODAY.slice(0,4)})`;
  const description = `Complete CoastFIRE guide for age ${age} — typical numbers, savings strategy, what to prioritize at this stage, and how to know if you're on track or behind.`;

  const yrsToRet = RETIRE_AGE - age;
  const compoundMultiplier = Math.pow(1 + REAL_RETURN, yrsToRet);

  // Show a table of CoastFIRE by income for this age
  const incomeRows = INCOMES.map(inc => ({
    inc,
    spend: inc * SPEND_RATIO,
    coast: coastFireToday(inc * SPEND_RATIO, age),
  }));

  const faqs = [
    {
      q: `What's a typical CoastFIRE number at age ${age}?`,
      a: `It depends entirely on your retirement spending. For a $75,000-income lifestyle (~$45,000/yr in retirement), CoastFIRE at ${age} is approximately <strong>${fmt0(coastFireToday(45000, age))}</strong>. For a $150,000 income (~$90,000/yr in retirement), it's around <strong>${fmt0(coastFireToday(90000, age))}</strong>. The full table above shows other income levels.`,
    },
    {
      q: `Is ${age} too late to start saving?`,
      a: age < 40
        ? `No — at ${age} you still have ${yrsToRet} years of compounding ahead. Every dollar you invest now will roughly ${compoundMultiplier.toFixed(1)}× by retirement (real, after inflation).`
        : age < 50
        ? `Not at all. With ${yrsToRet} years to retirement, you have meaningful compounding ahead. The math is harder than starting at 25, but a 20–25% savings rate over the next decade can still get you to CoastFIRE before 60.`
        : `Late, yes — impossible, no. With ${yrsToRet} years and the 50+ catch-up contributions, you can still reach CoastFIRE before 65, especially if you're willing to consider a part-time "BaristaFIRE" approach to bridge the final years.`,
    },
    {
      q: `How does ${age} compare to starting at 25?`,
      a: `Someone who hit CoastFIRE at 25 with a $300k portfolio would have roughly $${Math.round(300000 * Math.pow(1.05, age - 25) / 1000)}k by age ${age} without adding a dollar — that's the cost of waiting. The good news: starting at ${age} just means a higher savings rate and tighter spending control, not failure.`,
    },
    {
      q: `What return assumption is realistic?`,
      a: `This page uses <strong>5% real return</strong> (7% nominal minus 3% inflation). That matches the long-run S&P 500 average and is what most fee-only financial planners use. Some FIRE writers prefer 4% real (more conservative); a few use 7% real (more aggressive). Real-world Monte Carlo testing is in the <a href="../index.html">calculator</a>.`,
    },
  ];

  const ld = [
    articleLD(title, description, url),
    breadcrumbsLD([
      { name: 'Home', href: '/' },
      { name: 'CoastFIRE Scenarios', href: '/coastfire/' },
      { name: `Age ${age}`, href: `/coastfire/${slug}` },
    ]),
    faqLD(faqs),
  ];

  return `${head(title, description, url, ld)}
<body>

${nav()}

<div class="wrap">

${breadcrumbsHTML([
  { name: 'Home', href: '../index.html' },
  { name: 'CoastFIRE Scenarios', href: './index.html' },
  { name: `Age ${age}`, href: '' },
])}

<h1>CoastFIRE at Age ${age}: The Complete Guide</h1>
<div class="meta">By ${AUTHOR} · Updated ${TODAY} · 6 min read</div>

<p>You're ${age}. Retirement is ${yrsToRet} years away. The CoastFIRE question is simple: <em>how much do I need invested today so I can stop saving and still retire on time?</em></p>

<p>This guide answers that for several income levels, walks through what to prioritize at age ${age} specifically, and shows how the compound math actually works at this stage of your life.</p>

<a class="cta" href="../index.html">Calculate Your Exact Number →</a>

<h2>CoastFIRE Numbers at Age ${age} by Income</h2>

<p>The table below shows your CoastFIRE target at age ${age} based on your current household income, assuming you'll spend 60% of that in retirement and earn 5% real return:</p>

<table>
  <thead>
    <tr><th>Current Income</th><th>Retirement Spend</th><th>Total FIRE #</th><th>CoastFIRE Today</th></tr>
  </thead>
  <tbody>
    ${incomeRows.map(r => `<tr>
      <td><a href="age-${age}-income-${fmtK(r.inc)}.html" style="color:var(--accent2);text-decoration:none">${fmtIncome(r.inc)}</a></td>
      <td>${fmt0(r.spend)}</td>
      <td>${fmt0(r.spend / SWR)}</td>
      <td><strong>${fmt0(r.coast)}</strong></td>
    </tr>`).join('\n    ')}
  </tbody>
</table>

<p class="meta">Click any income level for a deeper breakdown specific to that scenario.</p>

<h2>Why Age ${age} Matters</h2>

<p>At ${age}, you have <strong>${yrsToRet} years of compounding</strong> available before traditional retirement age. Every dollar you invest today will grow to roughly <strong>${compoundMultiplier.toFixed(2)}× in real (after-inflation) value</strong> by 65.</p>

<div class="callout">
  <strong>The compounding leverage:</strong> $10,000 invested at age ${age} becomes <strong>${fmt0(10000 * compoundMultiplier)}</strong> by age ${RETIRE_AGE} (today's dollars), assuming 5% real return. The same $10,000 invested 10 years later becomes only ${fmt0(10000 * Math.pow(1.05, Math.max(yrsToRet - 10, 0)))} — a <strong>${((compoundMultiplier / Math.pow(1.05, Math.max(yrsToRet - 10, 0)) - 1) * 100).toFixed(0)}% penalty</strong> for waiting a decade.
</div>

${age < 35
  ? `<p>You're in the highest-leverage decade for retirement saving. Money you invest in your 20s and early 30s does roughly 4–6× the work of money invested in your 40s, simply because of how compound growth stacks. This is the time to be aggressive — high savings rate, all-equity portfolio, max every tax-advantaged vehicle you can.</p>`
  : age < 45
  ? `<p>You're in your peak earning years and still have substantial compounding ahead. The math at ${age} is forgiving but not generous — you can absolutely reach CoastFIRE by 50, but it requires sustained 20%+ savings rates and avoiding lifestyle inflation as your income grows.</p>`
  : age < 55
  ? `<p>At ${age}, the runway is shorter but the levers are still real. Catch-up contributions (50+) add $7,500/yr to your 401(k) limit. Most importantly: every year you delay retirement past 65 reduces your portfolio target by ~6%, both because you save longer and your money compounds another year.</p>`
  : `<p>At ${age}, you're close enough to retirement that the math becomes about portfolio durability, not accumulation. Sequence-of-returns risk is the dominant factor — a 30% market drop in the first 5 years of retirement is much worse than the same drop at 75. Consider a slightly more conservative allocation and a healthy cash buffer.</p>`
}

<h2>What to Prioritize at Age ${age}</h2>

<ol>
  ${age < 35 ? `
  <li><strong>Capture every dollar of employer match.</strong> A 50% match is a 50% guaranteed return — nothing else in finance comes close.</li>
  <li><strong>Max your Roth IRA</strong> ($7,000/yr in 2026). At your age, tax-free growth for 30+ years is mathematically extraordinary.</li>
  <li><strong>Build to a 20%+ total savings rate</strong> across 401(k), IRA, and brokerage.</li>
  <li><strong>Don't pre-invest your future raises.</strong> Each raise is an opportunity to bank 50%+ of the increase before lifestyle creep claims it.</li>
  <li><strong>Avoid actively managed funds and high fees.</strong> A 1% fee compounds to roughly 28% of your portfolio gone over 30 years.</li>` : age < 45 ? `
  <li><strong>Audit your savings rate.</strong> Aim for 20–25% of gross household income across all retirement vehicles.</li>
  <li><strong>Max the 401(k) if you can</strong> ($23,500 in 2026). At your tax bracket, the deduction is meaningful.</li>
  <li><strong>Open a brokerage bridge account</strong> if you might retire before 59½. Roth IRA contributions can be withdrawn anytime; brokerage gains at LTCG rates fill the rest.</li>
  <li><strong>HSA if eligible</strong> — triple tax-advantaged, $4,300 single / $8,550 family in 2026.</li>
  <li><strong>Run an estate-planning check</strong>: beneficiary designations, basic will, power of attorney. Boring but critical.</li>` : age < 55 ? `
  <li><strong>Take the catch-up contributions.</strong> At 50+, the 401(k) limit jumps by $7,500 and the IRA by $1,000.</li>
  <li><strong>Project your tax brackets in retirement.</strong> At ${age}, you can model whether to lean more Traditional (deduct now, taxed later) or Roth (taxed now, free later) based on expected retirement income.</li>
  <li><strong>Consider Roth conversions</strong> if you have significant Traditional balances and expect higher tax brackets later (RMDs at 73 surprise people).</li>
  <li><strong>Build cash reserves</strong> equivalent to 1–2 years of spending. Sequence-of-returns risk is real now.</li>
  <li><strong>Decide your retirement age</strong> with intent. Working to 67 or 70 reduces your portfolio target dramatically and increases Social Security.</li>` : `
  <li><strong>Maximize the 60–63 super catch-up</strong> ($11,250 extra into 401(k) under SECURE 2.0).</li>
  <li><strong>Run a Social Security claiming analysis.</strong> Delaying from 62 to 70 raises your monthly benefit by ~76%.</li>
  <li><strong>Reduce equity allocation gradually</strong> (e.g. 70/30 → 60/40) to manage sequence risk.</li>
  <li><strong>Plan your healthcare bridge</strong> if retiring before 65. ACA subsidies, COBRA, spouse coverage — pick a path.</li>
  <li><strong>Strategic Roth conversions</strong> in low-income years between retirement and Social Security can save five+ figures in lifetime tax.</li>`}
</ol>

<a class="cta" href="../index.html">See Your Personalized CoastFIRE Number →</a>

<h2>Frequently Asked Questions</h2>

${faqsHTML(faqs)}

<div class="related" style="margin-top:36px">
  <h3>Read more on CoastFIRE</h3>
  <ul>
    <li><a href="../blog/what-is-coastfire.html">What Is CoastFIRE? The Complete Beginner's Guide</a></li>
    <li><a href="../blog/coastfire-at-30-vs-40.html">CoastFIRE at 30 vs 40: Why a 10-year head start changes everything</a></li>
    <li><a href="../blog/coastfire-vs-baristafire.html">CoastFIRE vs BaristaFIRE: Which One Is Right for You?</a></li>
    <li><a href="../blog/4-percent-rule-coastfire.html">The 4% Rule and CoastFIRE</a></li>
    <li><a href="./index.html">All CoastFIRE Scenarios</a></li>
  </ul>
</div>

</div>

${footer()}

</body>
</html>`;
}

// ─── PAGE TYPE C: PROFESSION ──────────────────────────────────────────────
function renderProfessionPage(prof) {
  const slug = `for-${prof.slug}.html`;
  const url  = `${SITE}/coastfire/${slug}`;
  const title = `CoastFIRE for ${prof.name}: Income, Pension, and Account Strategy (${TODAY.slice(0,4)})`;
  const description = `CoastFIRE planning for ${prof.name}: typical income (${fmt0(prof.typIncome)}), the right account types (${prof.accountType}), and how ${prof.hasPension ? 'pension benefits change' : 'no-pension careers handle'} the math.`;

  const annualSpend = prof.typIncome * SPEND_RATIO;
  const coastNum    = coastFireToday(annualSpend, 35); // anchor age
  const ageRows     = [25, 30, 35, 40, 45, 50].map(age => ({
    age,
    coast: coastFireToday(annualSpend, age),
  }));

  const faqs = [
    {
      q: `What's a realistic CoastFIRE number for ${prof.name.toLowerCase()}?`,
      a: `At a typical income of ${fmt0(prof.typIncome)} and assuming 60% income replacement in retirement, the CoastFIRE number for a 35-year-old is approximately <strong>${fmt0(coastNum)}</strong>. The full table above shows other ages.`,
    },
    {
      q: `Should ${prof.name.toLowerCase()} prioritize ${prof.accountType.split(' ').slice(0,2).join(' ')} or Roth IRA?`,
      a: `Capture employer match first (free money), then prioritize Roth IRA at lower incomes (under $100k single / $200k MFJ) for tax-free growth. Above those incomes, the deduction in a Traditional ${prof.accountType.split(' ')[0]} usually wins. Mega-backdoor Roth (if available) is the gold-standard top-up.`,
    },
    {
      q: prof.hasPension
        ? `How much does my pension change my CoastFIRE number?`
        : `Without a pension, do I need to save more?`,
      a: prof.hasPension
        ? `A lot. Every $1,000/year of expected pension income lowers your portfolio target by about $25,000 (4% rule). A typical $30,000/yr pension reduces your CoastFIRE number by roughly $750,000.`
        : `Compared to pension-eligible careers, yes — your portfolio has to do all the heavy lifting. The flip side: no vesting cliffs, full portability when you switch jobs, and your money is yours regardless of employer drama.`,
    },
    {
      q: `What's the biggest CoastFIRE mistake for ${prof.name.toLowerCase()}?`,
      a: prof.note,
    },
  ];

  const ld = [
    articleLD(title, description, url),
    breadcrumbsLD([
      { name: 'Home', href: '/' },
      { name: 'CoastFIRE Scenarios', href: '/coastfire/' },
      { name: `For ${prof.name}`, href: `/coastfire/${slug}` },
    ]),
    faqLD(faqs),
  ];

  return `${head(title, description, url, ld)}
<body>

${nav()}

<div class="wrap">

${breadcrumbsHTML([
  { name: 'Home', href: '../index.html' },
  { name: 'CoastFIRE Scenarios', href: './index.html' },
  { name: `For ${prof.name}`, href: '' },
])}

<h1>CoastFIRE for ${prof.name}</h1>
<div class="meta">By ${AUTHOR} · Updated ${TODAY} · 5 min read</div>

<p>${prof.name} have a specific CoastFIRE setup: typical incomes around <strong>${fmt0(prof.typIncome)}</strong>, ${prof.hasPension ? 'access to pension benefits, ' : ''}and primary tax-advantaged accounts in the <strong>${prof.accountType}</strong> family. This guide walks through what those numbers look like and how ${prof.hasPension ? 'the pension' : 'a no-pension career'} changes the math.</p>

<div class="callout">
  ${prof.note}
</div>

<div class="num-callout">
  <div class="lbl">CoastFIRE at Age 35 for a Typical ${prof.name.replace(/s$/,'')}</div>
  <div class="val">${fmt0(coastNum)}</div>
  <div class="sub">Based on ${fmt0(prof.typIncome)} income, 60% replacement ratio, 5% real return</div>
</div>

<a class="cta" href="../index.html">Run Your Own CoastFIRE Numbers →</a>

<h2>CoastFIRE Numbers by Age for ${prof.name}</h2>

<table>
  <thead>
    <tr><th>Age</th><th>Years to 65</th><th>CoastFIRE Today</th></tr>
  </thead>
  <tbody>
    ${ageRows.map(r => `<tr>
      <td>${r.age}</td>
      <td>${RETIRE_AGE - r.age}</td>
      <td><strong>${fmt0(r.coast)}</strong></td>
    </tr>`).join('\n    ')}
  </tbody>
</table>

<p>The table assumes your retirement spending is 60% of your current income (~${fmt0(annualSpend)}/yr) and a 5% real return on investments.</p>

<h2>Account Strategy for ${prof.name}</h2>

<p>${prof.name} typically have access to <strong>${prof.accountType}</strong>. Here's the priority order most fee-only planners recommend:</p>

<ol>
  <li><strong>Employer match first</strong> — contribute enough to capture every match dollar. This is a guaranteed return that beats every other investment.</li>
  ${prof.hasPension ? `<li><strong>Understand your pension vesting schedule</strong> — many pensions require 5–10 years of service before you're vested. Leaving early can forfeit huge amounts.</li>` : ''}
  <li><strong>Max a Roth IRA if eligible</strong> ($7,000/yr in 2026; $8,000 if 50+). Income limits: phase out at $150–165k single / $236–246k MFJ in 2026.</li>
  <li><strong>Max your primary workplace plan</strong> ($23,500 in 2026 for ${prof.accountType.split(' ')[0]}; $31,000 if 50+).</li>
  ${prof.slug === 'engineers' || prof.slug === 'doctors' || prof.slug === 'small-business-owners' ? `<li><strong>Mega-backdoor Roth if available</strong> — total 401(k) limit is $70,000 in 2026 (employee + employer + after-tax). The after-tax portion can be converted to Roth.</li>` : ''}
  ${prof.slug === 'freelancers' || prof.slug === 'small-business-owners' ? `<li><strong>HSA if on a high-deductible plan</strong> — triple tax-advantaged, $4,300 single / $8,550 family.</li>` : `<li><strong>HSA if eligible</strong> ($4,300 single / $8,550 family in 2026) — best tax-advantaged account in existence.</li>`}
  <li><strong>Brokerage for everything beyond that</strong> — taxable, but flexible, no contribution limits, and LTCG rates (15% for most) are friendlier than ordinary income.</li>
</ol>

${prof.hasPension ? `<h2>The Pension Math</h2>

<p>A pension is mathematically equivalent to a bond paying you a guaranteed amount for life. To estimate its "lump sum equivalent":</p>

<div class="callout">
  <strong>Lump sum value</strong> ≈ <code>annual pension × 25</code> (4% rule)<br><br>
  Example: a $36,000/year pension at retirement = a <strong>${fmt0(36000 * 25)} portfolio equivalent</strong>.
</div>

<p>That's why pension-eligible workers can hit CoastFIRE much earlier — half (or more) of your retirement income is already "saved" through your job. Run the calculator's pension toggle to see your specific number.</p>` : ''}

<h2>What Could Go Wrong</h2>

<ul>
  <li><strong>Job change before vesting</strong>${prof.hasPension ? ' — losing your pension without vesting is the most expensive mistake on this page.' : ' — leaving a 401(k) match table on the table when you switch jobs.'}</li>
  <li><strong>Lifestyle inflation as income grows</strong> — a $30k raise can become $30k of extra spending if you're not intentional.</li>
  <li><strong>Disability or income loss</strong> — own-occupation disability insurance is non-negotiable for ${prof.name.toLowerCase()} who depend on a specific skillset.</li>
  <li><strong>Sequence-of-returns risk in early retirement</strong> — a 30% drop in year 1 of retirement can permanently impair your portfolio if you don't have a cash buffer.</li>
</ul>

<a class="cta" href="../index.html">Build Your CoastFIRE Plan in the Calculator →</a>

<h2>Frequently Asked Questions</h2>

${faqsHTML(faqs)}

<div class="related" style="margin-top:36px">
  <h3>Read more</h3>
  <ul>
    <li><a href="../blog/what-is-coastfire.html">What Is CoastFIRE? The Complete Beginner's Guide</a></li>
    <li><a href="../blog/coastfire-vs-baristafire.html">CoastFIRE vs BaristaFIRE</a></li>
    <li><a href="../blog/5-coastfire-mistakes.html">5 CoastFIRE Mistakes to Avoid</a></li>
    <li><a href="./index.html">All CoastFIRE Scenarios</a></li>
  </ul>
</div>

</div>

${footer()}

</body>
</html>`;
}

// ─── HUB PAGE: /coastfire/index.html ──────────────────────────────────────
function renderHubPage() {
  const url   = `${SITE}/coastfire/`;
  const title = `CoastFIRE Scenarios: Calculate Your Number by Age, Income, or Career (${TODAY.slice(0,4)})`;
  const description = `Browse CoastFIRE numbers for every age (25–55) × income ($50k–$250k), single-age guides, and profession-specific strategies. Find your scenario and get your CoastFIRE target in seconds.`;

  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url,
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: 'CoastFIRE Finance', url: SITE },
    },
    breadcrumbsLD([
      { name: 'Home', href: '/' },
      { name: 'CoastFIRE Scenarios', href: '/coastfire/' },
    ]),
  ];

  // Build matrix table
  const matrixRows = AGES.map(age => {
    const cells = INCOMES.map(inc => {
      const target = coastFireToday(inc * SPEND_RATIO, age);
      return `<td><a href="age-${age}-income-${fmtK(inc)}.html" style="color:var(--text);text-decoration:none;display:block">${fmt0(target)}</a></td>`;
    });
    return `<tr><th style="text-align:left;color:var(--accent2)">Age ${age}</th>${cells.join('')}</tr>`;
  });

  return `${head(title, description, url, ld)}
<body>

${nav()}

<div class="wrap" style="max-width:880px">

${breadcrumbsHTML([
  { name: 'Home', href: '../index.html' },
  { name: 'CoastFIRE Scenarios', href: '' },
])}

<h1>CoastFIRE Scenarios</h1>
<div class="meta">By ${AUTHOR} · Updated ${TODAY} · Hub of pre-computed scenarios</div>

<p>Find your CoastFIRE number by age and income, dive into a specific age guide, or see how your career affects the math. Every page here uses the same conservative model: 60% income replacement in retirement, 5% real return, 4% safe withdrawal rate, retirement at 65.</p>

<a class="cta" href="../index.html">Skip the scenarios — open the calculator →</a>

<h2>By Age × Income</h2>
<p>Click any cell to see the full breakdown for that scenario:</p>

<div style="overflow-x:auto;margin:16px 0">
<table>
  <thead>
    <tr><th></th>${INCOMES.map(i => `<th style="text-align:right;color:var(--accent2)">${fmtIncome(i)}</th>`).join('')}</tr>
  </thead>
  <tbody>
    ${matrixRows.join('\n    ')}
  </tbody>
</table>
</div>

<h2>By Age (Deep-Dive Guides)</h2>
<div class="related">
  <ul>
    ${SINGLE_AGE_GUIDES.map(a => `<li><a href="at-age-${a}.html">CoastFIRE at age ${a}: complete guide</a></li>`).join('\n    ')}
  </ul>
</div>

<h2>By Career</h2>
<div class="related">
  <ul>
    ${PROFESSIONS.map(p => `<li><a href="for-${p.slug}.html">CoastFIRE for ${p.name}</a></li>`).join('\n    ')}
  </ul>
</div>

<h2>How These Numbers Are Calculated</h2>
<p>Every page uses three simple steps:</p>
<ol>
  <li><strong>Estimate retirement spending</strong>: 60% of current income (typical replacement ratio).</li>
  <li><strong>Compute the FIRE number</strong>: annual spending × 25 (the 4% safe withdrawal rule).</li>
  <li><strong>Discount to today</strong>: divide by (1.05)^(years until 65), where 5% is the assumed real return.</li>
</ol>
<p>The result is the amount you'd need invested today such that, even if you never contributed another dollar, compound growth alone would carry you to a fully-funded retirement at 65. That's CoastFIRE.</p>

<div class="callout">
  <strong>Want to override the assumptions?</strong> The <a href="../index.html">main calculator</a> lets you set your own retirement age, spending, return, withdrawal rate, tax assumptions, and pension/Social Security inputs. It also runs Monte Carlo simulations to stress-test your plan.
</div>

<a class="cta" href="../index.html">Open the Full CoastFIRE Calculator →</a>

</div>

${footer()}

</body>
</html>`;
}

// ─── SITEMAP UPDATER ──────────────────────────────────────────────────────
function buildSitemap(pseoUrls) {
  const staticEntries = [
    { loc: `${SITE}/`,                                    priority: '1.0', changefreq: 'weekly',  lastmod: TODAY },
    { loc: `${SITE}/blog/what-is-coastfire.html`,         priority: '0.8', changefreq: 'monthly', lastmod: '2026-04-20' },
    { loc: `${SITE}/blog/coastfire-vs-baristafire.html`,  priority: '0.8', changefreq: 'monthly', lastmod: '2026-04-20' },
    { loc: `${SITE}/blog/coastfire-at-30-vs-40.html`,     priority: '0.8', changefreq: 'monthly', lastmod: '2026-04-20' },
    { loc: `${SITE}/blog/my-coastfire-journey.html`,      priority: '0.7', changefreq: 'monthly', lastmod: '2026-04-20' },
    { loc: `${SITE}/blog/5-coastfire-mistakes.html`,      priority: '0.8', changefreq: 'monthly', lastmod: '2026-04-20' },
    { loc: `${SITE}/blog/4-percent-rule-coastfire.html`,  priority: '0.8', changefreq: 'monthly', lastmod: '2026-04-20' },
    { loc: `${SITE}/blog/roth-ira-coastfire.html`,        priority: '0.8', changefreq: 'monthly', lastmod: '2026-04-22' },
    { loc: `${SITE}/about.html`,                          priority: '0.6', changefreq: 'yearly',  lastmod: '2026-04-22' },
    { loc: `${SITE}/privacy.html`,                        priority: '0.3', changefreq: 'yearly',  lastmod: '2026-04-22' },
    { loc: `${SITE}/terms.html`,                          priority: '0.3', changefreq: 'yearly',  lastmod: '2026-04-22' },
    { loc: `${SITE}/coastfire/`,                          priority: '0.7', changefreq: 'weekly',  lastmod: TODAY },
  ];

  const pseoEntries = pseoUrls.map(u => ({
    loc: u, priority: '0.6', changefreq: 'monthly', lastmod: TODAY,
  }));

  const all = [...staticEntries, ...pseoEntries];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.map(e => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const written = [];
  const sitemapUrls = [];

  // Type A: Age × Income matrix
  for (const age of AGES) {
    for (const income of INCOMES) {
      const slug = `age-${age}-income-${fmtK(income)}.html`;
      const html = renderMatrixPage(age, income);
      fs.writeFileSync(path.join(OUT_DIR, slug), html);
      written.push(slug);
      sitemapUrls.push(`${SITE}/coastfire/${slug}`);
    }
  }

  // Type B: Single-age deep dives
  for (const age of SINGLE_AGE_GUIDES) {
    const slug = `at-age-${age}.html`;
    const html = renderAgePage(age);
    fs.writeFileSync(path.join(OUT_DIR, slug), html);
    written.push(slug);
    sitemapUrls.push(`${SITE}/coastfire/${slug}`);
  }

  // Type C: Profession pages
  for (const prof of PROFESSIONS) {
    const slug = `for-${prof.slug}.html`;
    const html = renderProfessionPage(prof);
    fs.writeFileSync(path.join(OUT_DIR, slug), html);
    written.push(slug);
    sitemapUrls.push(`${SITE}/coastfire/${slug}`);
  }

  // Hub page
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), renderHubPage());
  written.push('index.html');

  // Sitemap
  fs.writeFileSync(SITEMAP, buildSitemap(sitemapUrls));

  // Report
  console.log(`\n✅ Generated ${written.length} pages in /coastfire/`);
  console.log(`   • Age × Income matrix: ${AGES.length * INCOMES.length} pages`);
  console.log(`   • Single-age guides:   ${SINGLE_AGE_GUIDES.length} pages`);
  console.log(`   • Profession pages:    ${PROFESSIONS.length} pages`);
  console.log(`   • Hub page:            1`);
  console.log(`\n📍 Sitemap updated: ${SITEMAP}`);
  console.log(`   Total URLs in sitemap: ${sitemapUrls.length + 12}`);
  console.log(`\n📊 Sample CoastFIRE numbers:`);
  console.log(`   Age 30, $80k income → ${fmt0(coastFireToday(80000 * SPEND_RATIO, 30))}`);
  console.log(`   Age 40, $100k income → ${fmt0(coastFireToday(100000 * SPEND_RATIO, 40))}`);
  console.log(`   Age 50, $150k income → ${fmt0(coastFireToday(150000 * SPEND_RATIO, 50))}`);
  console.log(`\n🔗 Next steps:`);
  console.log(`   1. Open coastfire/index.html in your browser to spot-check pages.`);
  console.log(`   2. Commit & push — Netlify auto-deploys.`);
  console.log(`   3. In Google Search Console, submit the new sitemap URL.`);
  console.log(`   4. Re-run this script periodically (or after content updates) to refresh lastmod dates.`);
  console.log('');
}

main();
