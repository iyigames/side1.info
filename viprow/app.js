// Clean /index.html from URL bar so it always appears cleanly as /
if (typeof window !== 'undefined' && (window.location.pathname.endsWith('/index.html') || window.location.pathname.endsWith('/index'))) {
  const cleanPath = window.location.pathname.replace(/\/index(\.html)?$/, '/') + window.location.search + window.location.hash;
  window.history.replaceState(null, '', cleanPath);
}

// State management
let allMatches = [];
let availableDates = [];
let currentSport = 'ALL';
let currentDate = 'ALL';
let currentSearch = '';
let activeMatchForModal = null;
let _refreshTimer = null;

// Curated Sports Headlines (matching reference design)
const SPORTS_HEADLINES = [
  {
    id: 'h1',
    title: 'BREAKING: Mbappe Officially Joins Al-Hilal in Record Deal',
    category: 'Soccer',
    image: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=300&auto=format&fit=crop&q=80',
    summary: 'The football world has been stunned as global superstar Kylian Mbappe finalizes a blockbuster agreement in a record-breaking deal.'
  },
  {
    id: 'h2',
    title: "Shohei Ohtani's MVP Season Reaches New Heights",
    category: 'MLB',
    image: 'https://images.unsplash.com/photo-1593341646782-e0b495cff86d?w=300&auto=format&fit=crop&q=80',
    summary: 'Shohei Ohtani continues his unprecedented dual-threat performance, setting modern franchise records as the post-season approaches.'
  },
  {
    id: 'h3',
    title: 'WNBA All-Star Rosters Revealed, Caitlin Clark Dominates Fan Vote',
    category: 'WNBA',
    image: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=300&auto=format&fit=crop&q=80',
    summary: 'The official All-Star voting numbers confirm historic fan turnout and record television ratings across all major networks.'
  },
  {
    id: 'h4',
    title: 'F1 Austrian GP: Verstappen Retakes Pole in Last-Second Lap',
    category: 'F1',
    image: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=300&auto=format&fit=crop&q=80',
    summary: 'A dramatic qualifying shootout in Spielberg ends with a razor-thin margin as Red Bull clinches the top grid spot.'
  },
  {
    id: 'h5',
    title: 'Kansas City Chiefs Training Camp: Mahomes Unveils New RedZone Weapon',
    category: 'NFL',
    image: 'https://images.unsplash.com/photo-1566577739112-5180d4bf9390?w=300&auto=format&fit=crop&q=80',
    summary: 'Andy Reid and Patrick Mahomes have surprised defensive coordinators with an explosive set of new offensive formations.'
  },
  {
    id: 'h6',
    title: 'UFC 312: Makhachev Prepares for Historic Title Defense in Abu Dhabi',
    category: 'UFC',
    image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=300&auto=format&fit=crop&q=80',
    summary: 'Pound-for-pound champion Islam Makhachev enters fight week with high intensity, addressing challengers and legacy aspirations.'
  }
];

// Helper: Sport Emoji & Icon Mapping
function getSportIcon(sport, league) {
  const s = (sport || '').toUpperCase();
  const l = (league || '').toUpperCase();

  if (s.includes('SOCCER') || l.includes('SOCCER') || l.includes('LIGUE') || l.includes('SERIE') || l.includes('USL')) return '⚽';
  if (s.includes('NBA') || s.includes('BASKETBALL') || l.includes('WNBA') || l.includes('NCAAB')) return '🏀';
  if (s.includes('NFL') || s.includes('FOOTBALL') || l.includes('NFL') || l.includes('CFB') || l.includes('CFL')) return '🏈';
  if (s.includes('MLB') || s.includes('BASEBALL') || l.includes('BASEBALL')) return '⚾';
  if (s.includes('NHL') || s.includes('HOCKEY') || l.includes('HOCKEY')) return '🏒';
  if (s.includes('FIGHT') || s.includes('BOXING') || s.includes('MMA') || l.includes('UFC')) return '🥊';
  if (s.includes('TENNIS') || l.includes('TENNIS')) return '🎾';
  if (s.includes('MOTOR') || s.includes('F1') || l.includes('FORMULA') || l.includes('NASCAR')) return '🏎️';
  return '🏆';
}

// Priority ordering for sports categories (NFL strictly on top as requested)
const SPORT_PRIORITY = {
  'NFL': 1,
  'CFB': 2,
  'SOCCER': 3,
  'BASKETBALL': 4,
  'NBA': 4,
  'BASEBALL': 5,
  'MLB': 5,
  'NHL': 6,
  'HOCKEY': 6,
  'UFC': 7,
  'MMA': 7,
  'BOXING': 8,
  'TENNIS': 9,
  'USL': 10,
  'WNBA': 11,
  'NCAAB': 12,
  'CFL': 13,
  'F1': 14,
  'MOTORSPORTS': 15
};

function getSportSortOrder(sportKey) {
  const k = (sportKey || '').toUpperCase().trim();
  return SPORT_PRIORITY[k] || 99;
}

// Normalizes sport names for category filtering
function normalizeSportCategory(sport, league) {
  const s = (sport || '').toUpperCase().trim();
  const l = (league || '').toUpperCase().trim();

  if (s === 'NFL' || l.includes('NFL') || l.includes('NATIONAL FOOTBALL LEAGUE')) return 'NFL';
  if (s === 'CFB' || l.includes('COLLEGE FOOTBALL') || l.includes('NCAA') || l.includes('NCAAF')) return 'CFB';
  if (s === 'CFL' || l.includes('CFL')) return 'CFL';
  if (l.includes('WNBA')) return 'WNBA';
  if (s === 'NBA' || l.includes('NBA') || s.includes('BASKETBALL')) return 'BASKETBALL';
  if (s === 'MLB' || l.includes('MLB') || s.includes('BASEBALL') || l.includes('BASEBALL')) return 'BASEBALL';
  if (s === 'NHL' || l.includes('NHL') || s.includes('HOCKEY') || l.includes('HOCKEY')) return 'NHL';
  if (s === 'USL' || l.includes('USL')) return 'USL';
  if (s === 'SOCCER' || s === 'MLS' || l.includes('SOCCER') || l.includes('MLS') || l.includes('LIGUE') || l.includes('SERIE') || l.includes('PREMIER') || l.includes('LA LIGA') || l.includes('BUNDESLIGA') || l.includes('CHAMPIONS LEAGUE') || l.includes('EUROPA')) return 'SOCCER';
  if (s === 'BOXING' || l.includes('BOXING')) return 'BOXING';
  if (s === 'UFC' || s === 'MMA' || s === 'FIGHTING' || l.includes('UFC') || l.includes('MMA')) return 'UFC';
  if (s === 'TENNIS' || l.includes('TENNIS') || l.includes('ATP') || l.includes('WTA')) return 'TENNIS';
  if (s === 'MOTORSPORTS' || s === 'F1' || l.includes('F1') || l.includes('FORMULA') || l.includes('NASCAR') || l.includes('MOTO')) return 'F1';
  if (l.includes('NCAAB')) return 'NCAAB';

  return s || 'OTHER';
}

// Format readable date and time
function formatDateTime(dateStr, timeStr) {
  if (!dateStr && !timeStr) return 'TBD';
  const cleanTime = timeStr ? `${timeStr} ET` : '';
  if (!dateStr) return cleanTime;
  return `${dateStr}${cleanTime ? ', ' + cleanTime : ''}`;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  renderHeadlines();

  const urlParams = new URLSearchParams(window.location.search);
  const paramSport = urlParams.get('sport');
  if (paramSport) {
    selectSport(paramSport.toUpperCase());
  } else {
    selectSport('ALL');
  }

  fetchSchedule();
});

let lastScheduleRawStr = '';

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
  // Strategy 1: Isolated Web Worker (V8 worker isolate thread where window/DOM extension hooks don't exist)
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
    } catch (workerErr) {
      // Fall through to Strategy 2
    }
  }

  // Strategy 2: Clean unhooked iframe context (bypasses window.fetch and XMLHttpRequest monkey-patches)
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
  } catch (frameErr) {
    // Fall through to Strategy 3
  } finally {
    if (frame && frame.parentNode) {
      frame.parentNode.removeChild(frame);
    }
  }

  // Strategy 3: Standard fetch fallback
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Robust stealth real-time schedule fetcher
async function fetchRealTimeSchedule() {
  const cacheBust = `_t=${Date.now()}`;
  const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost' ||
    window.location.protocol === 'file:'
  );

  // In production (Vercel / Cloudflare), try edge serverless proxy first
  const endpoints = isLocal
    ? [`/data/schedule.bin?${cacheBust}`, `/schedule_cache.json?${cacheBust}`]
    : [`/api/schedule?${cacheBust}`, `/data/schedule.bin?${cacheBust}`, `/api/v1/schedule?${cacheBust}`, `/schedule_cache.json?${cacheBust}`];

  for (const ep of endpoints) {
    try {
      const data = await stealthFetchJson(ep, { timeout: 4000 });
      if (Array.isArray(data) && data.length > 0 && isDataFresh(data)) {
        return data;
      }
    } catch (e) { }
  }

  // Direct secure fallback (works anywhere: local development, Live Server, or if server proxy is unavailable)
  const secureFallback = getSecureScheduleEndpoint();
  if (secureFallback) {
    try {
      const data = await stealthFetchJson(secureFallback, { timeout: 7000 });
      if (Array.isArray(data) && data.length > 0 && isDataFresh(data)) {
        return data;
      }
    } catch (e) { }
  }

  // Final fallback to static cache
  try {
    const data = await stealthFetchJson(`/data/schedule.bin?${cacheBust}`, { timeout: 4000 });
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch (e) { }

  return null;
}

// Fetch Live Schedule — instant 0ms DOM render + stealth real-time sync
async function fetchSchedule(silent = false) {
  const matchesContainer = document.getElementById('matchesList');

  // 1. Instant zero-latency render from server-injected DOM data if fresh
  if (!allMatches.length) {
    try {
      const el = document.getElementById('__VIP_DATA__') || document.getElementById('__METH_DATA__');
      if (el && el.textContent && el.textContent.trim()) {
        const embedded = JSON.parse(el.textContent);
        if (isDataFresh(embedded)) {
          processScheduleData(embedded);
        }
      }
    } catch (e) {
      console.warn('DOM schedule parse error:', e);
    }

    // 2. Instant cache check from localStorage (only if fresh for today)
    if (!allMatches.length) {
      try {
        const cachedStr = localStorage.getItem('VIP_SCHEDULE_CACHE') || localStorage.getItem('METH_SCHEDULE_CACHE');
        if (cachedStr) {
          const cachedData = JSON.parse(cachedStr);
          if (isDataFresh(cachedData)) {
            processScheduleData(cachedData);
          } else {
            // Stale cache from previous day, clear it
            localStorage.removeItem('VIP_SCHEDULE_CACHE');
            localStorage.removeItem('METH_SCHEDULE_CACHE');
          }
        }
      } catch (e) { }
    }
  }

  // 3. Real-Time Network Sync:
  const freshData = await fetchRealTimeSchedule();
  if (freshData && Array.isArray(freshData) && freshData.length > 0) {
    processScheduleData(freshData);
    return;
  }

  // 4. Fallback error state only if matches list is still completely empty
  if (!allMatches.length && matchesContainer) {
    matchesContainer.innerHTML = `
      <div class="empty-state">
        <p>⚠️ Unable to load schedule. Please check your internet connection.</p>
        <button onclick="fetchSchedule()" style="margin-top:12px;padding:8px 16px;background:#dc2626;border:none;color:#fff;border-radius:6px;cursor:pointer;">Refresh Schedule</button>
      </div>
    `;
  }
}

// Set up continuous real-time live data polling (every 30 seconds)
if (!_refreshTimer && typeof window !== 'undefined') {
  _refreshTimer = setInterval(() => {
    fetchSchedule(true);
  }, 30000);

  // Also refresh immediately when the user switches back to the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      fetchSchedule(true);
    }
  });

  window.addEventListener('focus', () => {
    fetchSchedule(true);
  });
}

// Process and Normalize Data
function processScheduleData(apiDays) {
    if (!Array.isArray(apiDays) || apiDays.length === 0) return;

    const rawStr = JSON.stringify(apiDays);
    if (rawStr === lastScheduleRawStr && allMatches.length > 0) {
      return;
    }
    lastScheduleRawStr = rawStr;

    const now = Date.now();
    // Keep active days within 36 hours of current time (covers overnight games and timezone differences)
    const activeDays = apiDays.filter(dayGroup => {
      if (!dayGroup || !dayGroup.date) return false;
      const d = new Date(dayGroup.date);
      if (isNaN(d.getTime())) return true;
      return (now - d.getTime()) <= 36 * 60 * 60 * 1000;
    });

    const daysToRender = activeDays.length > 0 ? activeDays : apiDays;

    // Cache the fresh live data as offline fallback
    try {
      localStorage.setItem('VIP_SCHEDULE_CACHE', JSON.stringify(daysToRender));
    } catch (e) { }

    allMatches = [];
    const dateSet = new Set();

    daysToRender.forEach(dayGroup => {
      const dayDate = dayGroup.date || 'Upcoming';
      dateSet.add(dayDate);

      const sportsList = dayGroup.schedule || [];
      sportsList.forEach(sportItem => {
        const sportCategory = sportItem.sport;
        const matches = sportItem.league_schedule || [];

        matches.forEach(m => {
          const sportKey = normalizeSportCategory(sportCategory, m.sch_league || m.league);

          allMatches.push({
            id: m.sch_id || Math.random().toString(36).substr(2, 9),
            teams: m.teams || `${m.strHomeTeam || 'Home'} vs ${m.strAwayTeam || 'Away'}`,
            homeTeam: m.strHomeTeam || '',
            awayTeam: m.strAwayTeam || '',
            homeLogo: m.sch_home_logo || '',
            awayLogo: m.sch_away_logo || '',
            thumb: m.strThumb || '',
            date: dayDate,
            time: m.event_time || '',
            league: m.sch_league || m.league || sportCategory,
            sportCategory: sportKey,
            rawSport: sportCategory,
            liveStatus: m.live_status === 1 || m.live_status === '1' || m.event_status === 'LIVE' || m.status === 'LIVE' || m.tsdb_status === 'LIVE' || m.tsdb_status === 'IN PLAY',
            eventStatus: m.event_status || (m.live_status === 1 ? 'LIVE' : 'NS'),
            iframe: m.sch_iframe || '',
            channel: m.tv_guide || 'Live HD Stream',
            streams: m.streams || []
          });
        });
      });
    });

    availableDates = Array.from(dateSet);
    populateDateDropdown();
    renderMatches();
  }

  // Populate Date Dropdown Selector
  function populateDateDropdown() {
    const dateSelect = document.getElementById('dateSelect');
    if (!dateSelect) return;

    dateSelect.innerHTML = `<option value="ALL">All Dates</option>`;
    availableDates.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      dateSelect.appendChild(opt);
    });
  }

  // Category Configuration & Metadata
  const CATEGORY_CONFIG = {
    'NFL': { name: 'NFL Football', icon: '🏈' },
    'CFB': { name: 'College Football (CFB)', icon: '🏈' },
    'SOCCER': { name: 'Soccer', icon: '⚽' },
    'BASKETBALL': { name: 'Basketball (NBA)', icon: '🏀' },
    'BASEBALL': { name: 'Baseball (MLB)', icon: '⚾' },
    'NHL': { name: 'Hockey (NHL)', icon: '🏒' },
    'USL': { name: 'USL Championship', icon: '⚽' },
    'UFC': { name: 'UFC & MMA', icon: '🥊' },
    'BOXING': { name: 'Boxing', icon: '🥊' },
    'TENNIS': { name: 'Tennis', icon: '🎾' },
    'F1': { name: 'Formula 1 & Racing', icon: '🏎️' },
    'OTHER': { name: 'Other Sports', icon: '🏆' }
  };

  // Render single match card HTML (Clean Simple StreamHub Style)
  function renderMatchCard(m) {
    const sportLabel = (m.sportCategory || m.rawSport || 'SPORTS').toUpperCase();
    const dateFormatted = formatDateTime(m.date, m.time);
    const isLive = Boolean(m.liveStatus);

    // Subtle, clean live badge next to sport pill
    const liveBadge = isLive
      ? `<span class="simple-live-badge"><span class="live-dot-ping"></span>LIVE</span>`
      : '';

    const sportSlug = (m.rawSport || m.sportCategory || 'sports').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sports';
    const teamsSlug = (m.teams || 'match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'match';
    const cleanWatchUrl = `/watch/${encodeURIComponent(sportSlug)}/${encodeURIComponent(teamsSlug)}/${encodeURIComponent(m.id)}`;

    return `
    <a href="${cleanWatchUrl}" class="streamhub-match-card" data-match-id="${escapeHtml(String(m.id))}" onclick="if(!event.ctrlKey && !event.metaKey && event.button === 0){ event.preventDefault(); goToMatch('${escapeHtml(String(m.id))}', '${escapeHtml(m.rawSport || m.sportCategory || 'sports')}', '${escapeHtml(m.teams || 'match')}'); }">
      <div class="match-card-left">
        <h3 class="match-card-title" title="${escapeHtml(m.teams)}">${escapeHtml(m.teams)}</h3>
        <div class="match-card-meta">
          <span class="sport-badge-pill">${escapeHtml(sportLabel)}</span>
          ${liveBadge}
          <span class="match-card-date">${escapeHtml(dateFormatted)}</span>
        </div>
      </div>
      <div class="match-card-right">
        <span class="btn-watch-pill" aria-label="Watch ${escapeHtml(m.teams)}">Watch</span>
      </div>
    </a>
  `;
  }

  // Filter and Render Matches (Simple, Clean Layout with NFL on Top)
  function renderMatches() {
    const matchesContainer = document.getElementById('matchesList');
    const countBadge = document.getElementById('scheduleCountBadge') || document.getElementById('matchCountBadge');

    const filtered = allMatches.filter(m => {
      // Sport Filter with smart category mapping
      if (currentSport !== 'ALL') {
        const s = (currentSport || '').toUpperCase().trim();
        const mCat = (m.sportCategory || '').toUpperCase().trim();
        const mRaw = (m.rawSport || '').toUpperCase().trim();
        const mLeague = (m.league || '').toUpperCase().trim();

        if (s === 'BASKETBALL' || s === 'NBA') {
          if (mCat !== 'BASKETBALL' && mCat !== 'NBA' && mRaw !== 'NBA' && mCat !== 'WNBA' && mCat !== 'NCAAB' && !mLeague.includes('NBA')) return false;
        } else if (s === 'BASEBALL' || s === 'MLB') {
          if (mCat !== 'BASEBALL' && mCat !== 'MLB' && mRaw !== 'MLB' && !mLeague.includes('BASEBALL') && !mLeague.includes('MLB')) return false;
        } else if (s === 'USL') {
          if (mCat !== 'USL' && mRaw !== 'USL' && !mLeague.includes('USL')) return false;
        } else if (s === 'SOCCER') {
          if (mCat !== 'SOCCER' && mRaw !== 'SOCCER' && mCat !== 'USL' && mRaw !== 'USL' && !mLeague.includes('SOCCER') && !mLeague.includes('CUP') && !mLeague.includes('LEAGUE') && !mLeague.includes('CONCACAF') && !mLeague.includes('UEFA') && !mLeague.includes('LIBERTADORES')) return false;
        } else if (s === 'TENNIS') {
          if (mCat !== 'TENNIS' && mRaw !== 'TENNIS' && !mLeague.includes('TENNIS')) return false;
        } else if (s === 'NFL') {
          if (mCat !== 'NFL' && mRaw !== 'NFL' && !mLeague.includes('NFL')) return false;
        } else if (s === 'CFB') {
          if (mCat !== 'CFB' && mRaw !== 'CFB' && !mLeague.includes('COLLEGE') && !mLeague.includes('NCAA') && !mLeague.includes('NCAAF')) return false;
        } else if (s === 'NHL' || s === 'HOCKEY') {
          if (mCat !== 'NHL' && mRaw !== 'NHL' && !mLeague.includes('NHL') && !mLeague.includes('HOCKEY')) return false;
        } else if (s === 'UFC' || s === 'MMA') {
          if (mCat !== 'UFC' && mCat !== 'MMA' && mRaw !== 'UFC' && mRaw !== 'MMA' && !mLeague.includes('UFC') && !mLeague.includes('MMA')) return false;
        } else if (s === 'BOXING') {
          if (mCat !== 'BOXING' && mRaw !== 'BOXING' && !mLeague.includes('BOXING')) return false;
        } else if (s === 'F1' || s === 'MOTORSPORTS' || s === 'RACING') {
          if (mCat !== 'F1' && mCat !== 'MOTORSPORTS' && mRaw !== 'F1' && !mLeague.includes('F1') && !mLeague.includes('NASCAR') && !mLeague.includes('MOTO') && !mLeague.includes('RACING')) return false;
        } else {
          if (mCat !== s && mRaw !== s) return false;
        }
      }

      // Date Filter
      if (currentDate !== 'ALL') {
        if (m.date !== currentDate) return false;
      }

      // Search Filter
      if (currentSearch.trim() !== '') {
        const q = currentSearch.toLowerCase();
        const matchText = `${m.teams} ${m.league} ${m.sportCategory} ${m.rawSport}`.toLowerCase();
        if (!matchText.includes(q)) return false;
      }

      return true;
    });

    // Update counter if present
    if (countBadge) {
      if (currentSearch.trim() !== '') {
        countBadge.textContent = `${filtered.length} found`;
      } else if (currentSport !== 'ALL') {
        countBadge.textContent = `${filtered.length} ${currentSport} events`;
      } else {
        countBadge.textContent = `${filtered.length} events`;
      }
    }

    if (filtered.length === 0) {
      matchesContainer.innerHTML = `
      <div class="empty-state">
        <p>No matches found matching your selection.</p>
      </div>
    `;
      return;
    }

    // Helper sort function: Live matches first, then chronological
    const sortMatchesByTimeAndLive = (list) => {
      return list.slice().sort((a, b) => {
        if (a.liveStatus && !b.liveStatus) return -1;
        if (!a.liveStatus && b.liveStatus) return 1;
        return (a.time || '').localeCompare(b.time || '');
      });
    };

    let html = '';

    // If viewing ALL, group by category with NFL on top
    if (currentSport === 'ALL') {
      const groupsMap = new Map();
      filtered.forEach(m => {
        const cat = m.sportCategory || 'OTHER';
        if (!groupsMap.has(cat)) {
          groupsMap.set(cat, []);
        }
        groupsMap.get(cat).push(m);
      });

      // Order categories: NFL strictly on top, then by SPORT_PRIORITY
      const sortedCategories = Array.from(groupsMap.keys()).sort((a, b) => {
        if (a === 'NFL' && b !== 'NFL') return -1;
        if (a !== 'NFL' && b === 'NFL') return 1;
        return getSportSortOrder(a) - getSportSortOrder(b);
      });

      sortedCategories.forEach(catKey => {
        const catMatches = sortMatchesByTimeAndLive(groupsMap.get(catKey));
        const meta = CATEGORY_CONFIG[catKey] || { name: `${catKey}`, icon: '🏆' };

        html += `
        <div class="category-group" data-category="${escapeHtml(catKey)}">
          <div class="category-simple-header">
            <h3 class="category-simple-title">${meta.icon} ${escapeHtml(meta.name)}</h3>
            <span class="category-simple-count">(${catMatches.length})</span>
          </div>
          <div class="category-cards-list">
            ${catMatches.map(m => renderMatchCard(m)).join('')}
          </div>
        </div>
      `;
      });
    } else {
      // If filtered to a specific sport, render simple clean list
      const sorted = sortMatchesByTimeAndLive(filtered);
      html = `
      <div class="category-cards-list">
        ${sorted.map(m => renderMatchCard(m)).join('')}
      </div>
    `;
    }

    matchesContainer.innerHTML = html;
  }

  // Navigate to Match Page via dynamic API query with clean slugs
  window.openMatchDetail = function (matchId, sport, teams) {
    let matchTeams = teams;
    let matchSport = sport;
    if (!matchTeams) {
      const found = allMatches.find(m => String(m.id) === String(matchId));
      if (found) {
        matchTeams = found.teams;
        matchSport = found.rawSport || found.sportCategory;
      }
    }
    const sportSlug = (matchSport || 'sports').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sports';
    const teamsSlug = (matchTeams || 'match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'match';
    window.location.href = `/watch/${encodeURIComponent(sportSlug)}/${encodeURIComponent(teamsSlug)}/${encodeURIComponent(matchId)}`;
  };
  window.goToMatch = window.openMatchDetail;


  // Render Sports Headlines
  function renderHeadlines() {
    const headlinesContainer = document.getElementById('headlinesList');
    if (!headlinesContainer) return;

    headlinesContainer.innerHTML = SPORTS_HEADLINES.map(h => `
    <div class="headline-card" onclick="showHeadlineDetail('${h.id}')">
      <img src="${h.image}" alt="${escapeHtml(h.title)}" class="headline-thumb" loading="lazy">
      <div class="headline-body">
        <h4 class="headline-title">${escapeHtml(h.title)}</h4>
        <span class="headline-category">${escapeHtml(h.category)}</span>
      </div>
    </div>
  `).join('');
  }

  // Stream Player Modal Logic
  window.openStreamModal = function (matchId) {
    const match = allMatches.find(m => m.id === matchId);
    if (!match) return;

    activeMatchForModal = match;
    const modal = document.getElementById('playerModal');
    const title = document.getElementById('modalMatchTitle');
    const viewport = document.getElementById('playerViewport');
    const serverGroup = document.getElementById('serverBtnGroup');

    title.textContent = match.teams;

    // Iframe URL
    const iframeSrc = match.iframe || `https://embed.sportspatrika.com/live/embed.php?ch=${match.id}`;
    viewport.innerHTML = `
    <iframe 
      src="${iframeSrc}" 
      allowfullscreen 
      allow="encrypted-media; autoplay; picture-in-picture"
      scrolling="no"
    ></iframe>
  `;

    // Multi-server buttons
    serverGroup.innerHTML = `
    <button class="server-select-btn active" onclick="switchServer('${iframeSrc}', this)">Server 1 (Direct HD)</button>
    <button class="server-select-btn" onclick="switchServer('${iframeSrc}&cdn=fast', this)">Server 2 (Fast CDN)</button>
    <button class="server-select-btn" onclick="switchServer('${iframeSrc}&backup=true', this)">Server 3 (Direct Feed)</button>
  `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.closeStreamModal = function () {
    const modal = document.getElementById('playerModal');
    const viewport = document.getElementById('playerViewport');
    viewport.innerHTML = '';
    modal.classList.remove('active');
    document.body.style.overflow = '';
  };

  window.switchServer = function (url, btn) {
    const viewport = document.getElementById('playerViewport');
    viewport.innerHTML = `
    <iframe 
      src="${url}" 
      allowfullscreen 
      allow="encrypted-media; autoplay; picture-in-picture"
      scrolling="no"
    ></iframe>
  `;

    const allBtns = document.querySelectorAll('.server-select-btn');
    allBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };

  // Select Sport Helper (syncs desktop nav buttons & mobile drawer chips)
  function selectSport(sport) {
    currentSport = sport;

    // Sync nav buttons
    const navButtons = document.querySelectorAll('.nav-link-btn');
    navButtons.forEach(btn => {
      if (btn.dataset.sport === sport) {
        btn.classList.add('active');
        try {
          btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        } catch (e) { }
      } else {
        btn.classList.remove('active');
      }
    });

    // Sync mobile drawer chips
    const chips = document.querySelectorAll('.mobile-sport-chip');
    chips.forEach(chip => {
      if (chip.dataset.sport === sport) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    renderMatches();
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

    const chips = drawer.querySelectorAll('.mobile-sport-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const sport = chip.dataset.sport;
        if (sport) {
          selectSport(sport);
        }
        closeDrawer();
      });
    });
  }

  // Event Listeners Setup
  function setupEventListeners() {
    // Sports category nav buttons
    const navButtons = document.querySelectorAll('.nav-link-btn');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        selectSport(btn.dataset.sport);
      });
    });

    // Mobile drawer setup
    setupMobileMenu();

    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value;
        renderMatches();
      });
    }

    // Date select
    const dateSelect = document.getElementById('dateSelect');
    if (dateSelect) {
      dateSelect.addEventListener('change', (e) => {
        currentDate = e.target.value;
        renderMatches();
      });
    }

    // Close modal on escape key or clicking backdrop
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeStreamModal();
    });

    const modalOverlay = document.getElementById('playerModal');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeStreamModal();
      });
    }
  }

  // Social Share Action
  window.sharePage = function (platform) {
    const url = window.location.href;
    const title = "VIPRow - Free Live Sports Streams & Schedule";

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
    } else if (platform === 'linkedin') {
      window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank');
    } else {
      // Copy link
      navigator.clipboard.writeText(url).then(() => {
        showToast('Stream link copied to clipboard!');
      }).catch(() => {
        showToast('URL: ' + url);
      });
    }
  };

  function showToast(msg) {
    let toast = document.getElementById('toastMsg');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toastMsg';
      toast.className = 'toast-msg';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  // Headline preview toast/modal
  window.showHeadlineDetail = function (headlineId) {
    const item = SPORTS_HEADLINES.find(h => h.id === headlineId);
    if (!item) return;
    showToast(`📰 ${item.title}`);
  };

  // HTML escape utility
  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // FAQ Accordion Toggle
  window.toggleFaq = function (buttonEl) {
    const item = buttonEl.closest('.faq-item');
    if (!item) return;

    const isOpen = item.classList.contains('open');

    // Optional: close other items for single-open behavior, or allow multiple
    // Let's toggle this item:
    if (isOpen) {
      item.classList.remove('open');
    } else {
      item.classList.add('open');
    }
  };

  // Policy Modals Handler (Privacy, Terms, DMCA, Contact)
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
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
  };

  // Dismiss Bottom Floating Ad Banner
  window.dismissBottomAd = function () {
    const ad = document.getElementById('bottomStickyAd');
    if (ad) {
      ad.style.opacity = '0';
      ad.style.transform = 'translate(-50%, 24px)';
      setTimeout(() => {
        ad.style.display = 'none';
      }, 260);
    }
  };

  // Also close policy modal on backdrop click
  document.addEventListener('DOMContentLoaded', () => {
    const policyModal = document.getElementById('policyModal');
    if (policyModal) {
      policyModal.addEventListener('click', (e) => {
        if (e.target === policyModal) closePolicyModal();
      });
    }
  });

