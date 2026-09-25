/**
 * VIPROW - Match & Streamer Links Page Logic
 */

const PLAYER_DOMAIN = (typeof window !== 'undefined' && window.PLAYER_DOMAIN)
  ? window.PLAYER_DOMAIN
  : '';
const urlParams = new URLSearchParams(window.location.search);

// Dynamic player URL resolver with local dev fallback
function getPlayerUrl(teamsSlug, matchId, serverNum) {
  const isLocalStatic = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  const hasServiceWorker = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  // On local static server without active SW: use query param fallback so play.html loads directly
  if (isLocalStatic && !hasServiceWorker && !PLAYER_DOMAIN) {
    return `/play.html?teams=${encodeURIComponent(teamsSlug)}&id=${encodeURIComponent(matchId)}${serverNum && serverNum > 1 ? '&server=' + encodeURIComponent(serverNum) : ''}`;
  }
  // Production (Cloudflare/Vercel) or local with SW active: use clean slug URL
  return `${PLAYER_DOMAIN}/play/${encodeURIComponent(teamsSlug)}/${encodeURIComponent(matchId)}${serverNum && serverNum > 1 ? '?server=' + encodeURIComponent(serverNum) : ''}`;
}

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

// Helper: parse matchId, sport, and teams from either pathname (/watch/:sport/:slug/:id) or query params (?id=...&sport=...&teams=...)
function getMatchDetailsFromUrl() {
  const pathToCheck = window.location.pathname;
  let id = urlParams.get('id');
  let sport = urlParams.get('sport');
  let teams = urlParams.get('teams');

  const pathParts = pathToCheck.split('/').filter(Boolean);
  const watchIdx = pathParts.indexOf('watch');
  if (watchIdx !== -1) {
    const parts = pathParts.slice(watchIdx + 1);
    if (parts.length >= 3) {
      if (!sport) sport = parts[0];
      if (!teams) teams = parts[1];
      if (!id) id = parts[2];
    } else if (parts.length === 2) {
      if (/^\d+$/.test(parts[1])) {
        if (!teams) teams = parts[0];
        if (!id) id = parts[1];
      } else {
        if (!sport) sport = parts[0];
        if (!teams) teams = parts[1];
      }
    } else if (parts.length === 1) {
      if (/^\d+$/.test(parts[0])) {
        if (!id) id = parts[0];
      } else {
        if (!teams) teams = parts[0];
      }
    }
  }

  // Trailing digits fallback for ID
  if (!id) {
    const numMatch = pathToCheck.match(/\/(\d+)\/?(?:\?|#|$)/);
    if (numMatch && numMatch[1]) id = numMatch[1];
  }

  return {
    id: id || (typeof window.STATIC_MATCH_ID !== 'undefined' ? window.STATIC_MATCH_ID : null),
    sport: sport || '',
    teams: teams || ''
  };
}

const urlMatchDetails = getMatchDetailsFromUrl();
const matchId = urlMatchDetails.id;

// Helper: always keep browser URL at clean permanent format /watch/:sport/:teams/:id
function updateCleanMatchUrl(sport, teams, id) {
  try {
    const targetId = id || matchId;
    if (!targetId) return;
    const s = (sport || urlMatchDetails.sport || 'sports').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sports';
    const t = (teams || urlMatchDetails.teams || 'match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'match';
    const cleanPath = '/watch/' + encodeURIComponent(s) + '/' + encodeURIComponent(t) + '/' + encodeURIComponent(targetId);
    if (window.location.pathname !== cleanPath) {
      window.history.replaceState(null, '', cleanPath);
    }
  } catch (e) {}
}

// Ensure URL is clean immediately on load if details are present
if (matchId && (urlMatchDetails.sport || urlMatchDetails.teams)) {
  updateCleanMatchUrl(urlMatchDetails.sport, urlMatchDetails.teams, matchId);
}

let currentMatchData = null;
let currentActiveStreamId = 1;

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadMatchPage();
});

// Load match information from API or fallback
async function loadMatchPage() {
  const infoCard = document.getElementById('matchInfoCard');
  const watchCardBox = document.getElementById('watchCardBox');

  if (!matchId) {
    if (watchCardBox) {
      watchCardBox.innerHTML = `
        <h1 class="watch-match-heading" style="color: #ef4444; font-size: 1.6rem;">No Match Specified</h1>
        <p style="color: #94a3b8; margin: 12px 0 24px;">Please select an event from the schedule to start streaming.</p>
        <a href="/" class="btn-watch-primary" style="display:inline-block; width:auto; padding: 12px 28px;">Back to Schedule</a>
      `;
    }
    if (infoCard) {
      infoCard.innerHTML = `
        <div style="padding: 24px; text-align: center;">
          <h2 style="color: #dc2626; font-size: 1.5rem; margin-bottom: 8px;">No Match Specified</h2>
          <p style="color: #64748b; margin-bottom: 18px;">Please select an event from the schedule to view streamer links.</p>
          <a href="/" class="btn-streameast-watch">Return to Schedule</a>
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
        findAndRenderMatch(initialData);
      }
    } catch (e) {
      console.warn('Embedded schedule parse failed in match.js:', e);
    }
  }

  // 1. Instant static build data check
  if (!currentMatchData && typeof window.STATIC_MATCH_DATA !== 'undefined' && window.STATIC_MATCH_DATA) {
    try {
      const staticData = Array.isArray(window.STATIC_MATCH_DATA) ? window.STATIC_MATCH_DATA : [window.STATIC_MATCH_DATA];
      if (isDataFresh(staticData)) {
        findAndRenderMatch(staticData);
      }
    } catch (e) {
      console.warn('STATIC_MATCH_DATA render failed, falling back to cache:', e);
    }
  }

  // 2. Instant cache check: check localStorage / sessionStorage saved from app.js (only if fresh)
  if (!currentMatchData) {
    try {
      const cachedStr = localStorage.getItem('VIP_SCHEDULE_CACHE') || localStorage.getItem('METH_SCHEDULE_CACHE') || sessionStorage.getItem('METH_SCHEDULE_CACHE');
      if (cachedStr) {
        const cachedData = JSON.parse(cachedStr);
        if (Array.isArray(cachedData) && cachedData.length > 0) {
          if (isDataFresh(cachedData)) {
            findAndRenderMatch(cachedData);
          } else {
            localStorage.removeItem('VIP_SCHEDULE_CACHE');
            localStorage.removeItem('METH_SCHEDULE_CACHE');
          }
        }
      }
    } catch (e) { }
  }

  let loaded = !!currentMatchData;

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
        findAndRenderMatch(data);
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
          findAndRenderMatch(data);
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
        findAndRenderMatch(data);
        loaded = true;
      }
    } catch (e) { }
  }

  if (!loaded) {
    console.error('All data sources failed.');
    if (watchCardBox) {
      watchCardBox.innerHTML = `
        <h1 class="watch-match-heading" style="color: #ef4444; font-size: 1.6rem;">Unable to Load Match</h1>
        <p style="color: #94a3b8; margin: 12px 0 24px;">Could not connect to the live schedule feed. Please check your internet connection and refresh the page.</p>
        <a href="/" class="btn-watch-primary" style="display:inline-block; width:auto; padding: 12px 28px;">Return to Schedule</a>
      `;
    }
    if (infoCard) {
      infoCard.innerHTML = `
        <div style="padding: 24px; text-align: center;">
          <h2 style="color: #dc2626; font-size: 1.5rem; margin-bottom: 8px;">Unable to Load Match</h2>
          <p style="color: #64748b; margin-bottom: 18px;">Could not connect to the live schedule feed. Please check your internet connection and refresh the page.</p>
          <a href="/" class="btn-streameast-watch">Return to Schedule</a>
        </div>
      `;
    }
  }
}


// Find match object in nested data structure
function findAndRenderMatch(data) {
  let found = null;

  if (Array.isArray(data)) {
    for (const dayGroup of data) {
      const dayDate = dayGroup.date || 'Upcoming';
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
    // Extract sport and teams from either URL pathname (/watch/sport/teams/id) or query params
    const teamsParam = urlMatchDetails.teams || urlParams.get('teams') || '';
    const sportParam = urlMatchDetails.sport || urlParams.get('sport') || '';
    const teamsReadable = teamsParam.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const sportReadable = sportParam.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    if (teamsReadable) {
      updateCleanMatchUrl(sportParam, teamsParam, matchId);
      // Render a graceful expired-match page using slug info from URL
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
        event_status: 'FT',   // treat as finished so stream links are hidden
        live_status: 0,
        sch_iframe: '',
        tv_guide: ''
      };
      currentMatchData = stubMatch;
      renderMatchView(stubMatch);
      // Override the finished/expired message in the countdown card
      const countdownTitle = document.getElementById('countdownTitle');
      const countdownDesc = document.getElementById('countdownDescText');
      const countdownBadgePill = document.getElementById('countdownBadgePill');
      const countdownIconWrap = document.getElementById('countdownIconWrap');
      const countdownCard = document.getElementById('streamCountdownCard');
      if (countdownCard) countdownCard.style.display = 'flex';
      if (countdownTitle) countdownTitle.textContent = 'This Event Is No Longer in the Current Schedule';
      if (countdownDesc) countdownDesc.textContent = 'This match link is from a previous day\'s schedule. The event may have already concluded. Please return to the schedule to find today\'s live matches.';
      if (countdownBadgePill) countdownBadgePill.innerHTML = `<span>📅 Event: <strong>${escapeHtml(teamsReadable)}</strong> — Schedule Expired</span>`;
      if (countdownIconWrap) countdownIconWrap.innerHTML = `<span style="font-size: 1.8rem; line-height: 1;">📅</span>`;
    } else {
      if (watchCardBox) {
        watchCardBox.innerHTML = `
          <h1 class="watch-match-heading" style="color: #ef4444; font-size: 1.6rem;">Match Not Found</h1>
          <p style="color: #94a3b8; margin: 12px 0 24px;">The requested match could not be found in the current schedule. It may be from a previous day.</p>
          <a href="/" class="btn-watch-primary" style="display:inline-block; width:auto; padding: 12px 28px;">Return to Schedule</a>
        `;
      }
      const infoCard = document.getElementById('matchInfoCard');
      if (infoCard) {
        infoCard.innerHTML = `
          <div style="padding: 24px; text-align: center;">
            <h2 style="color: #dc2626; font-size: 1.5rem; margin-bottom: 8px;">Match Not Found</h2>
            <p style="color: #64748b; margin-bottom: 18px;">The requested match could not be found in the current schedule. It may be from a previous day.</p>
            <a href="/" class="btn-streameast-watch">Return to Schedule</a>
          </div>
        `;
      }
    }
    return;
  }

  currentMatchData = found;
  updateCleanMatchUrl(found.rawSport || found.sportCategory, found.teams, found.sch_id);

  // Dynamic Sports Category Nav Links (matching screenshot)
  const navContainer = document.getElementById('watchNavLinks');
  if (navContainer && Array.isArray(data)) {
    const sportsSet = new Set();
    for (const dayGroup of data) {
      if (Array.isArray(dayGroup.schedule)) {
        for (const item of dayGroup.schedule) {
          if (item.sport) sportsSet.add(item.sport.toUpperCase().trim());
        }
      }
    }
    if (sportsSet.size > 0) {
      const priorityList = ['SOCCER', 'MLB', 'USL', 'NFL', 'BASKETBALL', 'NHL'];
      const picked = [];
      for (const sp of priorityList) {
        if (sportsSet.has(sp)) picked.push(sp);
      }
      for (const sp of sportsSet) {
        if (!picked.includes(sp) && picked.length < 4) picked.push(sp);
      }
      if (picked.length > 0) {
        navContainer.innerHTML = picked.slice(0, 4).map(sp =>
          `<a href="/?sport=${encodeURIComponent(sp)}" class="watch-nav-item">${escapeHtml(sp)}</a>`
        ).join('\n');
      }
    }
  }

  renderMatchView(found);
}

// Parse and format complex comma-separated TV guide channel lists
function parseChannelGuide(rawTvGuide) {
  if (!rawTvGuide || typeof rawTvGuide !== 'string' || rawTvGuide.trim() === '') {
    return {
      primary: 'Live HD Broadcast',
      tableDisplay: 'Live HD Broadcast',
      all: ['Live HD Broadcast'],
      totalCount: 0,
      displayedCount: 1
    };
  }

  const channels = rawTvGuide.split(',').map(s => s.trim()).filter(Boolean);
  if (channels.length <= 1) {
    const single = channels[0] || 'Live HD Broadcast';
    return {
      primary: single,
      tableDisplay: single,
      all: channels,
      totalCount: channels.length,
      displayedCount: channels.length
    };
  }

  // Major broadcast networks to prioritize for display
  const priorityKeywords = [
    'sky sports premier', 'peacock', 'sky sports main', 'sky sports f1', 'sky sports',
    'tnt sports', 'usa network', 'nbc', 'espn', 'dazn', 'fox sports', 'cbs sports', 'bein sports',
    'apple tv', 'paramount', 'sportsnet', 'tsn', 'viaplay sports', 'premier sports', 'optus sport', 'supersport'
  ];

  const picked = [];
  for (const kw of priorityKeywords) {
    for (const ch of channels) {
      if (ch.toLowerCase().includes(kw) && !picked.includes(ch)) {
        picked.push(ch);
        if (picked.length >= 2) break;
      }
    }
    if (picked.length >= 2) break;
  }

  // Fallback to first 2 channels if no priority keyword matched
  if (picked.length === 0) {
    picked.push(...channels.slice(0, 2));
  }

  const primaryStr = picked.join(' / ');
  return {
    primary: primaryStr,
    tableDisplay: primaryStr,
    all: channels,
    totalCount: channels.length,
    displayedCount: picked.length
  };
}

// Helper to check if match has finished
function isMatchFinished(match) {
  if (!match) return false;
  const st = String(match.event_status || '').toUpperCase().trim();
  return st === 'FT' || st === 'FINISHED' || st === 'ENDED' || st === 'FINAL' || st === 'AOT';
}

// Helper to format date and time to screenshot format: "2026-09-16 01:00:00 PM ET"
function formatWatchDateTime(dateStr, timeStr) {
  let yyyy_mm_dd = '';
  try {
    if (dateStr && dateStr.includes(',')) {
      const parts = dateStr.split(',');
      const year = parts[1] ? parts[1].trim() : '2026';
      const monthDay = parts[0] ? parts[0].trim().split(/\s+/) : [];
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const monthIdx = monthNames.findIndex(m => m.toLowerCase() === (monthDay[0] || '').toLowerCase());
      if (monthIdx !== -1) {
        const m = String(monthIdx + 1).padStart(2, '0');
        const d = String(monthDay[1] || '01').padStart(2, '0');
        yyyy_mm_dd = `${year}-${m}-${d}`;
      }
    }
  } catch (e) {}

  if (!yyyy_mm_dd) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      yyyy_mm_dd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } else {
      yyyy_mm_dd = '2026-09-16';
    }
  }

  let cleanTime = (timeStr || '01:00 PM').trim();
  if (cleanTime.match(/^\d{1,2}:\d{2}\s*(?:AM|PM)$/i)) {
    cleanTime = cleanTime.replace(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i, '$1:$2:00 $3');
  }
  if (!cleanTime.toUpperCase().endsWith('ET')) {
    cleanTime += ' ET';
  }
  return `${yyyy_mm_dd} ${cleanTime}`;
}

// Render Match Page Content
function renderMatchView(match) {
  const matchTitle = match.teams || `${match.strHomeTeam || 'Home'} vs ${match.strAwayTeam || 'Away'}`;
  document.title = `Watch ${matchTitle} Live Stream - VIPRow`;

  // Determine sport category: from match data, or query param, or fallback
  const sportCategory = match.sportCategory || match.sport || urlParams.get('sport') || 'Sports';
  const matchDesc = `Watch ${matchTitle} live on VIPRow`;

  const sportSlug = (sportCategory || 'sports').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sports';
  const teamsSlug = (matchTitle || 'match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'match';

  // Update dynamic meta description tags in DOM
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', matchDesc);
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.setAttribute('content', matchDesc);
  const twDesc = document.querySelector('meta[name="twitter:description"]');
  if (twDesc) twDesc.setAttribute('content', matchDesc);

  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute('content', `Watch ${matchTitle} Live Stream - VIPRow`);
  const twTitle = document.querySelector('meta[name="twitter:title"]');
  if (twTitle) twTitle.setAttribute('content', `Watch ${matchTitle} Live Stream - VIPRow`);

  const dateStr = match.date || 'Today';
  const timeStr = match.event_time ? `${match.event_time} ET` : 'Live';
  const leagueStr = match.sch_league || match.league || match.sportCategory || 'Sports League';

  // 1. StreamHub Clean Watch Page Hero Card (Matching User's Screenshot)
  const watchLoadingState = document.getElementById('watchLoadingState');
  const watchCardInner = document.getElementById('watchCardInner');
  const watchMatchTitle = document.getElementById('watchMatchTitle');
  const watchLeaguePill = document.getElementById('watchLeaguePill');
  const watchMatchDateTime = document.getElementById('watchMatchDateTime');
  const watchNowBtn = document.getElementById('watchNowBtn');

  if (watchCardInner) {
    if (watchLoadingState) watchLoadingState.style.display = 'none';
    watchCardInner.style.display = 'block';

    if (watchMatchTitle) watchMatchTitle.textContent = matchTitle;
    if (watchLeaguePill) {
      const rawLeague = match.sch_league || match.league || match.sportCategory || 'SPORTS';
      watchLeaguePill.textContent = rawLeague.toUpperCase();
    }
    if (watchMatchDateTime) {
      watchMatchDateTime.textContent = formatWatchDateTime(match.event_date || match.date, match.event_time);
    }
    if (watchNowBtn) {
      const playerUrl = getPlayerUrl(teamsSlug, match.sch_id);
      watchNowBtn.href = playerUrl;
      watchNowBtn.onclick = function (e) {
        window.location.href = playerUrl;
        return false;
      };
    }
  }

  // Status Pill for legacy/additional containers
  const isFinished = isMatchFinished(match);
  const isLive = !isFinished && (match.live_status === 1 || match.event_status === 'LIVE');
  let statusBadge = '';
  if (isFinished) {
    statusBadge = `<span class="status-badge finished">FINISHED</span>`;
  } else if (isLive) {
    statusBadge = `
      <span class="live-now-text">[LIVE NOW]</span>
      <span class="status-badge live"><span class="live-pulse-dot"></span>LIVE</span>
    `;
  } else {
    statusBadge = `<span class="status-badge upcoming">UPCOMING</span>`;
  }

  // 2. Render Top Header Card (Legacy support)
  const infoCard = document.getElementById('matchInfoCard');
  if (infoCard) {
    infoCard.innerHTML = `
      <h1 class="match-page-title">${escapeHtml(matchTitle)}</h1>
      <p class="match-page-description">${escapeHtml(matchDesc)}</p>
      <div class="match-page-meta-row">
        <span>📅 ${escapeHtml(dateStr)}</span>
        <span>⏰ ${escapeHtml(timeStr)}</span>
        <span>🏆 ${escapeHtml(leagueStr)}</span>
      </div>
      <div class="match-page-badges-row">
        ${statusBadge}
        <span style="font-size:0.8rem;color:#64748b;font-weight:600;">Feed ID: #${escapeHtml(String(match.sch_id))}</span>
      </div>
    `;
  }

  // 3. Build Streamer Links List (Multiple Streamers: VIPRow, BuffStreams, TotalSportek, SportSurge)
  const baseIframe = match.sch_iframe || `https://embed.sportspatrika.com/live/embed.php?ch=${match.sch_id || 'es1'}`;
  const sep = baseIframe.includes('?') ? '&' : '?';

  const streamerList = [
    {
      id: 1,
      name: 'VIPRow',
      rating: 'Gold',
      lang: 'English',
      quality: '1080p FHD',
      isFhd: true,
      ads: '0',
      adblock: 'Yes',
      bitrate: '7500 Kbps',
      serverNum: 1,
      url: baseIframe
    },
    {
      id: 2,
      name: 'BuffStreams',
      rating: 'Gold',
      lang: 'English',
      quality: '1080p FHD',
      isFhd: true,
      ads: '1',
      adblock: 'Yes',
      bitrate: '6800 Kbps',
      serverNum: 2,
      url: `${baseIframe}${sep}cdn=buff`
    },
    {
      id: 3,
      name: 'TotalSportek',
      rating: 'Gold',
      lang: 'English',
      quality: '1080p HD',
      isFhd: false,
      ads: '1',
      adblock: 'Yes',
      bitrate: '6200 Kbps',
      serverNum: 3,
      url: `${baseIframe}${sep}mirror=totalsportek`
    },
    {
      id: 4,
      name: 'SportSurge',
      rating: 'Gold',
      lang: 'English',
      quality: '720p HD',
      isFhd: false,
      ads: '0',
      adblock: 'Yes',
      bitrate: '5500 Kbps',
      serverNum: 4,
      url: `${baseIframe}${sep}feed=sportsurge`
    }
  ];

  // 4. Link Visibility: NEVER show links on FINISHED events, only show if within 1 hour or LIVE
  const showLinks = isWithinOneHourOrLive(match);
  const countdownCard = document.getElementById('streamCountdownCard');
  const streamLinksCard = document.getElementById('streamLinksCard');
  const kickoffDisplay = document.getElementById('kickoffTimeDisplay');
  const countdownTitle = document.getElementById('countdownTitle');
  const countdownDesc = document.getElementById('countdownDescText');
  const countdownBadgePill = document.getElementById('countdownBadgePill');
  const countdownIconWrap = document.getElementById('countdownIconWrap');

  if (showLinks) {
    if (countdownCard) countdownCard.style.display = 'none';
    if (streamLinksCard) streamLinksCard.style.display = 'block';

    const tableBody = document.getElementById('streamTableBody');
    if (tableBody) {
      tableBody.innerHTML = streamerList.map(st => {
        const qualityClass = st.isFhd ? 'badge-quality-fhd' : 'badge-quality-hd';

        return `
          <tr id="streamRow_${st.id}">
            <td class="col-streamer">
              <div class="streamer-name">
                <span class="streamer-play-icon">▶</span>
                <span>${escapeHtml(st.name)}</span>
              </div>
              <div class="mobile-sub-meta">🥇 ${escapeHtml(st.rating)} • ${escapeHtml(st.lang)} • ${escapeHtml(st.bitrate)}</div>
            </td>
            <td class="col-rating">
              <span class="badge-rating-gold">
                <span class="medal-icon">🥇</span> ${escapeHtml(st.rating)}
              </span>
            </td>
            <td class="col-lang col-hide-mobile">${escapeHtml(st.lang)}</td>
            <td class="col-quality"><span class="${qualityClass}">${escapeHtml(st.quality)}</span></td>
            <td class="col-ads col-hide-tablet">${escapeHtml(st.ads)}</td>
            <td class="col-adblock col-hide-tablet"><span class="badge-adblock-yes">${escapeHtml(st.adblock)}</span></td>
            <td class="col-bitrate col-hide-tablet"><span style="color:#64748b;font-weight:600;">${escapeHtml(st.bitrate)}</span></td>
            <td class="col-action">
              <a 
                href="${getPlayerUrl(teamsSlug, match.sch_id, st.serverNum)}" 
                target="_blank" 
                rel="noopener noreferrer"
                class="btn-streameast-watch" 
                id="watchBtn_${st.id}"
              >
                Watch
              </a>
            </td>
          </tr>
        `;
      }).join('');
    }
  } else {
    // Hide links table
    if (streamLinksCard) streamLinksCard.style.display = 'none';

    // Show appropriate notice card
    if (countdownCard) {
      countdownCard.style.display = 'flex';

      if (isFinished) {
        countdownCard.classList.add('is-finished');
        if (countdownTitle) countdownTitle.textContent = 'This Match Has Concluded (Finished)';
        if (countdownDesc) countdownDesc.textContent = 'The official live broadcast feed for this event has ended. Streamer links are no longer available for completed events.';
        if (countdownBadgePill) countdownBadgePill.innerHTML = `<span>🏁 Event Status: <strong>Match Finished (FT)</strong></span>`;
        if (countdownIconWrap) countdownIconWrap.innerHTML = `<span style="font-size: 1.8rem; line-height: 1;">🏁</span>`;
      } else {
        countdownCard.classList.remove('is-finished');
        if (countdownTitle) countdownTitle.textContent = 'Live Stream Links Available 1 Hour Before Kickoff';
        if (countdownDesc) countdownDesc.textContent = 'Live stream links for this event will be published automatically 60 minutes before scheduled kickoff. Please check back soon!';

        const diffMinutes = getMinutesUntilKickoff(match);
        let timeRemainingText = '';
        if (diffMinutes !== null && diffMinutes > 60) {
          const hours = Math.floor(diffMinutes / 60);
          const mins = Math.floor(diffMinutes % 60);
          timeRemainingText = ` <span style="color:#ef4444;font-weight:700;">(Starts in ~${hours}h ${mins}m)</span>`;
        }

        if (countdownBadgePill) countdownBadgePill.innerHTML = `<span>⏰ Scheduled Kickoff: <strong id="kickoffTimeDisplay">${escapeHtml(dateStr)} • ${escapeHtml(timeStr)}</strong>${timeRemainingText}</span>`;
        if (countdownIconWrap) countdownIconWrap.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/></svg>`;
      }
    }
  }

  // 5. Populate Match Details Card (Legacy support)
  const detailsCard = document.getElementById('matchDetailsCard');
  const detailsGrid = document.getElementById('matchDetailsGrid');
  if (detailsCard) detailsCard.style.display = 'block';

  let streamerStatusText = '';
  if (isFinished) {
    streamerStatusText = '<span style="color:#64748b;">● Broadcast Ended (Match Finished)</span>';
  } else if (showLinks) {
    streamerStatusText = '<span style="color:#16a34a;">● VIPRow (Online & Ready)</span>';
  } else {
    streamerStatusText = '<span style="color:#ea580c;">⏳ Available 1 hour before kickoff</span>';
  }

  if (detailsGrid) {
    detailsGrid.innerHTML = `
      <div class="match-detail-box">
        <div class="detail-label">Home Team</div>
        <div class="detail-value">${escapeHtml(match.strHomeTeam || match.teams || 'TBD')}</div>
      </div>
      <div class="match-detail-box">
        <div class="detail-label">Away Team</div>
        <div class="detail-value">${escapeHtml(match.strAwayTeam || 'TBD')}</div>
      </div>
      <div class="match-detail-box">
        <div class="detail-label">League / Competition</div>
        <div class="detail-value">${escapeHtml(leagueStr)}</div>
      </div>
      <div class="match-detail-box">
        <div class="detail-label">Sport Category</div>
        <div class="detail-value">${escapeHtml(match.sportCategory || 'Live Sports')}</div>
      </div>
      <div class="match-detail-box">
        <div class="detail-label">Date & Time</div>
        <div class="detail-value">${escapeHtml(dateStr)} • ${escapeHtml(timeStr)}</div>
      </div>
      <div class="match-detail-box">
        <div class="detail-label">Broadcast Guide</div>
        <div class="detail-value">${escapeHtml(match.tv_guide ? match.tv_guide.split(',')[0].trim() : leagueStr + ' HD Broadcast')}</div>
      </div>
      <div class="match-detail-box">
        <div class="detail-label">Event Status</div>
        <div class="detail-value">${escapeHtml(isFinished ? 'FINISHED (FT)' : (isLive ? 'LIVE' : (match.event_status || 'Scheduled')))}</div>
      </div>
      <div class="match-detail-box">
        <div class="detail-label">Verified Streamer</div>
        <div class="detail-value">${streamerStatusText}</div>
      </div>
    `;
  }
}

// Parse North American Eastern Time (ET) with proper timezone offset
function parseMatchEasternDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;

  const cleanTime = timeStr.replace(/\s*(?:ET|EDT|EST|UTC|GMT)\s*$/i, '').trim();

  // In North America, Daylight Saving Time (EDT: UTC-4) applies from 2nd Sunday in March through 1st Sunday in November.
  // In other months, Standard Time (EST: UTC-5) applies.
  const lowerDate = dateStr.toLowerCase();
  const isEDT = lowerDate.includes('apr') || lowerDate.includes('may') || lowerDate.includes('jun') ||
    lowerDate.includes('jul') || lowerDate.includes('aug') || lowerDate.includes('sep') ||
    lowerDate.includes('oct') || lowerDate.includes('mar');

  const tz = isEDT ? 'EDT' : 'EST';
  let dt = new Date(`${dateStr} ${cleanTime} ${tz}`);

  if (isNaN(dt.getTime())) {
    const gmtOffset = isEDT ? 'GMT-0400' : 'GMT-0500';
    dt = new Date(`${dateStr} ${cleanTime} ${gmtOffset}`);
  }

  return isNaN(dt.getTime()) ? null : dt;
}

// Calculate remaining time until kickoff in minutes (positive = future, negative = past)
function getMinutesUntilKickoff(match) {
  if (!match || !match.date || !match.event_time) return null;
  const matchDateTime = parseMatchEasternDateTime(match.date, match.event_time);
  if (!matchDateTime) return null;

  const now = new Date();
  return (matchDateTime.getTime() - now.getTime()) / (1000 * 60);
}

// Check if match is within 1 hour of kickoff or currently LIVE
function isWithinOneHourOrLive(match) {
  // 1. Never show links for finished matches
  if (isMatchFinished(match)) {
    return false;
  }

  const viewParam = new URLSearchParams(window.location.search).get('view');
  if (viewParam === 'links') return true;
  if (viewParam === 'notice') return false;

  // 2. Explicit LIVE status
  if (match.live_status === 1 || match.event_status === 'LIVE') {
    return true;
  }

  // 3. Time comparison: only show links if within 60 minutes of kickoff or ongoing (started within past 150m)
  try {
    const diffMinutes = getMinutesUntilKickoff(match);
    if (diffMinutes !== null) {
      if (diffMinutes <= 60 && diffMinutes >= -150) {
        return true;
      }
    }
  } catch (err) {
    console.warn('Time calculation error:', err);
  }

  return false;
}

// Open Stream Modal on Watch Click
window.openStreamModal = function (streamerName, streamUrl) {
  const modal = document.getElementById('playerModal');
  const title = document.getElementById('modalMatchTitle');
  const viewport = document.getElementById('playerViewport');
  const directLink = document.getElementById('modalDirectLink');

  if (title && currentMatchData) {
    const matchName = currentMatchData.teams || `${currentMatchData.strHomeTeam || ''} vs ${currentMatchData.strAwayTeam || ''}`;
    title.textContent = `${matchName} - ${streamerName}`;
  }

  if (directLink) {
    directLink.href = streamUrl;
  }

  if (viewport) {
    viewport.innerHTML = `
      <iframe 
        src="${streamUrl}" 
        allowfullscreen 
        allow="encrypted-media; autoplay; picture-in-picture"
        scrolling="no"
      ></iframe>
    `;
  }

  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
};

window.closeStreamModal = function () {
  const modal = document.getElementById('playerModal');
  const viewport = document.getElementById('playerViewport');
  if (viewport) viewport.innerHTML = '';
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
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
      <p style="color:#ffffff; line-height:1.8;">We respect your privacy and believe in complete transparency regarding how your data is treated when you browse our platform. This policy explains our approach to information gathering, advertising partners, and external links.</p>
      <h4 style="color:#ffffff; margin-top:14px; margin-bottom:6px;">1. Data Collection &amp; Server Logs</h4>
      <p style="color:#ffffff; line-height:1.8;">We do not mandate user accounts, build personal profiles, or actively gather identifiable personal details. To keep our platform secure and running smoothly, our servers automatically generate basic technical logs.</p>
      <h4 style="color:#ffffff; margin-top:14px; margin-bottom:6px;">2. Ads &amp; Tracking Tools</h4>
      <p style="color:#ffffff; line-height:1.8;">While we avoid using our own tracking cookies or analytics software, we do team up with external ad networks to fund the site.</p>
      <h4 style="color:#ffffff; margin-top:14px; margin-bottom:6px;">3. Outside Links &amp; Third-Party Websites</h4>
      <p style="color:#ffffff; line-height:1.8;">Because we act as a link directory, our pages are filled with links routing you to outside streaming platforms. Please note that we do not own or manage these external websites.</p>
      <p style="color:#ffffff; line-height:1.8; margin-top:12px;">For inquiries, reach out via our <a href="/contact" style="color:#ffffff; text-decoration:underline;">Contact Page</a> or read our full <a href="/privacy-policy" style="color:#ffffff; text-decoration:underline;">Privacy Policy</a>.</p>
    `
  },
  terms: {
    title: 'Terms of Service',
    content: `
      <p style="color:#ffffff; line-height:1.8;">Welcome to our site. Please review these Terms of Service ("Terms") thoroughly before utilizing our platform. By accessing this website, you consent to these Terms. If you disagree with any portion of this agreement, you must stop using the site immediately.</p>
      <h4 style="color:#ffffff; margin-top:14px; margin-bottom:6px;">1. Description of Service</h4>
      <p style="color:#ffffff; line-height:1.8;">This platform acts exclusively as a search directory and link aggregator for publicly accessible content. We supply event schedules and route visitors to external streaming sites. We never host, upload, stream, or store media on our own infrastructure. All videos and feeds found via our site are entirely managed and hosted by independent third parties.</p>
      <h4 style="color:#ffffff; margin-top:14px; margin-bottom:6px;">2. Age Requirements</h4>
      <p style="color:#ffffff; line-height:1.8;">This website is built exclusively for individuals who are eighteen (18) years old or older. By accessing our platform, you confirm that you meet this age requirement. If you are under 18, you are not permitted to use our services.</p>
      <p style="color:#ffffff; line-height:1.8; margin-top:12px;">For inquiries, reach out via our <a href="/contact" style="color:#ffffff; text-decoration:underline;">Contact Page</a> or read our full <a href="/terms-of-service" style="color:#ffffff; text-decoration:underline;">Terms of Service</a>.</p>
    `
  },
  dmca: {
    title: 'DMCA Policy',
    content: `
      <p style="color:#ffffff; line-height:1.8;">This page outlines our compliance with the Digital Millennium Copyright Act (DMCA) and our approach to handling copyright infringement claims.</p>
      <h4 style="color:#ffffff; margin-top:14px; margin-bottom:6px;">Copyright Notice &amp; Content Hosting</h4>
      <p style="color:#ffffff; line-height:1.8;">We respect the intellectual property rights of others and expect our users to do the same. Our website operates strictly as a directory and aggregator of publicly available links, providing scheduling information and directing users to third-party streaming platforms.</p>
      <p style="color:#ffffff; line-height:1.8;">We do not host, store, upload, transmit, or control any media content on our servers. All streaming video content is hosted and managed entirely by independent, third-party providers.</p>
      <h4 style="color:#ffffff; margin-top:14px; margin-bottom:6px;">Filing a DMCA Takedown Request</h4>
      <p style="color:#ffffff; line-height:1.8;">If you believe that a link on our website directs users to content that infringes upon your copyright, we strongly recommend contacting the third-party hosting provider directly, as they have direct control over the media.</p>
      <p style="color:#ffffff; line-height:1.8;">However, if you wish to request the removal of a specific link from our directory, please provide us with a formal DMCA notice containing required statutory information via email to <a href="#" onclick="window.location.href='mailto:contact@' + (window.location.hostname || '');return false;" style="color:#ffffff; text-decoration:underline;">contact@<span class="active-site-host"></span></a>. Please include “DMCA Notice” in the subject line to ensure prompt and proper handling.</p>
    `
  },
  contact: {
    title: 'Contact Us',
    content: `
      <p style="font-size:1.15rem; font-weight:700; color:#ffffff;">Email: <a href="#" onclick="window.location.href='mailto:contact@' + (window.location.hostname || 'viprow.nu');return false;" style="color:#ffffff; text-decoration:underline;">contact@<span class="active-site-host">viprow.nu</span></a></p>
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

window.dismissBottomAd = function () {
  const ad = document.getElementById('bottomStickyAd');
  if (ad) {
    ad.classList.add('dismissed');
    setTimeout(() => {
      ad.style.display = 'none';
    }, 300);
  }
};

window.sharePage = function (platform) {
  const url = window.location.href;
  const title = document.title || "VIPRow - Live Sports Stream";

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

let currentBroadcasterList = [];

// Official Broadcasters Channel Modal Logic
window.openChannelsModal = function () {
  const modal = document.getElementById('channelsModal');
  const title = document.getElementById('channelsModalTitle');
  const searchInput = document.getElementById('channelSearchInput');

  if (!modal) return;

  if (currentMatchData && title) {
    const matchName = currentMatchData.teams || `${currentMatchData.strHomeTeam || ''} vs ${currentMatchData.strAwayTeam || ''}`;
    title.textContent = `Official Broadcasters: ${matchName}`;
  }

  if (currentMatchData && currentMatchData.channelData && Array.isArray(currentMatchData.channelData.all)) {
    currentBroadcasterList = currentMatchData.channelData.all;
  } else if (currentMatchData && currentMatchData.tv_guide) {
    currentBroadcasterList = currentMatchData.tv_guide.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    currentBroadcasterList = [];
  }

  if (searchInput) searchInput.value = '';
  renderChannelsList(currentBroadcasterList);

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  if (searchInput) {
    setTimeout(() => searchInput.focus(), 80);
  }
};

window.closeChannelsModal = function () {
  const modal = document.getElementById('channelsModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
};

function renderChannelsList(list, query = '') {
  const grid = document.getElementById('channelsBadgeGrid');
  if (!grid) return;

  if (!list || list.length === 0) {
    grid.innerHTML = `
      <div style="width:100%;text-align:center;padding:28px 12px;color:#94a3b8;font-size:0.9rem;">
        ${query ? `No broadcaster channels found matching "${escapeHtml(query)}".` : 'No channel guide available for this event.'}
      </div>
    `;
    return;
  }

  grid.innerHTML = list.map(ch => {
    return `<span class="channel-pill-item"><span style="opacity:0.8;">📺</span> ${escapeHtml(ch)}</span>`;
  }).join('');
}

window.filterChannelsList = function (query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderChannelsList(currentBroadcasterList);
    return;
  }
  const filtered = currentBroadcasterList.filter(ch => ch.toLowerCase().includes(q));
  renderChannelsList(filtered, query);
};

function setupEventListeners() {
  const modalOverlay = document.getElementById('policyModal');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closePolicyModal();
    });
  }

  const playerOverlay = document.getElementById('playerModal');
  if (playerOverlay) {
    playerOverlay.addEventListener('click', (e) => {
      if (e.target === playerOverlay) closeStreamModal();
    });
  }

  const channelsOverlay = document.getElementById('channelsModal');
  if (channelsOverlay) {
    channelsOverlay.addEventListener('click', (e) => {
      if (e.target === channelsOverlay) closeChannelsModal();
    });
  }

  // Mobile menu setup
  setupMobileMenu();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePolicyModal();
      closeStreamModal();
      closeChannelsModal();
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
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
