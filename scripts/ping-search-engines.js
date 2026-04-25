#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
 * ping-search-engines.js — Notify search engines of new/updated URLs
 *
 * Pings:
 *   • IndexNow (Bing, Yandex, Seznam, Naver) — instant indexing protocol
 *   • Google sitemap ping — Google deprecated direct ping, but submitting
 *     a fresh sitemap to GSC manually is what works now.
 *
 * Usage:
 *   node scripts/ping-search-engines.js          # ping all coastfire/* URLs
 *   node scripts/ping-search-engines.js --all    # ping every URL in sitemap
 *   node scripts/ping-search-engines.js URL [URL ...]   # specific URLs
 *
 * One-time setup:
 *   1. Generate an IndexNow key at https://www.bing.com/indexnow
 *   2. Save it to a file at the site root: <key>.txt containing just the key
 *   3. Set the INDEXNOW_KEY environment variable, OR replace the placeholder below.
 *
 * Note: IndexNow is rate-limited (~10k URLs/day per host). For programmatic SEO
 * pages, this is plenty. For sites with millions of URLs, batch carefully.
 * ────────────────────────────────────────────────────────────────────────── */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const SITE          = 'coastfirefinance.com';
const SITEMAP_FILE  = path.resolve(__dirname, '..', 'sitemap.xml');
const INDEXNOW_KEY  = process.env.INDEXNOW_KEY || 'PASTE_YOUR_INDEXNOW_KEY_HERE';

// ─── Read URLs from CLI args, sitemap, or default to coastfire/* ─────────
function getUrls() {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] !== '--all') {
    return args; // explicit URL list
  }

  const sitemap = fs.readFileSync(SITEMAP_FILE, 'utf8');
  const allUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

  if (args[0] === '--all') return allUrls;

  // Default: just /coastfire/* URLs (the new programmatic SEO pages)
  return allUrls.filter(u => u.includes('/coastfire/'));
}

// ─── IndexNow submission ─────────────────────────────────────────────────
function submitToIndexNow(urls) {
  if (INDEXNOW_KEY === 'PASTE_YOUR_INDEXNOW_KEY_HERE') {
    console.log('\n⚠️  IndexNow key not set. Skipping IndexNow ping.');
    console.log('   1. Generate a key at https://www.bing.com/indexnow');
    console.log(`   2. Save the key to ${SITE}/<key>.txt at the site root`);
    console.log('   3. Set INDEXNOW_KEY env var or edit this script\n');
    return Promise.resolve(null);
  }

  const payload = JSON.stringify({
    host: SITE,
    key: INDEXNOW_KEY,
    keyLocation: `https://${SITE}/${INDEXNOW_KEY}.txt`,
    urlList: urls,
  });

  const options = {
    hostname: 'api.indexnow.org',
    port: 443,
    path: '/IndexNow',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        console.log(`   IndexNow → ${res.statusCode} ${ok ? '✅' : '⚠️'} ${body || '(empty)'}`);
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.on('error', err => {
      console.log(`   IndexNow → ❌ ${err.message}`);
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

// ─── Bing direct sitemap ping (still works) ──────────────────────────────
function pingBingSitemap() {
  const url = `https://www.bing.com/ping?sitemap=https://${SITE}/sitemap.xml`;
  return new Promise(resolve => {
    https.get(url, res => {
      console.log(`   Bing sitemap → ${res.statusCode} ${res.statusCode < 400 ? '✅' : '⚠️'}`);
      resolve(res.statusCode);
      res.resume();
    }).on('error', err => {
      console.log(`   Bing sitemap → ❌ ${err.message}`);
      resolve(null);
    });
  });
}

// ─── MAIN ────────────────────────────────────────────────────────────────
async function main() {
  const urls = getUrls();
  console.log(`\n🚀 Pinging search engines for ${urls.length} URL${urls.length === 1 ? '' : 's'}…\n`);
  if (urls.length <= 5) urls.forEach(u => console.log(`   • ${u}`));
  else { urls.slice(0, 3).forEach(u => console.log(`   • ${u}`)); console.log(`   • ... and ${urls.length - 3} more`); }

  console.log('\n📡 Pinging…');

  // IndexNow (Bing, Yandex, Seznam, Naver, Microsoft Bing)
  await submitToIndexNow(urls);

  // Bing sitemap ping (still supported)
  await pingBingSitemap();

  console.log('\n✨ Done.');
  console.log('   • For Google: GSC sitemap submissions are the only reliable path.');
  console.log('     Open https://search.google.com/search-console → Sitemaps → submit sitemap.xml');
  console.log('   • IndexNow updates Bing within minutes; Google can take days–weeks.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
