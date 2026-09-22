// Cloudflare Pages Functions route for /api/schedule
function getUpstreamUrl(env) {
  if (env && env.SCHEDULE_API_URL) return env.SCHEDULE_API_URL;
  if (typeof process !== 'undefined' && process.env && process.env.SCHEDULE_API_URL) {
    return process.env.SCHEDULE_API_URL;
  }
  const p1 = 'aHR0cHM6Ly9zcGFuZWx2Mi5hbmRyaGluby5jb20v';
  const p2 = 'YXBpL3YyL2FwcHNjaGVkdWxlYXBp';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(p1 + p2, 'base64').toString('utf8');
  }
  return atob(p1 + p2);
}

let cachedSchedule = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 15000; // 15s edge cache for live match freshness

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Access-Control-Allow-Origin': '*'
};

export async function onRequest(context) {
  const now = Date.now();
  if (cachedSchedule && (now - lastFetchTime < CACHE_TTL_MS)) {
    return new Response(JSON.stringify(cachedSchedule), {
      status: 200,
      headers: HEADERS
    });
  }

  const endpoint = getUpstreamUrl(context.env);

  try {
    const res = await fetch(endpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        cachedSchedule = data;
        lastFetchTime = now;
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: HEADERS
        });
      }
    }
  } catch (err) {
    console.warn('Functions /api/schedule upstream fetch failed:', err);
  }

  return new Response(JSON.stringify(cachedSchedule || []), {
    status: 200,
    headers: HEADERS
  });
}
