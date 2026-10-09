// Japanese (ja-JP) acquisition pages for PropBetEdge F1 (Global Issue #67, Japan first wave).
// Built on the shared locale contract pbe-locale/1.0.0 (src/vendor/pbe-locale, byte-identical + drift test):
//   createLocale({ ready: ['ja'] }) for routing and reciprocal hreflang, format('ja', { timeZone: 'Asia/Tokyo' }) for
//   every date/time (JST), clipText for CJK meta descriptions.
// Rules (owner GO 2026-10-09):
//   - Only COMPLETE pages are published in Japanese: /ja (landing) and /ja/standings. Everything else stays English;
//     no untranslated duplicate is ever emitted or indexed.
//   - Names and numbers are identical to the English site (same build context). Japanese renderings of names only
//     where certain (NAME_JA); every other proper noun stays in Latin script, marked translate="no".
//   - Sports data and analysis only: no sportsbook/odds/prediction-market/referral modules or links, no betting CTA,
//     no picks. Membership CTA -> propbetedge.ai/ja/pro?via=f1 (price shown as 月額 US$29, never changed here).
//   - Ja pages are self-contained: no account/auth client, no Kalshi partner footer, no soft-nav router.
import { createLocale, format, clipText, LOCALE_REGISTRY } from '../../src/vendor/pbe-locale/pbe-locale.js';
import { esc, SITE, fmtPts, headshot, teamClass } from './lib.mjs';
import { sessionsAhead } from './components.mjs';

export const JA_READY = ['ja'];
export const L = createLocale({ ready: JA_READY, site: SITE });
export const JA_PRO_URL = 'https://propbetedge.ai/ja/pro?via=f1';
export const JA_TOKUSHOHO_URL = 'https://propbetedge.ai/ja/legal/tokushoho';
export const JA_PRICE = '月額 US$29';
/** English paths that have a complete Japanese counterpart (the only pages that get hreflang ja + the switch). */
export const JA_PAGES = Object.freeze(['/', '/standings']);
const fmt = format('ja', { timeZone: 'Asia/Tokyo' });

/** This site serves trailingSlash:false (vercel.json), so /ja/ is served as /ja: canonical + hreflang use the final URL. */
const finalUrl = (u) => u.replace(/^((?:https:\/\/[^/]+)?\/ja)\/$/, '$1');
export const jaPath = (path) => finalUrl(L.localizePath(path, 'ja'));
export const alternatesFor = (path) => L.alternateLinks(path).map((a) => ({ hreflang: a.hreflang, url: finalUrl(a.url) }));

// ---------------------------------------------------------------------------------------------- vocabulary
export const SESSION_JA = { fp1: 'フリー走行1回目', fp2: 'フリー走行2回目', fp3: 'フリー走行3回目', sprint_qualifying: 'スプリント予選', sprint: 'スプリント', qualifying: '予選', race: '決勝' };
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
};
export const COUNTRY_JA = {
  Australia: 'オーストラリア', China: '中国', Japan: '日本', Bahrain: 'バーレーン', 'Saudi Arabia': 'サウジアラビア', USA: 'アメリカ', Canada: 'カナダ',
  Monaco: 'モナコ', Spain: 'スペイン', Austria: 'オーストリア', Britain: 'イギリス', Belgium: 'ベルギー', Hungary: 'ハンガリー', Netherlands: 'オランダ',
  Italy: 'イタリア', Azerbaijan: 'アゼルバイジャン', Malaysia: 'マレーシア', Singapore: 'シンガポール', Mexico: 'メキシコ', Brazil: 'ブラジル',
  Qatar: 'カタール', 'United Arab Emirates': 'アラブ首長国連邦',
};
// Japanese-script names only where certain (Japanese drivers and Suzuka). Everyone else keeps the source spelling.
export const NAME_JA = {
  'espn-5652': '角田裕毅', 'espn-432': '佐藤琢磨', 'espn-4378': '小林可夢偉', 'espn-5432': '鈴木亜久里', 'espn-5420': '中嶋悟', 'espn-4300': '中嶋一貴', 'espn-333': '片山右京',
};
export const CIRCUIT_JA = { 'suzuka-circuit': '鈴鹿サーキット' };
const TSUNODA = 'espn-5652';
const SUZUKA = 'suzuka-circuit';

const latin = (s) => `<span translate="no">${esc(s)}</span>`;
export const gpName = (ev) => {
  const k = String(ev?.slug || '').replace(/^\d{4}-/, '');
  return GP_JA[k] ? esc(GP_JA[k]) : latin(ev?.name || '');
};
const circuitLabel = (ctx, cid) => {
  const c = ctx.circuitById[cid];
  return c && CIRCUIT_JA[c.slug] ? esc(CIRCUIT_JA[c.slug]) : latin(ctx.circuitName(cid));
};
const driverName = (ctx, id) => {
  const d = ctx.driverById[id];
  if (!d) return '—';
  return NAME_JA[id] ? `${esc(NAME_JA[id])} <span class="jp-latin" translate="no">${esc(d.full_name)}</span>` : latin(d.full_name);
};
const teamName = (ctx, cid) => (ctx.conById[cid] ? latin(ctx.conById[cid].name) : '—');
const seasonSpan = (a, b) => (a === b ? `${a}年` : `${a}–${b}年`);

// ---------------------------------------------------------------------------------------------- components
function standingsTableJa(ctx, season, kind, limit = 99) {
  const rows = (ctx.standingsBy[`${season}|${kind}`] || []).filter((s) => s.subject_id).sort((a, b) => a.position - b.position).slice(0, limit);
  if (!rows.length) return '';
  const head = kind === 'driver'
    ? '<th class="pos">順位</th><th>ドライバー</th><th>チーム</th><th class="num">勝利</th><th class="num">ポイント</th>'
    : '<th class="pos">順位</th><th>コンストラクター</th><th class="num">勝利</th><th class="num">ポイント</th>';
  const body = rows.map((s) => {
    if (kind === 'driver') {
      const team = ctx.dcsByDriver[s.subject_id]?.filter((x) => x.season === season).sort((a, b) => b.entries - a.entries)[0]?.constructor_id;
      const color = ctx.colorOf(team, season);
      return `<tr class="p${s.position}"><td class="pos">${s.position}</td><td><div class="drv ${teamClass(color)}"><span class="tbar"></span>${headshot(ctx.driverById[s.subject_id], 'sm', ctx.mediaOk, color)}<span>${driverName(ctx, s.subject_id)}</span></div></td><td class="team-cell">${teamName(ctx, team)}</td><td class="num">${s.wins ?? '—'}</td><td class="num"><b>${fmtPts(s.points)}</b></td></tr>`;
    }
    const color = ctx.colorOf(s.subject_id, season);
    return `<tr class="p${s.position}"><td class="pos">${s.position}</td><td><div class="drv ${teamClass(color)}"><span class="tbar"></span>${teamName(ctx, s.subject_id)}</div></td><td class="num">${s.wins ?? '—'}</td><td class="num"><b>${fmtPts(s.points)}</b></td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function sessionListJa(ctx, ev) {
  const ss = [...(ctx.sessionsByEvent[ev.id] || [])].filter((s) => SESSION_JA[s.type]).sort((a, b) => (a.start_utc || '').localeCompare(b.start_utc || ''));
  return ss.map((s) => {
    const st = s.state === 'completed' ? '<span class="pill pill-done">終了</span>' : s.state === 'canceled' ? '<span class="pill pill-cancel">中止</span>' : '';
    const when = s.time_valid ? `<time datetime="${esc(s.start_utc)}">${esc(fmt.dateTime(s.start_utc))}</time>` : `${esc(fmt.dateLong(s.start_utc))}・時刻未定`;
    return `<div class="sess"><span class="n">${esc(SESSION_JA[s.type])}</span><span>${st}</span><span class="st">${when}</span></div>`;
  }).join('');
}

const ctaBlock = (lead = true) => `<div class="jp-cta${lead ? '' : ' jp-cta-sm'}"><a class="pc-cta jp-cta-btn" href="${JA_PRO_URL}" rel="noopener" data-pbe-placement="f1_ja_pro">All Access の詳細を見る（${JA_PRICE}）</a></div>`;

function nextRaceSection(ctx) {
  const ev = ctx.nextEvent;
  if (!ev) return '';
  const c = ctx.circuitById[ev.circuit_id];
  const country = COUNTRY_JA[c?.country];
  const ahead = sessionsAhead(ctx.sessionsByEvent[ev.id], ctx.now);
  const sessions = sessionListJa(ctx, ev);
  return `<section class="section" id="next"><div class="wrap"><div class="card gp">
    <div class="gp-main"><span class="eyebrow">${ev.round ? `第${ev.round}戦 · ` : ''}${ev.season}年 · 次戦</span>
      <h2>${gpName(ev)}</h2>
      <div class="hero-meta"><span><b>サーキット</b>${circuitLabel(ctx, ev.circuit_id)}</span>${country ? `<span><b>開催国</b>${esc(country)}</span>` : ''}<span><b>フォーマット</b>${ev.sprint ? 'スプリント開催' : '通常フォーマット'}</span></div>
      ${ahead[0] ? `<p class="kicker">次のセッション: ${esc(SESSION_JA[ahead[0].type] || '')} · <time datetime="${esc(ahead[0].start_utc)}">${esc(fmt.dateTime(ahead[0].start_utc))}</time></p>` : ''}
    </div>
    ${sessions ? `<div class="gp-sessions"><span class="kicker">セッションスケジュール（日本時間）</span>${sessions}</div>` : ''}
  </div></div></section>`;
}

function latestResult(ctx) {
  const last = ctx.lastCompleted;
  if (!last) return '';
  const podium = ctx.rows(last.id, 'race').filter((r) => r.status === 'classified' && r.position <= 3);
  if (podium.length < 3) return '';
  const order = [podium[1], podium[0], podium[2]];
  return `<div class="card"><span class="eyebrow">最新レース結果${last.round ? ` · 第${last.round}戦` : ''}</span><h3>${gpName(last)}</h3><p class="fine">${esc(fmt.dateLong(last.end_utc || last.start_utc))} · ${circuitLabel(ctx, last.circuit_id)}</p>
    <div class="podium">${order.map((r) => `<div class="pp pp${r.position} ${teamClass(ctx.colorOf(r.constructor_id, last.season))}">${headshot(ctx.driverById[r.driver_id], 'md', ctx.mediaOk, ctx.colorOf(r.constructor_id, last.season))}<b>${r.position}</b><span class="nm" translate="no">${esc(ctx.driverById[r.driver_id]?.last_name)}</span></div>`).join('')}</div></div>`;
}

// Japan module: only rendered from real data in this build (no empty-state UI).
export function japanModule(ctx) {
  const season = ctx.currentSeason;
  const cards = [];
  // 1) Yuki Tsunoda (career totals exactly as the English driver page)
  const yt = ctx.driverById[TSUNODA];
  const k = ctx.careers[TSUNODA];
  if (yt && k?.entries) {
    const st = (ctx.standingsBy[`${season}|driver`] || []).find((s) => s.subject_id === TSUNODA);
    const teams = (k.teams || []).map((t) => teamName(ctx, t)).join(' · ');
    const latest = ctx.latestTeam[TSUNODA];
    const color = latest ? ctx.colorOf(latest.constructor_id, latest.season) : null;
    const stat = (label, v) => (v == null ? '' : `<div><dt>${label}</dt><dd>${v}</dd></div>`);
    cards.push(`<div class="card jp-driver ${teamClass(color)}"><span class="eyebrow">日本人ドライバー</span>
      <div class="jp-driver-head">${headshot(yt, 'md', ctx.mediaOk, color)}<h3>${esc(NAME_JA[TSUNODA])}<span class="jp-latin" translate="no">${esc(yt.full_name)}</span></h3></div>
      <dl class="jp-stats">${stat('出走', k.starts)}${stat('通算ポイント', fmtPts(k.points))}${stat('最高位', k.best_finish ? `${k.best_finish}位` : null)}${stat('表彰台', k.podiums)}${stat('シーズン', k.first_season ? seasonSpan(k.first_season, k.last_season) : null)}</dl>
      ${st ? `<p class="fine">${season}年ドライバーズ選手権: ${st.position}位（${fmtPts(st.points)}ポイント）</p>` : ''}
      ${teams ? `<p class="fine">所属チーム: ${teams}</p>` : ''}</div>`);
  }
  // 2) Japanese Grand Prix at Suzuka: latest completed edition + venue facts
  const suzuka = ctx.circuits.find((c) => c.slug === SUZUKA);
  if (suzuka) {
    const jgp = (ctx.eventsByCircuit[suzuka.id] || []).filter((e) => e.status === 'completed').sort((a, b) => b.start_utc.localeCompare(a.start_utc))[0];
    const dna = ctx.circuitDna[suzuka.id];
    const win = jgp ? ctx.rows(jgp.id, 'race').find((r) => r.status === 'classified' && r.position === 1) : null;
    const pole = jgp ? (ctx.rows(jgp.id, 'qualifying').find((r) => r.position === 1) || ctx.rows(jgp.id, 'race').find((r) => r.grid === 1)) : null;
    const facts = [
      suzuka.length_km ? ['全長', `${suzuka.length_km.toFixed(3)} km`] : null,
      suzuka.turns ? ['コーナー数', `${suzuka.turns}`] : null,
      dna?.race_laps ? ['決勝周回数', `${dna.race_laps}周`] : null,
      dna?.race_distance_km ? ['レース距離', `${dna.race_distance_km} km`] : null,
      dna?.races_held ? ['F1開催', `${dna.races_held}回（${seasonSpan(dna.first_season, dna.last_season)}）`] : null,
    ].filter(Boolean);
    if (facts.length || win) {
      cards.push(`<div class="card jp-suzuka"><span class="eyebrow">日本GP · ${esc(CIRCUIT_JA[SUZUKA])}</span><h3>${jgp ? `${jgp.season}年 ${gpName(jgp)}` : esc(CIRCUIT_JA[SUZUKA])}</h3>
        ${win || pole ? `<dl class="jp-stats">${win ? `<div><dt>優勝</dt><dd>${driverName(ctx, win.driver_id)}<small>${teamName(ctx, win.constructor_id)}</small></dd></div>` : ''}${pole ? `<div><dt>ポールポジション</dt><dd>${driverName(ctx, pole.driver_id)}</dd></div>` : ''}</dl>` : ''}
        ${facts.length ? `<dl class="jp-facts">${facts.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>` : ''}</div>`);
    }
  }
  // 3) Japanese drivers who reached the podium (career data)
  const podium = ctx.drivers.filter((d) => /^Japan/i.test(d.nationality || '') && ctx.careers[d.id]?.podiums > 0)
    .map((d) => ({ d, k: ctx.careers[d.id] })).sort((a, b) => b.k.podiums - a.k.podiums || b.k.points - a.k.points);
  if (podium.length) {
    cards.push(`<div class="card jp-podiums"><span class="eyebrow">日本人ドライバーの表彰台</span><h3>F1で表彰台に上った日本人</h3>
      <div class="table-wrap"><table><thead><tr><th>ドライバー</th><th class="num">表彰台</th><th class="num">最高位</th><th class="num">出走</th><th>シーズン</th></tr></thead><tbody>${podium.map(({ d, k: c }) => `<tr><td>${driverName(ctx, d.id)}</td><td class="num">${c.podiums}</td><td class="num">${c.best_finish}位</td><td class="num">${c.starts}</td><td>${seasonSpan(c.first_season, c.last_season)}</td></tr>`).join('')}</tbody></table></div></div>`);
  }
  // 4) Honda power units on the current grid (canonical machine registry)
  const honda = (ctx.currentTeamIds || []).map((cid) => ({ cid, pt: ctx.powertrainFor?.(cid, season) })).filter((x) => x.pt?.makerKey === 'honda');
  if (honda.length) {
    cards.push(`<div class="card jp-honda"><span class="eyebrow">${season}年 · パワーユニット</span><h3>ホンダ製パワーユニット搭載チーム</h3><ul class="jp-list">${honda.map(({ cid, pt }) => `<li>${teamName(ctx, cid)}${pt.designation ? ` <span class="muted" translate="no">${esc(pt.designation)}</span>` : ''}${pt.relationship === 'works' ? '<span class="pill">ワークス</span>' : ''}</li>`).join('')}</ul></div>`);
  }
  if (!cards.length) return '';
  return `<section class="section" id="japan"><div class="wrap"><div class="section-head"><div><span class="eyebrow">日本とF1</span><h2>日本のファンのために</h2></div></div><div class="grid g2 jp-grid">${cards.join('')}</div></div></section>`;
}

const FEATURES = [
  ['ドライバーDNA', '予選ペース、チームメイトとの比較、順位アップ、完走率、得点シェアなどを、同じ条件のドライバーとの比較（パーセンタイル）で可視化します。'],
  ['コンストラクターDNA', '予選スピード、レース結果、信頼性、ドライバー間のバランスをシーズンごとに数値化。マシンの力とドライバーの力を分けて見られます。'],
  ['サーキット分析', '過去10シーズンのデータからコースの特徴を整理し、次戦のサーキットに合うドライバーを示します（サーキット適性）。'],
  ['チームメイト対決', '同じマシンで戦うチームメイト同士の予選・決勝の直接対決と、予選タイム差の推移を比較できます。'],
  ['天気予報', 'レースウィークエンドの最高気温・降水量・風速の予報をサーキットごとに確認できます。'],
  ['PBEcast ライブ', 'セッション中はトラックマップとタイミング順位をリアルタイムで表示。All Access ではリプレイやポジショングラフも利用できます。'],
];
const AA_F1 = ['Race Lab（サーキット適性・ドライバーDNA・フォーム・チームメイト分析の完全版）', 'ドライバーとマッチアップの詳細分析（全DNA項目、予選タイム差の履歴）', 'フルタイミングタワー（ギャップ、インターバル、ピットストップ、ベストラップ）', 'セッション中のライブフィード全件', 'セッションリプレイ（0.5倍〜4倍、周回ジャンプ）', '全ドライバーのポジショングラフ'];
const FREE_F1 = ['レースカレンダー・スケジュール・結果', '選手権順位', 'ドライバー・チーム・サーキットの基本プロフィール', 'PBEcast のトラックマップとタイミング順位'];

function membershipSection() {
  return `<section class="section" id="all-access"><div class="wrap"><div class="card jp-aa">
    <span class="eyebrow">PropBetEdge All Access</span><h2>F1の分析を、すべて。</h2>
    <p class="jp-price"><b>${JA_PRICE}</b><span>F1を含む10競技のデータと分析をひとつのメンバーシップで</span></p>
    <div class="jp-aa-grid"><div><h3>All Access で追加される F1 機能</h3><ul class="jp-list jp-check">${AA_F1.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div><h3>無料で使える機能</h3><ul class="jp-list">${FREE_F1.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
    ${ctaBlock()}
    <p class="fine">メンバー限定のデータは、PropBetEdge のサーバー側で会員資格を確認したうえで表示されます。</p>
  </div></div></section>`;
}

// ---------------------------------------------------------------------------------------------- pages
export function jaHome(ctx) {
  const season = ctx.currentSeason;
  const stand = (ctx.standingsBy[`${season}|driver`] || []).length ? `<section class="section" id="standings"><div class="wrap"><div class="split even">
    <div><div class="section-head"><div><span class="eyebrow">${season}年 選手権</span><h2>ドライバーズ</h2></div><a class="more" href="${jaPath('/standings')}">全順位を見る</a></div>${standingsTableJa(ctx, season, 'driver', 10)}</div>
    <div><div class="section-head"><div><span class="eyebrow">${season}年 選手権</span><h2>コンストラクターズ</h2></div><a class="more" href="${jaPath('/standings')}#constructors">全チーム</a></div>${standingsTableJa(ctx, season, 'constructor', 11)}</div>
  </div></div></section>` : '';
  const latest = latestResult(ctx);
  const body = `
  <section class="hero jp-hero"><div class="wrap"><span class="eyebrow">PropBetEdge F1 · 日本語版</span><h1>F1を、データで読み解く。</h1>
    <p class="sub">PropBetEdge F1 は、ドライバー・コンストラクター・サーキットの情報を、出典のあるレース結果だけをもとに整理した F1 データ分析サイトです。最新の選手権順位、日本時間のセッションスケジュール、チームメイト対決、天気予報まで、F1をより深く楽しむためのデータをお届けします。</p>
    <div class="jp-hero-actions"><a class="pc-cta" href="${jaPath('/standings')}">${season}年の選手権順位</a><a class="more" href="#all-access">All Access（${JA_PRICE}）</a></div></div></section>
  ${nextRaceSection(ctx)}
  ${stand}
  ${latest ? `<section class="section"><div class="wrap"><div class="grid g2">${latest}<div class="card jp-note"><span class="eyebrow">データについて</span><h3>出典のあるデータだけ</h3><p>結果・セッション・順位・ドライバー・サーキットのデータは PropSports から取得しています。DNA、サーキット適性、マッチアップは PropBetEdge による記述的な分析で、予測ではありません。ドライバー名・チーム名・数値は英語版と同一です。</p></div></div></div></section>` : ''}
  ${japanModule(ctx)}
  <section class="section" id="features"><div class="wrap"><div class="section-head"><div><span class="eyebrow">機能紹介</span><h2>PropBetEdge F1 でできること</h2></div></div><div class="grid g3">${FEATURES.map(([h, p]) => `<div class="card jp-feature"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('')}</div></div></section>
  ${membershipSection()}`;
  const description = clipText(`F1（フォーミュラ1）${season}年のデータ分析を日本語で。選手権順位、次戦のセッションスケジュール（日本時間）、ドライバーDNA、コンストラクター分析、サーキット分析、チームメイト対決、天気予報を、出典のあるレース結果からお届けします。`, 120, 'ja');
  return {
    lang: 'ja', path: '/ja', enPath: '/',
    title: `F1 ${season} データ分析・選手権順位・日本時間スケジュール | PropBetEdge F1`,
    description, body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'PropBetEdge F1 日本語版', url: `${SITE}/ja`, inLanguage: 'ja', isPartOf: { '@type': 'WebSite', name: 'PropBetEdge F1', url: `${SITE}/` } }],
  };
}

export function jaStandings(ctx) {
  const season = ctx.currentSeason;
  const drivers = standingsTableJa(ctx, season, 'driver');
  if (!drivers) return null;
  const bc = [['/ja', 'トップ'], ['/ja/standings', '選手権順位']];
  const body = `<nav class="crumbs" aria-label="パンくずリスト"><a href="/ja">トップ</a><span class="sep">/</span><span aria-current="page">選手権順位</span></nav>
  <section class="hero"><div class="wrap"><span class="eyebrow">FIA フォーミュラ1 世界選手権</span><h1>${season}年 選手権順位</h1><p class="sub">ドライバーズ選手権とコンストラクターズ選手権の最新順位です。ドライバー名・チーム名・数値は英語版と同一のデータです。</p></div></section>
  <section class="section"><div class="wrap"><div class="split even"><div><div class="section-head"><h2>ドライバーズ</h2></div>${drivers}</div><div id="constructors"><div class="section-head"><h2>コンストラクターズ</h2></div>${standingsTableJa(ctx, season, 'constructor')}</div></div></div></section>
  <section class="section"><div class="wrap"><div class="card jp-aa jp-aa-sm"><span class="eyebrow">PropBetEdge All Access</span><h2>順位の推移も、チームメイト比較も。</h2><p>ラウンドごとの順位推移、コンストラクターの動き、チームメイト間の差は All Access の Race Lab で確認できます。</p>${ctaBlock(false)}</div></div></section>`;
  return {
    lang: 'ja', path: '/ja/standings', enPath: '/standings',
    title: `F1 ${season}年 選手権順位（ドライバーズ・コンストラクターズ）| PropBetEdge F1`,
    description: clipText(`F1（フォーミュラ1）${season}年のドライバーズ選手権・コンストラクターズ選手権の最新順位。勝利数とポイントを日本語でまとめています。`, 120, 'ja'),
    body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: bc.map(([h, t], i) => ({ '@type': 'ListItem', position: i + 1, name: t, item: SITE + h })) }],
  };
}

// ---------------------------------------------------------------------------------------------- layout
const NAV_JA = [['/ja', 'トップ'], ['/ja#next', '次戦'], ['/ja/standings', '選手権順位'], ['/ja#japan', '日本とF1'], ['/ja#all-access', 'All Access']];

export function langSwitch(enHref, jaHref, current) {
  const en = current === 'en' ? '<span aria-current="true" lang="en">EN</span>' : `<a href="${esc(enHref)}" hreflang="en" lang="en" data-no-soft data-lang-switch>EN</a>`;
  const ja = current === 'ja' ? '<span aria-current="true" lang="ja">日本語</span>' : `<a href="${esc(jaHref)}" hreflang="ja" lang="ja" data-no-soft data-lang-switch>日本語</a>`;
  return `<nav class="lang-switch" aria-label="${current === 'ja' ? esc(LOCALE_REGISTRY.ja.langLabel) : 'Language'}">${en}<span class="lang-sep" aria-hidden="true">/</span>${ja}</nav>`;
}

export function jaLayout({ path, enPath, title, description, body, jsonLd = [], noindex = false, assets }) {
  const canonical = SITE + path;
  const alts = alternatesFor(enPath);
  const ld = jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('');
  const nav = NAV_JA.map(([h, t]) => `<a href="${h}"${h === path ? ' aria-current="page"' : ''}>${esc(t)}</a>`).join('');
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
<meta property="og:type" content="website">
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
<link rel="preload" href="/assets/fonts/barlow-condensed-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${assets.css}">
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
      <p class="fine jp-legal"><a href="${JA_TOKUSHOHO_URL}">特定商取引法に基づく表記</a> · <a href="${JA_PRO_URL}" rel="noopener">All Access（${JA_PRICE}）</a> · <a href="${esc(enPath)}" hreflang="en" data-no-soft>英語版</a></p>
    </div>
    <nav aria-label="日本語ページ" class="network"><span class="network-k">日本語ページ</span>${NAV_JA.filter(([h]) => !h.includes('#')).map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join('')}</nav>
  </div>
  <div class="wrap fine copy">© ${new Date().getUTCFullYear()} PropBetEdge. F1、FORMULA 1 および関連する商標は Formula One Licensing B.V. の商標です。</div>
</footer>
</body>
</html>`;
}
