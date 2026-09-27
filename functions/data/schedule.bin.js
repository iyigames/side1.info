// Cloudflare Pages Functions route for /data/schedule.bin
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
const CACHE_TTL_MS = 15000; // 15 seconds

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Access-Control-Allow-Origin': '*'
};

const _VIP_CIPHER_KEY = [0x53, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x48, 0x75, 0x62, 0x5f, 0x56, 0x49, 0x50, 0x32, 0x36, 0x21];

function encryptPayload(data) {
  const str = JSON.stringify(data || []);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] ^= _VIP_CIPHER_KEY[i % _VIP_CIPHER_KEY.length];
  }
  return bytes;
}

const BIN_HEADERS = {
  ...HEADERS,
  'Content-Type': 'application/octet-stream'
};

export async function onRequest(context) {
  const now = Date.now();
  if (cachedSchedule && (now - lastFetchTime < CACHE_TTL_MS)) {
    return new Response(encryptPayload(cachedSchedule), {
      status: 200,
      headers: BIN_HEADERS
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
        return new Response(encryptPayload(data), {
          status: 200,
          headers: BIN_HEADERS
        });
      }
    }
  } catch (err) {
    console.warn('Functions schedule fetch failed:', err);
  }

  return new Response(encryptPayload(cachedSchedule || []), {
    status: 200,
    headers: BIN_HEADERS
  });
}
