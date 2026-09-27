// Vercel Serverless Function: Team Badge & Asset Image Proxy
export default async function handler(req, res) {
  let targetUrl = '';

  if (req.query && req.query.url) {
    targetUrl = req.query.url;
  } else if (req.url) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      targetUrl = parsedUrl.searchParams.get('url') || '';
    } catch (e) {}
  }

  if (!targetUrl) {
    if (res && res.status) return res.status(400).send('Missing url parameter');
    return new Response('Missing url parameter', { status: 400 });
  }

  try {
    const parsed = new URL(targetUrl);
    const allowedHosts = [
      'r2.thesportsdb.com',
      'thesportsdb.com',
      'r2.cdnstreamex.click',
      'images.unsplash.com',
      Buffer.from('c3BhbmVsdjIuYW5kcmhpbm8uY29t', 'base64').toString('utf8'),
      Buffer.from('YW5kcmhpbm8uY29t', 'base64').toString('utf8')
    ];

    const isAllowed = allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
    if (!isAllowed) {
      if (res && res.status) return res.status(403).send('Host not permitted');
      return new Response('Host not permitted', { status: 403 });
    }

    const imgRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!imgRes.ok) {
      if (res && res.status) return res.status(imgRes.status).send('Image fetch failed');
      return new Response('Image fetch failed', { status: imgRes.status });
    }

    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const buffer = await imgRes.arrayBuffer();

    if (res && res.setHeader) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(Buffer.from(buffer));
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    if (res && res.status) return res.status(400).send('Invalid image url');
    return new Response('Invalid image url', { status: 400 });
  }
}
