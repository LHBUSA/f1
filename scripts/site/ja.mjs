// Japanese (ja-JP) locale adapter for PropBetEdge F1 (Global Issue #67 Japan first wave; f1#11 full route cohort).
// ONE versioned adapter for routing, vocabulary, names, formatting, components and SEO; page renderers live in
// ./ja-pages.mjs. Built on the shared locale contract pbe-locale/1.0.0 (src/vendor/pbe-locale, byte-identical + drift
// test): createLocale({ ready: ['ja'] }) for routing and reciprocal hreflang, clipText for CJK meta descriptions.
// Rules (owner GO 2026-10-09, extended by f1#11 2026-10-10):
//   - Only COMPLETE pages are published in Japanese (the route matrix: docs/global/f1-ja-route-matrix.md). Routes
//     without a native Japanese page stay English-only; no untranslated duplicate is ever emitted or indexed.
//   - Every internal link on a Japanese page resolves through jaHref(): a Japanese page when one is built, otherwise no
//     link (never a silent jump to English, never a dead link, never a redirect to /ja).
//   - Names and numbers are identical to the English site (same build context). Japanese renderings of names only
//     where they are standard and certain (NAME_JA / TEAM_JA / CIRCUIT_JA, native review owed); every other proper
//     noun stays in Latin script, marked translate="no".
//   - Times are Japan Standard Time (Asia/Tokyo), rendered server-side; app.js never re-renders them (no data-local).
//   - Sports data and analysis only: no sportsbook/odds/prediction-market/referral modules or links, no betting CTA,
//     no picks. Membership CTA -> propbetedge.ai/ja/pro?via=f1 (price shown as 月額 US$29, never changed here).
//   - Ja pages are self-contained: no account/auth client, no Kalshi partner footer, no soft-nav router. Japanese-only
//     styles ship in their own stylesheet (assets.jaCss), so English pages never download them.
import { createLocale, clipText, LOCALE_REGISTRY } from '../../src/vendor/pbe-locale/pbe-locale.js';
import { esc, SITE, fmtPts, fmtMs, headshot, teamClass, teamMark, PROPSPORTS_F1 } from './lib.mjs';
import { sessionsAhead } from './components.mjs';

export const JA_ADAPTER_VERSION = 'f1-ja/2.0.0';
export const JA_READY = ['ja'];
export const L = createLocale({ ready: JA_READY, site: SITE });
export const JA_PRO_URL = 'https://propbetedge.ai/ja/pro?via=f1';
export const JA_TOKUSHOHO_URL = 'https://propbetedge.ai/ja/legal/tokushoho';
export const JA_PRICE = '月額 US$29';
export { clipText };

/** This site serves trailingSlash:false (vercel.json), so /ja/ is served as /ja: canonical + hreflang use the final URL. */
const finalUrl = (u) => u.replace(/^((?:https:\/\/[^/]+)?\/ja)\/$/, '$1');
export const jaPath = (path) => finalUrl(L.localizePath(path, 'ja'));
export const alternatesFor = (path) => L.alternateLinks(path).map((a) => ({ hreflang: a.hreflang, url: finalUrl(a.url) }));

// ---------------------------------------------------------------------------------------------- route registry
/**
 * The English paths that get a native Japanese page in this build. Decided from the same data the English generator
 * uses, BEFORE anything renders, so every Japanese link can be resolved (jaHref) and every English counterpart can
 * carry reciprocal hreflang. Eligibility per route family is documented in docs/global/f1-ja-route-matrix.md.
 */
export function jaRouteSet(ctx) {
  const s = new Set(['/', '/races', '/drivers', '/teams', '/circuits', '/methodology', '/data-coverage']);
  if ((ctx.standingsBy[`${ctx.currentSeason}|driver`] || []).length) s.add('/standings');
  for (const y of Object.keys(ctx.eventsBySeason).map(Number)) {
    if (y !== ctx.currentSeason) s.add(`/seasons/${y}`);
    if (y !== ctx.currentSeason && ctx.standingsBy[`${y}|driver`]) s.add(`/standings/${y}`);
  }
  for (const ev of ctx.events) s.add(`/races/${ev.slug}`);
  for (const d of ctx.drivers) if (ctx.careers[d.id]?.entries) s.add(`/drivers/${d.slug}`);
  for (const c of ctx.constructors) s.add(`/teams/${c.id}`);
  for (const c of ctx.circuits) s.add(`/circuits/${c.slug}`);
  return s;
}
let ROUTES = new Set(['/', '/standings']);
export const setJaRoutes = (set) => { ROUTES = set; };
export const hasJa = (enPath) => ROUTES.has(enPath);
/** Japanese URL for an English path (keeps #hash), or null when that route has no Japanese page. */
export function jaHref(enPath) {
  if (!enPath) return null;
  const [p, h] = String(enPath).split('#');
  if (!ROUTES.has(p || '/')) return null;
  return jaPath(p || '/') + (h ? `#${h}` : '');
}
const link = (enPath, html, attrs = '') => { const h = jaHref(enPath); return h ? `<a href="${h}"${attrs}>${html}</a>` : html; };

// ---------------------------------------------------------------------------------------------- vocabulary
export const SESSION_JA = { fp1: 'フリー走行1回目', fp2: 'フリー走行2回目', fp3: 'フリー走行3回目', sprint_qualifying: 'スプリント予選', sprint: 'スプリント', qualifying: '予選', race: '決勝' };
export const SESSION_ORDER = ['race', 'sprint', 'qualifying', 'sprint_qualifying', 'fp3', 'fp2', 'fp1'];
// Grand Prix names (event slug without the season). Unmapped events fall back to the Latin source name (translate="no").
export const GP_JA = {
  'australian-grand-prix': 'オーストラリアGP', 'chinese-grand-prix': '中国GP', 'japanese-grand-prix': '日本GP', 'bahrain-grand-prix': 'バーレーンGP',
  'saudi-arabian-grand-prix': 'サウジアラビアGP', 'miami-grand-prix': 'マイアミGP', 'canadian-grand-prix': 'カナダGP', 'monaco-grand-prix': 'モナコGP',
  'barcelona-catalunya-grand-prix': 'バルセロナ・カタルーニャGP', 'austrian-grand-prix': 'オーストリアGP', 'british-grand-prix': 'イギリスGP',
  'belgian-grand-prix': 'ベルギーGP', 'hungarian-grand-prix': 'ハンガリーGP', 'dutch-grand-prix': 'オランダGP', 'italian-grand-prix': 'イタリアGP',
  'spanish-grand-prix': 'スペインGP', 'azerbaijan-grand-prix': 'アゼルバイジャンGP', 'bahrain-grand-prix-in-malaysia': 'バーレーンGP（マレーシア開催）',
  'singapore-grand-prix': 'シンガポールGP', 'united-states-grand-prix': 'アメリカGP', 'mexico-city-grand-prix': 'メキシコシティGP',
  'sao-paulo-grand-prix': 'サンパウロGP', 'las-vegas-grand-prix': 'ラスベガスGP', 'qatar-grand-prix': 'カタールGP', 'abu-dhabi-grand-prix': 'アブダビGP',
  'emilia-romagna-grand-prix': 'エミリア・ロマーニャGP',
  // historic rounds (1950-2025 archive)
  'indianapolis-500': 'インディアナポリス500', 'swiss-grand-prix': 'スイスGP', 'french-grand-prix': 'フランスGP', 'german-grand-prix': 'ドイツGP',
  'argentine-grand-prix': 'アルゼンチンGP', 'pescara-grand-prix': 'ペスカーラGP', 'portuguese-grand-prix': 'ポルトガルGP', 'moroccan-grand-prix': 'モロッコGP',
  'south-african-grand-prix': '南アフリカGP', 'mexican-grand-prix': 'メキシコGP', 'brazilian-grand-prix': 'ブラジルGP', 'swedish-grand-prix': 'スウェーデンGP',
  'united-states-grand-prix-west': 'アメリカ西GP', 'san-marino-grand-prix': 'サンマリノGP', 'caesars-palace-grand-prix': 'シーザーズパレスGP',
  'detroit-grand-prix': 'デトロイトGP', 'european-grand-prix': 'ヨーロッパGP', 'dallas-grand-prix': 'ダラスGP', 'pacific-grand-prix': 'パシフィックGP',
  'luxembourg-grand-prix': 'ルクセンブルクGP', 'malaysian-grand-prix': 'マレーシアGP', 'turkish-grand-prix': 'トルコGP', 'korean-grand-prix': '韓国GP',
  'indian-grand-prix': 'インドGP', 'russian-grand-prix': 'ロシアGP', 'tuscan-grand-prix': 'トスカーナGP', 'pries-der-eifel-grand-prix': 'アイフェルGP',
  'sakhir-grand-prix': 'サクヒールGP', 'mercedes-benz-german-grand-prix': 'ドイツGP', 'canada-grand-prix': 'カナダGP',
  'singapore-air-singapore-gp': 'シンガポールGP', 'honda-japanese-grand-prix': '日本GP', 'mexico-grand-prix': 'メキシコGP', 'brazil-grand-prix': 'ブラジルGP',
};
export const COUNTRY_JA = {
  Australia: 'オーストラリア', China: '中国', Japan: '日本', Bahrain: 'バーレーン', 'Saudi Arabia': 'サウジアラビア', USA: 'アメリカ', 'United States': 'アメリカ',
  Canada: 'カナダ', Monaco: 'モナコ', Spain: 'スペイン', Austria: 'オーストリア', Britain: 'イギリス', 'United Kingdom': 'イギリス', England: 'イングランド',
  Belgium: 'ベルギー', Hungary: 'ハンガリー', Netherlands: 'オランダ', Italy: 'イタリア', Azerbaijan: 'アゼルバイジャン', Malaysia: 'マレーシア',
  Singapore: 'シンガポール', Mexico: 'メキシコ', Brazil: 'ブラジル', Qatar: 'カタール', 'United Arab Emirates': 'アラブ首長国連邦', Türkiye: 'トルコ',
  'South Korea': '韓国', India: 'インド', Germany: 'ドイツ', France: 'フランス', Russia: 'ロシア', Portugal: 'ポルトガル', Switzerland: 'スイス',
  Argentina: 'アルゼンチン', Morocco: 'モロッコ', 'South Africa': '南アフリカ', Sweden: 'スウェーデン', Ireland: 'アイルランド', Chile: 'チリ',
  Finland: 'フィンランド', 'Czech Republic': 'チェコ', Denmark: 'デンマーク', Colombia: 'コロンビア', Venezuela: 'ベネズエラ', Indonesia: 'インドネシア',
  Thailand: 'タイ', Uruguay: 'ウルグアイ', 'New Zealand': 'ニュージーランド', Zimbabwe: 'ジンバブエ', Liechtenstein: 'リヒテンシュタイン',
  Israel: 'イスラエル', Estonia: 'エストニア', Poland: 'ポーランド',
};
// Japanese-script names only where they are standard (Japanese F1 media usage). Everyone else keeps the source spelling.
export const NAME_JA = {
  // Japanese drivers
  'espn-5652': '角田裕毅', 'espn-432': '佐藤琢磨', 'espn-4378': '小林可夢偉', 'espn-5432': '鈴木亜久里', 'espn-5420': '中嶋悟', 'espn-4300': '中嶋一貴', 'espn-333': '片山右京',
  // current grid
  'espn-4665': 'マックス・フェルスタッペン', 'espn-5829': 'キミ・アントネッリ', 'espn-868': 'ルイス・ハミルトン', 'espn-5498': 'シャルル・ルクレール',
  'espn-5790': 'アイザック・ハジャー', 'espn-5752': 'オスカー・ピアストリ', 'espn-5741': 'リアム・ローソン', 'espn-348': 'フェルナンド・アロンソ',
  'espn-5579': 'ランド・ノリス', 'espn-5855': 'アービッド・リンドブラッド', 'espn-4396': 'ニコ・ヒュルケンベルグ', 'espn-4775': 'ランス・ストロール',
  'espn-5823': 'フランコ・コラピント', 'espn-5789': 'オリバー・ベアマン', 'espn-4678': 'エステバン・オコン', 'espn-5501': 'ピエール・ガスリー',
  'espn-4686': 'カルロス・サインツ', 'espn-5835': 'ガブリエル・ボルトレート', 'espn-4472': 'セルジオ・ペレス', 'espn-5503': 'ジョージ・ラッセル',
  'espn-5592': 'アレクサンダー・アルボン', 'espn-4520': 'バルテリ・ボッタス',
};
// keyed by the English source name, so a back-labelled or renamed entity never inherits a wrong rendering
export const TEAM_JA = {
  'Red Bull Racing': 'レッドブル・レーシング', Mercedes: 'メルセデス', Ferrari: 'フェラーリ', McLaren: 'マクラーレン', 'Racing Bulls': 'レーシングブルズ',
  'Aston Martin': 'アストンマーティン', Audi: 'アウディ', Alpine: 'アルピーヌ', Haas: 'ハース', Williams: 'ウィリアムズ', Cadillac: 'キャデラック',
  'Kick Sauber': 'キック・ザウバー', Sauber: 'ザウバー', 'Toro Rosso': 'トロロッソ', AlphaTauri: 'アルファタウリ', 'Super Aguri': 'スーパーアグリ',
  Toyota: 'トヨタ', 'Honda (2006–08)': 'ホンダ（2006–08）', 'Honda (1964–68)': 'ホンダ（1964–68）', Benetton: 'ベネトン', Tyrrell: 'ティレル',
  Brabham: 'ブラバム', Jordan: 'ジョーダン', Minardi: 'ミナルディ', Ligier: 'リジェ', 'Team Lotus': 'チーム・ロータス', 'Force India': 'フォース・インディア',
  'Racing Point': 'レーシングポイント', 'Brawn GP': 'ブラウンGP', Jaguar: 'ジャガー', Stewart: 'スチュワート', Prost: 'プロスト', Arrows: 'アロウズ',
  Maserati: 'マセラティ', Cooper: 'クーパー', 'BMW Sauber': 'BMWザウバー', 'Renault (2002–10)': 'ルノー（2002–10）', 'Renault (2016–20)': 'ルノー（2016–20）',
};
export const CIRCUIT_JA = {
  'suzuka-circuit': '鈴鹿サーキット', 'fuji-speedway': '富士スピードウェイ', 'okayama-international-circuit': '岡山国際サーキット',
  'albert-park': 'アルバート・パーク', 'shanghai-international-circuit': '上海インターナショナル・サーキット', 'bahrain-international-circuit': 'バーレーン・インターナショナル・サーキット',
  'jeddah-street-circuit': 'ジェッダ市街地コース', 'miami-international-autodrome': 'マイアミ・インターナショナル・オートドローム', 'circuit-gilles-villeneuve': 'ジル・ヴィルヌーヴ・サーキット',
  'circuit-de-monaco': 'モナコ市街地コース', 'circuit-de-catalunya': 'カタルーニャ・サーキット', 'red-bull-ring': 'レッドブル・リンク', 'silverstone-circuit': 'シルバーストン・サーキット',
  'spa-francorchamps': 'スパ・フランコルシャン', hungaroring: 'ハンガロリンク', 'circuit-park-zandvoort': 'ザントフォールト', 'autodromo-nazionale-monza': 'モンツァ・サーキット',
  madring: 'マドリング', 'baku-city-circuit': 'バクー市街地コース', 'marina-bay-circuit': 'マリーナベイ市街地コース', 'circuit-of-the-americas': 'サーキット・オブ・ジ・アメリカズ',
  'autodromo-hermanos-rodriguez': 'エルマノス・ロドリゲス・サーキット', 'autodromo-jose-carlos-pace': 'インテルラゴス・サーキット', 'las-vegas-street-circuit': 'ラスベガス市街地コース',
  'losail-international-circuit': 'ルサイル・インターナショナル・サーキット', 'yas-marina-circuit': 'ヤス・マリーナ・サーキット', 'sepang-international-circuit': 'セパン・インターナショナル・サーキット',
  'autodromo-enzo-e-dino-ferrari': 'イモラ・サーキット', 'imola-circuit': 'イモラ・サーキット',
};
const LAYOUT_JA = { Track: '常設サーキット', Street: '市街地コース', 'Tri-Oval': 'トライオーバル', Road: 'ロードコース' };
export const layoutJa = (t) => LAYOUT_JA[String(t || '').trim()] || null;

// ---------------------------------------------------------------------------------------------- formatting (JST)
const TZ = 'Asia/Tokyo';
const ok = (iso) => iso && Number.isFinite(Date.parse(iso));
export const jst = {
  /** 2026年10月11日(日) */
  date: (iso) => (ok(iso) ? new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: TZ }) : '—'),
  /** 10月11日 */
  short: (iso) => (ok(iso) ? new Date(iso).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', timeZone: TZ }) : '—'),
  /** 21:00 */
  time: (iso) => (ok(iso) ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }) : ''),
  /** 2026年10月11日(日) 21:00（日本時間） */
  dateTime(iso) { return ok(iso) ? `${this.date(iso)} ${this.time(iso)}（日本時間）` : '—'; },
};
/** A calendar date with no time of day (birth dates): never shifted by a time zone. */
export const civilDate = (iso) => (ok(iso) ? new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '—');
export const timeJa = (iso) => (ok(iso) ? `<time datetime="${esc(iso)}">${esc(jst.dateTime(iso))}</time>` : '—');
export const seasonSpan = (a, b) => (a === b ? `${a}年` : `${a}–${b}年`);
export const nth = (n) => (n == null ? '—' : `${n}位`);

// ---------------------------------------------------------------------------------------------- names
export const latin = (s) => `<span translate="no">${esc(s)}</span>`;
export const gpLabel = (ev) => GP_JA[String(ev?.slug || '').replace(/^\d{4}-/, '')] || null;
export const gpName = (ev) => { const j = gpLabel(ev); return j ? esc(j) : latin(ev?.name || ''); };
export const gpText = (ev) => gpLabel(ev) || ev?.name || '';
export const circuitText = (ctx, cid) => { const c = ctx.circuitById[cid]; return (c && CIRCUIT_JA[c.slug]) || ctx.circuitName(cid); };
export const circuitLabel = (ctx, cid) => { const c = ctx.circuitById[cid]; return c && CIRCUIT_JA[c.slug] ? esc(CIRCUIT_JA[c.slug]) : latin(ctx.circuitName(cid)); };
export const countryJa = (s) => (s ? COUNTRY_JA[s] || s : '');
export const driverText = (ctx, id) => NAME_JA[id] || ctx.driverById[id]?.full_name || id;
/** Name with the Latin source spelling under a Japanese rendering (heroes and cards). */
export const driverName = (ctx, id) => {
  const d = ctx.driverById[id];
  if (!d) return '—';
  return NAME_JA[id] ? `${esc(NAME_JA[id])} <span class="jp-latin" translate="no">${esc(d.full_name)}</span>` : latin(d.full_name);
};
/** Compact name for tables: Japanese rendering where certain, else Latin. */
export const driverShort = (ctx, id) => { const d = ctx.driverById[id]; if (!d) return '—'; return NAME_JA[id] ? esc(NAME_JA[id]) : latin(d.full_name); };
export const driverLast = (ctx, id) => { const d = ctx.driverById[id]; if (!d) return '—'; return NAME_JA[id] ? esc(NAME_JA[id].split('・').pop()) : latin(d.last_name || d.full_name); };
export const teamText = (ctx, cid) => { const n = ctx.conById[cid]?.name; return n ? TEAM_JA[n] || n : cid || '—'; };
export const teamName = (ctx, cid) => { const n = ctx.conById[cid]?.name; if (!n) return '—'; return TEAM_JA[n] ? esc(TEAM_JA[n]) : latin(n); };

// ---------------------------------------------------------------------------------------------- components
export function crumbsJa(items) {
  return `<nav class="crumbs" aria-label="パンくずリスト">${items.map(([h, t], i) => (i === items.length - 1 ? `<span aria-current="page">${t}</span>` : `<a href="${h}">${t}</a>`)).join('<span class="sep">/</span>')}</nav>`;
}
export const breadcrumbLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([h, t], i) => ({ '@type': 'ListItem', position: i + 1, name: String(t).replace(/<[^>]+>/g, ''), item: SITE + h })) });

export function driverCellJa(ctx, did, cid, season, opts = {}) {
  const d = ctx.driverById[did];
  const color = ctx.colorOf(cid, season);
  const href = d ? jaHref(`/drivers/${d.slug}`) : null;
  const nm = driverShort(ctx, did);
  return `<div class="drv ${teamClass(color)}"><span class="tbar"></span>${opts.avatar ? headshot(d, 'sm', ctx.mediaOk, color) : ''}<span>${href ? `<a href="${href}">${nm}</a>` : nm}${opts.code !== false && d?.code ? ` <span class="code" translate="no">${esc(d.code)}</span>` : ''}</span></div>`;
}
export const teamLinkJa = (ctx, cid, season) => (cid && ctx.conById[cid] ? link(`/teams/${cid}`, `${season === ctx.currentSeason ? teamMark(ctx.logoFor?.(cid), 16) : ''}${teamName(ctx, cid)}`, ' class="tlink"') : esc(cid || '—'));

export function statusTextJa(r) {
  if (!r.status) return '—';
  if (r.status === 'classified') return r.behind_laps ? `+${r.behind_laps}周` : esc(r.gap_text || r.time_text || '完走');
  const laps = r.laps != null ? `（${r.laps}周）` : '';
  if (r.status === 'retired') return `<span class="st-ret">リタイア${laps}</span>`;
  if (r.status === 'disqualified') return '<span class="st-dsq">失格</span>';
  if (r.status === 'did_not_start') return '<span class="st-ret">出走せず</span>';
  if (r.status === 'not_classified') return `<span class="st-ret">完走扱いなし${laps}</span>`;
  if (r.status === 'did_not_appear' || r.status === 'withdrawn') return '<span class="muted">出走取り消し</span>';
  if (r.status === 'did_not_qualify') return '<span class="muted">予選不通過</span>';
  if (r.status === 'did_not_prequalify' || r.status === 'not_prequalified') return '<span class="muted">予備予選不通過</span>';
  return esc(r.status_text || r.status);
}

export function sessionTableJa(ctx, ev, type) {
  const rows = ctx.rows(ev.id, type);
  if (!rows.length) return '';
  const isRace = type === 'race' || type === 'sprint';
  const isQ = type === 'qualifying' || type === 'sprint_qualifying';
  const fastest = Math.min(...rows.map((r) => r.fastest_lap_ms || Infinity));
  const bestQ = {};
  for (const k of ['q1_ms', 'q2_ms', 'q3_ms']) bestQ[k] = Math.min(...rows.map((r) => r[k] || Infinity));
  const head = isRace
    ? '<th class="pos">順位</th><th>ドライバー</th><th>チーム</th><th class="num">グリッド</th><th class="num">増減</th><th class="num">周回</th><th>タイム／状況</th><th class="num">ピット</th><th class="num">ポイント</th>'
    : isQ
      ? '<th class="pos">順位</th><th>ドライバー</th><th>チーム</th><th class="num">Q1</th><th class="num">Q2</th><th class="num">Q3</th><th class="num">周回</th>'
      : '<th class="pos">順位</th><th>ドライバー</th><th>チーム</th><th class="num">ベストラップ</th><th class="num">差</th><th class="num">周回</th>';
  const body = rows.map((r) => {
    const posCls = r.position && r.position <= 3 && (r.status === 'classified' || !isRace) ? `p${r.position}` : '';
    const pos = isRace && r.status !== 'classified' ? '—' : r.position ?? '—';
    const who = `<td>${driverCellJa(ctx, r.driver_id, r.constructor_id, ev.season)}</td><td class="team-cell">${teamLinkJa(ctx, r.constructor_id, ev.season)}</td>`;
    if (isRace) {
      const delta = r.status === 'classified' && r.grid && r.position ? r.grid - r.position : null;
      return `<tr class="${posCls}"><td class="pos">${pos}</td>${who}<td class="num">${r.grid || (r.grid === 0 ? 'ピット' : '—')}</td><td class="num ${delta > 0 ? 'gain' : delta < 0 ? 'loss' : ''}">${delta == null ? '' : delta > 0 ? '+' + delta : delta}</td><td class="num">${r.laps ?? '—'}</td><td>${statusTextJa(r)}${Number.isFinite(fastest) && r.fastest_lap_ms === fastest ? ` <span class="fl" title="ファステストラップ ${esc(r.fastest_lap_text)}">FL</span>` : ''}</td><td class="num">${r.pit_stops ?? '—'}</td><td class="num">${r.points ? fmtPts(r.points) : ''}</td></tr>`;
    }
    if (isQ) {
      const q = (k) => (r[k] ? `<span class="${r[k] === bestQ[k] ? 'purple' : ''}">${fmtMs(r[k])}</span>` : '—');
      return `<tr class="${posCls}"><td class="pos">${pos}</td>${who}<td class="num">${q('q1_ms')}</td><td class="num">${q('q2_ms')}</td><td class="num">${q('q3_ms')}</td><td class="num">${r.laps ?? '—'}</td></tr>`;
    }
    return `<tr class="${posCls}"><td class="pos">${pos}</td>${who}<td class="num ${r.position === 1 ? 'purple' : ''}">${fmtMs(r.best_lap_ms)}</td><td class="num">${r.position === 1 ? '' : esc(r.gap_text || '')}</td><td class="num">${r.laps ?? '—'}</td></tr>`;
  }).join('');
  const note = type === 'race' && rows.some((r) => r.points_scope === 'weekend_incl_sprint') ? '<p class="fine">ポイントは週末の合計（スプリントのポイントを含む）です。</p>' : '';
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${note}`;
}

export function statusPillJa(ev, now = Date.now()) {
  if (ev.status === 'completed') return '<span class="pill pill-done">終了</span>';
  if (ev.status === 'live' || ev.status === 'in_progress') return '<span class="pill pill-live">開催中</span>';
  if (ev.status === 'canceled') return '<span class="pill pill-cancel">中止</span>';
  const end = ev.end_utc || ev.start_utc;
  if (end && Date.parse(end) <= now) return '';
  return `<span class="pill"${end ? ` data-until="${esc(end)}"` : ''}>開催予定</span>`;
}

export function sessionListJa(ctx, ev) {
  const ss = [...(ctx.sessionsByEvent[ev.id] || [])].filter((s) => SESSION_JA[s.type]).sort((a, b) => (a.start_utc || '').localeCompare(b.start_utc || ''));
  return ss.map((s) => {
    const st = s.state === 'completed' ? '<span class="pill pill-done">終了</span>' : s.state === 'live' ? '<span class="pill pill-live">ライブ</span>' : s.state === 'canceled' ? '<span class="pill pill-cancel">中止</span>' : '';
    const when = s.time_valid ? timeJa(s.start_utc) : `${esc(jst.date(s.start_utc))}・時刻未定`;
    return `<div class="sess"><span class="n">${esc(SESSION_JA[s.type])}</span><span>${st}</span><span class="st">${when}</span></div>`;
  }).join('');
}

export function standingsTableJa(ctx, season, kind, limit = 99) {
  const rows = (ctx.standingsBy[`${season}|${kind}`] || []).filter((s) => s.subject_id).sort((a, b) => a.position - b.position).slice(0, limit);
  if (!rows.length) return '';
  const head = kind === 'driver'
    ? '<th class="pos">順位</th><th>ドライバー</th><th>チーム</th><th class="num">勝利</th><th class="num">ポイント</th>'
    : '<th class="pos">順位</th><th>コンストラクター</th><th class="num">勝利</th><th class="num">ポイント</th>';
  const body = rows.map((s) => {
    if (kind === 'driver') {
      const team = ctx.dcsByDriver[s.subject_id]?.filter((x) => x.season === season).sort((a, b) => b.entries - a.entries)[0]?.constructor_id;
      return `<tr class="p${s.position}"><td class="pos">${s.position}</td><td>${driverCellJa(ctx, s.subject_id, team, season, { avatar: true, code: false })}</td><td class="team-cell">${teamLinkJa(ctx, team, season)}</td><td class="num">${s.wins ?? '—'}</td><td class="num"><b>${fmtPts(s.points)}</b></td></tr>`;
    }
    const color = ctx.colorOf(s.subject_id, season);
    return `<tr class="p${s.position}"><td class="pos">${s.position}</td><td><div class="drv ${teamClass(color)}"><span class="tbar"></span>${teamLinkJa(ctx, s.subject_id, season)}</div></td><td class="num">${s.wins ?? '—'}</td><td class="num"><b>${fmtPts(s.points)}</b></td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export const ctaBlock = (lead = true) => `<div class="jp-cta${lead ? '' : ' jp-cta-sm'}"><a class="pc-cta jp-cta-btn" href="${JA_PRO_URL}" rel="noopener" data-pbe-placement="f1_ja_pro">All Access の詳細を見る（${JA_PRICE}）</a></div>`;
/** All Access explanation for analysis that stays member-only (Race Lab). Informational: links to the Japanese /pro page. */
export const premiumGateJa = (title, copy) => `<section class="section"><div class="wrap"><div class="card jp-aa jp-aa-sm"><span class="eyebrow">PropBetEdge All Access · Race Lab</span><h2>${esc(title)}</h2><p>${esc(copy)}</p>${ctaBlock(false)}</div></div></section>`;

// ---------------------------------------------------------------------------------------------- layout
const NAV_JA = [['/', 'トップ'], ['/races', 'レース'], ['/standings', '選手権順位'], ['/drivers', 'ドライバー'], ['/teams', 'チーム'], ['/circuits', 'サーキット'], ['/#all-access', 'All Access']];
const navSection = (path) => { const seg = '/' + (path.replace(/^\/ja/, '').split('/')[1] || ''); return seg === '/seasons' ? '/races' : seg; };

export function langSwitch(enHref, jaHref, current) {
  const en = current === 'en' ? '<span aria-current="true" lang="en">EN</span>' : `<a href="${esc(enHref)}" hreflang="en" lang="en" data-no-soft data-lang-switch>EN</a>`;
  const ja = current === 'ja' ? '<span aria-current="true" lang="ja">日本語</span>' : `<a href="${esc(jaHref)}" hreflang="ja" lang="ja" data-no-soft data-lang-switch>日本語</a>`;
  return `<nav class="lang-switch" aria-label="${current === 'ja' ? esc(LOCALE_REGISTRY.ja.langLabel) : 'Language'}">${en}<span class="lang-sep" aria-hidden="true">/</span>${ja}</nav>`;
}

export function jaLayout({ path, enPath, title, description, body, jsonLd = [], noindex = false, ogType = 'website', assets }) {
  const canonical = SITE + path;
  // reciprocal hreflang only between two indexable, equivalent pages
  const alts = noindex ? [] : alternatesFor(enPath);
  const page = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, url: canonical, inLanguage: 'ja', isPartOf: { '@type': 'WebSite', name: 'PropBetEdge F1', url: `${SITE}/` } };
  const ldAll = jsonLd.some((j) => j['@type'] === 'WebPage') ? jsonLd : [page, ...jsonLd];
  const ld = ldAll.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('');
  const cur = navSection(path);
  const nav = NAV_JA.map(([h, t]) => `<a href="${jaHref(h)}"${!h.includes('#') && h === cur ? ' aria-current="page"' : ''}>${esc(t)}</a>`).join('');
  return `<!doctype html>
<html lang="${LOCALE_REGISTRY.ja.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${alts.map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.url}">`).join('\n')}
${noindex ? '<meta name="robots" content="noindex,follow">' : '<meta name="robots" content="index,follow,max-image-preview:large">'}
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="PropBetEdge F1">
<meta property="og:locale" content="${LOCALE_REGISTRY.ja.og}">
<meta property="og:locale:alternate" content="${LOCALE_REGISTRY.en.og}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/og.png">
<meta name="theme-color" content="#14110d">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="${new URL(PROPSPORTS_F1).origin}">
<link rel="stylesheet" href="${assets.css}">
<link rel="stylesheet" href="${assets.jaCss}">
<script src="${assets.js}" defer></script>
${ld}
</head>
<body data-path="${esc(path)}" class="bg-data jp">
<a class="skip" href="#main">本文へ移動</a>
<header class="site-header jp-header">
  <div class="masthead wrap">
    <a class="brand" href="/ja" aria-label="PropBetEdge F1 日本語版トップ"><span class="brand-mark" aria-hidden="true"></span><span class="brand-pbe" translate="no">PROPBETEDGE</span><span class="brand-f1" translate="no">F1</span></a>
    ${langSwitch(enPath, path, 'ja')}
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="primary-nav" data-menu><span></span><span></span><span></span><span class="sr">メニュー</span></button>
  </div>
  <nav class="primary-nav" id="primary-nav" aria-label="メインメニュー"><div class="wrap nav-inner">${nav}</div></nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer jp-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="brand brand-sm" href="/ja"><span class="brand-mark" aria-hidden="true"></span><span class="brand-pbe" translate="no">PROPBETEDGE</span><span class="brand-f1" translate="no">F1</span></a>
      <p class="fine">出典のあるデータだけで作る F1 データ分析サイト。データ提供: <a href="https://propsports.proptechusa.ai" rel="noopener">PropSports</a>。DNA、サーキット適性、マッチアップは PropBetEdge による記述的な分析であり、予測ではありません。PropBetEdge は Formula 1、FIA および各チームとは提携していません。</p>
      <p class="fine"><a href="${jaHref('/methodology')}">分析手法とデータ出典</a> · <a href="${jaHref('/data-coverage')}">データ収録範囲</a></p>
      <p class="fine jp-legal"><a href="${JA_TOKUSHOHO_URL}">特定商取引法に基づく表記</a> · <a href="${JA_PRO_URL}" rel="noopener">All Access（${JA_PRICE}）</a> · <a href="${esc(enPath)}" hreflang="en" data-no-soft>英語版</a></p>
    </div>
    <nav aria-label="日本語ページ" class="network"><span class="network-k">日本語ページ</span>${NAV_JA.filter(([h]) => !h.includes('#')).map(([h, t]) => `<a href="${jaHref(h)}">${esc(t)}</a>`).join('')}</nav>
  </div>
  <div class="wrap fine copy">© ${new Date().getUTCFullYear()} PropBetEdge. F1、FORMULA 1 および関連する商標は Formula One Licensing B.V. の商標です。</div>
</footer>
</body>
</html>`;
}

// re-exported for the existing tests / build (pages moved to ./ja-pages.mjs)
export { jaHome, jaStandings, japanModule } from './ja-pages.mjs';
