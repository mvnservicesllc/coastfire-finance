// Netlify Function: answer CoastFIRE questions in-page via the Claude API.
//
// The browser posts { question, context, history }, where `context` is a plain
// text snapshot of the user's calculator state. Nothing is persisted — each
// request is stateless and the conversation is replayed from the client.
//
// Required env var (Netlify → Site configuration → Environment variables):
//   ANTHROPIC_API_KEY   e.g. sk-ant-api03-...
//
// Optional:
//   ASK_MODEL       default "claude-haiku-5-5" (see note below)
//   ASK_DAILY_CAP   default 2000 — soft global request cap per UTC day
//   ASK_EFFORT      default "low" — low | medium | high
//
// Model note: Haiku 5.5 is the default because this is a public widget answering
// short questions over context we hand it, and the site owner pays per query —
// roughly $0.0004 a question versus ~$0.017 on Opus 5.5, a ~40x difference.
// Set ASK_MODEL=claude-opus-5-5 for noticeably better reasoning on open-ended
// "what am I missing?" questions.

import Anthropic from '@anthropic-ai/sdk';

const MODEL      = process.env.ASK_MODEL || 'claude-haiku-5-5';
const EFFORT     = process.env.ASK_EFFORT || 'low';
const MAX_TOKENS = 1500;
const DAILY_CAP  = parseInt(process.env.ASK_DAILY_CAP || '2000', 10);

// Per-IP throttle plus a global daily counter. In-memory, so it resets on every
// cold start — enough to blunt casual abuse, not a security boundary.
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

// Frozen string — no dates, IDs or per-request values, so it stays byte-identical
// and caches. Comfortably over the 512-token minimum for Haiku 5.5.
const SYSTEM_PROMPT = `You are the built-in assistant for coastfirefinance.com, a CoastFIRE calculator.

The user's current calculator inputs and results are provided with each question. Answer using those specific numbers — never generic advice where you can cite their actual figures.

HOW THIS CALCULATOR MODELS THINGS (keep answers consistent with what's on screen):
- CoastFIRE = the portfolio where compound growth alone reaches the full FIRE number by retirement age, with zero further contributions.
- Net FIRE # = (gross spending need ÷ safe withdrawal rate) minus pension/Social Security/other income offsets, plus the present value of any mortgage payments still due after retirement.
- Portfolio withdrawals, Social Security, and taxable pension or other income are treated as pre-tax, taxed at a blended rate derived from the Traditional share of the portfolio. Pension and Other Income each have a taxable/tax-free toggle.
- Before age 59½ only brokerage and Roth IRA contribution basis are penalty-free. Traditional 401k/IRA, Roth 401k, and Roth IRA earnings are locked; the escape hatches are Rule of 55 and SEPP/72(t).
- A fixed-rate mortgage is a flat nominal stream: it never inflates and it terminates at payoff. Payments still due after retirement are added as a lump-sum present value rather than multiplied by the withdrawal rate, because the obligation is finite.
- An HSA routes to either the Traditional or Roth bucket depending on the user's withdrawal strategy setting.
- Healthspan = active, mobile, cognitively sharp years. Lifespan = total years. The gap is typically 8–12 years. The value of a year of healthy time escalates convexly as it approaches the end of healthspan.
- Employer match can be configured to count Roth 401k contributions and to land in either the Traditional or Roth bucket.

RULES:
- Be concise. Two to four short paragraphs, or a tight list. No preamble, no restating the question.
- Use their actual numbers and round sensibly ($486K, not $486,213.44).
- Markdown renders: **bold**, bullet and numbered lists, \`code\`, and simple pipe tables. Nothing else.
- You are not a licensed financial advisor. Where a question genuinely needs personalized investment, tax, or legal advice, explain the general mechanics and suggest a fee-only fiduciary. Say this once, briefly, and only when warranted — never append a blanket disclaimer to every answer.
- If a question needs a number the calculator does not track, say so plainly and name the input that would surface it.
- If asked something unrelated to personal finance or this tool, decline in one sentence and redirect.`;

const client = new Anthropic();  // reads ANTHROPIC_API_KEY from the environment

export default async (req) => {
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: cors });

  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405);

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({
      error: 'not_configured',
      message: 'The in-page assistant is not set up yet — ANTHROPIC_API_KEY is missing.',
    }, 503);
  }

  const ip = req.headers.get('x-nf-client-connection-ip')
          || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || 'unknown';

  if (rateLimited(ip)) {
    return json({ error: 'rate_limited', message: 'Slow down a moment — try again in a minute.' }, 429);
  }
  if (overDailyCap()) {
    return json({
      error: 'daily_cap',
      message: "The assistant has hit today's usage cap. Try again tomorrow, or use Copy prompt to ask in ChatGPT or Claude.",
    }, 429);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'bad_json' }, 400); }

  const question = String(body.question || '').slice(0, 2000).trim();
  const context  = String(body.context  || '').slice(0, 8000);
  const history  = Array.isArray(body.history) ? body.history.slice(-6) : [];

  if (!question) return json({ error: 'empty_question' }, 400);

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
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: EFFORT },
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages,
    });

    // Safety classifiers can decline with HTTP 200 — check before reading content.
    if (response.stop_reason === 'refusal') {
      return json({
        error: 'refused',
        message: 'I can\'t answer that one. Try rephrasing, or ask something about your retirement numbers.',
      }, 200);
    }

    const answer = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return json({
      answer: answer || 'No answer came back. Try rephrasing the question.',
      truncated: response.stop_reason === 'max_tokens',
      usage: {
        input: response.usage?.input_tokens ?? 0,
        output: response.usage?.output_tokens ?? 0,
        cache_read: response.usage?.cache_read_input_tokens ?? 0,
        cache_write: response.usage?.cache_creation_input_tokens ?? 0,
      },
    }, 200);

  } catch (err) {
    // Typed chain, most specific first. `detail` is a short machine-readable
    // code so the site owner can diagnose setup problems from the browser
    // without the function leaking key material or upstream response bodies.
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[ask] auth failed — check ANTHROPIC_API_KEY', err.message);
      return json({
        error: 'upstream', detail: 'auth',
        message: 'The assistant\'s API key is invalid or revoked. (Site owner: check ANTHROPIC_API_KEY.)',
      }, 502);
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      console.error('[ask] permission denied', err.message);
      return json({
        error: 'upstream', detail: 'permission',
        message: 'The API key lacks permission for this model. (Site owner: check workspace access and ASK_MODEL.)',
      }, 502);
    }
    if (err instanceof Anthropic.NotFoundError) {
      console.error('[ask] model not found:', MODEL, err.message);
      return json({
        error: 'upstream', detail: 'model',
        message: `Model "${MODEL}" was not found. (Site owner: check the ASK_MODEL env var.)`,
      }, 502);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return json({
        error: 'upstream', detail: 'rate_limit',
        message: 'The assistant is busy right now — try again in a moment.',
      }, 429);
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error('[ask] bad request', err.message);
      return json({
        error: 'upstream', detail: 'bad_request',
        message: 'That request was rejected. (Site owner: check credit balance and request parameters.)',
      }, 502);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return json({
        error: 'upstream', detail: 'connection',
        message: 'Could not reach the assistant. Try again in a moment.',
      }, 502);
    }
    if (err instanceof Anthropic.APIError) {
      console.error('[ask] API error', err.status, err.message);
      return json({
        error: 'upstream', detail: `api_${err.status}`,
        message: 'The assistant could not answer that. Try rephrasing, or use Copy prompt.',
      }, 502);
    }
    console.error('[ask] unexpected failure:', err);
    return json({
      error: 'internal', detail: 'unknown',
      message: 'Something went wrong. Try again in a moment.',
    }, 500);
  }
};

export const config = { path: '/api/ask' };
