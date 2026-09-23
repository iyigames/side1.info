// Cloudflare Pages & Edge Worker: Server-Side Data Injection, Proxy & SEO
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

const CACHE_TTL_MS = 15000; // 15s edge cache
let cachedSchedule = null;
let lastFetchTime = 0;

// Helper: Fetch schedule data server-side with in-memory caching
async function getScheduleData(env) {
  const now = Date.now();
  if (cachedSchedule && (now - lastFetchTime < CACHE_TTL_MS)) {
    return cachedSchedule;
  }

  const endpoint = getUpstreamUrl(env);
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
        return data;
      }
    }
  } catch (err) {
    console.warn('Worker upstream schedule fetch failed:', err);
  }

  return cachedSchedule;
}

function formatTeamName(slug) {
  if (!slug) return '';
  let str = decodeURIComponent(slug).trim();
  if (str.includes('-') && !str.includes(' ')) {
    str = str.replace(/^-+|-+$/g, '').replace(/-+/g, ' ');
    str = str.replace(/\b\w/g, l => l.toUpperCase());
  } else if (str === str.toLowerCase()) {
    str = str.replace(/\b\w/g, l => l.toUpperCase());
  }
  return str.replace(/\bvs\b/gi, 'vs').trim();
}

// Safely serialize JSON for embedding in HTML <script>
function serializeForScript(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function injectScheduleScript(html, scheduleData) {
  if (!scheduleData || !Array.isArray(scheduleData) || scheduleData.length === 0) return html;
  const dataScript = `<script id="__VIP_DATA__" type="application/json">${serializeForScript(scheduleData)}</script>`;
  
  if (html.includes('id="__VIP_DATA__"')) {
    return html.replace(/<script id="__VIP_DATA__"[\s\S]*?<\/script>/, () => dataScript);
  }
  if (html.includes('id="__METH_DATA__"')) {
    return html.replace(/<script id="__METH_DATA__"[\s\S]*?<\/script>/, () => dataScript);
  }
  if (html.includes('</head>')) {
    return html.replace('</head>', () => `${dataScript}\n</head>`);
  }
  return `${dataScript}\n${html}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. Same-Origin Proxy Endpoint for dynamic schedule sync
    if (pathname === '/data/schedule.bin' || pathname === '/api/schedule' || pathname === '/api/v1/schedule' || pathname === '/schedule_cache.json') {
      const data = await getScheduleData(env);
      return new Response(JSON.stringify(data || []), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
          'CDN-Cache-Control': 'no-store',
          'Cloudflare-CDN-Cache-Control': 'no-store',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 2. Same-Origin Proxy Endpoint for team badges / images
    if (pathname === '/cdn-img') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return new Response('Missing url parameter', { status: 400 });
      }

      try {
        const parsed = new URL(targetUrl);
        const allowedHosts = [
          'r2.thesportsdb.com',
          'thesportsdb.com',
          'r2.cdnstreamex.click',
          'images.unsplash.com',
          atob('c3BhbmVsdjIuYW5kcmhpbm8uY29t'),
          atob('YW5kcmhpbm8uY29t')
        ];

        const isAllowed = allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
        if (!isAllowed) {
          return new Response('Host not permitted', { status: 403 });
        }

        const imgRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        if (!imgRes.ok) {
          return new Response('Image fetch failed', { status: imgRes.status });
        }

        const contentType = imgRes.headers.get('content-type') || 'image/png';
        return new Response(imgRes.body, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=604800, s-maxage=604800'
          }
        });
      } catch (err) {
        return new Response('Invalid image url', { status: 400 });
      }
    }

    // 2.5. Handle Static Clean URLs for Policy & Info Pages
    const cleanStaticPages = {
      '/terms-of-service': '/terms-of-service.html',
      '/privacy-policy': '/privacy-policy.html',
      '/dmca': '/dmca.html',
      '/contact': '/contact.html'
    };
    const normPath = pathname.replace(/\/$/, '');
    if (cleanStaticPages[normPath]) {
      try {
        const assetUrl = new URL(cleanStaticPages[normPath], url.origin);
        return await env.ASSETS.fetch(assetUrl);
      } catch (e) {
        return env.ASSETS.fetch(request);
      }
    }

    // 3. Handle Root / Index page: Server-side embed schedule data
    if (pathname === '/' || pathname === '/index.html' || pathname === '') {
      try {
        const assetUrl = new URL('/index.html', url.origin);
        const res = await env.ASSETS.fetch(assetUrl);
        let html = await res.text();

        const scheduleData = await getScheduleData(env);
        html = injectScheduleScript(html, scheduleData);

        return new Response(html, {
          status: res.status,
          headers: {
            ...Object.fromEntries(res.headers.entries()),
            'content-type': 'text/html; charset=utf-8'
          }
        });
      } catch (e) {
        return env.ASSETS.fetch(request);
      }
    }

    // 4. Handle /watch/* and watch.html requests: SEO + Server-side schedule embedding
    if (pathname.startsWith('/watch/') || pathname === '/watch' || pathname === '/watch.html') {
      try {
        const assetUrl = new URL('/watch.html', url.origin);
        const res = await env.ASSETS.fetch(assetUrl);
        let html = await res.text();

        const pathParts = pathname.split('/').filter(Boolean);
        const watchIdx = pathParts.indexOf('watch');
        const parts = watchIdx !== -1 ? pathParts.slice(watchIdx + 1) : [];

        let sport = '';
        let teams = '';
        let id = '';

        if (parts.length >= 3) {
          sport = parts[0] ? decodeURIComponent(parts[0]) : '';
          teams = parts[1] ? decodeURIComponent(parts[1]) : '';
          id = parts[2] || '';
        } else if (parts.length === 2) {
          if (/^\d+$/.test(parts[1])) {
            teams = decodeURIComponent(parts[0]);
            id = parts[1];
          } else {
            sport = decodeURIComponent(parts[0]);
            teams = decodeURIComponent(parts[1]);
          }
        } else if (parts.length === 1) {
          if (/^\d+$/.test(parts[0])) {
            id = parts[0];
          } else {
            teams = decodeURIComponent(parts[0]);
          }
        }

        if (!teams || teams === 'match') {
          teams = url.searchParams.get('teams') || '';
        }
        if (!sport || sport === 'sports') {
          sport = url.searchParams.get('sport') || url.searchParams.get('category') || '';
        }
        if (!id) {
          id = url.searchParams.get('id') || '';
        }
        if (!id) {
          const numMatch = pathname.match(/\/(\d+)\/?(?:\?|#|$)/);
          if (numMatch && numMatch[1]) id = numMatch[1];
        }

        const scheduleData = await getScheduleData(env);

        // If ID is available but team name is not, find from schedule data
        if ((!teams || teams === 'match') && id && Array.isArray(scheduleData)) {
          for (const day of scheduleData) {
            if (Array.isArray(day.schedule)) {
              for (const item of day.schedule) {
                if (Array.isArray(item.league_schedule)) {
                  const match = item.league_schedule.find(m => String(m.sch_id) === String(id));
                  if (match) {
                    teams = match.teams || `${match.strHomeTeam} vs ${match.strAwayTeam}`;
                    if (!sport) sport = item.sport;
                    break;
                  }
                }
              }
            }
            if (teams && teams !== 'match') break;
          }
        }

        if (teams && teams !== 'match') {
          const teamName = formatTeamName(teams);
          const fullTitle = `Watch ${teamName} Live Stream - VIPRow`;
          const fullDesc = `Watch ${teamName} live on VIPRow`;

          html = html
            .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${fullTitle}</title>`)
            .replace(/<meta\s+[^>]*name=["']description["'][^>]*>/i, () => `<meta name="description" content="${fullDesc}">`)
            .replace(/<meta\s+[^>]*property=["']og:title["'][^>]*>/i, () => `<meta property="og:title" content="${fullTitle}">`)
            .replace(/<meta\s+[^>]*property=["']og:description["'][^>]*>/i, () => `<meta property="og:description" content="${fullDesc}">`)
            .replace(/<meta\s+[^>]*name=["']twitter:title["'][^>]*>/i, () => `<meta name="twitter:title" content="${fullTitle}">`)
            .replace(/<meta\s+[^>]*name=["']twitter:description["'][^>]*>/i, () => `<meta name="twitter:description" content="${fullDesc}">`);
        }

        html = injectScheduleScript(html, scheduleData);

        return new Response(html, {
          status: res.status,
          headers: {
            ...Object.fromEntries(res.headers.entries()),
            'content-type': 'text/html; charset=utf-8'
          }
        });
      } catch (err) {
        return env.ASSETS.fetch(request);
      }
    }

    // 5. Handle /play/* and play.html requests: Server-side schedule embedding
    if (pathname.startsWith('/play/') || pathname === '/play' || pathname === '/play.html') {
      try {
        const assetUrl = new URL('/play.html', url.origin);
        const res = await env.ASSETS.fetch(assetUrl);
        let html = await res.text();

        const scheduleData = await getScheduleData(env);
        html = injectScheduleScript(html, scheduleData);

        return new Response(html, {
          status: res.status,
          headers: {
            ...Object.fromEntries(res.headers.entries()),
            'content-type': 'text/html; charset=utf-8'
          }
        });
      } catch (e) {
        return env.ASSETS.fetch(request);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
