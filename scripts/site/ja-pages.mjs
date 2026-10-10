// Japanese (ja-JP) page renderers for PropBetEdge F1 (f1#11). Each returns { lang:'ja', path, enPath, title, description,
// body, jsonLd, noindex } for jaLayout. Content comes from the same build context as the English page (names, numbers,
// results), only the language differs. noindex mirrors the English counterpart exactly (thin pages stay unindexed in
// both languages), and the layout emits reciprocal hreflang only for indexable pairs.
import { esc, SITE, fmtPts, fmtMs, headshot, teamClass, teamMark, flag } from './lib.mjs';
import { sessionsAhead } from './components.mjs';
import {
  JA_PRO_URL, JA_PRICE, NAME_JA, CIRCUIT_JA, COUNTRY_JA, SESSION_JA, SESSION_ORDER, clipText, jaHref, jaPath,
  jst, civilDate, timeJa, seasonSpan, nth, latin, gpName, gpText, circuitText, circuitLabel, countryJa, driverText, driverName,
  driverShort, driverLast, teamText, teamName, crumbsJa, breadcrumbLd, driverCellJa, teamLinkJa, sessionTableJa, statusPillJa,
  sessionListJa, standingsTableJa, ctaBlock, premiumGateJa, layoutJa,
} from './ja.mjs';

const TSUNODA = 'espn-5652';
const SUZUKA = 'suzuka-circuit';
const winnerOf = (ctx, eid) => ctx.rows(eid, 'race').find((r) => r.status === 'classified' && r.position === 1);
const poleOf = (ctx, eid) => ctx.rows(eid, 'qualifying').find((r) => r.position === 1) || ctx.rows(eid, 'race').find((r) => r.grid === 1);
const a = (enPath, html, attrs = '') => { const h = jaHref(enPath); return h ? `<a href="${h}"${attrs}>${html}</a>` : html; };
const page = (o) => ({ lang: 'ja', ...o, path: jaPath(o.enPath) });
const T = (s) => `${s} | PropBetEdge F1`;
const HOME = ['/ja', 'トップ'];
/** 開催地: locality (Latin) + country (Japanese); a city-state is named once. */
const locJa = (c) => (!c ? '' : [c.locality && c.locality !== c.country ? latin(c.locality) : '', c.country ? esc(countryJa(c.country)) : ''].filter(Boolean).join('、'));

// ============================================================================================== home
function nextRaceSection(ctx) {
  const ev = ctx.nextEvent;
  if (!ev) return '';
  const c = ctx.circuitById[ev.circuit_id];
  const country = COUNTRY_JA[c?.country];
  const ahead = sessionsAhead(ctx.sessionsByEvent[ev.id], ctx.now);
  const sessions = sessionListJa(ctx, ev);
  return `<section class="section" id="next"><div class="wrap"><div class="card gp">
    <div class="gp-main"><span class="eyebrow">${ev.round ? `第${ev.round}戦 · ` : ''}${ev.season}年 · 次戦</span>
      <h2>${a(`/races/${ev.slug}`, gpName(ev))}</h2>
      <div class="hero-meta"><span><b>サーキット</b>${a(`/circuits/${c?.slug}`, circuitLabel(ctx, ev.circuit_id))}</span>${country ? `<span><b>開催国</b>${esc(country)}</span>` : ''}<span><b>フォーマット</b>${ev.sprint ? 'スプリント開催' : '通常フォーマット'}</span></div>
      ${ahead[0] ? `<p class="kicker">次のセッション: ${esc(SESSION_JA[ahead[0].type] || '')} · ${timeJa(ahead[0].start_utc)}</p>` : ''}
      <p class="jp-more">${a(`/races/${ev.slug}`, 'レースページへ', ' class="more"')}</p>
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
  return `<div class="card"><span class="eyebrow">最新レース結果${last.round ? ` · 第${last.round}戦` : ''}</span><h3>${a(`/races/${last.slug}`, gpName(last))}</h3><p class="fine">${esc(jst.date(last.end_utc || last.start_utc))} · ${circuitLabel(ctx, last.circuit_id)}</p>
    <div class="podium">${order.map((r) => `<div class="pp pp${r.position} ${teamClass(ctx.colorOf(r.constructor_id, last.season))}">${headshot(ctx.driverById[r.driver_id], 'md', ctx.mediaOk, ctx.colorOf(r.constructor_id, last.season))}<b>${r.position}</b><span class="nm">${driverLast(ctx, r.driver_id)}</span></div>`).join('')}</div></div>`;
}

// Japan module: only rendered from real data in this build (no empty-state UI).
export function japanModule(ctx) {
  const season = ctx.currentSeason;
  const cards = [];
  const yt = ctx.driverById[TSUNODA];
  const k = ctx.careers[TSUNODA];
  if (yt && k?.entries) {
    const st = (ctx.standingsBy[`${season}|driver`] || []).find((s) => s.subject_id === TSUNODA);
    const teams = (k.teams || []).map((t) => teamName(ctx, t)).join(' · ');
    const latest = ctx.latestTeam[TSUNODA];
    const color = latest ? ctx.colorOf(latest.constructor_id, latest.season) : null;
    const stat = (label, v) => (v == null ? '' : `<div><dt>${label}</dt><dd>${v}</dd></div>`);
    cards.push(`<div class="card jp-driver ${teamClass(color)}"><span class="eyebrow">日本人ドライバー</span>
      <div class="jp-driver-head">${headshot(yt, 'md', ctx.mediaOk, color)}<h3>${a(`/drivers/${yt.slug}`, esc(NAME_JA[TSUNODA]))}<span class="jp-latin" translate="no">${esc(yt.full_name)}</span></h3></div>
      <dl class="jp-stats">${stat('出走', k.starts)}${stat('通算ポイント', fmtPts(k.points))}${stat('最高位', k.best_finish ? `${k.best_finish}位` : null)}${stat('表彰台', k.podiums)}${stat('シーズン', k.first_season ? seasonSpan(k.first_season, k.last_season) : null)}</dl>
      ${st ? `<p class="fine">${season}年ドライバーズ選手権: ${st.position}位（${fmtPts(st.points)}ポイント）</p>` : ''}
      ${teams ? `<p class="fine">所属チーム: ${teams}</p>` : ''}</div>`);
  }
  const suzuka = ctx.circuits.find((c) => c.slug === SUZUKA);
  if (suzuka) {
    const jgp = (ctx.eventsByCircuit[suzuka.id] || []).filter((e) => e.status === 'completed').sort((x, y) => y.start_utc.localeCompare(x.start_utc))[0];
    const dna = ctx.circuitDna[suzuka.id];
    const win = jgp ? winnerOf(ctx, jgp.id) : null;
    const pole = jgp ? poleOf(ctx, jgp.id) : null;
    const facts = [
      suzuka.length_km ? ['全長', `${suzuka.length_km.toFixed(3)} km`] : null,
      suzuka.turns ? ['コーナー数', `${suzuka.turns}`] : null,
      dna?.race_laps ? ['決勝周回数', `${dna.race_laps}周`] : null,
      dna?.race_distance_km ? ['レース距離', `${dna.race_distance_km} km`] : null,
      dna?.races_held ? ['F1開催', `${dna.races_held}回（${seasonSpan(dna.first_season, dna.last_season)}）`] : null,
    ].filter(Boolean);
    if (facts.length || win) {
      cards.push(`<div class="card jp-suzuka"><span class="eyebrow">日本GP · ${a(`/circuits/${SUZUKA}`, esc(CIRCUIT_JA[SUZUKA]))}</span><h3>${jgp ? a(`/races/${jgp.slug}`, `${jgp.season}年 ${gpName(jgp)}`) : esc(CIRCUIT_JA[SUZUKA])}</h3>
        ${win || pole ? `<dl class="jp-stats">${win ? `<div><dt>優勝</dt><dd>${driverName(ctx, win.driver_id)}<small>${teamName(ctx, win.constructor_id)}</small></dd></div>` : ''}${pole ? `<div><dt>ポールポジション</dt><dd>${driverName(ctx, pole.driver_id)}</dd></div>` : ''}</dl>` : ''}
        ${facts.length ? `<dl class="jp-facts">${facts.map(([x, y]) => `<div><dt>${x}</dt><dd>${esc(y)}</dd></div>`).join('')}</dl>` : ''}</div>`);
    }
  }
  const podium = ctx.drivers.filter((d) => /^Japan/i.test(d.nationality || '') && ctx.careers[d.id]?.podiums > 0)
    .map((d) => ({ d, k: ctx.careers[d.id] })).sort((x, y) => y.k.podiums - x.k.podiums || y.k.points - x.k.points);
  if (podium.length) {
    cards.push(`<div class="card jp-podiums"><span class="eyebrow">日本人ドライバーの表彰台</span><h3>F1で表彰台に上った日本人</h3>
      <div class="table-wrap"><table><thead><tr><th>ドライバー</th><th class="num">表彰台</th><th class="num">最高位</th><th class="num">出走</th><th>シーズン</th></tr></thead><tbody>${podium.map(({ d, k: c }) => `<tr><td>${a(`/drivers/${d.slug}`, driverName(ctx, d.id))}</td><td class="num">${c.podiums}</td><td class="num">${c.best_finish}位</td><td class="num">${c.starts}</td><td>${seasonSpan(c.first_season, c.last_season)}</td></tr>`).join('')}</tbody></table></div></div>`);
  }
  const honda = (ctx.currentTeamIds || []).map((cid) => ({ cid, pt: ctx.powertrainFor?.(cid, season) })).filter((x) => x.pt?.makerKey === 'honda');
  if (honda.length) {
    cards.push(`<div class="card jp-honda"><span class="eyebrow">${season}年 · パワーユニット</span><h3>ホンダ製パワーユニット搭載チーム</h3><ul class="jp-list">${honda.map(({ cid, pt }) => `<li>${teamLinkJa(ctx, cid)}${pt.designation ? ` <span class="muted" translate="no">${esc(pt.designation)}</span>` : ''}${pt.relationship === 'works' ? '<span class="pill">ワークス</span>' : ''}</li>`).join('')}</ul></div>`);
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
    <p class="fine">メンバー限定のデータは、PropBetEdge のサーバー側で会員資格を確認したうえで表示されます。Race Lab、PBEcast のメンバー機能、ニュース記事は現在英語版のみで提供しています。</p>
  </div></div></section>`;
}

const EXPLORE = [['/races', 'レースカレンダー', '全ラウンドの日程（日本時間）、優勝者、ポールポジション、全セッションの結果'], ['/drivers', 'ドライバー', '現役グリッドと歴代の世界選手権ドライバーの通算成績'], ['/teams', 'チーム', 'コンストラクターの歴史、系譜、シーズンごとの成績'], ['/circuits', 'サーキット', 'コースの基本データと歴代の優勝者']];

export function jaHome(ctx) {
  const season = ctx.currentSeason;
  const stand = (ctx.standingsBy[`${season}|driver`] || []).length ? `<section class="section" id="standings"><div class="wrap"><div class="split even">
    <div><div class="section-head"><div><span class="eyebrow">${season}年 選手権</span><h2>ドライバーズ</h2></div><a class="more" href="${jaPath('/standings')}">全順位を見る</a></div>${standingsTableJa(ctx, season, 'driver', 10)}</div>
    <div><div class="section-head"><div><span class="eyebrow">${season}年 選手権</span><h2>コンストラクターズ</h2></div><a class="more" href="${jaPath('/standings')}#constructors">全チーム</a></div>${standingsTableJa(ctx, season, 'constructor', 11)}</div>
  </div></div></section>` : '';
  const latest = latestResult(ctx);
  const body = `
  <section class="hero jp-hero"><div class="wrap"><span class="eyebrow">PropBetEdge F1 · 日本語版</span><h1>F1を、データで読み解く。</h1>
    <p class="sub">PropBetEdge F1 は、ドライバー・コンストラクター・サーキットの情報を、出典のあるレース結果だけをもとに整理した F1 データ分析サイトです。最新の選手権順位、日本時間のセッションスケジュール、全レースの結果、歴代ドライバーとチームの記録まで、F1をより深く楽しむためのデータをお届けします。</p>
    <div class="jp-hero-actions"><a class="pc-cta" href="${jaPath('/standings')}">${season}年の選手権順位</a><a class="more" href="${jaPath('/races')}">${season}年のレースカレンダー</a><a class="more" href="#all-access">All Access（${JA_PRICE}）</a></div></div></section>
  ${nextRaceSection(ctx)}
  ${stand}
  ${latest ? `<section class="section"><div class="wrap"><div class="grid g2">${latest}<div class="card jp-note"><span class="eyebrow">データについて</span><h3>出典のあるデータだけ</h3><p>結果・セッション・順位・ドライバー・サーキットのデータは PropSports から取得しています。DNA、サーキット適性、マッチアップは PropBetEdge による記述的な分析で、予測ではありません。ドライバー名・チーム名・数値は英語版と同一です。</p><p>${a('/methodology', '分析手法とデータ出典', ' class="more"')}</p></div></div></div></section>` : ''}
  <section class="section" id="explore"><div class="wrap"><div class="section-head"><div><span class="eyebrow">日本語で読める F1 データ</span><h2>サイトの使い方</h2></div></div><div class="grid g4">${EXPLORE.map(([h, t, p]) => `<a class="card card-link jp-feature" href="${jaHref(h)}"><h3>${esc(t)}</h3><p>${esc(p)}</p></a>`).join('')}</div></div></section>
  ${japanModule(ctx)}
  <section class="section" id="features"><div class="wrap"><div class="section-head"><div><span class="eyebrow">機能紹介</span><h2>PropBetEdge F1 でできること</h2></div></div><div class="grid g3">${FEATURES.map(([h, p]) => `<div class="card jp-feature"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('')}</div></div></section>
  ${membershipSection()}`;
  const description = clipText(`F1（フォーミュラ1）${season}年のデータ分析を日本語で。選手権順位、次戦のセッションスケジュール（日本時間）、全レースの結果、ドライバー・チーム・サーキットの記録を、出典のあるレース結果からお届けします。`, 120, 'ja');
  return page({
    enPath: '/', path: '/ja',
    title: `F1 ${season} データ分析・選手権順位・日本時間スケジュール | PropBetEdge F1`,
    description, body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'PropBetEdge F1 日本語版', url: `${SITE}/ja`, inLanguage: 'ja', isPartOf: { '@type': 'WebSite', name: 'PropBetEdge F1', url: `${SITE}/` } }],
  });
}

// ============================================================================================== standings
const seasonLinks = (ctx, cur, kind) => {
  const ys = Object.keys(ctx.eventsBySeason).map(Number).filter((y) => kind === 'standings' ? ctx.standingsBy[`${y}|driver`] : true).sort((x, y) => y - x);
  const href = (y) => (kind === 'standings' ? (y === ctx.currentSeason ? '/standings' : `/standings/${y}`) : (y === ctx.currentSeason ? '/races' : `/seasons/${y}`));
  return `<nav class="season-links" aria-label="シーズン">${ys.map((y) => `<a href="${jaHref(href(y))}"${y === cur ? ' aria-current="page"' : ''}>${y}</a>`).join('')}</nav>`;
};

export function jaStandings(ctx, season = ctx.currentSeason) {
  const isCur = season === ctx.currentSeason;
  const enPath = isCur ? '/standings' : `/standings/${season}`;
  const drivers = standingsTableJa(ctx, season, 'driver');
  if (!drivers) return null;
  const prog = ctx.progression[season];
  const bc = [HOME, ['/ja/standings', '選手権順位'], ...(isCur ? [] : [[jaPath(enPath), `${season}年`]])];
  const body = `${crumbsJa(bc)}
  <section class="hero"><div class="wrap"><span class="eyebrow">FIA フォーミュラ1 世界選手権</span><h1>${season}年 選手権順位</h1><p class="sub">ドライバーズ選手権とコンストラクターズ選手権の${isCur ? '最新' : '最終'}順位です。ドライバー名・チーム名・数値は英語版と同一のデータです。</p>${prog?.note ? '<p class="note warn">このシーズンは、レースごとのポイント合計が公式順位表と一致しません（有効得点制またはデータ修正のため）。公式順位を正としています。</p>' : ''}</div></section>
  <section class="section"><div class="wrap"><div class="split even"><div><div class="section-head"><h2>ドライバーズ</h2></div>${drivers}</div><div id="constructors"><div class="section-head"><h2>コンストラクターズ</h2></div>${standingsTableJa(ctx, season, 'constructor') || '<p class="fine">コンストラクターズ選手権は1958年に始まりました。</p>'}</div></div></div></section>
  ${isCur ? `<section class="section"><div class="wrap"><div class="card jp-aa jp-aa-sm"><span class="eyebrow">PropBetEdge All Access</span><h2>順位の推移も、チームメイト比較も。</h2><p>ラウンドごとの順位推移、コンストラクターの動き、チームメイト間の差は All Access の Race Lab で確認できます。</p>${ctaBlock(false)}</div></div></section>` : ''}
  <section class="section"><div class="wrap"><p class="note">選手権の獲得確率は表示していません。検証済みのモデルがまだないためです。</p><div class="section-head"><h2>全シーズン</h2></div>${seasonLinks(ctx, season, 'standings')}</div></section>`;
  return page({
    enPath,
    title: T(`F1 ${season}年 選手権順位（ドライバーズ・コンストラクターズ）`),
    description: clipText(`F1（フォーミュラ1）${season}年のドライバーズ選手権・コンストラクターズ選手権の${isCur ? '最新' : '最終'}順位。勝利数とポイントを日本語でまとめています。`, 120, 'ja'),
    body,
    jsonLd: [breadcrumbLd(bc)],
  });
}

// ============================================================================================== races
export function jaRacesIndex(ctx, season) {
  const isMain = season === ctx.currentSeason;
  const enPath = isMain ? '/races' : `/seasons/${season}`;
  const evs = ctx.eventsBySeason[season] || [];
  const rows = evs.map((e) => {
    const w = winnerOf(ctx, e.id);
    const p = poleOf(ctx, e.id);
    return `<tr><td class="pos">${e.round ?? '—'}</td><td>${a(`/races/${e.slug}`, `<b>${gpName(e)}</b>`)}<div class="fine">${circuitLabel(ctx, e.circuit_id)}</div></td><td>${esc(jst.short(e.end_utc || e.start_utc))}</td><td>${statusPillJa(e, ctx.now)}${e.sprint ? ' <span class="pill pill-sprint">スプリント</span>' : ''}</td><td>${w ? driverCellJa(ctx, w.driver_id, w.constructor_id, season) : '—'}</td><td>${p ? driverCellJa(ctx, p.driver_id, p.constructor_id, season) : '—'}</td></tr>`;
  }).join('');
  const rounds = evs.filter((e) => e.round).length;
  const canceled = evs.filter((e) => e.status === 'canceled').length;
  const bc = [HOME, ['/ja/races', 'レース'], ...(isMain ? [] : [[jaPath(enPath), `${season}年`]])];
  const body = `${crumbsJa(bc)}
  <section class="hero"><div class="wrap"><span class="eyebrow">${season}年 FIA フォーミュラ1 世界選手権</span><h1>${season}年 レースカレンダー</h1><p class="sub">全${rounds}戦${canceled ? `（うち${canceled}戦は中止）` : ''}。優勝者、ポールポジション、全セッションの結果を掲載しています。日付は日本時間です。</p></div></section>
  <section class="section"><div class="wrap"><div class="table-wrap"><table><thead><tr><th class="pos">戦</th><th>グランプリ</th><th>決勝日</th><th>状況</th><th>優勝</th><th>ポールポジション</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>シーズンアーカイブ</h2></div>${seasonLinks(ctx, season, 'races')}</div></section>`;
  return page({
    enPath,
    title: T(`F1 ${season}年 レースカレンダー・結果・優勝者`),
    description: clipText(`F1（フォーミュラ1）${season}年シーズンの全ラウンド。日程（日本時間）、サーキット、優勝者、ポールポジション、全セッションの結果を日本語で。`, 120, 'ja'),
    body,
    jsonLd: [breadcrumbLd(bc)],
  });
}

export function jaRacePage(ctx, ev) {
  const c = ctx.circuitById[ev.circuit_id];
  const types = SESSION_ORDER.filter((t) => ctx.rows(ev.id, t).length);
  const w = winnerOf(ctx, ev.id);
  const p = poleOf(ctx, ev.id);
  const race = ctx.rows(ev.id, 'race');
  const fl = race.filter((r) => r.fastest_lap_ms).sort((x, y) => x.fastest_lap_ms - y.fastest_lap_ms)[0];
  const gainer = race.filter((r) => r.status === 'classified' && r.grid && r.position).sort((x, y) => y.grid - y.position - (x.grid - x.position))[0];
  const dnfs = race.filter((r) => r.status === 'retired' || r.status === 'disqualified' || r.status === 'not_classified');
  const tabs = types.length
    ? `<div class="tabs" role="tablist" aria-label="セッション">${types.map((t, i) => `<button class="tab" role="tab" type="button" aria-selected="${i === 0}" aria-controls="tp-${t}" id="tb-${t}">${esc(SESSION_JA[t])}</button>`).join('')}</div>${types.map((t, i) => `<div class="tabpanel" role="tabpanel" id="tp-${t}" aria-labelledby="tb-${t}"${i ? ' hidden' : ''}>${sessionTableJa(ctx, ev, t)}</div>`).join('')}`
    : '<p class="fine">セッションの結果は、各セッションの公式結果が発表されるとここに掲載されます。</p>';
  const facts = w
    ? `<div class="stats">
      <div class="stat-box"><span>優勝</span><b>${driverLast(ctx, w.driver_id)}</b><span>${teamLinkJa(ctx, w.constructor_id)} · ${w.grid ? `${w.grid}番グリッドから` : 'ピットスタート'}</span></div>
      ${p ? `<div class="stat-box"><span>ポールポジション</span><b>${driverLast(ctx, p.driver_id)}</b><span>${p.q3_ms ? fmtMs(p.q3_ms) : ''}</span></div>` : ''}
      ${fl ? `<div class="stat-box"><span>ファステストラップ</span><b class="purple">${esc(fl.fastest_lap_text)}</b><span>${driverLast(ctx, fl.driver_id)}${fl.fastest_lap_number ? ` · ${fl.fastest_lap_number}周目` : ''}</span></div>` : ''}
      ${gainer && gainer.grid - gainer.position > 0 ? `<div class="stat-box"><span>最大ジャンプアップ</span><b class="green">+${gainer.grid - gainer.position}</b><span>${driverLast(ctx, gainer.driver_id)} ${gainer.grid}番手→${gainer.position}位</span></div>` : ''}
      <div class="stat-box"><span>リタイア等</span><b>${dnfs.length}</b><span>出走${race.filter((r) => ['classified', 'retired', 'disqualified', 'not_classified'].includes(r.status)).length}台中</span></div>
    </div>`
    : '';
  const prog = ctx.progression[ev.season];
  const roundRow = prog?.rounds.find((r) => r.event_id === ev.id);
  const prevRow = prog?.rounds[prog.rounds.indexOf(roundRow) - 1];
  const champ = roundRow && prog.matches_official !== false
    ? `<div class="card"><span class="eyebrow">第${ev.round}戦終了時点の選手権</span><div class="table-wrap"><table><thead><tr><th class="pos">順位</th><th>ドライバー</th><th class="num">ポイント</th><th class="num">変動</th></tr></thead><tbody>${Object.entries(roundRow.drivers)
        .sort((x, y) => x[1].pos - y[1].pos).slice(0, 8)
        .map(([id, v]) => {
          const pv = prevRow?.drivers[id];
          const mv = pv ? pv.pos - v.pos : null;
          const team = race.find((r) => r.driver_id === id)?.constructor_id;
          return `<tr><td class="pos">${v.pos}</td><td>${driverCellJa(ctx, id, team, ev.season)}</td><td class="num">${fmtPts(v.p)}</td><td class="num">${mv ? (mv > 0 ? `<span class="gain">▲${mv}</span>` : `<span class="loss">▼${-mv}</span>`) : ''}</td></tr>`;
        }).join('')}</tbody></table></div><p class="fine">発表されたレースポイントの累計です。</p></div>`
    : '';
  const history = (ctx.eventsByCircuit[ev.circuit_id] || []).filter((e) => e.season < ev.season && e.status === 'completed').slice(-8).reverse();
  const reloc = ctx.relocations?.[ev.slug];
  const bc = [HOME, ['/ja/races', 'レース'], [jaHref(ev.season === ctx.currentSeason ? '/races' : `/seasons/${ev.season}`), `${ev.season}年`], [jaPath(`/races/${ev.slug}`), gpName(ev)]];
  const loc = locJa(c);
  const body = `${crumbsJa(bc)}
  <section class="hero"><div class="wrap"><span class="eyebrow">${ev.round ? `第${ev.round}戦 · ` : ''}${ev.season}年${ev.sprint ? ' · スプリント開催' : ''}</span><h1>${ev.season}年 ${gpName(ev)}</h1>
  <div class="hero-meta"><span><b>サーキット</b>${a(`/circuits/${c?.slug}`, circuitLabel(ctx, ev.circuit_id))}</span>${loc ? `<span><b>開催地</b>${loc}</span>` : ''}<span><b>日程</b>${esc(jst.short(ev.start_utc))} – ${esc(jst.short(ev.end_utc || ev.start_utc))}（日本時間）</span><span>${statusPillJa(ev, ctx.now)}</span></div>
  ${ev.official_name && ev.official_name !== ev.name ? `<p class="fine">正式名称: ${latin(ev.official_name)}</p>` : ''}
  ${reloc ? `<p class="note">このラウンドは当初の開催地から変更されて開催されました。当初予定されていたラウンドは中止として記録されています。${a(`/races/${reloc.orig_id}`, '当初のラウンド', ' class="more"')}</p>` : ''}</div></section>
  ${facts ? `<section class="section"><div class="wrap">${facts}</div></section>` : ''}
  <section class="section"><div class="wrap"><div class="split"><div><div class="section-head"><h2>リザルト</h2></div>${tabs}</div><div class="grid">
    <div class="card"><span class="kicker">セッションスケジュール（日本時間）</span>${sessionListJa(ctx, ev) || '<p class="fine">セッション日程は未発表です。</p>'}</div>
    ${champ}
  </div></div></div></section>
  ${ctx.fit[ev.id] ? premiumGateJa('この週末の分析をすべて見る', 'Race Lab では、サーキット適性の全ランキング、チームメイト間の予選タイム差、ドライバーDNA、フォーム、選手権の動きをこの週末について確認できます。') : ''}
  ${history.length ? `<section class="section"><div class="wrap"><div class="section-head"><h2>${circuitLabel(ctx, ev.circuit_id)}の最近の優勝者</h2>${a(`/circuits/${c?.slug}`, 'サーキットのページ', ' class="more"')}</div><div class="table-wrap"><table><thead><tr><th>シーズン</th><th>グランプリ</th><th>優勝</th><th>チーム</th><th class="num">グリッド</th></tr></thead><tbody>${history.map((h) => {
      const hw = winnerOf(ctx, h.id);
      return `<tr><td>${h.season}</td><td>${a(`/races/${h.slug}`, gpName(h))}</td><td>${hw ? driverCellJa(ctx, hw.driver_id, hw.constructor_id, h.season) : '—'}</td><td>${hw ? teamLinkJa(ctx, hw.constructor_id) : ''}</td><td class="num">${hw?.grid ?? '—'}</td></tr>`;
    }).join('')}</tbody></table></div></div></section>` : ''}`;
  const name = `${ev.season}年 ${gpText(ev)}`;
  const jsonLd = [
    { '@context': 'https://schema.org', '@type': 'SportsEvent', name, inLanguage: 'ja', startDate: ev.start_utc, endDate: ev.end_utc || ev.start_utc,
      ...(ev.status === 'canceled' ? { eventStatus: 'https://schema.org/EventCancelled' } : ev.status === 'completed' || Date.parse(ev.end_utc || ev.start_utc) <= ctx.now ? {} : { eventStatus: 'https://schema.org/EventScheduled' }),
      sport: 'Formula One',
      location: { '@type': 'Place', name: circuitText(ctx, ev.circuit_id), address: [c?.locality, countryJa(c?.country)].filter(Boolean).join(', '), ...(c?.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: c.lat, longitude: c.lon } } : {}) },
      url: SITE + jaPath(`/races/${ev.slug}`) },
    breadcrumbLd(bc),
  ];
  const desc = w
    ? `F1 ${name}の結果。優勝は${driverText(ctx, w.driver_id)}（${teamText(ctx, w.constructor_id)}）。決勝・予選・スプリント・フリー走行の全結果と選手権への影響を日本語で。`
    : `F1 ${name}（${circuitText(ctx, ev.circuit_id)}）のセッションスケジュール（日本時間）と最近の優勝者、各セッションの結果。`;
  return page({ enPath: `/races/${ev.slug}`, title: T(`${name} ${w ? '結果' : 'スケジュール'}`), description: clipText(desc, 120, 'ja'), body, jsonLd, ogType: 'article' });
}

// ============================================================================================== drivers
export function jaDriversIndex(ctx) {
  const season = ctx.currentSeason;
  const grid = ctx.currentGrid.map((g) => {
    const d = ctx.driverById[g.driver_id];
    const st = (ctx.standingsBy[`${season}|driver`] || []).find((s) => s.subject_id === g.driver_id);
    const color = ctx.colorOf(g.constructor_id, season);
    const num = (ctx.dcsByDriver[g.driver_id] || []).find((x) => x.season === season)?.car_numbers?.[0];
    return { st, html: `<a class="card card-link dcard ${teamClass(color)}" href="${jaHref(`/drivers/${d.slug}`)}">${headshot(d, 'md', ctx.mediaOk, color)}<div><span class="nm">${driverName(ctx, d.id)}<small>${flag(d)} ${teamName(ctx, g.constructor_id)}${num ? ' · #' + esc(num) : ''}</small></span><span class="stat">${st ? `${st.position}位 · ${fmtPts(st.points)}ポイント · ${st.wins ?? 0}勝` : ''}</span></div></a>` };
  }).sort((x, y) => (x.st?.position ?? 99) - (y.st?.position ?? 99)).map((x) => x.html).join('');
  const all = [...ctx.drivers].filter((d) => ctx.careers[d.id]?.entries).sort((x, y) => (x.last_name || x.full_name).localeCompare(y.last_name || y.full_name));
  const list = all.map((d) => `<a href="${jaHref(`/drivers/${d.slug}`)}" data-name="${esc(`${(d.full_name || '').toLowerCase()} ${NAME_JA[d.id] || ''}`)}">${NAME_JA[d.id] ? esc(NAME_JA[d.id]) : latin(d.full_name)}<span>${ctx.careers[d.id].first_season}–${ctx.careers[d.id].last_season}</span></a>`).join('');
  const bc = [HOME, ['/ja/drivers', 'ドライバー']];
  const body = `${crumbsJa(bc)}
  <section class="hero"><div class="wrap"><span class="eyebrow">${season}年のグリッド</span><h1>ドライバー</h1><p class="sub">${season}年のグリッドに並ぶ${ctx.currentGrid.length}人と、${ctx.coverage.earliest_season}年以降の世界選手権ドライバー${all.length.toLocaleString('ja-JP')}人の記録です。</p></div></section>
  <section class="section"><div class="wrap"><div class="grid g3">${grid}</div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>歴代ドライバー一覧</h2><input class="search" type="search" placeholder="ドライバー名で絞り込み" aria-label="ドライバー名で絞り込み" data-filter=".alpha a"></div><div class="alpha">${list}</div></div></section>`;
  return page({
    enPath: '/drivers',
    title: T(`F1ドライバー ${season}年: グリッド・プロフィール・通算成績`),
    description: clipText(`F1（フォーミュラ1）${season}年の全ドライバーと、${ctx.coverage.earliest_season}年以降の世界選手権ドライバー${all.length.toLocaleString('ja-JP')}人の通算成績と全リザルト。ドライバーDNAとチームメイト分析は All Access の Race Lab で。`, 120, 'ja'),
    body,
    jsonLd: [breadcrumbLd(bc)],
  });
}

export function jaDriverPage(ctx, d) {
  const car = ctx.careers[d.id];
  const lt = ctx.latestTeam[d.id];
  const color = ctx.colorOf(lt?.constructor_id, lt?.season);
  const onGrid = ctx.currentGrid.some((g) => g.driver_id === d.id);
  const bySeason = {};
  for (const x of ctx.driverLog[d.id] || []) (bySeason[x.season] ||= []).push(x);
  const seasons = Object.values(bySeason).map((rows) => {
    const y = rows[0].season;
    const st = (ctx.standingsBy[`${y}|driver`] || []).find((s) => s.subject_id === d.id);
    const teams = [...new Set(rows.map((r) => r.constructor_id))];
    const cls = rows.filter((r) => r.classified);
    return `<tr><td>${a(y === ctx.currentSeason ? '/standings' : `/standings/${y}`, String(y))}</td><td class="list">${teams.map((t) => teamLinkJa(ctx, t)).join('、')}</td><td class="num">${rows.filter((r) => r.started).length}</td><td class="num">${cls.filter((r) => r.finish === 1).length}</td><td class="num">${cls.filter((r) => r.finish <= 3).length}</td><td class="num">${rows.filter((r) => r.pole).length}</td><td class="num">${fmtPts(st?.points ?? rows.reduce((s, r) => s + r.points, 0))}</td><td class="num">${st ? nth(st.position) : '—'}</td></tr>`;
  }).reverse().join('');
  const STATUS = { retired: 'リタイア', disqualified: '失格', did_not_start: '出走せず', not_classified: '完走扱いなし', did_not_qualify: '予選不通過', withdrawn: '出走取り消し', did_not_appear: '出走取り消し', not_prequalified: '予備予選不通過' };
  const recentRows = (ctx.driverLog[d.id] || []).slice(-12).reverse().map((x) => {
    const ev = ctx.eventById[x.event_id];
    return `<tr><td>${ev.season}</td><td>${a(`/races/${ev.slug}`, gpName(ev))}</td><td>${teamLinkJa(ctx, x.constructor_id, ev.season)}</td><td class="num">${x.quali_pos ?? '—'}</td><td class="num">${x.grid || '—'}</td><td class="num">${x.classified ? x.finish : `<span class="st-ret">${esc(STATUS[x.status] || x.status || '—')}</span>`}</td><td class="num">${x.points ? fmtPts(x.points) : ''}</td></tr>`;
  }).join('');
  const num = (ctx.dcsByDriver[d.id] || []).sort((x, y) => y.season - x.season)[0]?.car_numbers?.[0];
  const thin = (car?.entries || 0) < 3;
  const age = (dob) => { const b = new Date(dob), n = new Date(ctx.now); let y = n.getUTCFullYear() - b.getUTCFullYear(); if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) y--; return y; };
  const bc = [HOME, ['/ja/drivers', 'ドライバー'], [jaPath(`/drivers/${d.slug}`), driverShort(ctx, d.id)]];
  const hasMates = (ctx.teammatesByDriver[d.id] || []).length;
  const body = `${crumbsJa(bc)}
  <section class="hero ${teamClass(color)}"><div class="wrap hero-person">${headshot(d, 'lg', ctx.mediaOk, color)}<div class="hero-id">
    <span class="eyebrow">${onGrid ? `${ctx.currentSeason}年 · ${teamName(ctx, lt.constructor_id)}` : `F1ドライバー · ${seasonSpan(car?.first_season ?? '', car?.last_season ?? '')}`}</span>
    <h1>${NAME_JA[d.id] ? `${esc(NAME_JA[d.id])}<span class="jp-latin" translate="no">${esc(d.full_name)}</span>` : latin(d.full_name)}</h1>
    <div class="hero-meta">${d.nationality ? `<span><b>国籍</b>${flag(d)} ${esc(countryJa(d.nationality))}</span>` : ''}${d.date_of_birth ? `<span><b>生年月日</b>${esc(civilDate(d.date_of_birth))}${onGrid ? `（${age(d.date_of_birth)}歳）` : ''}</span>` : ''}${d.code ? `<span><b>略称</b><span translate="no">${esc(d.code)}</span></span>` : ''}${num ? `<span><b>カーナンバー</b>${esc(num)}</span>` : ''}${lt ? `<span><b>${onGrid ? '所属チーム' : '最後の所属チーム'}</b>${teamLinkJa(ctx, lt.constructor_id)}</span>` : ''}</div>
    <div class="team-stripe"></div></div></div></section>
  <section class="section"><div class="wrap"><div class="stats">
    <div class="stat-box"><span>出走</span><b>${car?.starts ?? 0}</b></div><div class="stat-box"><span>優勝</span><b>${car?.wins ?? 0}</b></div><div class="stat-box"><span>表彰台</span><b>${car?.podiums ?? 0}</b></div><div class="stat-box"><span>ポールポジション</span><b>${car?.poles ?? 0}</b></div><div class="stat-box"><span>ポイント</span><b>${fmtPts(car?.points ?? 0)}</b></div><div class="stat-box"><span>ドライバーズタイトル</span><b>${car?.championships.length ?? 0}</b>${car?.championships.length ? `<span>${car.championships.join('、')}</span>` : ''}</div>
  </div><p class="fine">通算成績は発表されたレースのリザルト（${ctx.coverage.earliest_season}–${ctx.currentSeason}年）から集計しています。ポールポジションは予選結果が発表されている場合は予選1位、それ以外はグリッド1番手です。ポイントはレースとスプリントで獲得したポイントの合計で、有効得点制だった1990年以前のシーズンは公式の選手権ポイントと異なる場合があります。</p></div></section>
  ${ctx.dnaCur[d.id] || ctx.dnaCareer[d.id] || hasMates ? premiumGateJa(`${driverText(ctx, d.id)}の詳細分析`, 'All Access の Race Lab では、ドライバーDNAの全項目とパーセンタイルのサンプル、チームメイトとの詳細な直接対決を確認できます。通算成績とレース結果は無料で公開しています。') : ''}
  ${recentRows ? `<section class="section"><div class="wrap"><div class="section-head"><h2>最近のレース</h2></div><div class="table-wrap"><table><thead><tr><th>シーズン</th><th>グランプリ</th><th>チーム</th><th class="num">予選</th><th class="num">グリッド</th><th class="num">決勝</th><th class="num">ポイント</th></tr></thead><tbody>${recentRows}</tbody></table></div></div></section>` : ''}
  ${seasons ? `<section class="section"><div class="wrap"><div class="section-head"><h2>シーズン別成績</h2></div><div class="table-wrap"><table><thead><tr><th>年</th><th>チーム</th><th class="num">出走</th><th class="num">優勝</th><th class="num">表彰台</th><th class="num">PP</th><th class="num">ポイント</th><th class="num">順位</th></tr></thead><tbody>${seasons}</tbody></table></div></div></section>` : ''}`;
  const name = driverText(ctx, d.id);
  const jsonLd = [
    { '@context': 'https://schema.org', '@type': 'Person', name: d.full_name, ...(NAME_JA[d.id] ? { alternateName: NAME_JA[d.id] } : {}), ...(d.date_of_birth ? { birthDate: d.date_of_birth } : {}), ...(d.nationality ? { nationality: countryJa(d.nationality) } : {}), jobTitle: 'F1ドライバー', url: SITE + jaPath(`/drivers/${d.slug}`), ...(lt ? { memberOf: { '@type': 'SportsTeam', name: ctx.conById[lt.constructor_id]?.name } } : {}) },
    breadcrumbLd(bc),
  ];
  const desc = `${name}のF1プロフィール: 出走${car?.starts ?? 0}回、優勝${car?.wins ?? 0}回、表彰台${car?.podiums ?? 0}回、ポールポジション${car?.poles ?? 0}回${car?.championships.length ? `、ドライバーズタイトル${car.championships.length}回` : ''}。通算成績と全リザルトを日本語で。`;
  return page({ enPath: `/drivers/${d.slug}`, title: T(`${name} – F1通算成績・リザルト`), description: clipText(desc, 120, 'ja'), body, jsonLd, noindex: thin, ogType: 'profile' });
}

// ============================================================================================== teams
function teamCardJa(ctx, cid, season) {
  const color = ctx.colorOf(cid, season);
  const st = (ctx.standingsBy[`${season}|constructor`] || []).find((s) => s.subject_id === cid);
  const ds = ctx.currentGrid.filter((g) => g.constructor_id === cid);
  return `<a class="card card-link dcard ${teamClass(color)}" href="${jaHref(`/teams/${cid}`)}"><span class="bignum">${st ? st.position : '–'}</span><div><span class="nm">${season === ctx.currentSeason ? teamMark(ctx.logoFor?.(cid), 18) : ''}${teamName(ctx, cid)}<small>${st ? fmtPts(st.points) + 'ポイント' : ''}</small></span><span class="stat">${ds.map((g) => driverLast(ctx, g.driver_id)).join(' · ')}</span></div></a>`;
}

export function jaTeamsIndex(ctx, order) {
  const season = ctx.currentSeason;
  const all = [...ctx.constructors].sort((x, y) => y.last_season - x.last_season || x.name.localeCompare(y.name));
  const bc = [HOME, ['/ja/teams', 'チーム']];
  const body = `${crumbsJa(bc)}
  <section class="hero"><div class="wrap"><span class="eyebrow">${season}年のコンストラクター</span><h1>チーム</h1><p class="sub">${season}年に参戦する${ctx.currentTeams.length}チームと、${ctx.coverage.earliest_season}年以降に記録のある${all.length}のコンストラクター。チームの系譜とシーズンごとの成績を掲載しています。</p></div></section>
  <section class="section"><div class="wrap"><div class="grid g4">${order.map((cid) => teamCardJa(ctx, cid, season)).join('')}</div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>全コンストラクター</h2><input class="search" type="search" placeholder="チーム名で絞り込み" aria-label="チーム名で絞り込み" data-filter=".alpha a"></div><div class="alpha">${all.map((c) => `<a href="${jaHref(`/teams/${c.id}`)}" data-name="${esc(`${c.name.toLowerCase()} ${teamText(ctx, c.id)}`)}">${teamName(ctx, c.id)}<span>${c.first_season}–${c.last_season}</span></a>`).join('')}</div></div></section>`;
  return page({
    enPath: '/teams',
    title: T(`F1チーム ${season}年: コンストラクター・系譜・成績`),
    description: clipText(`F1（フォーミュラ1）${season}年の全${ctx.currentTeams.length}チームと歴代コンストラクター。系譜、ドライバー、選手権順位、シーズンごとの成績を日本語で。`, 120, 'ja'),
    body,
    jsonLd: [breadcrumbLd(bc)],
  });
}

export function jaTeamPage(ctx, c, lineageChain) {
  const season = ctx.currentSeason;
  const color = ctx.colorOf(c.id, c.last_season);
  const chain = (lineageChain(c.lineage_id) || [c.id]).filter((id) => ctx.conById[id]);
  const bySeason = {};
  for (const x of ctx.dcsByCon[c.id] || []) (bySeason[x.season] ||= []).push(x);
  const seasonRows = Object.keys(bySeason).map(Number).sort((x, y) => y - x).map((y) => {
    const st = (ctx.standingsBy[`${y}|constructor`] || []).find((s) => s.subject_id === c.id);
    const ds = bySeason[y].sort((x, z) => z.race_starts - x.race_starts).filter((x) => x.race_starts > 0);
    return `<tr><td>${a(y === season ? '/standings' : `/standings/${y}`, String(y))}</td><td class="list">${ds.map((x) => a(`/drivers/${ctx.driverById[x.driver_id]?.slug}`, driverLast(ctx, x.driver_id))).join('、')}</td><td class="num">${st ? nth(st.position) : '—'}</td><td class="num">${st ? fmtPts(st.points) : '—'}</td><td class="num">${st?.wins ?? '—'}</td></tr>`;
  }).join('');
  const titles = ctx.standings.filter((s) => s.kind === 'constructor' && s.subject_id === c.id && s.position === 1 && s.season < season).map((s) => s.season);
  const raceRows = ctx.results.filter((r) => r.session_type === 'race' && r.constructor_id === c.id);
  const wins = raceRows.filter((r) => r.status === 'classified' && r.position === 1).length;
  const podiums = raceRows.filter((r) => r.status === 'classified' && r.position <= 3).length;
  const races = new Set(raceRows.map((r) => r.event_id)).size;
  const current = c.last_season === season;
  const lineup = current ? ctx.currentGrid.filter((g) => g.constructor_id === c.id) : [];
  const photo = current ? ctx.carPhotoFor?.(c.id, season) : null;
  const machine = current ? ctx.machineFor?.(c.id, season) : null;
  const car = photo ? `<figure class="team-car"><div class="car-id">${teamMark(ctx.logoFor?.(c.id), 22, 'car-mark')}<span>${season}年のマシン</span>${machine?.carModel ? `<b translate="no">${esc(machine.carModel.value)}</b>` : ''}</div><div class="car-stage"><picture><source type="image/avif" srcset="${[640, 960, 1280, 1920].map((w) => `/media/cars/${photo.id}-${w}.avif ${w}w`).join(', ')}" sizes="(min-width:1024px) 46vw, 100vw"><img src="/media/cars/${photo.id}-1280.webp" srcset="${[640, 960, 1280, 1920].map((w) => `/media/cars/${photo.id}-${w}.webp ${w}w`).join(', ')}" sizes="(min-width:1024px) 46vw, 100vw" width="1280" height="${Math.round((1280 * photo.derivatives.aspect[1]) / photo.derivatives.aspect[0])}" alt="${esc(`${season}年 ${teamText(ctx, c.id)}${photo.carModel ? ` ${photo.carModel}` : ''}`)}" fetchpriority="high" decoding="async"></picture></div><figcaption><a href="${esc(photo.sourceUrl)}" rel="noopener">写真: ${esc(photo.photographer)}</a>、<a href="${esc(photo.licenseUrl)}" rel="noopener license">${esc(photo.license)}</a> · 背景を除去${photo.approvedForPublicUse ? '' : ' · プレビュー候補'}</figcaption></figure>` : '';
  const lineageTl = chain.length > 1
    ? `<ol class="lin-tl">${chain.map((id) => { const m = ctx.conById[id]; return `<li${id === c.id ? ' class="cur" aria-current="page"' : ''}><span class="lin-yrs">${m.first_season}–${m.last_season === season ? '現在' : m.last_season}</span>${id === c.id ? `<b>${teamName(ctx, id)}</b>` : a(`/teams/${id}`, teamName(ctx, id))}</li>`; }).join('')}</ol>`
    : '';
  const bc = [HOME, ['/ja/teams', 'チーム'], [jaPath(`/teams/${c.id}`), teamName(ctx, c.id)]];
  const dna = ctx.conDna[c.last_season]?.[c.id];
  const body = `${crumbsJa(bc)}
  <section class="hero ${teamClass(color)}${car ? ' has-car' : ''}"><div class="wrap"><span class="eyebrow">${c.first_season}–${current ? '現在' : `${c.last_season}年`}</span><h1 class="team-h1">${current ? teamMark(ctx.logoFor?.(c.id), 52, 'hero-mark') : ''}<span>${teamName(ctx, c.id)}${teamText(ctx, c.id) !== c.name ? `<span class="jp-latin" translate="no">${esc(c.name)}</span>` : ''}</span></h1>
  <div class="hero-meta">${c.source_names?.length ? `<span><b>データ上の表記</b>${latin(c.source_names.join(', '))}</span>` : ''}${titles.length ? `<span><b>コンストラクターズタイトル</b>${titles.length}回（${titles.join('、')}）</span>` : ''}${lineup.length ? `<span><b>${season}年のドライバー</b>${lineup.map((g) => a(`/drivers/${ctx.driverById[g.driver_id]?.slug}`, driverShort(ctx, g.driver_id))).join('、')}</span>` : ''}</div><div class="team-stripe"></div>${car}
  </div></section>
  <section class="section"><div class="wrap"><div class="stats"><div class="stat-box"><span>グランプリ出走</span><b>${races}</b></div><div class="stat-box"><span>優勝</span><b>${wins}</b></div><div class="stat-box"><span>表彰台</span><b>${podiums}</b></div><div class="stat-box"><span>タイトル</span><b>${titles.length}</b></div></div></div></section>
  ${lineageTl ? `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">チームの系譜</span><h2>チームの歩み</h2></div></div>${lineageTl}<p class="fine">系譜は、名称変更を経た同じエントラントを PropBetEdge が編集上まとめたものです。各名称の記録はそれぞれ別に集計しています。</p></div></section>` : ''}
  ${dna ? premiumGateJa(`${teamText(ctx, c.id)}の詳細分析`, 'All Access の Race Lab では、コンストラクターDNA、現在のチームメイト対決、チームの詳細な分析を確認できます。チームの歴史とシーズン成績は無料で公開しています。') : ''}
  ${seasonRows ? `<section class="section"><div class="wrap"><div class="section-head"><h2>シーズン別成績</h2></div><div class="table-wrap"><table><thead><tr><th>シーズン</th><th>ドライバー</th><th class="num">順位</th><th class="num">ポイント</th><th class="num">優勝</th></tr></thead><tbody>${seasonRows}</tbody></table></div></div></section>` : ''}`;
  const name = teamText(ctx, c.id);
  return page({
    enPath: `/teams/${c.id}`,
    title: T(`${name} F1チーム – 成績・ドライバー・系譜`),
    description: clipText(`F1チーム${name}（${seasonSpan(c.first_season, c.last_season)}）: グランプリ出走${races}回、優勝${wins}回、表彰台${podiums}回。シーズンごとのドライバーと成績、チームの系譜を日本語で。`, 120, 'ja'),
    body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'SportsTeam', name: c.name, ...(name !== c.name ? { alternateName: name } : {}), sport: 'Formula One', url: SITE + jaPath(`/teams/${c.id}`) }, breadcrumbLd(bc)],
    noindex: races < 2,
  });
}

// ============================================================================================== circuits
export function jaCircuitsIndex(ctx) {
  const season = ctx.currentSeason;
  const curIds = new Set((ctx.eventsBySeason[season] || []).filter((e) => e.status !== 'canceled').map((e) => e.circuit_id));
  const cur = ctx.circuits.filter((c) => curIds.has(c.id));
  const rest = ctx.circuits.filter((c) => !curIds.has(c.id)).sort((x, y) => (ctx.circuitDna[y.id]?.races_held || 0) - (ctx.circuitDna[x.id]?.races_held || 0));
  const card = (c) => {
    const dna = ctx.circuitDna[c.id];
    const facts = [c.length_km ? `${c.length_km.toFixed(3)} km` : '', c.turns ? `コーナー${c.turns}` : '', dna?.races_held ? `GP開催${dna.races_held}回` : '', layoutJa(c.layout_type) || ''].filter(Boolean).join(' · ');
    return `<a class="card card-link" href="${jaHref(`/circuits/${c.slug}`)}"><span class="kicker">${locJa(c)}</span><h3>${circuitLabel(ctx, c.id)}</h3><p class="fine">${facts}</p></a>`;
  };
  const bc = [HOME, ['/ja/circuits', 'サーキット']];
  const body = `${crumbsJa(bc)}
  <section class="hero"><div class="wrap"><span class="eyebrow">サーキット</span><h1>サーキット</h1><p class="sub">${season}年のカレンダーに含まれる${cur.length}会場と、${ctx.coverage.earliest_season}年以降に世界選手権が開催された${ctx.circuits.length}のサーキット。</p></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>${season}年の開催サーキット</h2></div><div class="grid g3">${cur.map(card).join('')}</div></div></section>
  <section class="section"><div class="wrap"><div class="section-head"><h2>過去のサーキット</h2></div><div class="grid g4">${rest.map(card).join('')}</div></div></section>`;
  return page({
    enPath: '/circuits',
    title: T(`F1サーキット: ${season}年の開催地と歴代サーキット`),
    description: clipText('F1（フォーミュラ1）の全サーキット。コースの全長、コーナー数、レース周回数、歴代の優勝者を日本語で。', 120, 'ja'),
    body,
    jsonLd: [breadcrumbLd(bc)],
  });
}

export function jaCircuitPage(ctx, c) {
  const dna = ctx.circuitDna[c.id];
  const evs = [...(ctx.eventsByCircuit[c.id] || [])].sort((x, y) => y.start_utc.localeCompare(x.start_utc));
  const next = evs.find((e) => e.season === ctx.currentSeason && e.status !== 'completed' && e.status !== 'canceled');
  const winRows = evs.filter((e) => e.status === 'completed').slice(0, 25).map((e) => {
    const w = winnerOf(ctx, e.id);
    const p = poleOf(ctx, e.id);
    return `<tr><td>${e.season}</td><td>${a(`/races/${e.slug}`, gpName(e))}</td><td>${w ? driverCellJa(ctx, w.driver_id, w.constructor_id, e.season) : '—'}</td><td>${w ? teamLinkJa(ctx, w.constructor_id) : ''}</td><td>${p ? driverLast(ctx, p.driver_id) : '—'}</td></tr>`;
  }).join('');
  const name = circuitText(ctx, c.id);
  const bc = [HOME, ['/ja/circuits', 'サーキット'], [jaPath(`/circuits/${c.slug}`), circuitLabel(ctx, c.id)]];
  const loc = locJa(c);
  const body = `${crumbsJa(bc)}
  <section class="hero"><div class="wrap"><span class="eyebrow">${loc}</span><h1>${circuitLabel(ctx, c.id)}${CIRCUIT_JA[c.slug] ? `<span class="jp-latin" translate="no">${esc(ctx.circuitName(c.id))}</span>` : ''}</h1>
  <div class="hero-meta">${c.length_km ? `<span><b>最新レイアウト</b>${c.length_km.toFixed(3)} km${c.turns ? `、コーナー${c.turns}` : ''}</span>` : ''}${dna?.race_laps ? `<span><b>決勝周回数</b>${dna.race_laps}周</span>` : ''}${dna?.race_distance_km ? `<span><b>レース距離</b>${dna.race_distance_km} km</span>` : ''}${layoutJa(c.layout_type) ? `<span><b>コース種別</b>${layoutJa(c.layout_type)}</span>` : ''}${c.lat != null ? `<span><b>座標</b>${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}</span>` : ''}${c.opened ? `<span><b>開業</b>${c.opened}年</span>` : ''}${dna?.races_held ? `<span><b>グランプリ開催</b>${dna.races_held}回（${seasonSpan(dna.first_season, dna.last_season)}）</span>` : ''}</div>
  ${next ? `<p class="section">${a(`/races/${next.slug}`, `${next.season}年 ${gpName(next)}のページ`, ' class="more"')}</p>` : ''}
  <p class="fine">全長とコーナー数は最新のレイアウトのもので、過去のレイアウトには適用していません。</p></div></section>
  ${dna ? premiumGateJa(`${name}の詳細分析`, 'All Access の Race Lab では、サーキットの完全なプロフィール（ポールポジションの勝率、グリッドと決勝順位の関係、リタイア率、ピットストップ数）と次戦のサーキット適性を確認できます。コースの基本データと優勝者は無料で公開しています。') : ''}
  ${winRows ? `<section class="section"><div class="wrap"><div class="section-head"><h2>歴代の優勝者</h2></div><div class="table-wrap"><table><thead><tr><th>シーズン</th><th>グランプリ</th><th>優勝</th><th>チーム</th><th>ポールポジション</th></tr></thead><tbody>${winRows}</tbody></table></div></div></section>` : ''}`;
  return page({
    enPath: `/circuits/${c.slug}`,
    title: T(`${name} – F1サーキットの基本データと歴代優勝者`),
    description: clipText(`${name}（${[c.locality, countryJa(c.country)].filter(Boolean).join('、')}）: ${c.length_km ? `全長${c.length_km.toFixed(3)} km、` : ''}${c.turns ? `コーナー${c.turns}、` : ''}コースの基本データ、歴代の優勝者、F1の開催の歴史を日本語で。`, 120, 'ja'),
    body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'SportsActivityLocation', name: ctx.circuitName(c.id), ...(CIRCUIT_JA[c.slug] ? { alternateName: CIRCUIT_JA[c.slug] } : {}), address: [c.locality, countryJa(c.country)].filter(Boolean).join(', '), ...(c.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: c.lat, longitude: c.lon } } : {}), url: SITE + jaPath(`/circuits/${c.slug}`) }, breadcrumbLd(bc)],
    noindex: (dna?.races_held || 0) < 1,
  });
}

// ============================================================================================== methodology + coverage
export function jaMethodology(ctx) {
  const r = ctx.dnaReport;
  const bc = [HOME, ['/ja/methodology', '分析手法とデータ出典']];
  const body = `${crumbsJa(bc)}<section class="section"><div class="wrap prose">
  <span class="eyebrow">分析手法 · <span translate="no">${esc(r.version)}</span></span><h1>PropBetEdge F1 の仕組み</h1>
  <p>出典のある事実と、そこから算出した分析は分けて管理しています。正規化したテーブルには、データ提供元が公開した情報だけを保存し、各レコードに出典（<code>source</code>、<code>source_id</code>、<code>source_url</code>、<code>source_updated_at</code>、<code>ingested_at</code>）を記録しています。DNA、サーキット適性、マッチアップ、順位の推移はこれらのテーブルから算出し、別にバージョン管理しています。</p>
  <h2>データ</h2>
  <p>レース結果、セッション、選手権順位、ドライバー、サーキットのデータはすべて <a href="https://propsports.proptechusa.ai" rel="noopener">PropSports</a> から取得しています。各レコードは出典を保持したまま、解析前にアーカイブしています。有料のタイミングデータは使用していません。</p>
  <h2>収録していないデータ</h2>
  <p>データフィードには、周回ごとのタイム、セクタータイム、タイヤコンパウンド、スティント、ピットストップの所要時間、車両の位置、テレメトリー、レースコントロールのメッセージ、過去の天候は含まれていません。これらを必要とする機能は推定せず「出典なし」として扱います。PBEcast が車両の位置をシミュレーションすることはありません。</p>
  <h2 id="driver-dna">ドライバーDNA</h2>
  <p>集計期間は「現在」（<span translate="no">${esc(Object.values(ctx.dnaCur)[0]?.window || '')}</span>）と「キャリア」の2種類です。各項目について、同じ期間で最低サンプル数を満たすドライバーの中でのパーセンタイル、サンプル数、信頼度（8未満は低、8〜19は中、20以上は高）、元の指標を示します。</p>
  <ul>
  <li><b>予選ペース</b> — 両者がタイムを記録した最も後のノックアウトセッションでの、チームメイトとの予選タイム差（%）の中央値。5%を超える差は代表的でないため除外します。タイムがない場合は予選の直接対決で代替します。</li>
  <li><b>決勝でのチームメイト比較</b> — チームメイトより前でフィニッシュしたレースの割合（片方だけがリタイアした場合は完走した側の勝ちとします）。</li>
  <li><b>順位アップ</b> — そのグリッド位置での過去の期待値を上回った、グリッドからフィニッシュまでの順位の上げ幅。</li>
  <li><b>完走</b> — 完走率からチームメイトの完走率を引いた値（同じマシン同士の比較）。</li>
  <li><b>安定性</b> — チームメイトとの予選タイム差のばらつき。</li>
  <li><b>チーム内得点シェア</b> — 得点した週末における、チームの得点に占める割合。</li>
  <li><b>市街地・高速・低速</b> — それぞれのサーキット区分でのチームメイトとの予選タイム差を、そのドライバーの全体の差と比べた値。速度区分はポールラップの平均速度（コース全長 ÷ 予選最速ラップ）の三分位で、コーナーのテレメトリーではありません。</li></ul>
  <h2 id="constructor-dna">コンストラクターDNA</h2>
  <p>シーズンごとに、予選スピード（セッション最速に対するチームのベストラップ）、レース結果（週末あたりのポイント）、完走の信頼性、レースでの順位アップ、高速・低速・市街地での相対的なペース、ドライバー間のバランスを算出します。ドライバーの影響（チーム内の差）とマシンの影響（チームのベストとフィールドの差）は別に示します。</p>
  <h2 id="circuit-dna">サーキットDNA</h2>
  <p>各サーキットの直近10シーズンから、トラックポジションの重要度（グリッドと決勝順位の順位相関、ポール・トゥ・ウィンの割合）、順位の変動、ポールラップの速度、リタイア率、1台あたりのピットストップ回数（2014年以降）を算出します。ブレーキング、タイヤへの負荷、DRS、セーフティカー、天候の変動は出典がないため扱いません。</p>
  <h2>サーキット適性</h2>
  <p>ドライバーDNAとコンストラクターDNAの関連するパーセンタイルの加重平均で、重みはサーキットの特徴で決まります（たとえばトラックポジションが重要なサーキットでは予選の比重を上げます）。記述的な指標であり、予測や確率、ベッティングのシグナルではありません。</p>
  <h2>ポイント</h2>
  <p>レースごとのポイントは週末の合計（スプリントを含む）として公開されています。1991年より前のシーズンは有効得点制だったため、レースごとの合計が公式の合計と異なる場合があります。常に公式の選手権順位を正とし、合計が一致しないシーズンでは順位推移のグラフを表示しません。</p>
  <h2>エンティティの識別</h2>
  <p>各マシンにはチーム名が付いていますが、過去のエントリーには後年の名称が付けられている場合があります（たとえば2006〜2019年のトロロッソに「AlphaTauri」、2002〜2010年のルノーに「Alpine」）。そのため、どのエンティティかはシーズンで判断します。チーム名がまったくない場合（2024〜2025年のキック・ザウバーの全エントリー）は、そのシーズンの公式順位表に載っているコンストラクターのうち、そのセッションでマシンにラベルがない唯一のコンストラクターに割り当て、推定である旨を記録しています。</p>
  <p>サーキットはレースの開催ごとに紐づけているため、過去のグランプリは実際にその年に使われたサーキットにリンクしています。全長とコーナー数は最新のレイアウトのもので、過去のレイアウトには適用していません。</p>
  <p>ドライバーは固定IDで識別し、名前で統合することはありません。コンストラクターは名前<b>と</b>シーズンの範囲で区別し（たとえば1958〜1994年のチーム・ロータス、2010〜2011年のロータス・レーシング、2012〜2015年のロータスF1はそれぞれ別のエンティティです）、ナビゲーションのためだけに系譜としてまとめています。</p>
  <p class="fine">英語版のこのページには、英語版のレースページと PBEcast に掲載している予測市場の価格についての説明も含まれています。日本語版のページには予測市場やベッティングに関する機能を掲載していないため、その説明は省略しています。</p>
  </div></section>`;
  return page({ enPath: '/methodology', title: T('分析手法とデータ出典'), description: clipText('PropBetEdge F1 のデータの取得と正規化、ドライバーDNA、コンストラクターDNA、サーキットDNA、サーキット適性の算出方法、出典と制約を日本語で説明します。', 120, 'ja'), body, jsonLd: [breadcrumbLd(bc)] });
}

export function jaCoverage(ctx) {
  const c = ctx.coverage;
  const r = ctx.dnaReport;
  const rows = [
    ['シーズン', `${c.seasons}（${c.earliest_season}–${c.latest_season}年）`],
    ['イベント', `${c.events}（うち終了 ${c.events_completed}）`],
    ['セッション', c.sessions],
    ['リザルト（順位記録）', c.classifications],
    ['ドライバー', c.drivers],
    ['コンストラクター', c.constructors],
    ['サーキット（正規化後）', ctx.circuits.length],
    ['フリー走行・予選のセッション', `${c.first_season_with_sessions}年以降`],
    ['Q1/Q2/Q3のタイム', `${c.first_season_with_q123}年以降`],
    ['ピットストップ回数', `${c.first_season_with_pit_counts}年以降`],
    ['周回ごとのデータ', '収録なし（ライセンスを受けた出典がないため）'],
    ['テレメトリー', '収録なし'],
    ['ドライバーDNA（現在）', `${r.driver_dna_current_qualifying}人、平均 ${r.driver_dna_current_avg_populated} / ${r.driver_dna_dimensions_defined} 項目`],
    ['ドライバーDNA（キャリア）', `${r.driver_dna_career_qualifying}人、平均 ${r.driver_dna_career_avg_populated} 項目`],
    ['コンストラクターDNA', `${r.constructor_dna_seasons}シーズン、現在のチーム ${r.constructor_dna_current_teams}`],
    ['サーキットDNA', `${r.circuit_dna_circuits}サーキット中 ${r.circuit_dna_with_recent_profile} をプロファイル`],
    ['サーキット適性', `${r.circuit_fit_events}イベント、ドライバー ${r.circuit_fit_driver_rows} 行`],
    ['チームメイトの組み合わせ', r.teammate_pairs],
  ];
  const bc = [HOME, ['/ja/data-coverage', 'データ収録範囲']];
  const body = `${crumbsJa(bc)}<section class="section"><div class="wrap prose"><span class="eyebrow">生成日時 ${esc(jst.dateTime(c.generated_at))}</span><h1>データ収録範囲</h1><div class="table-wrap"><table><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(String(v))}</td></tr>`).join('')}</tbody></table></div>
  ${c.unresolved_constructor_names?.length ? `<p class="fine">系譜の編集がなく、データ上の名称で識別しているコンストラクター: ${c.unresolved_constructor_names.length}</p>` : ''}</div></section>`;
  return page({ enPath: '/data-coverage', title: T('データ収録範囲'), description: clipText('PropBetEdge F1 のデータ収録範囲: シーズン、イベント、セッション、リザルト、DNAの対象と、収録していないデータ。', 120, 'ja'), body, jsonLd: [breadcrumbLd(bc)] });
}

/** Every Japanese page of this build, in emit order. */
export function jaPages(ctx, { lineageChain, teamOrder }) {
  const out = [jaHome(ctx), jaStandings(ctx)];
  const seasons = Object.keys(ctx.eventsBySeason).map(Number);
  for (const y of seasons) if (y !== ctx.currentSeason && ctx.standingsBy[`${y}|driver`]) out.push(jaStandings(ctx, y));
  out.push(jaRacesIndex(ctx, ctx.currentSeason));
  for (const y of seasons) if (y !== ctx.currentSeason) out.push(jaRacesIndex(ctx, y));
  for (const ev of ctx.events) out.push(jaRacePage(ctx, ev));
  out.push(jaDriversIndex(ctx));
  for (const d of ctx.drivers) if (ctx.careers[d.id]?.entries) out.push(jaDriverPage(ctx, d));
  out.push(jaTeamsIndex(ctx, teamOrder));
  for (const c of ctx.constructors) out.push(jaTeamPage(ctx, c, lineageChain));
  out.push(jaCircuitsIndex(ctx));
  for (const c of ctx.circuits) out.push(jaCircuitPage(ctx, c));
  out.push(jaMethodology(ctx), jaCoverage(ctx));
  return out.filter(Boolean);
}
