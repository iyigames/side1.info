// Vercel Serverless Function: Real-Time Dynamic Schedule Proxy
// Compatible with both Node.js and Edge runtimes on Vercel
let cachedSchedule = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 15000; // 15 seconds in-memory cache for live event freshness

function getUpstreamUrl() {
  if (typeof process !== 'undefined' && process.env && process.env.SCHEDULE_API_URL) {
    return process.env.SCHEDULE_API_URL;
  }
  // Base64 obfuscated to prevent GitHub repository scraping
  const p1 = 'aHR0cHM6Ly9zcGFuZWx2Mi5hbmRyaGluby5jb20v';
  const p2 = 'YXBpL3YyL2FwcHNjaGVkdWxlYXBp';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(p1 + p2, 'base64').toString('utf8');
  }
  return atob(p1 + p2);
}

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
  'X-Content-Type-Options': 'nosniff'
};

async function fetchUpstreamSchedule() {
  const now = Date.now();
  if (cachedSchedule && (now - lastFetchTime < CACHE_TTL_MS)) {
    return cachedSchedule;
  }

  const upstreamUrl = getUpstreamUrl();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        cachedSchedule = data;
        lastFetchTime = now;
        return data;
      }
    }
  } catch (err) {
    console.warn('Upstream schedule fetch failed:', err.message || err);
  }

  return cachedSchedule || [];
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    if (res && typeof res.status === 'function') {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        res.setHeader(k, v);
      }
      return res.status(204).end();
    }
    return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  }

  const data = await fetchUpstreamSchedule();
  const jsonBody = JSON.stringify(data);

  // Standard Node.js Serverless runtime (Vercel default)
  if (res && typeof res.setHeader === 'function') {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(k, v);
    }
    return res.status(200).send(jsonBody);
  }

  // Edge runtime fallback
  return new Response(jsonBody, {
    status: 200,
    headers: SECURITY_HEADERS
  });
}
