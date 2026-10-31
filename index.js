// Scene BGM — 대화 분위기에 맞춰 유튜브 음악을 골라 틀어주는 실리태번 확장
// 판단은 따로 지정한 연결 프로필(또는 메인 API)로, 검색은 실리태번 서버 경유(키 없음) 또는 YouTube Data API로.

const MODULE = 'sceneBgm';
const LOG = '[Scene BGM]';
const ctx = () => SillyTavern.getContext();

const GENRE_GROUPS = [
    ['잔잔·배경', [
        ['lofi', '로파이', 'lofi'],
        ['jazz', '재즈', 'jazz'],
        ['piano', '피아노', 'piano'],
        ['acoustic', '어쿠스틱', 'acoustic guitar'],
        ['ambient', '앰비언트', 'ambient'],
        ['newage', '뉴에이지', 'new age'],
        ['bossa', '보사노바', 'bossa nova'],
        ['classical', '클래식', 'classical'],
    ]],
    ['장면·세계관', [
        ['orchestral', '오케스트라·OST', 'orchestral soundtrack'],
        ['cinematic', '시네마틱', 'epic cinematic'],
        ['game', '게임 OST', 'video game soundtrack'],
        ['anime', '애니 OST', 'anime soundtrack'],
        ['fantasy', '중세·판타지', 'medieval fantasy'],
        ['folk', '포크·켈틱', 'celtic folk'],
        ['eastern', '동양풍', 'traditional east asian'],
        ['gugak', '국악', 'korean traditional gugak'],
        ['dark', '다크·호러', 'dark ambient horror'],
    ]],
    ['대중음악', [
        ['citypop', '시티팝', 'city pop'],
        ['synthwave', '신스웨이브', 'synthwave'],
        ['electronic', '일렉트로닉', 'electronic'],
        ['chiptune', '칩튠', 'chiptune 8-bit'],
        ['rock', '록', 'rock'],
        ['postrock', '포스트록', 'post rock'],
        ['metal', '메탈', 'metal'],
        ['blues', '블루스', 'blues'],
        ['rnb', 'R&B', 'r&b soul'],
        ['hiphop', '힙합', 'hip hop'],
        ['ballad', '발라드', 'ballad'],
        ['jpop', 'J-pop', 'j-pop'],
        ['kpop', 'K-pop', 'k-pop'],
        ['kindie', 'K-인디', 'korean indie'],
    ]],
];
const GENRES = GENRE_GROUPS.flatMap(([, list]) => list);
const GENRE_MAP = Object.fromEntries(GENRES.map(([k, ko, en]) => [k, { ko, en }]));

const DEFAULT_GENRE_CONFIG = {
    genres: ['lofi', 'jazz', 'piano'],
    customGenres: '',
    excludes: '',
    instrumentalOnly: true,
    strict: false,
};

const DEFAULTS = {
    enabled: true,
    windowOpen: true,
    mode: 'auto', // auto | suggest | manual
    profileId: '', // '' = 메인 API
    maxTokens: 500,
    userMsgs: 1, // 판단에 넣을 내 메시지 수
    aiMsgs: 2, // 판단에 넣을 AI 답변 수
    minGap: 2,
    preferShort: true, // 15분 이하 단일 곡 우선
    sortBy: 'views', // views | relevance
    pickMode: 'songs', // songs: 실제 곡(아티스트·곡명) 추천 | mood: 분위기 검색
    avoidFree: true, // '무료 BGM / 저작권 없음' 영상 뒤로
    embedOk: {}, // 영상 id → 외부 재생 가능 여부 캐시
    avoidAi: true, // AI 생성 음악 거르기
    aiVideo: {}, // 영상 id → AI 표시 여부 캐시
    aiChannels: [], // AI 음악으로 확인된 채널 (자동 학습)
    blockedChannels: [], // 내가 막은 채널
    searchSource: 'st', // st | api
    apiKey: '',
    volume: 60,
    genre: { ...DEFAULT_GENRE_CONFIG },
    perChar: {},
    window: { x: null, y: null, w: 340, h: 560, collapsed: false, tab: 'queue', genresOpen: false, likeScope: 'chat' },
    history: [],
    saved: [],
    blocked: [],
    lastTrack: null,
};

const HISTORY_MAX = 100;

const HEART_PATH = 'M12 20.6s-7.6-4.6-9.6-9.4C1 7.9 3 4.4 6.4 4.1c2.1-.2 3.9.9 5.6 3 1.7-2.1 3.5-3.2 5.6-3 3.4.3 5.4 3.8 4 7.1-2 4.8-9.6 9.4-9.6 9.4z';
const heartSvg = (on) => `<svg class="sbgm-heart${on ? ' on' : ''}" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="${HEART_PATH}" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;

// ───────────────────────── 상태 ─────────────────────────
const state = {
    current: null, // {id,title,channel,thumb,duration,query,mood,reason}
    queue: [],
    queueIndex: -1,
    queueLabel: '',
    related: [],
    relatedFor: null,
    backStack: [],
    suggestion: null, // {mood, reason, query, items}
    lastDecision: null, // {result, mood, query, reason, thinking, at, source}
    whyOpen: false,
    skipped: {}, // 이번 판단에서 건너뛴 수 { embed, ai }
    aiSinceChange: 0,
    chatSwitched: false,
    busy: false,
    player: null,
    playerReady: false,
    pendingId: null,
    isPlaying: false,
    errorSkips: 0,
    cache: new Map(),
    seeking: false,
};

function S() {
    const all = ctx().extensionSettings;
    if (!all[MODULE]) all[MODULE] = structuredClone(DEFAULTS);
    const s = all[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = structuredClone(v);
    }
    if (s.cacheVer !== 2) { s.embedOk = {}; s.aiVideo = {}; s.cacheVer = 2; }
    for (const [k, v] of Object.entries(DEFAULTS.window)) if (s.window[k] === undefined) s.window[k] = v;
    for (const [k, v] of Object.entries(DEFAULT_GENRE_CONFIG)) if (s.genre[k] === undefined) s.genre[k] = structuredClone(v);
    return s;
}
const save = () => ctx().saveSettingsDebounced();

// ───────────────────────── 유틸 ─────────────────────────
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ytUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
const thumbOf = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const fmtTime = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
// "조회수 38,643회", "3.8만", "1.2M views", "21K" → 숫자. 실시간 방송("시청 중", "watching")은 0
function parseViews(text) {
    const t = String(text || '');
    if (!t) return null;
    if (/시청\s*중|watching|대기\s*중|waiting/i.test(t)) return 0;
    if (/없음|no views/i.test(t)) return 0;
    const m = t.match(/(\d[\d,.]*)\s*(억|만|천|[KMB](?![a-z]))?/i);
    if (!m) return null;
    const n = m[2] ? parseFloat(m[1].replace(/,/g, '')) : Number(m[1].replace(/[,.]/g, ''));
    const mul = { 억: 1e8, 만: 1e4, 천: 1e3, k: 1e3, m: 1e6, b: 1e9 }[String(m[2] || '').toLowerCase()] || 1;
    return Math.round(n * mul);
}
function fmtViews(n) {
    if (n === null || n === undefined) return '';
    if (n === 0) return '';
    if (n >= 1e8) return `조회수 ${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, '')}억`;
    if (n >= 1e4) return `조회수 ${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}만`;
    return `조회수 ${n.toLocaleString()}`;
}
const decodeHtml = (s) => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
const textOf = (t) => t?.simpleText ?? t?.content ?? (Array.isArray(t?.runs) ? t.runs.map((r) => r.text).join('') : '') ?? '';
const notify = (type, msg) => { try { toastr[type](msg, 'Scene BGM', { timeOut: 3500 }); } catch { console.log(LOG, msg); } };
const trackLite = (t) => t && ({ id: t.id, title: t.title, channel: t.channel, duration: t.duration || '', views: t.views ?? null, thumb: t.thumb || thumbOf(t.id), query: t.query || '', mood: t.mood || '', reason: t.reason || '' });

function currentCharKey() {
    const c = ctx();
    if (c.groupId) return `group:${c.groupId}`;
    const ch = c.characters?.[c.characterId];
    return ch?.avatar ? `char:${ch.avatar}` : null;
}
function charDisplayName() {
    const c = ctx();
    if (c.groupId) return c.groups?.find((g) => g.id === c.groupId)?.name || '그룹';
    return c.characters?.[c.characterId]?.name || '';
}
function genreCfg() {
    const s = S();
    const key = currentCharKey();
    if (key && s.perChar[key]) return { cfg: s.perChar[key], perChar: true };
    return { cfg: s.genre, perChar: false };
}

// ───────────────────────── 유튜브 검색 ─────────────────────────
async function visit(url) {
    const res = await fetch('/api/search/visit', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({ url, html: true }),
    });
    if (!res.ok) throw new Error(`실리태번 서버에서 유튜브를 불러오지 못했어요 (${res.status})`);
    return await res.text();
}

function extractInitialData(html) {
    const m = html.match(/(?:var\s+ytInitialData|window\[["']ytInitialData["']\])\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
}

function collectVideos(root, excludeId = null) {
    const out = [];
    const seen = new Set(excludeId ? [excludeId] : []);
    const walk = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 60) return;
        if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return; }
        const vr = node.videoRenderer || node.compactVideoRenderer;
        if (vr?.videoId && !seen.has(vr.videoId)) {
            seen.add(vr.videoId);
            out.push({
                id: vr.videoId,
                title: textOf(vr.title),
                channel: textOf(vr.ownerText || vr.longBylineText || vr.shortBylineText),
                duration: textOf(vr.lengthText),
                views: parseViews(textOf(vr.viewCountText) || textOf(vr.shortViewCountText)),
                thumb: thumbOf(vr.videoId),
            });
        }
        const lv = node.lockupViewModel;
        if (lv?.contentId && /VIDEO/.test(lv.contentType || '') && !seen.has(lv.contentId)) {
            seen.add(lv.contentId);
            const meta = lv.metadata?.lockupMetadataViewModel;
            const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
            const channel = textOf(rows?.[0]?.metadataParts?.[0]?.text);
            const viewText = textOf(rows?.[1]?.metadataParts?.[0]?.text);
            const durMatch = JSON.stringify(lv.contentImage || {}).match(/"text":"(\d{1,2}:\d{2}(?::\d{2})?)"/);
            out.push({
                id: lv.contentId,
                title: textOf(meta?.title),
                channel,
                duration: durMatch?.[1] || '',
                views: parseViews(viewText),
                thumb: thumbOf(lv.contentId),
            });
        }
        for (const k in node) walk(node[k], depth + 1);
    };
    walk(root, 0);
    return out.filter((v) => v.title);
}

async function searchScrape(query) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    const html = await visit(url);
    const data = extractInitialData(html);
    if (!data) throw new Error('유튜브 검색 결과를 읽지 못했어요');
    return collectVideos(data);
}

async function searchApi(query) {
    const s = S();
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.search = new URLSearchParams({
        part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '12', q: query, key: s.apiKey.trim(),
    }).toString();
    const res = await fetch(u);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const reason = json?.error?.errors?.[0]?.reason || res.status;
        if (reason === 'quotaExceeded') throw new Error('YouTube API 오늘 할당량을 다 썼어요. 검색 방식을 "실리태번 서버"로 바꿔보세요');
        throw new Error(`YouTube API 오류: ${json?.error?.message || reason}`);
    }
    const items = (json.items || []).filter((it) => it.id?.videoId).map((it) => ({
        id: it.id.videoId,
        title: decodeHtml(it.snippet.title),
        channel: decodeHtml(it.snippet.channelTitle),
        duration: '',
        views: null,
        thumb: it.snippet.thumbnails?.medium?.url || thumbOf(it.id.videoId),
    }));
    // 조회수·길이는 search에 없어서 videos로 한 번 더 (1유닛)
    try {
        const v = new URL('https://www.googleapis.com/youtube/v3/videos');
        v.search = new URLSearchParams({ part: 'statistics,contentDetails', id: items.map((x) => x.id).join(','), key: s.apiKey.trim() }).toString();
        const vj = await (await fetch(v)).json();
        const byId = Object.fromEntries((vj.items || []).map((x) => [x.id, x]));
        for (const it of items) {
            const d = byId[it.id];
            if (!d) continue;
            it.views = Number(d.statistics?.viewCount ?? 0);
            const m = String(d.contentDetails?.duration || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (m) {
                const [h, mi, se] = [m[1], m[2], m[3]].map((x) => Number(x || 0));
                it.duration = h ? `${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}` : `${mi}:${String(se).padStart(2, '0')}`;
            }
        }
    } catch (e) {
        console.warn(LOG, 'video details failed', e);
    }
    return items;
}

async function searchVideos(query) {
    const s = S();
    const key = `${s.searchSource}|${query.toLowerCase()}`;
    const hit = state.cache.get(key);
    if (hit && Date.now() - hit.t < 30 * 60 * 1000) return hit.items;
    const items = s.searchSource === 'api' && s.apiKey.trim() ? await searchApi(query) : await searchScrape(query);
    state.cache.set(key, { t: Date.now(), items });
    return items;
}

async function fetchRelated(track) {
    if (!track) return [];
    try {
        const html = await visit(ytUrl(track.id));
        const data = extractInitialData(html);
        const secondary = data?.contents?.twoColumnWatchNextResults?.secondaryResults || data;
        const items = collectVideos(secondary, track.id);
        if (items.length) return items;
    } catch (e) {
        console.warn(LOG, 'related scrape failed', e);
    }
    // 실패하면 채널 + 분위기로 검색
    const q = [track.mood || track.query, track.channel].filter(Boolean).join(' ');
    return (await searchVideos(q)).filter((v) => v.id !== track.id);
}

const durSec = (d) => String(d || '').split(':').reduce((a, x) => a * 60 + Number(x || 0), 0);

function filterFresh(items) {
    const s = S();
    if (s.sortBy === 'views') {
        // 안정 정렬: 조회수가 같거나 모르면 유튜브 순서 유지
        items = items.map((v, i) => ({ v, i })).sort((a, b) => ((b.v.views ?? -1) - (a.v.views ?? -1)) || (a.i - b.i)).map((x) => x.v);
    }
    if (s.preferShort) {
        const short = items.filter((v) => { const d = durSec(v.duration); return d > 0 && d <= 15 * 60; });
        const long = items.filter((v) => !short.includes(v));
        if (short.length) items = [...short, ...long];
    }
    if (s.avoidFree) {
        const paid = items.filter((v) => !isFree(v));
        if (paid.length) items = [...paid, ...items.filter(isFree)];
    }
    items = items.filter((v) => s.embedOk[v.id] !== false && !(s.avoidAi && s.aiVideo[v.id]) && !channelBlocked(v));
    const blocked = new Set(s.blocked);
    const recent = new Set(s.history.slice(0, 8).map((h) => h.id));
    if (state.current) recent.add(state.current.id);
    const fresh = items.filter((v) => !blocked.has(v.id) && !recent.has(v.id));
    return fresh.length ? fresh : items.filter((v) => !blocked.has(v.id));
}

const FREE_RE = /no\s*copyright|copyright[\s-]*free|royalty[\s-]*free|free\s*(bgm|music|download|to use)|non[\s-]*copyright|ncs\b|저작권\s*(없는|free|프리)|무료\s*(bgm|브금|음악)|무료브금|노카피|\bvlog\s*music/i;
const isFree = (v) => FREE_RE.test(`${v.title} ${v.channel}`);
const chKey = (c) => String(c || '').trim().toLowerCase();
function channelBlocked(v) {
    const s = S();
    const k = chKey(v.channel);
    if (!k) return false;
    if (s.blockedChannels.includes(k)) return true;
    return s.avoidAi && s.aiChannels.includes(k);
}
const norm = (t) => String(t || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// 곡명 검색 결과 중 그 곡에 가장 가까운 영상 하나
function pickBestForSong(song, items) {
    const t = norm(song.title), a = norm(song.artist);
    let best = null, bestScore = -Infinity;
    items.forEach((v, i) => {
        const vt = norm(v.title), vc = norm(v.channel);
        let sc = -i * 0.6; // 검색 순위
        const titleFull = t && vt.includes(t);
        const titlePart = t && t.split(' ').filter((w) => w.length > 1 && vt.includes(w)).length >= Math.ceil(t.split(' ').length / 2);
        const artistHit = a && (vt.includes(a) || vc.includes(a) || a.split(' ').filter((w) => w.length > 2).some((w) => vc.includes(w)));
        const officialCh = / topic$/.test(vc) || /official|공식|vevo|records|music$/.test(vc);
        // AI 채널이 같은 제목으로 올린 가짜 곡을 피하려고, 아티스트가 안 맞으면 공식 채널일 때만 인정
        if (!(titleFull || titlePart) || (a && !artistHit && !officialCh)) return;
        if (titleFull) sc += 6; else sc += 3;
        if (artistHit) sc += 4;
        if (officialCh) sc += 2;
        if (/official (audio|music video|mv)|\[mv\]|\bmv\b|audio/.test(vt)) sc += 1;
        if (/lyrics|가사|cover|커버|reaction|리액션|karaoke|노래방|tutorial|sheet|\bhour|시간|playlist|플레이리스트|mix\b|loop|1h/.test(vt)) sc -= 3;
        if (/live|라이브|concert|콘서트|fancam|직캠/.test(vt)) sc -= 1.5;
        if (isFree(v)) sc -= 6;
        const d = durSec(v.duration);
        if (d > 15 * 60) sc -= 3;
        if (d === 0) sc -= 1;
        if (sc > bestScore) { bestScore = sc; best = v; }
    });
    return bestScore > 0 ? best : null;
}

async function resolveSongs(songs) {
    const blocked = new Set(S().blocked);
    const results = await Promise.all(songs.map(async (song) => {
        try {
            const q = [song.artist, song.title].filter(Boolean).join(' ');
            const all = (await searchVideos(q)).filter((v) => !blocked.has(v.id));
            const usable = (v) => S().embedOk[v.id] !== false && !(S().avoidAi && S().aiVideo[v.id] === true) && !channelBlocked(v);
            const v = pickBestForSong(song, all.filter(usable));
            if (v) return { ...v, song };
            // 왜 못 썼는지 표시용
            const raw = pickBestForSong(song, all);
            if (raw) song.skip = S().embedOk[raw.id] === false ? '외부 재생 막힘' : 'AI 생성 곡이라 건너뜀';
            return null;
        } catch (e) {
            console.warn(LOG, 'song search failed', song, e);
            return null;
        }
    }));
    const seen = new Set();
    return results.filter((v) => v && !seen.has(v.id) && seen.add(v.id));
}

// ───────────────────────── 장면 판단 ─────────────────────────
function cleanMes(text) {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function genreRules() {
    const { cfg } = genreCfg();
    const list = cfg.genres.map((g) => GENRE_MAP[g]?.en).filter(Boolean);
    const custom = cfg.customGenres.split(',').map((x) => x.trim()).filter(Boolean);
    const all = [...list, ...custom];
    const lines = [];
    if (all.length) {
        lines.push(cfg.strict
            ? `Genres: the track MUST be one of: ${all.join(', ')}.`
            : `Genres: prefer ${all.join(', ')}. Leave them only if the scene clearly demands something else.`);
    }
    if (cfg.instrumentalOnly) lines.push('Instrumental only, no vocals (lyrics would distract the reader).');
    if (cfg.excludes.trim()) lines.push(`Avoid: ${cfg.excludes.trim()}.`);
    return lines.join('\n');
}

// 긴 메시지는 앞과 끝을 남기고 가운데를 줄임 (끝부분이 지금 장면이라 더 길게)
function clip(text, max) {
    if (text.length <= max) return text;
    const head = Math.round(max * 0.3);
    return `${text.slice(0, head)} … ${text.slice(text.length - (max - head))}`;
}

// 최근 대화에서 내 메시지 N개 + AI 답변 M개를 시간순으로
function collectScene() {
    const s = S();
    const chat = (ctx().chat || []).filter((m) => !m.is_system && m.mes);
    const wantUser = Number(s.userMsgs) || 0;
    const wantAi = Math.max(1, Number(s.aiMsgs) || 1);
    let u = 0, a = 0;
    const picked = [];
    for (let i = chat.length - 1; i >= 0 && i >= chat.length - 40; i--) {
        const m = chat[i];
        if (m.is_user ? u < wantUser : a < wantAi) {
            picked.unshift(m);
            if (m.is_user) u++; else a++;
        }
        if (u >= wantUser && a >= wantAi) break;
    }
    const lastAi = picked.findLastIndex((m) => !m.is_user);
    return picked.map((m, i) => {
        const tag = m.is_user ? '사용자' : (i === lastAi ? '최신 AI 답변 ← 지금 장면' : '이전 AI 답변');
        const body = clip(cleanMes(m.mes), m.is_user ? 1000 : 2400);
        return `[${tag}] ${m.name}:\n${body}`;
    }).join('\n\n');
}

function buildPrompt(force, reject = null, extra = '') {
    const recent = collectScene();

    const system = [
        'You are the music supervisor for an ongoing interactive story (roleplay chat).',
        'The scene is given oldest to newest, as the user\'s messages and the AI\'s replies.',
        'The LATEST AI reply is the present moment: weigh it most. Use the earlier reply and the user\'s message to understand where the scene came from and where it is heading.',
        'Consider: location and setting, time of day and weather, emotional tone, tension and pacing, and the dynamic between the characters.',
        'Choose music that underscores the feeling of the moment, not a literal description of objects in the text.',
        ...(S().pickMode === 'songs' ? [
            'Recommend 5 REAL, existing recordings (artist + exact title) that are likely to be on YouTube: commercial songs, film/game/anime scores, jazz/classical recordings. Not generic "relaxing BGM" compilations or royalty-free stock music.',
            'Vary the artists. Order them best fit first. Respect the genre rules below.',
            'Answer with ONLY a JSON object, no other text:',
            '{"change": true|false, "mood": "2-5 English words", "songs": [{"artist": "...", "title": "..."}], "query": "fallback YouTube search, 3-7 English words describing the sound", "reason": "한국어 한 문장으로 선곡 이유"}',
        ] : [
            'Answer with ONLY a JSON object, no other text:',
            '{"change": true|false, "mood": "2-5 English words", "query": "YouTube search query, 3-7 English words, describe the sound (genre + mood + instrument), no artist names unless essential", "reason": "한국어 한 문장으로 선곡 이유"}',
        ]),
        force
            ? 'You must set "change": true and provide a query.'
            : 'Set "change": false when the current track still fits. Be conservative: change only on a clear shift of mood, location or tension.',
    ].join('\n');

    const cur = state.current
        ? `Currently playing: "${state.current.title}" (chosen for mood: ${state.current.mood || 'unknown'}).`
        : 'Nothing is playing yet.';
    const switched = state.chatSwitched ? '\nNote: the user just switched to a different chat/story; the current track was chosen for another story.' : '';
    const rejectNote = reject
        ? `\nThe user did NOT like "${reject.title}" (search: "${reject.query || '?'}"). Keep fitting the scene, but pick a clearly different sound: change the genre, instrument or tempo, and write a different query.`
        : '';
    const liked = chatLikes().slice(0, 6).map((t) => `"${t.title}"`);
    const recentPlayed = S().history.slice(0, 10).map((t) => `"${t.title}"`);
    const playedNote = recentPlayed.length && S().pickMode === 'songs' ? `Recently played (do not recommend again): ${recentPlayed.join(', ')}` : '';
    const likedNote = liked.length ? `Tracks the user liked in this story (taste hint, don't repeat them): ${liked.join(', ')}` : '';
    const user = [
        `Story: ${charDisplayName() || 'unknown'}`,
        genreRules(),
        likedNote,
        playedNote,
        cur + switched + rejectNote + (extra ? `\n${extra}` : ''),
        '',
        '### Scene (oldest → newest)',
        recent || '(empty)',
        '',
        'JSON:',
    ].join('\n');
    return { system, user };
}

function parseDecision(text) {
    const raw = String(text || '');
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a !== -1 && b > a) {
        try {
            const j = JSON.parse(raw.slice(a, b + 1));
            const songs = (Array.isArray(j?.songs) ? j.songs : [])
                .map((x) => (typeof x === 'string' ? { artist: '', title: x } : { artist: String(x?.artist || ''), title: String(x?.title || '') }))
                .filter((x) => x.title)
                .slice(0, 8);
            if (j && (j.query || songs.length || j.change === false)) {
                return { change: j.change !== false, mood: String(j.mood || ''), query: String(j.query || ''), reason: String(j.reason || ''), songs };
            }
        } catch { /* fallthrough */ }
    }
    const q = raw.match(/"?query"?\s*[:=]\s*"([^"]+)"/i);
    if (q) return { change: true, mood: '', query: q[1], reason: '', songs: [] };
    throw new Error('판단 모델의 답을 읽지 못했어요 (JSON 형식이 아님)');
}

async function askDirector(force, reject = null, extra = '') {
    const s = S();
    const c = ctx();
    const { system, user } = buildPrompt(force || !!reject, reject, extra);
    let text = '';
    let thinking = '';
    if (s.profileId) {
        const CM = c.ConnectionManagerRequestService;
        if (!CM) throw new Error('연결 프로필 기능을 쓸 수 없어요 (Connection Manager 꺼짐?)');
        const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
        const prompt = CM.constructPrompt(messages, s.profileId);
        const res = await CM.sendRequest(s.profileId, prompt, Number(s.maxTokens) || 500, {
            stream: false, extractData: true, includePreset: true, includeInstruct: true,
        });
        text = typeof res === 'string' ? res : res?.content;
        thinking = typeof res === 'object' ? (res?.reasoning || '') : '';
    } else {
        text = await c.generateRaw({ systemPrompt: system, prompt: user, responseLength: Number(s.maxTokens) || 500 });
    }
    const d = parseDecision(text);
    // 추론 블록이 본문에 섞여 온 경우 분리
    const inline = String(text || '').match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
    d.thinking = (thinking || inline?.[1] || '').trim();
    return d;
}

function finalizeQuery(q) {
    const { cfg } = genreCfg();
    let query = q.trim();
    if (cfg.instrumentalOnly && !/instrumental|lofi|lo-fi|ambient|piano|orchestral|ost|soundtrack|bgm/i.test(query)) {
        query += ' instrumental';
    }
    return query;
}

async function runDirector({ force = false, source = 'auto', reject = null } = {}) {
    const s = S();
    if (state.busy) return;
    state.busy = true;
    state.skipped = {};
    setStatus(reject ? '다른 곡으로 다시 고르는 중…' : source === 'continue' ? '이어서 들을 곡 고르는 중…' : '장면 분석 중…', 'busy');
    renderNow();
    try {
        const extra = source === 'continue'
            ? 'The previous picks have finished playing and the scene has not changed much. Recommend 5 MORE songs in the same vein, all different from the recently played ones.'
            : '';
        const d = await askDirector(force, reject, extra);
        const record = (result) => {
            state.lastDecision = { result, mood: d.mood, query: d.query, reason: d.reason, thinking: d.thinking, songs: d.songs || [], found: d.found || null, at: Date.now(), source };
        };
        if (!d.change && !force && !reject) {
            record('keep');
            setStatus(`유지 · ${d.reason || '지금 곡이 장면에 맞아요'}`);
            state.aiSinceChange = 0;
            return;
        }
        let query = d.query ? finalizeQuery(d.query) : '';
        let items = [];
        if (s.pickMode === 'songs' && d.songs?.length) {
            setStatus(`곡 찾는 중 · ${d.songs.map((x) => x.title).slice(0, 3).join(', ')}…`, 'busy');
            const found = await resolveSongs(d.songs);
            const recent = new Set([state.current?.id, ...s.history.slice(0, 8).map((h) => h.id)]);
            items = found.filter((v) => !recent.has(v.id));
            if (!items.length) items = found;
            d.found = found.map((v) => v.song);
            for (const v of found) v.song.videoId = v.id;
            if (!query) query = d.songs.map((x) => [x.artist, x.title].filter(Boolean).join(' - ')).join(' / ');
        }
        // 곡을 못 찾았거나 분위기 모드면 분위기 검색
        if (items.length < 2 && d.query) {
            const q = finalizeQuery(d.query);
            setStatus(`검색 중 · ${q}`, 'busy');
            const more = filterFresh(await searchVideos(q)).filter((v) => !items.some((x) => x.id === v.id));
            items = [...items, ...more];
            if (!query || s.pickMode !== 'songs') query = q;
        }
        if (!items.length) {
            setStatus(`검색 결과 없음 · ${query}`, 'error');
            return;
        }
        const tagged = items.map((v) => ({ ...v, query, mood: d.mood, reason: d.reason }));
        state.aiSinceChange = 0;
        state.chatSwitched = false;
        if (reject) items.splice(0, items.length, ...items.filter((v) => v.id !== reject.id));
        d.query = query;
        if (s.mode === 'suggest' && source !== 'force-play' && source !== 'continue' && !reject) {
            record('suggest');
            state.suggestion = { mood: d.mood, reason: d.reason, query, items: tagged };
            setStatus(`추천 도착 · ${d.mood || query}`);
            notify('info', `새 분위기: ${d.mood || query}`);
        } else {
            record(reject ? 'reroll' : source === 'continue' ? 'continue' : 'change');
            setQueue(tagged.filter((v) => !reject || v.id !== reject.id), 0, d.mood || query);
            setStatus(d.reason || d.mood || query);
        }
    } catch (e) {
        console.error(LOG, e);
        setStatus(e.message || String(e), 'error');
        if (source !== 'auto') notify('error', e.message || String(e));
    } finally {
        state.busy = false;
        renderAll();
    }
}

// ───────────────────────── 플레이어 ─────────────────────────
let ytApiPromise = null;
function loadYtApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise((resolve, reject) => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch { /* */ } resolve(); };
        const sc = document.createElement('script');
        sc.src = 'https://www.youtube.com/iframe_api';
        sc.onerror = () => { ytApiPromise = null; reject(new Error('유튜브 플레이어를 불러오지 못했어요 (인터넷 연결 확인)')); };
        document.head.appendChild(sc);
    });
    return ytApiPromise;
}

async function ensurePlayer(firstId) {
    if (state.player) return;
    await loadYtApi();
    const holder = document.getElementById('sbgm_video');
    holder.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.id = 'sbgm_iframe';
    // 실리태번은 no-referrer 정책이라 유튜브 임베드가 오류 153을 낸다 → iframe에만 referrer 허용
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.setAttribute('frameborder', '0');
    const params = new URLSearchParams({
        enablejsapi: '1', autoplay: '1', playsinline: '1', controls: '0', rel: '0', iv_load_policy: '3', disablekb: '1',
        origin: location.origin,
    });
    iframe.src = `https://www.youtube.com/embed/${firstId}?${params}`;
    holder.appendChild(iframe);
    state.pendingId = null;
    state.player = new YT.Player(iframe, {
        events: {
            onReady: () => {
                state.playerReady = true;
                state.player.setVolume(S().volume);
                if (state.pendingId) { state.player.loadVideoById(state.pendingId); state.pendingId = null; } else state.player.playVideo();
            },
            onStateChange: (e) => {
                state.isPlaying = e.data === YT.PlayerState.PLAYING;
                if (e.data === YT.PlayerState.PLAYING) state.errorSkips = 0;
                if (e.data === YT.PlayerState.ENDED) next(true);
                renderControls();
            },
            onError: (e) => {
                console.warn(LOG, 'player error', e.data, state.current?.id);
                if (state.current && [101, 150, 153].includes(e.data)) rememberEmbed(state.current.id, false);
                if (state.errorSkips++ < 10) {
                    state.skipped.embed = (state.skipped.embed || 0) + 1;
                    console.log(LOG, `skip (player error ${e.data})`, state.current?.title);
                    next(true);
                } else {
                    setStatus(`재생이 계속 실패해요 (오류 ${e.data})`, 'error');
                }
            },
        },
    });
}

async function playTrack(track, { pushBack = true } = {}) {
    if (!track) return;
    const s = S();
    if (pushBack && state.current && state.current.id !== track.id) {
        state.backStack.push(state.current);
        if (state.backStack.length > 50) state.backStack.shift();
    }
    state.current = trackLite(track);
    s.lastTrack = state.current;
    s.history = [state.current, ...s.history.filter((h) => h.id !== track.id)].slice(0, HISTORY_MAX);
    state.related = [];
    state.relatedFor = null;
    save();
    renderAll();
    try {
        if (!state.player) {
            await ensurePlayer(track.id);
        } else if (!state.playerReady) {
            state.pendingId = track.id;
        } else {
            state.player.loadVideoById(track.id);
        }
    } catch (e) {
        setStatus(e.message, 'error');
        notify('error', e.message);
    }
    if (S().window.tab === 'related') loadRelated();
}

// AI 음악 표시: 유튜브의 '콘텐츠 생성 방식(변경되었거나 합성된 콘텐츠)' 라벨, 또는 설명란의 AI 제작 문구
const AI_DESC_RE = /\bAI[-\s]?(generated|made|created|composed|produced|music|based|assisted|tools?)\b|\b(created|made|produced|composed|generated)\s+(with|using|by)\s+(an?\s+)?(AI|artificial intelligence|suno|udio)\b|\bsuno(\s*ai)?\b|\budio\b|인공\s*지능|AI\s*(로|으로|를\s*활용해|를\s*이용해)?\s*(만든|제작|생성|작곡)|AI\s*(음악|작곡|커버|보컬)|생성형\s*AI/i;
const NO_AI_RE = /\b(no|not|without|zero)\s+AI\b|AI\s*(미사용|없이|사용\s*안)|사람이\s*(직접\s*)?(연주|작곡)/i;

// 실리태번 서버로 영상 페이지를 열어 외부 재생 가능 여부와 AI 표시를 함께 확인
// 반환: { ok: 재생해도 되는지, why: '' | 'embed' | 'ai' }
async function inspectVideo(id, channel = '') {
    const s = S();
    if (s.embedOk[id] === false) return { ok: false, why: 'embed' };
    if (s.avoidAi && s.aiVideo[id] === true) return { ok: false, why: 'ai' };
    if (s.embedOk[id] === true && (!s.avoidAi || s.aiVideo[id] === false)) return { ok: true, why: '' };
    try {
        const html = await visit(ytUrl(id));
        const m = html.match(/"playableInEmbed"\s*:\s*(true|false)/);
        const st = html.match(/"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"(\w+)"/)?.[1];
        // 서버에서 열면 유튜브가 '로봇 확인'(LOGIN_REQUIRED) 페이지를 줄 때가 있음 → 그땐 판단하지 않고 일단 재생해 봄
        // 확실한 경우만 막음: 정상 페이지에서 playableInEmbed:false, 또는 삭제·비공개(ERROR)
        let embed = true;
        if (st === 'ERROR') embed = false;
        else if (st === 'OK' && m) embed = m[1] === 'true';
        if (st === 'OK' || st === 'ERROR') rememberEmbed(id, embed);
        else console.log(LOG, 'inspect: no verdict', id, st || 'no status');
        let desc = '';
        const dm = html.match(/"shortDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (dm) { try { desc = JSON.parse(`"${dm[1]}"`); } catch { desc = dm[1]; } }
        const labeled = /"howThisWasMadeSectionViewModel"\s*:\s*\{/.test(html);
        const ai = labeled || (AI_DESC_RE.test(desc) && !NO_AI_RE.test(desc));
        s.aiVideo[id] = ai;
        if (ai) {
            const ch = chKey(channel || (html.match(/"ownerChannelName"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? ''));
            if (ch && !s.aiChannels.includes(ch)) s.aiChannels = [...s.aiChannels, ch].slice(-400);
        }
        const keys = Object.keys(s.aiVideo);
        if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete s.aiVideo[k];
        save();
        if (!embed) return { ok: false, why: 'embed' };
        if (ai && s.avoidAi) return { ok: false, why: 'ai' };
        return { ok: true, why: '' };
    } catch {
        return { ok: true, why: '' };
    }
}
function rememberEmbed(id, ok) {
    const s = S();
    s.embedOk[id] = ok;
    const keys = Object.keys(s.embedOk);
    if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete s.embedOk[k];
    save();
}

// 대기열에서 index부터 재생 가능한 첫 곡을 찾아 재생 (막힌 곡은 조용히 건너뜀)
let playSeq = 0;
async function playFromQueue(index) {
    const seq = ++playSeq;
    let tries = 0;
    for (let i = index; i < state.queue.length && tries < 6; tries++) {
        const t = state.queue[i];
        const { ok, why } = await inspectVideo(t.id, t.channel);
        if (seq !== playSeq) return true; // 그사이 다른 곡을 눌렀음
        if (!ok) {
            // 외부 재생이 막혔거나 AI 생성 곡이면 대기열에서 빼고 같은 자리의 다음 곡으로
            state.queue.splice(i, 1);
            state.skipped[why] = (state.skipped[why] || 0) + 1;
            console.log(LOG, `skip (${why})`, t.title, t.channel);
            renderList();
            continue;
        }
        if (ok) {
            state.queueIndex = i;
            await playTrack(t);
            // 다음 곡도 미리 확인해 둠
            const nxt = state.queue[i + 1];
            if (nxt) inspectVideo(nxt.id, nxt.channel);
            return true;
        }
    }
    return false;
}

function setQueue(items, index, label) {
    state.queue = items.map(trackLite);
    state.queueIndex = index;
    state.queueLabel = label || '';
    state.suggestion = null;
    playFromQueue(index).then((ok) => { if (!ok) next(true); });
}

async function next(auto = false) {
    if (state.queueIndex + 1 < state.queue.length) {
        const from = state.queueIndex + 1;
        state.queueIndex = from;
        if (await playFromQueue(from)) return;
        state.queueIndex = state.queue.length - 1;
    }
    // 곡 추천 모드: 대기열이 끝나면 같은 장면으로 곡을 더 추천받음 (유튜브 추천 영상엔 AI 음악이 많음)
    const s = S();
    if (s.pickMode === 'songs' && s.enabled && s.mode !== 'manual' && !state.busy) {
        runDirector({ force: true, source: 'continue' });
        return;
    }
    // 그 밖엔 비슷한 곡으로 이어가기
    if (state.current) {
        try {
            setStatus('비슷한 곡 찾는 중…', 'busy');
            const rel = filterFresh(await fetchRelated(state.current));
            if (rel.length) {
                const base = state.current;
                const tagged = rel.map((v) => ({ ...v, query: base.query, mood: base.mood, reason: base.reason }));
                state.queue = tagged.map(trackLite);
                state.queueIndex = 0;
                state.queueLabel = `${base.title} 비슷한 곡`;
                setStatus(base.reason || base.mood || '');
                if (await playFromQueue(0)) return;
            }
        } catch (e) {
            setStatus(e.message, 'error');
        }
    }
    if (!auto) notify('info', '다음 곡이 없어요');
}

function prev() {
    if (state.player && state.playerReady && state.player.getCurrentTime?.() > 5) {
        state.player.seekTo(0, true);
        return;
    }
    const back = state.backStack.pop();
    if (!back) { state.player?.seekTo?.(0, true); return; }
    const qi = state.queue.findIndex((q) => q.id === back.id);
    if (qi !== -1) state.queueIndex = qi;
    playTrack(back, { pushBack: false });
}

function togglePlay() {
    if (!state.current) {
        const last = S().lastTrack;
        if (last) { state.queue = [last]; state.queueIndex = 0; return playTrack(last, { pushBack: false }); }
        return runDirector({ force: true, source: 'force-play' });
    }
    if (!state.player) return playTrack(state.current, { pushBack: false });
    if (!state.playerReady) return;
    if (state.isPlaying) state.player.pauseVideo(); else state.player.playVideo();
}

function pause() {
    try { if (state.playerReady && state.isPlaying) state.player.pauseVideo(); } catch { /* */ }
}

// 좋아요: 지금 채팅의 메타데이터(채팅 파일)에 기록 + 전체 목록에도 채팅 이름과 함께 남김
function chatId() {
    try { return ctx().getCurrentChatId?.() || null; } catch { return null; }
}
function chatLikes() {
    const meta = ctx().chatMetadata;
    return Array.isArray(meta?.sceneBgm?.liked) ? meta.sceneBgm.liked : [];
}
function isLikedHere(id) {
    return chatLikes().some((x) => x.id === id);
}
function toggleLike(track) {
    const s = S();
    const c = ctx();
    const cid = chatId();
    if (!cid || !c.chatMetadata) { notify('warning', '채팅을 연 상태에서 눌러주세요'); return; }
    const meta = c.chatMetadata;
    meta.sceneBgm = meta.sceneBgm || {};
    meta.sceneBgm.liked = Array.isArray(meta.sceneBgm.liked) ? meta.sceneBgm.liked : [];
    const list = meta.sceneBgm.liked;
    const i = list.findIndex((x) => x.id === track.id);
    if (i === -1) {
        const entry = { ...trackLite(track), likedAt: Date.now() };
        list.unshift(entry);
        s.saved = [{ ...entry, chatId: cid, chatName: charDisplayName() }, ...s.saved.filter((x) => !(x.id === track.id && x.chatId === cid))].slice(0, 500);
        notify('success', `좋아요 — "${charDisplayName() || '이 채팅'}"에 기록했어요`);
    } else {
        list.splice(i, 1);
        s.saved = s.saved.filter((x) => !(x.id === track.id && x.chatId === cid));
    }
    c.saveMetadata?.();
    save();
    renderAll();
}

function reroll() {
    if (!S().enabled) setEnabled(true);
    if (!state.current) return runDirector({ force: true, source: 'force-play' });
    runDirector({ force: true, source: 'reroll', reject: state.current });
}

function blockCurrent(scope = 'song') {
    const s = S();
    if (!state.current) return;
    if (scope === 'channel' && state.current.channel) {
        const k = chKey(state.current.channel);
        if (!s.blockedChannels.includes(k)) s.blockedChannels = [...s.blockedChannels, k].slice(-500);
        save();
        notify('info', `"${state.current.channel}" 채널은 다시 고르지 않아요`);
        state.queue = state.queue.filter((t, i) => i <= state.queueIndex || chKey(t.channel) !== k);
        next();
        return;
    }
    if (!s.blocked.includes(state.current.id)) s.blocked.push(state.current.id);
    s.blocked = s.blocked.slice(-500);
    save();
    notify('info', '이 곡은 다시 고르지 않아요');
    next();
}

async function loadRelated() {
    if (!state.current || state.relatedFor === state.current.id) return;
    const target = state.current;
    state.relatedFor = target.id;
    state.related = null; // 로딩 표시
    renderList();
    try {
        const items = await fetchRelated(target);
        if (state.current?.id !== target.id) return;
        state.related = items.map((v) => trackLite({ ...v, query: target.query, mood: target.mood, reason: target.reason }));
    } catch (e) {
        state.related = [];
        state.relatedFor = null;
        setStatus(e.message, 'error');
    }
    renderList();
}

// ───────────────────────── 창 UI ─────────────────────────
let $win = null;
let statusText = '';
let statusKind = '';

function setStatus(text, kind = '') {
    statusText = text;
    statusKind = kind;
    const el = document.getElementById('sbgm_status');
    if (!el) return;
    el.querySelector('.sbgm-status-text').textContent = text;
    el.dataset.kind = kind;
    el.classList.toggle('open', state.whyOpen);
    requestAnimationFrame(() => updateMarquee(el));
}

// 긴 문장은 흘러가게
function updateMarquee(el) {
    const span = el.querySelector('.sbgm-status-text');
    el.classList.remove('sbgm-marquee');
    const over = span.scrollWidth - el.clientWidth;
    if (over > 4 && !state.whyOpen) {
        el.style.setProperty('--sbgm-mq-dist', `-${over + 8}px`);
        el.style.setProperty('--sbgm-mq-dur', `${Math.max(7, (over + 8) / 22 + 4)}s`);
        el.classList.add('sbgm-marquee');
    }
}

const RESULT_LABEL = { change: '교체', keep: '유지', suggest: '추천', reroll: '새로 고르기', continue: '이어서' };
function renderWhy() {
    const $w = $('#sbgm_why');
    if (!state.whyOpen) { $w.hide().empty(); return; }
    const d = state.lastDecision || (state.current ? { result: null, mood: state.current.mood, query: state.current.query, reason: state.current.reason } : null);
    if (!d) { $w.html('<div class="sbgm-why-empty">아직 판단한 내용이 없어요</div>').show(); return; }
    const time = d.at ? new Date(d.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    $w.html(`
<div class="sbgm-why-head">${d.result ? `<span class="sbgm-badge">${RESULT_LABEL[d.result] || d.result}</span>` : ''}${time ? `<span>${time}</span>` : ''}</div>
${d.reason ? `<p class="sbgm-why-reason">${esc(d.reason)}</p>` : ''}
<dl>
  ${d.mood ? `<dt>분위기</dt><dd>${esc(d.mood)}</dd>` : ''}
  ${d.query && !d.songs?.length ? `<dt>검색어</dt><dd>${esc(d.query)}</dd>` : ''}
</dl>
${d.songs?.length ? `<div class="sbgm-why-songs"><div>추천 곡</div><ol>${d.songs.map((x) => {
        const found = !d.found || d.found.includes(x);
        const blocked = found && x.videoId && S().embedOk[x.videoId] === false;
        const aiHit = found && x.videoId && S().aiVideo[x.videoId] === true;
        const note = !found ? (x.skip || '유튜브에서 못 찾음') : blocked ? '외부 재생 막힘' : aiHit ? 'AI 생성 곡이라 건너뜀' : '';
        return `<li class="${note ? 'miss' : ''}">${esc([x.artist, x.title].filter(Boolean).join(' – '))}${note ? ` <small>(${note})</small>` : ''}</li>`;
    }).join('')}</ol></div>` : ''}
${(state.skipped.ai || state.skipped.embed) ? `<div class="sbgm-why-skip">건너뜀: ${[state.skipped.ai ? `AI 생성 ${state.skipped.ai}곡` : '', state.skipped.embed ? `외부 재생 막힘 ${state.skipped.embed}곡` : ''].filter(Boolean).join(', ')}</div>` : ''}
${d.thinking ? `<details><summary>모델의 생각 보기</summary><pre>${esc(d.thinking)}</pre></details>` : ''}`).show();
}

function buildWindow() {
    const html = `
<div id="sbgm_window" class="sbgm-window" role="dialog" aria-label="Scene BGM">
  <div class="sbgm-head" id="sbgm_head">
    <span class="sbgm-grip fa-solid fa-grip-vertical" aria-hidden="true"></span>
    <span class="sbgm-brand">Scene BGM</span>
    <div class="sbgm-mode" id="sbgm_mode" role="group" aria-label="모드">
      <button data-mode="auto" title="AI 답변마다 분위기를 보고 자동으로 바꿔요">자동</button>
      <button data-mode="suggest" title="바꿀 때가 되면 후보만 띄워요">추천</button>
      <button data-mode="manual" title="🔍 버튼을 눌렀을 때만 골라요">수동</button>
    </div>
    <button class="sbgm-icon" id="sbgm_power" title="켜기/끄기"><i class="fa-solid fa-power-off"></i></button>
    <button class="sbgm-icon" id="sbgm_collapse" title="접기/펼치기"><i class="fa-solid fa-minus"></i></button>
    <button class="sbgm-icon" id="sbgm_close" title="창 닫기 (음악은 계속)"><i class="fa-solid fa-xmark"></i></button>
  </div>

  <div class="sbgm-now">
    <div class="sbgm-video" id="sbgm_video"><div class="sbgm-video-empty"><i class="fa-solid fa-music"></i></div></div>
    <div class="sbgm-meta">
      <a class="sbgm-title" id="sbgm_title" target="_blank" rel="noopener">아직 재생 중인 곡이 없어요</a>
      <div class="sbgm-channel" id="sbgm_channel"></div>
      <button class="sbgm-status" id="sbgm_status" title="눌러서 판단 내용 보기"><span class="sbgm-status-text"></span></button>
    </div>
  </div>

  <div class="sbgm-why" id="sbgm_why"></div>
  <div class="sbgm-suggest" id="sbgm_suggest"></div>

  <div class="sbgm-seek">
    <span id="sbgm_t_cur">0:00</span>
    <input type="range" id="sbgm_seek" min="0" max="1000" value="0" aria-label="재생 위치">
    <span id="sbgm_t_dur">0:00</span>
  </div>

  <div class="sbgm-controls">
    <button class="sbgm-icon" id="sbgm_find" title="지금 장면에 맞는 곡 찾기"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
    <button class="sbgm-icon" id="sbgm_prev" title="이전 곡"><i class="fa-solid fa-backward-step"></i></button>
    <button class="sbgm-icon sbgm-play" id="sbgm_play" title="재생/일시정지"><i class="fa-solid fa-play"></i></button>
    <button class="sbgm-icon" id="sbgm_next" title="다음 곡"><i class="fa-solid fa-forward-step"></i></button>
    <button class="sbgm-icon" id="sbgm_reroll" title="이 곡 말고 새로 고르기"><i class="fa-solid fa-arrows-rotate"></i></button>
    <button class="sbgm-icon" id="sbgm_save" title="좋아요 (이 채팅에 기록)" aria-pressed="false">${heartSvg(false)}</button>
    <span class="sbgm-block-wrap"><button class="sbgm-icon" id="sbgm_block" title="다시 안 듣기 (곡 / 채널)"><i class="fa-solid fa-ban"></i></button><div class="sbgm-block-menu" id="sbgm_block_menu"></div></span>
    <div class="sbgm-vol" title="볼륨"><i class="fa-solid fa-volume-low"></i><input type="range" id="sbgm_vol" min="0" max="100" aria-label="볼륨"></div>
  </div>

  <div class="sbgm-body">
    <div class="sbgm-genres">
      <div class="sbgm-genre-head">
        <button class="sbgm-genre-toggle" id="sbgm_genre_toggle" title="장르 펼치기/접기">
          <i class="fa-solid fa-chevron-right"></i><b>장르</b> <small id="sbgm_genre_scope"></small>
          <span class="sbgm-genre-summary" id="sbgm_genre_summary"></span>
        </button>
        <label class="sbgm-inline"><input type="checkbox" id="sbgm_inst"> 연주곡만</label>
      </div>
      <div class="sbgm-chips" id="sbgm_chips"></div>
    </div>

    <div class="sbgm-tabs" role="tablist">
      <button data-tab="queue">대기열</button>
      <button data-tab="related">비슷한 곡</button>
      <button data-tab="history">기록</button>
      <button data-tab="saved">좋아요</button>
    </div>
    <div class="sbgm-list" id="sbgm_list"></div>
  </div>
</div>`;
    $('body').append(html);
    $win = $('#sbgm_window');
    bindWindow();
    applyWindowGeometry();
}

function applyWindowGeometry() {
    const s = S();
    const w = s.window;
    const el = $win[0];
    el.classList.toggle('sbgm-collapsed', !!w.collapsed);
    el.classList.toggle('sbgm-hidden', !s.windowOpen);
    if (isMobile()) {
        el.style.left = el.style.width = el.style.height = '';
        positionMobile();
        return;
    }
    const width = Math.min(Math.max(w.w || 340, 280), window.innerWidth - 16);
    el.style.width = `${width}px`;
    el.style.height = w.collapsed ? '' : `${Math.min(Math.max(w.h || 560, 320), window.innerHeight - 16)}px`;
    const rect = el.getBoundingClientRect();
    let x = w.x ?? window.innerWidth - width - 16;
    let y = w.y ?? 64;
    x = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8);
    y = Math.min(Math.max(8, y), window.innerHeight - 48);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
}

const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

// 모바일에서는 입력창 위에 붙인다. (실리태번이 모바일에서 html에 transform을 걸어 bottom 기준 고정이 안 먹음)
function positionMobile() {
    if (!$win || !isMobile()) return;
    const el = $win[0];
    const form = document.getElementById('send_form');
    const formTop = form ? form.getBoundingClientRect().top : window.innerHeight - 56;
    const top = Math.max(8, formTop - el.offsetHeight - 8);
    el.style.setProperty('top', `${top}px`, 'important');
}

function bindWindow() {
    const el = $win[0];
    const head = document.getElementById('sbgm_head');

    // 드래그 (PC)
    let drag = null;
    head.addEventListener('pointerdown', (e) => {
        if (isMobile() || e.button !== 0 || e.target.closest('button')) return;
        const r = el.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
        head.setPointerCapture(e.pointerId);
        el.classList.add('sbgm-dragging');
        e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const r = el.getBoundingClientRect();
        const x = Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - r.width);
        const y = Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - 40);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
    });
    const endDrag = () => {
        if (!drag) return;
        drag = null;
        el.classList.remove('sbgm-dragging');
        const r = el.getBoundingClientRect();
        S().window.x = Math.round(r.left);
        S().window.y = Math.round(r.top);
        save();
    };
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);

    // 크기 조절 저장
    const ro = new ResizeObserver(() => {
        if (isMobile() || S().window.collapsed || !S().windowOpen) return;
        const r = el.getBoundingClientRect();
        if (r.width < 50) return;
        S().window.w = Math.round(r.width);
        S().window.h = Math.round(r.height);
        save();
    });
    ro.observe(el);
    window.addEventListener('resize', () => applyWindowGeometry());
    window.visualViewport?.addEventListener('resize', () => positionMobile());
    window.visualViewport?.addEventListener('scroll', () => positionMobile());
    // 입력창 높이가 바뀌면(여러 줄 입력) 따라 올라가게
    const form = document.getElementById('send_form');
    if (form) new ResizeObserver(() => positionMobile()).observe(form);

    $('#sbgm_mode').on('click', 'button', function () {
        S().mode = this.dataset.mode;
        if (S().mode !== 'suggest') state.suggestion = null;
        save();
        renderAll();
        syncSettingsPanel();
    });
    $('#sbgm_power').on('click', () => setEnabled(!S().enabled));
    $('#sbgm_collapse').on('click', () => {
        S().window.collapsed = !S().window.collapsed;
        save();
        applyWindowGeometry();
        renderHead();
    });
    $('#sbgm_close').on('click', () => setWindowOpen(false));

    $('#sbgm_play').on('click', togglePlay);
    $('#sbgm_next').on('click', () => next());
    $('#sbgm_prev').on('click', prev);
    $('#sbgm_find').on('click', () => {
        if (!S().enabled) setEnabled(true);
        runDirector({ force: true, source: 'manual' });
    });
    $('#sbgm_save').on('click', () => state.current && toggleLike(state.current));
    $('#sbgm_reroll').on('click', reroll);
    $('#sbgm_block').on('click', (e) => {
        e.stopPropagation();
        if (!state.current) return;
        const $m = $('#sbgm_block_menu');
        if ($m.is(':visible')) { $m.hide(); return; }
        $m.html(`<button data-scope="song"><i class="fa-solid fa-ban"></i> 이 곡 다시 안 듣기</button>
            <button data-scope="channel"><i class="fa-solid fa-user-slash"></i> 이 채널 전체 안 듣기<small>${esc(state.current.channel || '')}</small></button>`).show();
    });
    $('#sbgm_block_menu').on('click', 'button', function (e) {
        e.stopPropagation();
        $('#sbgm_block_menu').hide();
        blockCurrent(this.dataset.scope);
    });
    $(document).on('click', () => $('#sbgm_block_menu').hide());

    $('#sbgm_vol').on('input', function () {
        S().volume = Number(this.value);
        this.style.setProperty('--p', `${this.value}%`);
        try { state.player?.setVolume?.(S().volume); } catch { /* */ }
        save();
    });
    const seek = document.getElementById('sbgm_seek');
    seek.addEventListener('pointerdown', () => { state.seeking = true; });
    seek.addEventListener('input', () => seek.style.setProperty('--p', `${seek.value / 10}%`));
    seek.addEventListener('change', () => {
        state.seeking = false;
        if (!state.playerReady) return;
        const d = state.player.getDuration?.() || 0;
        state.player.seekTo((Number(seek.value) / 1000) * d, true);
    });

    $('#sbgm_chips').on('click', 'button', function () {
        const { cfg } = genreCfg();
        const g = this.dataset.genre;
        cfg.genres = cfg.genres.includes(g) ? cfg.genres.filter((x) => x !== g) : [...cfg.genres, g];
        save();
        renderGenres();
        syncSettingsPanel();
    });
    $('#sbgm_genre_toggle').on('click', () => {
        S().window.genresOpen = !S().window.genresOpen;
        save();
        renderGenres();
    });
    $('#sbgm_inst').on('change', function () {
        genreCfg().cfg.instrumentalOnly = this.checked;
        save();
        syncSettingsPanel();
    });

    $win.find('.sbgm-tabs').on('click', 'button', function () {
        S().window.tab = this.dataset.tab;
        save();
        renderTabs();
        renderList();
        if (this.dataset.tab === 'related') loadRelated();
    });

    $('#sbgm_list').on('click', '.sbgm-row', function (e) {
        if (e.target.closest('a, .sbgm-row-act')) return;
        const tab = S().window.tab;
        const i = Number(this.dataset.i);
        const list = listFor(tab);
        if (!list?.[i]) return;
        if (tab === 'queue') { state.queueIndex = i; playTrack(state.queue[i]); return; }
        state.queue = list.map(trackLite);
        state.queueIndex = i;
        state.queueLabel = { related: '비슷한 곡', history: '기록', saved: '좋아요' }[tab];
        playTrack(state.queue[i]);
    });
    $('#sbgm_list').on('click', '.sbgm-row-act[data-act="save"]', function () {
        const list = listFor(S().window.tab);
        const t = list?.[Number($(this).closest('.sbgm-row').data('i'))];
        if (t) toggleLike(t);
    });
    $('#sbgm_list').on('click', '[data-scope]', function () {
        S().window.likeScope = this.dataset.scope;
        save();
        renderList();
    });
    $('#sbgm_list').on('click', '.sbgm-row-act[data-act="remove"]', function () {
        const s = S();
        const tab = s.window.tab;
        const i = Number($(this).closest('.sbgm-row').data('i'));
        if (tab === 'history') s.history.splice(i, 1);
        if (tab === 'saved') {
            const t = listFor('saved')[i];
            if (t && (s.window.likeScope === 'chat' || t.chatId === chatId())) { toggleLike(t); return; }
            const gi = s.saved.indexOf(t);
            if (gi !== -1) s.saved.splice(gi, 1);
        }
        save();
        renderList();
    });

    $('#sbgm_suggest').on('click', '[data-pick]', function () {
        const sg = state.suggestion;
        if (!sg) return;
        setQueue(sg.items, Number(this.dataset.pick), sg.mood || sg.query);
        setStatus(sg.reason || sg.mood || sg.query);
    });
    $('#sbgm_status').on('click', () => {
        state.whyOpen = !state.whyOpen;
        renderWhy();
        setStatus(statusText, statusKind);
        positionMobile();
    });
    $('#sbgm_suggest').on('click', '[data-dismiss]', () => { state.suggestion = null; renderSuggest(); });
}

function listFor(tab) {
    const s = S();
    if (tab === 'queue') return state.queue;
    if (tab === 'related') return state.related;
    if (tab === 'history') return s.history;
    if (tab === 'saved') return s.window.likeScope === 'all' ? s.saved : chatLikes();
    return [];
}

function rowHtml(t, i, tab) {
    const s = S();
    const isCur = state.current?.id === t.id && (tab !== 'queue' || i === state.queueIndex);
    const liked = isLikedHere(t.id);
    const removable = tab === 'history' || tab === 'saved';
    return `
<div class="sbgm-row${isCur ? ' sbgm-cur' : ''}" data-i="${i}" title="${esc(t.title)}">
  <div class="sbgm-thumb"><img loading="lazy" src="${esc(t.thumb || thumbOf(t.id))}" alt="">${t.duration ? `<span>${esc(t.duration)}</span>` : ''}${isCur ? '<i class="fa-solid fa-volume-high"></i>' : ''}</div>
  <div class="sbgm-row-text"><div class="sbgm-row-title">${esc(t.title)}</div><div class="sbgm-row-sub">${esc([t.channel, fmtViews(t.views)].filter(Boolean).join(' · '))}${tab === 'history' && t.mood ? ` · ${esc(t.mood)}` : ''}${tab === 'saved' && s.window.likeScope === 'all' && t.chatName ? ` · ${esc(t.chatName)}` : ''}</div></div>
  <div class="sbgm-row-acts">
    <button class="sbgm-row-act" data-act="save" title="${liked ? '좋아요 취소' : '좋아요 (이 채팅에 기록)'}" aria-pressed="${liked}">${heartSvg(liked)}</button>
    <a class="sbgm-row-act" href="${ytUrl(t.id)}" target="_blank" rel="noopener" title="유튜브에서 열기"><i class="fa-brands fa-youtube"></i></a>
    ${removable ? '<button class="sbgm-row-act" data-act="remove" title="목록에서 지우기"><i class="fa-solid fa-xmark"></i></button>' : ''}
  </div>
</div>`;
}

function renderList() {
    if (!$win) return;
    const tab = S().window.tab;
    const list = listFor(tab);
    const $l = $('#sbgm_list');
    if (list === null) { $l.html('<div class="sbgm-empty"><i class="fa-solid fa-spinner fa-spin"></i> 불러오는 중…</div>'); return; }
    const empty = {
        queue: '분위기가 정해지면 여기에 곡이 쌓여요',
        related: state.current ? '비슷한 곡이 없어요' : '곡을 재생하면 비슷한 곡이 보여요',
        history: '들은 곡이 여기에 남아요',
        saved: S().window.likeScope === 'all' ? '아직 좋아요한 곡이 없어요' : '♡를 누르면 이 채팅에 기록돼요',
    }[tab];
    let label = tab === 'queue' && state.queueLabel ? `<div class="sbgm-list-label">${esc(state.queueLabel)}</div>` : '';
    if (tab === 'saved') {
        const sc = S().window.likeScope;
        label = `<div class="sbgm-scope"><button data-scope="chat" class="${sc !== 'all' ? 'sbgm-sel' : ''}">이 채팅${charDisplayName() ? ` · ${esc(charDisplayName())}` : ''}</button><button data-scope="all" class="${sc === 'all' ? 'sbgm-sel' : ''}">전체</button></div>`;
    }
    $l.html(label + (list?.length ? list.map((t, i) => rowHtml(t, i, tab)).join('') : `<div class="sbgm-empty">${empty}</div>`));
}

function renderTabs() {
    $win.find('.sbgm-tabs button').each(function () {
        this.classList.toggle('sbgm-sel', this.dataset.tab === S().window.tab);
    });
}

function renderGenres() {
    const { cfg, perChar } = genreCfg();
    const open = !!S().window.genresOpen;
    const custom = cfg.customGenres.split(',').map((x) => x.trim()).filter(Boolean);
    $('#sbgm_chips').toggle(open).html(GENRE_GROUPS.map(([group, list]) => `
<div class="sbgm-chip-group"><span>${esc(group)}</span>${list.map(([k, ko]) => `<button data-genre="${k}" class="${cfg.genres.includes(k) ? 'on' : ''}">${esc(ko)}</button>`).join('')}</div>`).join('')
        + (custom.length ? `<div class="sbgm-chip-group"><span>직접 추가</span>${custom.map((x) => `<span class="sbgm-chip-custom">${esc(x)}</span>`).join('')}</div>` : ''));
    const names = [...cfg.genres.map((g) => GENRE_MAP[g]?.ko).filter(Boolean), ...custom];
    $('#sbgm_genre_summary').text(names.length ? (names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ')) : '선택 안 함');
    $('#sbgm_genre_toggle').toggleClass('open', open);
    $('#sbgm_inst').prop('checked', !!cfg.instrumentalOnly);
    $('#sbgm_genre_scope').text(perChar ? `· ${charDisplayName()} 전용` : '· 전체 공통');
}

function renderHead() {
    const s = S();
    $win.toggleClass('sbgm-off', !s.enabled);
    $('#sbgm_power').toggleClass('on', s.enabled).attr('title', s.enabled ? '끄기 (음악 정지 + 판단 중지)' : '켜기');
    $('#sbgm_mode button').each(function () {
        const on = this.dataset.mode === s.mode;
        this.classList.toggle('sbgm-sel', on);
        this.setAttribute('aria-pressed', String(on));
    });
    $('#sbgm_collapse i').attr('class', `fa-solid ${s.window.collapsed ? 'fa-up-right-and-down-left-from-center' : 'fa-minus'}`);
}

function renderNow() {
    const t = state.current || S().lastTrack;
    const $title = $('#sbgm_title');
    if (t) {
        $title.text(t.title).attr('href', ytUrl(t.id)).attr('title', `${t.title}\n유튜브에서 열기`);
        $('#sbgm_channel').text(t.channel || '');
        if (!state.player) {
            $('#sbgm_video').html(`<div class="sbgm-video-empty" style="background-image:url('${esc(t.thumb || thumbOf(t.id))}')"><i class="fa-solid fa-play"></i></div>`);
        }
    } else {
        $title.text('아직 재생 중인 곡이 없어요').removeAttr('href');
        $('#sbgm_channel').text(S().enabled ? '대화가 이어지면 분위기에 맞춰 골라요' : '꺼져 있어요');
    }
    $win.toggleClass('sbgm-busy', state.busy);
    setStatus(statusText, statusKind);
}

function renderSuggest() {
    const sg = state.suggestion;
    const $s = $('#sbgm_suggest');
    if (!sg) { $s.empty().hide(); return; }
    $s.html(`
<div class="sbgm-suggest-head"><i class="fa-solid fa-lightbulb"></i> <b>${esc(sg.mood || '새 분위기')}</b><button data-dismiss title="무시"><i class="fa-solid fa-xmark"></i></button></div>
${sg.reason ? `<div class="sbgm-suggest-reason">${esc(sg.reason)}</div>` : ''}
<div class="sbgm-suggest-items">${sg.items.slice(0, 3).map((t, i) => `
  <button data-pick="${i}" title="${esc(t.title)}"><img src="${esc(t.thumb)}" alt=""><span>${esc(t.title)}</span></button>`).join('')}
</div>`).show();
}

function renderControls() {
    $('#sbgm_play i').attr('class', `fa-solid ${state.isPlaying ? 'fa-pause' : 'fa-play'}`);
    const saved = state.current && isLikedHere(state.current.id);
    $('#sbgm_save').html(heartSvg(!!saved)).attr('aria-pressed', String(!!saved)).attr('title', saved ? '좋아요 취소' : '좋아요 (이 채팅에 기록)');
    $('#sbgm_quick').toggleClass('sbgm-quick-playing', state.isPlaying).attr('title', state.isPlaying && state.current ? `Scene BGM · ${state.current.title}` : 'Scene BGM');
    $('#sbgm_vol').val(S().volume)[0]?.style.setProperty('--p', `${S().volume}%`);
}

function renderAll() {
    if (!$win) return;
    renderHead();
    renderNow();
    renderWhy();
    renderSuggest();
    renderControls();
    renderGenres();
    renderTabs();
    renderList();
    positionMobile();
}

function tick() {
    if (!state.playerReady || !S().windowOpen) return;
    try {
        const cur = state.player.getCurrentTime() || 0;
        const dur = state.player.getDuration() || 0;
        $('#sbgm_t_cur').text(fmtTime(cur));
        $('#sbgm_t_dur').text(dur ? fmtTime(dur) : 'LIVE');
        if (!state.seeking) {
            const v = dur ? Math.round((cur / dur) * 1000) : 0;
            $('#sbgm_seek').val(v)[0]?.style.setProperty('--p', `${v / 10}%`);
        }
    } catch { /* */ }
}

function setEnabled(on) {
    S().enabled = on;
    if (!on) { pause(); state.suggestion = null; setStatus('꺼짐'); } else setStatus('켜짐');
    save();
    renderAll();
    syncSettingsPanel();
}

function setWindowOpen(open) {
    S().windowOpen = open;
    save();
    applyWindowGeometry();
    $('#sbgm_wand_label').text(open ? 'Scene BGM 창 닫기' : 'Scene BGM 창 열기');
    $('#sbgm_quick').toggleClass('sbgm-quick-open', open);
    positionMobile();
    syncSettingsPanel();
}

// ───────────────────────── 설정 패널 ─────────────────────────
function buildSettingsPanel() {
    const html = `
<div class="sbgm-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b><i class="fa-solid fa-music"></i> Scene BGM</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <label class="checkbox_label"><input type="checkbox" id="sbgm_s_enabled"> 사용하기</label>
      <div class="sbgm-s-row">
        <div class="menu_button" id="sbgm_s_toggle_window"><i class="fa-solid fa-window-restore"></i> 플레이어 창 열기/닫기</div>
        <div class="menu_button" id="sbgm_s_reset_window"><i class="fa-solid fa-arrows-to-dot"></i> 창 위치 초기화</div>
      </div>

      <h4>판단</h4>
      <label for="sbgm_s_profile">판단에 쓸 연결 프로필</label>
      <select id="sbgm_s_profile" class="text_pole"></select>
      <small class="sbgm-note">메인 롤플 모델과 따로, 싸고 빠른 모델 프로필을 고르는 걸 추천해요. "메인 API"는 지금 연결된 모델을 써요.</small>
      <label for="sbgm_s_mode">모드</label>
      <select id="sbgm_s_mode" class="text_pole">
        <option value="auto">자동 — 분위기가 바뀌면 바로 교체</option>
        <option value="suggest">추천 — 후보만 띄우고 내가 고름</option>
        <option value="manual">수동 — 버튼 눌렀을 때만</option>
      </select>
      <div class="sbgm-s-grid">
        <label>읽을 내 메시지 수 <input type="number" class="text_pole" id="sbgm_s_user" min="0" max="10"></label>
        <label>읽을 AI 답변 수 <input type="number" class="text_pole" id="sbgm_s_ai" min="1" max="10"></label>
        <label>최소 간격 (AI 답변 수) <input type="number" class="text_pole" id="sbgm_s_gap" min="1" max="50"></label>
        <label>판단 최대 토큰 <input type="number" class="text_pole" id="sbgm_s_tokens" min="100" max="8000" step="50"></label>
      </div>
      <small class="sbgm-note">추론(thinking) 모델은 토큰을 많이 써서 답이 비어 올 수 있어요. 그럴 땐 최대 토큰을 1500 이상으로.</small>

      <h4>장르</h4>
      <label class="checkbox_label"><input type="checkbox" id="sbgm_s_perchar"> <span id="sbgm_s_perchar_label">이 캐릭터만 장르 따로 저장</span></label>
      <div class="sbgm-s-genres" id="sbgm_s_genres"></div>
      <label for="sbgm_s_custom">직접 추가 (쉼표로 구분, 영어 추천)</label>
      <input type="text" class="text_pole" id="sbgm_s_custom" placeholder="dark academia, medieval tavern">
      <label for="sbgm_s_excl">피할 것</label>
      <input type="text" class="text_pole" id="sbgm_s_excl" placeholder="EDM, heavy metal, 동요">
      <label class="checkbox_label"><input type="checkbox" id="sbgm_s_inst"> 연주곡만 (가사 없는 곡)</label>
      <label class="checkbox_label"><input type="checkbox" id="sbgm_s_strict"> 장르 고정 (장면이 달라도 안 벗어남)</label>
      <label class="checkbox_label"><input type="checkbox" id="sbgm_s_short"> 한 곡짜리 우선 (몇 시간짜리 모음 영상은 뒤로)</label>
      <label for="sbgm_s_pick">곡 고르는 방식</label>
      <select id="sbgm_s_pick" class="text_pole">
        <option value="songs">실제 곡 추천 — AI가 아티스트·곡명을 골라 찾아요</option>
        <option value="mood">분위기 검색 — 분위기 검색어로 찾아요 (BGM 모음 위주)</option>
      </select>
      <label class="checkbox_label"><input type="checkbox" id="sbgm_s_free"> '무료 BGM·저작권 없음' 영상은 뒤로</label>
      <label class="checkbox_label"><input type="checkbox" id="sbgm_s_ai"> AI 생성 음악 거르기 (유튜브 'AI·합성 콘텐츠' 표시, 설명란의 AI 제작 문구)</label>
      <div class="sbgm-s-row">
        <div class="menu_button" id="sbgm_s_clear_ai"><i class="fa-solid fa-robot"></i> AI 채널 기억 비우기 (<span id="sbgm_s_ai_n">0</span>)</div>
        <div class="menu_button" id="sbgm_s_clear_ch"><i class="fa-solid fa-user-slash"></i> 막은 채널 비우기 (<span id="sbgm_s_ch_n">0</span>)</div>
      </div>
      <label for="sbgm_s_sort">고르는 순서</label>
      <select id="sbgm_s_sort" class="text_pole">
        <option value="views">조회수 높은 순 (검색 결과 안에서)</option>
        <option value="relevance">유튜브 검색 순서 그대로</option>
      </select>

      <h4>유튜브 검색</h4>
      <select id="sbgm_s_source" class="text_pole">
        <option value="st">실리태번 서버 경유 (키 필요 없음)</option>
        <option value="api">YouTube Data API 키 사용</option>
      </select>
      <input type="password" class="text_pole" id="sbgm_s_key" placeholder="YouTube Data API 키 (AIza…)" autocomplete="off">
      <small class="sbgm-note" id="sbgm_s_source_note"></small>

      <h4>기록</h4>
      <div class="sbgm-s-row">
        <div class="menu_button" id="sbgm_s_clear_hist"><i class="fa-solid fa-clock-rotate-left"></i> 기록 비우기</div>
        <div class="menu_button" id="sbgm_s_clear_block"><i class="fa-solid fa-ban"></i> 안 듣기 목록 비우기 (<span id="sbgm_s_block_n">0</span>)</div>
      </div>
    </div>
  </div>
</div>`;
    $('#extensions_settings2').append(html);

    $('#sbgm_s_enabled').on('change', function () { setEnabled(this.checked); });
    $('#sbgm_s_toggle_window').on('click', () => setWindowOpen(!S().windowOpen));
    $('#sbgm_s_reset_window').on('click', () => {
        Object.assign(S().window, { x: null, y: null, w: 340, h: 560, collapsed: false });
        save();
        setWindowOpen(true);
        renderHead();
    });
    $('#sbgm_s_profile').on('focus mousedown', fillProfiles).on('change', function () { S().profileId = this.value; save(); });
    $('#sbgm_s_mode').on('change', function () { S().mode = this.value; state.suggestion = null; save(); renderAll(); });
    $('#sbgm_s_user').on('change', function () { S().userMsgs = clampNum(this.value, 0, 10, 1); this.value = S().userMsgs; save(); });
    $('#sbgm_s_ai').on('change', function () { S().aiMsgs = clampNum(this.value, 1, 10, 2); this.value = S().aiMsgs; save(); });
    $('#sbgm_s_gap').on('change', function () { S().minGap = clampNum(this.value, 1, 50, 2); save(); });
    $('#sbgm_s_tokens').on('change', function () { S().maxTokens = clampNum(this.value, 100, 8000, 500); save(); });

    $('#sbgm_s_perchar').on('change', function () {
        const s = S();
        const key = currentCharKey();
        if (!key) { this.checked = false; notify('warning', '캐릭터 채팅을 먼저 열어주세요'); return; }
        if (this.checked) s.perChar[key] = structuredClone(s.genre);
        else delete s.perChar[key];
        save();
        renderGenres();
        syncSettingsPanel();
    });
    $('#sbgm_s_genres').on('change', 'input', function () {
        const { cfg } = genreCfg();
        const g = this.dataset.genre;
        cfg.genres = this.checked ? [...new Set([...cfg.genres, g])] : cfg.genres.filter((x) => x !== g);
        save();
        renderGenres();
    });
    $('#sbgm_s_custom').on('input', function () { genreCfg().cfg.customGenres = this.value; save(); renderGenres(); });
    $('#sbgm_s_excl').on('input', function () { genreCfg().cfg.excludes = this.value; save(); });
    $('#sbgm_s_inst').on('change', function () { genreCfg().cfg.instrumentalOnly = this.checked; save(); renderGenres(); });
    $('#sbgm_s_strict').on('change', function () { genreCfg().cfg.strict = this.checked; save(); });
    $('#sbgm_s_short').on('change', function () { S().preferShort = this.checked; state.cache.clear(); save(); });
    $('#sbgm_s_sort').on('change', function () { S().sortBy = this.value; save(); });
    $('#sbgm_s_pick').on('change', function () { S().pickMode = this.value; save(); });
    $('#sbgm_s_free').on('change', function () { S().avoidFree = this.checked; save(); });
    $('#sbgm_s_ai').on('change', function () { S().avoidAi = this.checked; save(); });
    $('#sbgm_s_clear_ai').on('click', () => { S().aiChannels = []; S().aiVideo = {}; save(); syncSettingsPanel(); });
    $('#sbgm_s_clear_ch').on('click', () => { S().blockedChannels = []; save(); syncSettingsPanel(); });

    $('#sbgm_s_source').on('change', function () { S().searchSource = this.value; save(); syncSettingsPanel(); });
    $('#sbgm_s_key').on('input', function () { S().apiKey = this.value.trim(); save(); });

    $('#sbgm_s_clear_hist').on('click', () => { S().history = []; state.backStack = []; save(); renderList(); notify('success', '기록을 비웠어요'); });
    $('#sbgm_s_clear_block').on('click', () => { S().blocked = []; save(); syncSettingsPanel(); });

    fillProfiles();
    syncSettingsPanel();
}

const clampNum = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };

function fillProfiles() {
    const s = S();
    const c = ctx();
    const $sel = $('#sbgm_s_profile');
    let profiles = [];
    try {
        const CM = c.ConnectionManagerRequestService;
        profiles = CM ? CM.getSupportedProfiles() : [];
    } catch {
        profiles = [];
    }
    const opts = ['<option value="">메인 API (현재 연결)</option>']
        .concat(profiles.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`));
    if (s.profileId && !profiles.some((p) => p.id === s.profileId)) opts.push(`<option value="${esc(s.profileId)}">(삭제된 프로필)</option>`);
    $sel.html(opts.join(''));
    $sel.val(s.profileId);
}

function syncSettingsPanel() {
    if (!$('#sbgm_s_enabled').length) return;
    const s = S();
    const { cfg, perChar } = genreCfg();
    $('#sbgm_s_enabled').prop('checked', s.enabled);
    $('#sbgm_s_mode').val(s.mode);
    $('#sbgm_s_user').val(s.userMsgs);
    $('#sbgm_s_ai').val(s.aiMsgs);
    $('#sbgm_s_gap').val(s.minGap);
    $('#sbgm_s_tokens').val(s.maxTokens);
    $('#sbgm_s_perchar').prop('checked', perChar);
    const name = charDisplayName();
    $('#sbgm_s_perchar_label').text(name ? `"${name}"만 장르 따로 저장` : '이 캐릭터만 장르 따로 저장');
    $('#sbgm_s_genres').html(GENRE_GROUPS.map(([group, list]) => `<div class="sbgm-s-genre-group">${esc(group)}</div>` + list.map(([k, ko]) => `<label class="checkbox_label"><input type="checkbox" data-genre="${k}" ${cfg.genres.includes(k) ? 'checked' : ''}> ${esc(ko)}</label>`).join('')).join(''));
    if (document.activeElement?.id !== 'sbgm_s_custom') $('#sbgm_s_custom').val(cfg.customGenres);
    if (document.activeElement?.id !== 'sbgm_s_excl') $('#sbgm_s_excl').val(cfg.excludes);
    $('#sbgm_s_inst').prop('checked', cfg.instrumentalOnly);
    $('#sbgm_s_strict').prop('checked', cfg.strict);
    $('#sbgm_s_short').prop('checked', s.preferShort);
    $('#sbgm_s_sort').val(s.sortBy);
    $('#sbgm_s_pick').val(s.pickMode);
    $('#sbgm_s_free').prop('checked', s.avoidFree);
    $('#sbgm_s_ai').prop('checked', s.avoidAi);
    $('#sbgm_s_ai_n').text(s.aiChannels.length);
    $('#sbgm_s_ch_n').text(s.blockedChannels.length);
    $('#sbgm_s_source').val(s.searchSource);
    $('#sbgm_s_key').val(s.apiKey).toggle(s.searchSource === 'api');
    $('#sbgm_s_source_note').html(s.searchSource === 'api'
        ? '검색 1번에 100유닛, 하루 기본 10,000유닛(약 100번). 키는 Google Cloud Console에서 "YouTube Data API v3"를 켜고 만들어요.'
        : '실리태번 서버가 유튜브 검색 페이지를 대신 열어 읽어요. 키도 할당량도 없지만, 유튜브 페이지 구조가 바뀌면 고장날 수 있어요.');
    $('#sbgm_s_block_n').text(s.blocked.length);
}

// ───────────────────────── 이벤트 ─────────────────────────
function onAiMessage(messageId) {
    const s = S();
    if (!s.enabled) return;
    const msg = ctx().chat?.[messageId];
    if (!msg || msg.is_user || msg.is_system) return;
    state.aiSinceChange++;
    if (s.mode === 'manual') return;
    if (state.current && state.aiSinceChange < s.minGap && !state.chatSwitched) return;
    runDirector({ force: !state.current, source: 'auto' });
}

function onChatChanged() {
    state.chatSwitched = !!state.current;
    state.aiSinceChange = S().minGap;
    state.suggestion = null;
    state.lastDecision = null;
    renderAll();
    syncSettingsPanel();
}

function addQuickButton() {
    if (document.getElementById('sbgm_quick')) return;
    const btn = $('<div id="sbgm_quick" class="fa-solid fa-music interactable" tabindex="0" role="button" title="Scene BGM"></div>');
    const $right = $('#rightSendForm');
    if ($right.length) $right.prepend(btn); else $('#leftSendForm').append(btn);
    btn.on('click', () => setWindowOpen(!S().windowOpen));
    btn.on('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWindowOpen(!S().windowOpen); } });
}

function addWandButton() {
    const html = `
<div id="sbgm_wand_container" class="extension_container">
  <div id="sbgm_wand" class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="button">
    <div class="fa-solid fa-music extensionsMenuExtensionButton"></div>
    <span id="sbgm_wand_label">${S().windowOpen ? 'Scene BGM 창 닫기' : 'Scene BGM 창 열기'}</span>
  </div>
</div>`;
    $('#extensionsMenu').append(html);
    $('#sbgm_wand').on('click', () => setWindowOpen(!S().windowOpen));
}

function registerSlash() {
    const c = ctx();
    try {
        const { SlashCommandParser, SlashCommand } = c;
        if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) return;
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'bgm',
            callback: async (_args, value) => {
                const v = String(value || '').trim();
                if (!v || v === 'find') runDirector({ force: true, source: 'manual' });
                else if (v === 'next') next();
                else if (v === 'reroll' || v === 'new') reroll();
                else if (v === 'prev') prev();
                else if (v === 'toggle') togglePlay();
                else if (v === 'on') setEnabled(true);
                else if (v === 'off') setEnabled(false);
                else if (v === 'window') setWindowOpen(!S().windowOpen);
                else {
                    const items = await searchVideos(v);
                    if (items.length) setQueue(items.map((x) => ({ ...x, query: v, mood: v })), 0, v);
                }
                return '';
            },
            helpString: 'Scene BGM: /bgm (장면으로 찾기), /bgm next|prev|reroll|toggle|on|off|window, /bgm 검색어 (직접 검색해 재생)',
        }));
    } catch (e) {
        console.warn(LOG, 'slash command registration failed', e);
    }
}

jQuery(async () => {
    try {
        S();
        buildWindow();
        buildSettingsPanel();
        addWandButton();
        addQuickButton();
        $('#sbgm_quick').toggleClass('sbgm-quick-open', S().windowOpen);
        registerSlash();
        const c = ctx();
        const ev = c.eventTypes || c.event_types;
        c.eventSource.on(ev.MESSAGE_RECEIVED, onAiMessage);
        c.eventSource.on(ev.CHAT_CHANGED, onChatChanged);
        if (ev.CONNECTION_PROFILE_LOADED) c.eventSource.on(ev.CONNECTION_PROFILE_LOADED, fillProfiles);
        setInterval(tick, 500);
        renderAll();
        console.log(LOG, 'loaded');
    } catch (e) {
        console.error(LOG, 'init failed', e);
    }
});
