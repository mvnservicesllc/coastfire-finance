// Netlify Function: answer CoastFIRE questions in-page via the Claude API.
//
// The browser posts { question, context, history } where `context` is a plain
// text snapshot of the user's calculator state. We never persist anything —
// each request is stateless and the conversation is replayed from the client.
//
// Required env var (set in Netlify UI → Site settings → Environment variables):
//   ANTHROPIC_API_KEY
//
// Optional:
//   ASK_MODEL          default "claude-haiku-5-5"
//   ASK_DAILY_CAP      default 2000 — soft global request cap per UTC day

const MODEL       = process.env.ASK_MODEL || 'claude-haiku-5-5';
const MAX_TOKENS  = 700;
const DAILY_CAP   = parseInt(process.env.ASK_DAILY_CAP || '2000', 10);

// Per-IP throttle + global daily counter. In-memory, so it resets whenever the
// function cold-starts. Good enough to blunt casual abuse; it is not a security
// boundary. Netlify's own rate limiting sits in front of this.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX       = 8;
const hits = new Map();
let dayKey = '';
let dayCount = 0;

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 });
  } else if (rec.n >= RATE_MAX) {
    return true;
  } else {
    rec.n++;
  }
  // Opportunistic cleanup so the map can't grow without bound.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now - v.start > RATE_WINDOW_MS) hits.delete(k);
  }
  return false;
}

function overDailyCap() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; dayCount = 0; }
  if (dayCount >= DAILY_CAP) return true;
  dayCount++;
  return false;
}

const SYSTEM_PROMPT = `You are the built-in assistant for coastfirefinance.com, a CoastFIRE calculator.

The user's current calculator inputs and results are provided below. Answer their question using those specific numbers — never generic advice when you can cite their actual figures.

HOW THIS CALCULATOR MODELS THINGS (so your answers stay consistent with what's on screen):
- CoastFIRE = the portfolio where compound growth alone reaches the full FIRE number by retirement age, with zero further contributions.
- Net FIRE # = (gross spending need ÷ SWR) minus pension/SS/other income offsets, plus the present value of any mortgage payments still due after retirement.
- Portfolio withdrawals, Social Security, and taxable pension/other income are treated as pre-tax, taxed at a blended rate derived from the Traditional share of the portfolio. Pension and Other Income each have a taxable/tax-free toggle.
- Before age 59½ only brokerage and Roth IRA contribution basis are penalty-free; Traditional 401k/IRA, Roth 401k, and Roth IRA earnings are locked.
- A fixed-rate mortgage is a flat nominal stream that never inflates and terminates at payoff, so it is added as a lump-sum present value rather than multiplied by the SWR.
- Healthspan = active, mobile, cognitively sharp years; lifespan = total years. The gap is typically 8–12 years. Time value escalates convexly toward end of healthspan.

RULES:
- Be concise. 2-4 short paragraphs or a tight list. No preamble.
- Use their actual numbers. Round sensibly ($486K not $486,213.44).
- Markdown is supported: **bold**, lists, and simple tables render correctly.
- You are not a licensed financial advisor. For anything requiring personalized investment, tax, or legal advice, give the general mechanics and suggest a fee-only fiduciary. Say this once, briefly, only when genuinely warranted — do not append a disclaimer to every answer.
- If a question needs a number the calculator doesn't track, say so plainly and tell them which input would surface it.
- If asked something unrelated to personal finance or this tool, decline in one sentence and redirect.`;

export default async (req) => {
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: 'not_configured',
      message: 'The in-page assistant is not set up yet. ANTHROPIC_API_KEY is missing.',
    }), { status: 503, headers: cors });
  }

  const ip = req.headers.get('x-nf-client-connection-ip')
          || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || 'unknown';

  if (rateLimited(ip)) {
    return new Response(JSON.stringify({
      error: 'rate_limited',
      message: 'Slow down a moment — try again in a minute.',
    }), { status: 429, headers: cors });
  }
  if (overDailyCap()) {
    return new Response(JSON.stringify({
      error: 'daily_cap',
      message: "The assistant has hit today's usage cap. Try again tomorrow, or use the Copy prompt button to ask in ChatGPT or Claude.",
    }), { status: 429, headers: cors });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400, headers: cors }); }

  const question = String(body.question || '').slice(0, 2000).trim();
  const context  = String(body.context  || '').slice(0, 8000);
  const history  = Array.isArray(body.history) ? body.history.slice(-6) : [];

  if (!question) {
    return new Response(JSON.stringify({ error: 'Empty question' }), { status: 400, headers: cors });
  }

  // Replay prior turns, then the current question with fresh context attached.
  const messages = [];
  for (const h of history) {
    const role = h.role === 'assistant' ? 'assistant' : 'user';
    const text = String(h.content || '').slice(0, 4000);
    if (text) messages.push({ role, content: text });
  }
  messages.push({
    role: 'user',
    content: `Here is my current calculator state:\n\n${context}\n\n---\n\nMy question: ${question}`,
  });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('Anthropic API error', res.status, detail.slice(0, 500));
      const msg = res.status === 429
        ? 'The assistant is busy right now — try again shortly.'
        : 'The assistant could not answer that. Try rephrasing, or use the Copy prompt button.';
      return new Response(JSON.stringify({ error: 'upstream', message: msg }), { status: 502, headers: cors });
    }

    const data = await res.json();
    const answer = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return new Response(JSON.stringify({
      answer: answer || 'No answer returned. Try rephrasing the question.',
      usage: data.usage || null,
    }), { status: 200, headers: cors });

  } catch (err) {
    console.error('ask function failed:', err);
    return new Response(JSON.stringify({
      error: 'internal',
      message: 'Something went wrong reaching the assistant. Try again in a moment.',
    }), { status: 500, headers: cors });
  }
};

export const config = { path: '/api/ask' };
