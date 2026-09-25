/**
 * VIPROW - Dedicated Live Player Page Logic
 */

const MAIN_SITE_URL = '';
const urlParams = new URLSearchParams(window.location.search);

// Dynamic fallback endpoint resolver (keeps upstream provider private and hidden from public search)
function getSecureScheduleEndpoint() {
  const chunks = ['aHR0cHM6Ly9zcGFuZWx2Mi5h', 'bmRyaGluby5jb20vYXBpL3Yy', 'L2FwcHNjaGVkdWxlYXBp'];
  try {
    return atob(chunks.join(''));
  } catch (e) {
    return '';
  }
}

// Check if data contains today or future dates (rejects stale caches like yesterday's games)
function isDataFresh(apiDays) {
  if (!Array.isArray(apiDays) || apiDays.length === 0) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return apiDays.some(dayGroup => {
    if (!dayGroup || !dayGroup.date) return false;
    const d = new Date(dayGroup.date);
    if (isNaN(d.getTime())) return false;
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 1; // today (0), future (<0), or yesterday (1)
  });
}

// Stealth Fetch Engine: Completely invisible to API Detector extensions, sniffers, and window-level hooks
async function stealthFetchJson(url, options = {}) {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      const data = await new Promise((resolve, reject) => {
        const workerCode = `
          self.onmessage = async (e) => {
            try {
              const res = await fetch(e.data.url, e.data.options);
              if (!res.ok) throw new Error('HTTP ' + res.status);
              const json = await res.json();
              self.postMessage({ ok: true, data: json });
            } catch (err) {
              self.postMessage({ ok: false, error: err.message });
            }
          };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);
        const timeoutId = setTimeout(() => {
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          reject(new Error('Worker timeout'));
        }, (options.timeout || 7000));

        worker.onmessage = (e) => {
          clearTimeout(timeoutId);
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          if (e.data && e.data.ok) resolve(e.data.data);
          else reject(new Error(e.data ? e.data.error : 'Unknown worker error'));
        };

        worker.onerror = (err) => {
          clearTimeout(timeoutId);
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          reject(err);
        };

        worker.postMessage({ url, options: { cache: 'no-store' } });
      });

      if (data) return data;
    } catch (workerErr) { }
  }

  let frame = null;
  try {
    frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none;';
    frame.src = 'about:blank';
    (document.body || document.documentElement).appendChild(frame);

    const pristineWin = frame.contentWindow;
    if (pristineWin && typeof pristineWin.fetch === 'function') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), (options.timeout || 7000));
      const res = await pristineWin.fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data;
    }
  } catch (frameErr) { } finally {
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
  }

  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Helper: parse matchId and teams from either pathname (/play/:slug/:id) or query params (?id=...&teams=...)
function getPlayerDetailsFromUrl() {
  const pathToCheck = window.location.pathname;
  let id = urlParams.get('id');
  let teams = urlParams.get('teams');

  const pathParts = pathToCheck.split('/').filter(Boolean);
  const playIdx = pathParts.indexOf('play');
  if (playIdx !== -1) {
    if (!teams && pathParts.length > playIdx + 1) teams = pathParts[playIdx + 1];
    if (!id && pathParts.length > playIdx + 2) id = pathParts[playIdx + 2];
  }

  // Trailing digits fallback for ID
  if (!id) {
    const numMatch = pathToCheck.match(/\/(\d+)\/?(?:\?|#|$)/);
    if (numMatch && numMatch[1]) id = numMatch[1];
  }

  return {
    id: id || (typeof window.STATIC_MATCH_ID !== 'undefined' ? window.STATIC_MATCH_ID : null),
    teams: teams || ''
  };
}

const playerUrlDetails = getPlayerDetailsFromUrl();
const matchId = playerUrlDetails.id;

// Helper: always keep browser URL at clean permanent format /play/:teams/:id
function updateCleanPlayerUrl(teams, id) {
  try {
    const targetId = id || matchId;
    if (!targetId) return;
    const t = (teams || playerUrlDetails.teams || 'match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'match';
    const cleanPath = '/play/' + encodeURIComponent(t) + '/' + encodeURIComponent(targetId);
    if (window.location.pathname !== cleanPath) {
      window.history.replaceState(null, '', cleanPath);
    }
  } catch (e) { }
}

// Ensure URL is clean immediately on load if details are present
if (matchId && playerUrlDetails.teams) {
  updateCleanPlayerUrl(playerUrlDetails.teams, matchId);
}

let currentMatch = null;
let currentStreamUrl = '';

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadPlayerPage();
});

// Load match information and stream feed
async function loadPlayerPage() {
  const headerCard = document.getElementById('playerEventHeader') || document.getElementById('playerStateCard');

  if (!matchId) {
    if (headerCard) {
      headerCard.innerHTML = `
        <div style="padding: 24px; text-align: center;">
          <h2 style="color: #dc2626; font-size: 1.5rem; margin-bottom: 8px;">No Event Specified</h2>
          <p style="color: #64748b; margin-bottom: 18px;">Please select a match from the schedule to launch the player.</p>
          <a href="${MAIN_SITE_URL || '/'}" class="btn-streameast-watch">Return to Schedule</a>
        </div>
      `;
    }
    return;
  }

  // 0. Instant Server-Side Injected Schedule (NO NETWORK REQUEST!)
  const inlineDataEl = document.getElementById('__VIP_DATA__') || document.getElementById('__METH_DATA__');
  if (inlineDataEl && inlineDataEl.textContent && inlineDataEl.textContent.trim()) {
    try {
      const initialData = JSON.parse(inlineDataEl.textContent);
      if (Array.isArray(initialData) && initialData.length > 0 && isDataFresh(initialData)) {
        try {
          localStorage.setItem('VIP_SCHEDULE_CACHE', JSON.stringify(initialData));
        } catch (e) { }
        findAndInitializeMatch(initialData);
      }
    } catch (e) {
      console.warn('Embedded schedule parse failed in player.js:', e);
    }
  }

  // 1. Static match data check
  if (!currentMatch && typeof window.STATIC_MATCH_DATA !== 'undefined' && window.STATIC_MATCH_DATA) {
    try {
      const staticData = Array.isArray(window.STATIC_MATCH_DATA) ? window.STATIC_MATCH_DATA : [window.STATIC_MATCH_DATA];
      if (isDataFresh(staticData)) {
        findAndInitializeMatch(staticData);
      }
    } catch (e) {
      console.warn('STATIC_MATCH_DATA render failed, falling back to cache:', e);
    }
  }

  // 2. Instant cache check: check localStorage / sessionStorage (only if fresh)
  if (!currentMatch) {
    try {
      const cachedStr = localStorage.getItem('VIP_SCHEDULE_CACHE') || localStorage.getItem('METH_SCHEDULE_CACHE') || sessionStorage.getItem('METH_SCHEDULE_CACHE');
      if (cachedStr) {
        const cachedData = JSON.parse(cachedStr);
        if (Array.isArray(cachedData) && cachedData.length > 0) {
          if (isDataFresh(cachedData)) {
            findAndInitializeMatch(cachedData);
          } else {
            localStorage.removeItem('VIP_SCHEDULE_CACHE');
            localStorage.removeItem('METH_SCHEDULE_CACHE');
          }
        }
      }
    } catch (e) { }
  }

  let loaded = !!currentMatch;

  // 3. Background / Live Synchronization:
  const cacheBust = `_t=${Date.now()}`;
  const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost' ||
    window.location.protocol === 'file:'
  );

  const endpoints = isLocal
    ? [`/data/schedule.bin?${cacheBust}`, `/schedule_cache.json?${cacheBust}`]
    : [`/api/schedule?${cacheBust}`, `/data/schedule.bin?${cacheBust}`, `/api/v1/schedule?${cacheBust}`, `/schedule_cache.json?${cacheBust}`];

  for (const ep of endpoints) {
    try {
      const data = await stealthFetchJson(ep, { timeout: 4000 });
      if (Array.isArray(data) && data.length > 0 && isDataFresh(data)) {
        try {
          localStorage.setItem('VIP_SCHEDULE_CACHE', JSON.stringify(data));
        } catch (e) { }
        findAndInitializeMatch(data);
        loaded = true;
        break;
      }
    } catch (e) { }
  }

  // Direct secure fallback (works on local dev e.g. Live Server or when proxy fails)
  if (!loaded) {
    const secureFallback = getSecureScheduleEndpoint();
    if (secureFallback) {
      try {
        const data = await stealthFetchJson(secureFallback, { timeout: 7000 });
        if (Array.isArray(data) && data.length > 0 && isDataFresh(data)) {
          try {
            localStorage.setItem('VIP_SCHEDULE_CACHE', JSON.stringify(data));
          } catch (e) { }
          findAndInitializeMatch(data);
          loaded = true;
        }
      } catch (e) { }
    }
  }

  // Final fallback to static cache file
  if (!loaded) {
    try {
      const data = await stealthFetchJson(`/data/schedule.bin?${cacheBust}`, { timeout: 4000 });
      if (Array.isArray(data) && data.length > 0) {
        findAndInitializeMatch(data);
        loaded = true;
      }
    } catch (e) { }
  }

  if (!loaded) {
    console.error('All data sources failed.');
    if (headerCard) {
      headerCard.innerHTML = `
        <div style="padding: 24px; text-align: center;">
          <h2 style="color: #dc2626; font-size: 1.5rem; margin-bottom: 8px;">Unable to Load Broadcast</h2>
          <p style="color: #64748b; margin-bottom: 18px;">Could not connect to the streaming schedule server. Please check your internet connection and refresh.</p>
          <a href="${MAIN_SITE_URL || '/'}" class="btn-streameast-watch">Return to Schedule</a>
        </div>
      `;
    }
  }
}


// Find match object in schedule data
function findAndInitializeMatch(data) {
  let found = null;

  if (Array.isArray(data)) {
    for (const dayGroup of data) {
      const dayDate = dayGroup.date || 'Today';
      if (Array.isArray(dayGroup.schedule)) {
        for (const sportItem of dayGroup.schedule) {
          const sportCategory = sportItem.sport;
          if (Array.isArray(sportItem.league_schedule)) {
            for (const m of sportItem.league_schedule) {
              if (String(m.sch_id) === String(matchId)) {
                found = {
                  ...m,
                  date: dayDate,
                  sportCategory: sportCategory
                };
                break;
              }
            }
          }
          if (found) break;
        }
      }
      if (found) break;
    }
  }

  if (!found) {
    // Fallback: match not in today's schedule (e.g. next day schedule rolled over or bookmarked link).
    // Extract teams from either URL pathname (/play/teams/id) or query params
    const teamsParam = playerUrlDetails.teams || urlParams.get('teams') || '';
    const sportParam = urlParams.get('sport') || '';
    const teamsReadable = teamsParam.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const sportReadable = sportParam.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    if (teamsReadable) {
      updateCleanPlayerUrl(teamsParam, matchId);
      // Render a graceful expired page using URL slug info
      const stubMatch = {
        sch_id: matchId,
        teams: teamsReadable || 'Live Match',
        strHomeTeam: '',
        strAwayTeam: '',
        date: 'Previous Schedule',
        event_time: '',
        sch_league: sportReadable || 'Sports',
        sportCategory: sportReadable || 'Sports',
        sport: sportReadable || 'Sports',
        event_status: 'FT',
        live_status: 0,
        sch_iframe: '',
        tv_guide: ''
      };
      currentMatch = stubMatch;
      // Show the state card with an expired message instead of the player
      const sc = document.getElementById('playerStateCard');
      if (sc) sc.innerHTML = `
        <div style="padding: 32px; text-align: center;">
          <div style="font-size: 2.5rem; margin-bottom: 12px;">&#128197;</div>
          <h2 style="color: #dc2626; font-size: 1.4rem; margin-bottom: 8px;">Event Schedule Expired</h2>
          <p style="color: #64748b; margin-bottom: 6px; font-size: 1rem;">
            <strong style="color:#f1f5f9;">${escapeHtml(teamsReadable)}</strong>
          </p>
          <p style="color: #94a3b8; margin-bottom: 18px; font-size: 0.9rem;">
            This stream link is from a previous day's schedule. The event may have already concluded.
            Live stream links are only available for today's matches.
          </p>
          <a href="/" class="btn-streameast-watch">View Today's Schedule</a>
        </div>
      `;
      // Also update the top bar if visible
      const topbarName = document.getElementById('topbarMatchName');
      if (topbarName) topbarName.textContent = teamsReadable;
    } else {
      const sc = document.getElementById('playerStateCard');
      if (sc) sc.innerHTML = `
        <div style="padding: 32px; text-align: center;">
          <h2 style="color: #dc2626; font-size: 1.5rem; margin-bottom: 8px;">Match Not Found</h2>
          <p style="color: #64748b; margin-bottom: 18px;">Match #${escapeHtml(matchId)} is not in the current schedule. It may be from a previous day.</p>
          <a href="/" class="btn-streameast-watch">Return to Schedule</a>
        </div>
      `;
    }
    return;
  }

  currentMatch = found;
  updateCleanPlayerUrl(found.teams, found.sch_id);
  renderPlayerPage(found);
}

// Render Header, Player Viewport, Controls, and Technical Specifications
function renderPlayerPage(match) {
  const matchTitle = match.teams || `${match.strHomeTeam || 'Home'} vs ${match.strAwayTeam || 'Away'}`;
  const fullTitle = `Watch ${matchTitle} Live Stream - VIPRow`;
  const fullDesc = `Watch ${matchTitle} Live Stream Free in HD`;
  document.title = fullTitle;

  try {
    sessionStorage.setItem('current_match_teams', matchTitle);
    const mDesc = document.querySelector('meta[name="description"]');
    if (mDesc) mDesc.setAttribute('content', fullDesc);
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', fullDesc);
    const twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) twDesc.setAttribute('content', fullDesc);

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', fullTitle);
    const twTitle = document.querySelector('meta[name="twitter:title"]');
    if (twTitle) twTitle.setAttribute('content', fullTitle);
  } catch (e) { }

  const dateStr = match.date || 'Today';
  const timeStr = match.event_time ? `${match.event_time} ET` : 'Live';
  const leagueStr = match.sch_league || match.league || match.sportCategory || 'Sports League';
  const isFinished = match.event_status === 'FT' || match.event_status === 'FINISHED';
  const isLive = !isFinished && (match.live_status === 1 || match.event_status === 'LIVE');

  // -- Update top bar --
  const topbarName = document.getElementById('topbarMatchName');
  if (topbarName) topbarName.textContent = matchTitle;
  const topbarDot = document.getElementById('topbarLiveDot');
  if (topbarDot) topbarDot.style.display = isLive ? 'inline-block' : 'none';

  // -- Hide loading state, show player section --
  const stateCard = document.getElementById('playerStateCard');
  if (stateCard) stateCard.style.display = 'none';
  const playerSection = document.getElementById('playerSection');
  if (playerSection) playerSection.style.display = 'block';

  // -- Back to match link --
  const backBtn = document.getElementById('backToMatchBtn');
  if (backBtn) {
    const sportSlug = (match.sportCategory || match.sport || 'sports').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sports';
    const teamsSlug = (matchTitle || 'match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'match';
    backBtn.href = `${MAIN_SITE_URL}/watch/${encodeURIComponent(sportSlug)}/${encodeURIComponent(teamsSlug)}/${encodeURIComponent(match.sch_id)}`;
  }

  // Ensure topbar logo & schedule button point back to main site
  const brandLogo = document.getElementById('brandLogo');
  if (brandLogo) brandLogo.href = '/';
  const topbarScheduleBtn = document.getElementById('topbarScheduleBtn');
  if (topbarScheduleBtn) topbarScheduleBtn.href = '/';

  // -- Match info pills below player --
  const pillsBar = document.getElementById('matchInfoPills');
  if (pillsBar) {
    const statusPillClass = isLive ? 'info-pill live-pill' : 'info-pill';
    const statusText = isFinished ? 'FINISHED' : isLive ? '● LIVE NOW' : 'UPCOMING';
    pillsBar.innerHTML = `
      <span class="${statusPillClass}">${escapeHtml(statusText)}</span>
      <span class="info-pill">📅 ${escapeHtml(dateStr)}</span>
      <span class="info-pill">⏰ ${escapeHtml(timeStr)}</span>
      <span class="info-pill">🏆 ${escapeHtml(leagueStr)}</span>
      <span class="info-pill">#${escapeHtml(String(match.sch_id))}</span>
    `;
  }

  // -- Setup Video Stream Feed --
  const baseIframe = match.sch_iframe || `https://embed.sportspatrika.com/live/embed.php?ch=${match.sch_id || 'es1'}`;
  currentStreamUrl = baseIframe;

  const playerIframe = document.getElementById('mainPlayerIframe');
  const loaderOverlay = document.getElementById('playerLoaderOverlay');
  const serverGroup = document.getElementById('serverTabsGroup');
  const directLink = document.getElementById('playerDirectLink');

  // Generate Multi-Server Switcher Buttons
  const sep = baseIframe.includes('?') ? '&' : '?';
  const serverOptions = [
    { id: 1, name: 'Server 1 (VIPRow HD)', streamer: 'VIPRow', url: baseIframe, bitrate: '7500 Kbps' },
    { id: 2, name: 'Server 2 (BuffStreams)', streamer: 'BuffStreams', url: `${baseIframe}${sep}cdn=buff`, bitrate: '6800 Kbps' },
    { id: 3, name: 'Server 3 (TotalSportek)', streamer: 'TotalSportek', url: `${baseIframe}${sep}mirror=totalsportek`, bitrate: '6200 Kbps' },
    { id: 4, name: 'Server 4 (SportSurge)', streamer: 'SportSurge', url: `${baseIframe}${sep}feed=sportsurge`, bitrate: '5500 Kbps' }
  ];

  let selectedServerIndex = 0;
  try {
    const urlParamsLocal = new URLSearchParams(window.location.search);
    const sParam = parseInt(urlParamsLocal.get('server'), 10);
    if (sParam >= 1 && sParam <= serverOptions.length) selectedServerIndex = sParam - 1;
  } catch (e) { }

  const activeServer = serverOptions[selectedServerIndex];
  currentStreamUrl = activeServer.url;

  if (serverGroup) {
    serverGroup.innerHTML = serverOptions.map((srv, idx) => `
      <button 
        type="button" 
        class="server-btn ${idx === selectedServerIndex ? 'active' : ''}" 
        onclick="switchServer('${srv.url}', this, '${escapeHtml(srv.streamer)}', '${escapeHtml(srv.bitrate)}')"
      >${srv.name}</button>
    `).join('');
  }

  if (playerIframe) {
    playerIframe.src = activeServer.url;
    playerIframe.onload = () => {
      if (loaderOverlay) {
        loaderOverlay.style.opacity = '0';
        setTimeout(() => { loaderOverlay.style.display = 'none'; }, 250);
      }
    };
  }

  if (directLink) directLink.href = activeServer.url;
}

// Switch between live broadcast servers
window.switchServer = function (streamUrl, buttonEl, streamerName, bitrate) {
  const iframe = document.getElementById('mainPlayerIframe');
  const directLink = document.getElementById('playerDirectLink');
  const loaderOverlay = document.getElementById('playerLoaderOverlay');

  if (iframe) {
    if (loaderOverlay) {
      loaderOverlay.style.display = 'flex';
      loaderOverlay.style.opacity = '1';
    }
    iframe.src = streamUrl;
    currentStreamUrl = streamUrl;
  }

  if (directLink) {
    directLink.href = streamUrl;
  }

  // Update active button state
  document.querySelectorAll('.server-btn').forEach(b => b.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
};

// Reload stream player
window.reloadPlayer = function () {
  const iframe = document.getElementById('mainPlayerIframe');
  const loaderOverlay = document.getElementById('playerLoaderOverlay');

  if (iframe && currentStreamUrl) {
    if (loaderOverlay) {
      loaderOverlay.style.display = 'flex';
      loaderOverlay.style.opacity = '1';
    }
    const currentSrc = iframe.src;
    iframe.src = '';
    setTimeout(() => {
      iframe.src = currentSrc;
    }, 150);
  }
};

// Copy stream page URL
window.copyStreamPageLink = function () {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    alert('VIPRow live stream URL copied to clipboard!');
  }).catch(() => {
    alert('Stream URL: ' + url);
  });
};

// FAQ Accordion Toggle
window.toggleFaq = function (buttonEl) {
  const item = buttonEl.closest('.faq-item');
  if (!item) return;
  item.classList.toggle('open');
};

// Setup Policy Modals and Handlers
const POLICY_TEXTS = {
  privacy: {
    title: 'Privacy Policy',
    content: `
      <p>We respect your privacy and believe in complete transparency regarding how your data is treated when you browse our platform. This policy explains our approach to information gathering, advertising partners, and external links.</p>
      <p><strong>1. Data Collection &amp; Server Logs:</strong> We do not mandate user accounts, build personal profiles, or actively gather identifiable personal details. To keep our platform secure and running smoothly, our servers automatically generate basic technical logs.</p>
      <p><strong>2. Ads &amp; Tracking Tools:</strong> While we avoid using our own tracking cookies or analytics software, we do team up with external ad networks to fund the site.</p>
      <p>For more information, please read our full <a href="/privacy-policy" style="color:#ef4444;text-decoration:underline;">Privacy Policy</a>.</p>
    `
  },
  terms: {
    title: 'Terms of Service',
    content: `
      <p>Welcome to our site. Please review these Terms of Service ("Terms") thoroughly before utilizing our platform. By accessing this website, you consent to these Terms. If you disagree with any portion of this agreement, you must stop using the site immediately.</p>
      <p><strong>1. Description of Service:</strong> This platform acts exclusively as a search directory and link aggregator for publicly accessible content. We supply event schedules and route visitors to external streaming sites. We never host, upload, stream, or store media on our own infrastructure. All videos and feeds found via our site are entirely managed and hosted by independent third parties.</p>
      <p><strong>2. Age Requirements:</strong> This website is built exclusively for individuals who are eighteen (18) years old or older. By accessing our platform, you confirm that you meet this age requirement. If you are under 18, you are not permitted to use our services.</p>
      <p>For more information, please read our full <a href="/terms-of-service" style="color:#ef4444;text-decoration:underline;">Terms of Service</a>.</p>
    `
  },
  dmca: {
    title: 'DMCA Takedown Policy',
    content: `
      <p>This document explains our adherence to the Digital Millennium Copyright Act (DMCA) and outlines our procedures for resolving copyright infringement claims.</p>
      <p>We absolutely do not host, stream, upload, or store any video media on our own network. All broadcasts and files are controlled and hosted exclusively by independent external providers.</p>
      <p>To file a DMCA notice, please send an email directly to <a href="#" onclick="window.location.href='mailto:contact@' + (window.location.hostname || '');return false;" style="color:#ef4444;text-decoration:underline;">contact@<span class="active-site-host"></span></a> with “DMCA Notice” in the subject line, or read our full <a href="/dmca" style="color:#ef4444;text-decoration:underline;">DMCA Policy</a>.</p>
    `
  },
  contact: {
    title: 'Contact Us',
    content: `
      <p>Have questions, schedule inquiries, or feedback for the VIPRow team?</p>
      <p>Email us at: <a href="mailto:support@viprow.nu" style="color:#ef4444;font-weight:700;">support@viprow.nu</a></p>
      <p>DMCA Takedowns & Rights Enforcement: <a href="mailto:dmca@viprow.nu" style="color:#ef4444;font-weight:700;">dmca@viprow.nu</a></p>
      <p>We typically respond within 24 to 48 business hours.</p>
    `
  }
};

window.openPolicyModal = function (policyKey) {
  const policy = POLICY_TEXTS[policyKey];
  if (!policy) return;

  const modal = document.getElementById('policyModal');
  const title = document.getElementById('policyModalTitle');
  const body = document.getElementById('policyModalBody');

  title.textContent = policy.title;
  body.innerHTML = `
    <h3>${policy.title}</h3>
    ${policy.content}
  `;

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closePolicyModal = function () {
  const modal = document.getElementById('policyModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
};

window.sharePage = function (platform) {
  const url = window.location.href;
  const title = document.title || "VIPRow - Live Sports Stream Player";

  if (platform === 'facebook') {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
  } else if (platform === 'reddit') {
    window.open(`https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`, '_blank');
  } else if (platform === 'pinterest') {
    window.open(`https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(title)}`, '_blank');
  } else if (platform === 'whatsapp') {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(title + ' ' + url)}`, '_blank');
  } else if (platform === 'telegram') {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`, '_blank');
  } else if (platform === 'email') {
    window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`;
  } else {
    navigator.clipboard.writeText(url).then(() => {
      alert('Stream link copied to clipboard!');
    }).catch(() => {
      alert('URL: ' + url);
    });
  }
};

function setupEventListeners() {
  const modalOverlay = document.getElementById('policyModal');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closePolicyModal();
    });
  }

  // Mobile menu setup
  setupMobileMenu();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePolicyModal();
    }
  });
}

// Mobile Menu Drawer Setup
function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobileMenuToggle');
  const drawer = document.getElementById('mobileNavDrawer');
  const backdrop = document.getElementById('mobileDrawerBackdrop');
  const closeBtn = document.getElementById('mobileDrawerClose');

  if (!toggleBtn || !drawer) return;

  function openDrawer() {
    toggleBtn.classList.add('active');
    toggleBtn.setAttribute('aria-expanded', 'true');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    toggleBtn.classList.remove('active');
    toggleBtn.setAttribute('aria-expanded', 'false');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function toggleDrawer() {
    if (drawer.classList.contains('open')) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  toggleBtn.addEventListener('click', toggleDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (backdrop) backdrop.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) {
      closeDrawer();
    }
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
