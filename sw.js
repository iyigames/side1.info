// VIPRow Service Worker - Local & Offline SPA Router (Version: 2.5)
const SW_VERSION = 'v2.5-hidden-api';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

function formatTeamName(slug) {
  if (!slug) return '';
  let str = decodeURIComponent(slug).trim();
  if (str.includes('-') && !str.includes(' ')) {
    str = str.replace(/^-+|-+$/g, '').replace(/-+/g, ' ');
    str = str.replace(/\b\w/g, (l) => l.toUpperCase());
  } else if (str === str.toLowerCase()) {
    str = str.replace(/\b\w/g, (l) => l.toUpperCase());
  }
  return str.replace(/\bvs\b/gi, 'vs').trim();
}

async function handleWatchRoute(event) {
  const url = new URL(event.request.url);
  const pathname = url.pathname;
  const isLocalStatic = self.location.hostname === '127.0.0.1' || self.location.hostname === 'localhost';

  // In production (Cloudflare), try the edge server first for SSR response
  if (!isLocalStatic) {
    try {
      const serverRes = await fetch(event.request);
      if (serverRes.ok) {
        return serverRes;
      }
    } catch (e) {}
  }

  // On local servers (e.g. VS Code Live Server 127.0.0.1:5500) or edge fallback:
  // Fetch /watch.html and dynamically inject the public source meta tags!
  let htmlRes;
  try {
    htmlRes = await fetch('/watch.html');
    if (!htmlRes.ok) throw new Error('watch.html fetch failed');
  } catch (err) {
    htmlRes = await caches.match('/watch.html');
  }

  if (!htmlRes) {
    return new Response('Page not found', { status: 404 });
  }

  let html = await htmlRes.text();

  const pathParts = pathname.split('/').filter(Boolean);
  const watchIdx = pathParts.indexOf('watch');
  const parts = watchIdx !== -1 ? pathParts.slice(watchIdx + 1) : [];

  let teams = '';
  if (parts.length >= 3) {
    teams = parts[1];
  } else if (parts.length === 2) {
    teams = /^\d+$/.test(parts[1]) ? parts[0] : parts[1];
  } else if (parts.length === 1 && !/^\d+$/.test(parts[0])) {
    teams = parts[0];
  }

  if (!teams || teams === 'match') {
    teams = url.searchParams.get('teams') || '';
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

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin navigation GET requests
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  const pathname = url.pathname;

  // Direct requests to watch.html or play.html without query params -> redirect to dashboard
  if ((pathname === '/watch.html' || pathname === '/play.html' || pathname === '/match.html' || pathname === '/player.html') && !url.search) {
    event.respondWith(Response.redirect('/', 302));
    return;
  }

  // Intercept /watch/* routes: serve with dynamic meta tags in both local dev (Live Server) and production
  if (pathname.startsWith('/watch/') || pathname === '/watch') {
    event.respondWith(handleWatchRoute(event));
    return;
  }

  // Intercept /play/* routes:
  // On player domain, serve /play.html directly (which returns play.html with 200 OK)
  if (pathname.startsWith('/play/')) {
    if (self.location.hostname.includes('pages.dev')) {
      event.respondWith(
        fetch('/play.html')
          .then((res) => {
            if (!res.ok) throw new Error('Player route failed');
            return res;
          })
          .catch(() => caches.match('/play.html'))
          .catch(() => fetch(event.request))
      );
      return;
    }
    // On main domain, pass through to let 404.html handle cross-domain redirect safely
    return;
  }

  // Intercept clean static policy & info pages
  const staticPages = ['/privacy-policy', '/terms-of-service', '/dmca', '/contact'];
  if (staticPages.includes(pathname)) {
    event.respondWith(
      fetch(pathname + '.html')
        .catch(() => caches.match(pathname + '.html'))
    );
    return;
  }
});
