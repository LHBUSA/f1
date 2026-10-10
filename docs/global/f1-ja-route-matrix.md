# F1 Japanese (ja-JP) route matrix

Issue: LHBUSA/f1#11 (program: LHBUSA/propbetedge-news-site#67). Adapter: `f1-ja/2.0.0` (`scripts/site/ja.mjs`,
renderers in `scripts/site/ja-pages.mjs`) on the shared contract `pbe-locale/1.0.0` (`src/vendor/pbe-locale`).

The build decides the Japanese route set first (`jaRouteSet`), renders every Japanese page, and fails if the two
disagree or if a Japanese page's robots differ from its English counterpart. Counts below are from the build of
2026-10-10 (data snapshot of that day); they move with the data, the rules do not.

## Rules applied to every Japanese page

- Static HTML from the build (no client-side translation, no runtime catalog), `<html lang="ja">`, self-canonical.
- Reciprocal `hreflang` en / ja / x-default (English) only when **both** pages are indexable. A noindex English page
  (thin driver, one-race team) has a noindex Japanese page and neither carries `hreflang`.
- Indexable Japanese pages are listed in `/sitemap-ja.xml` (with `xhtml:link` alternates), referenced from
  `robots.txt`. `/sitemap.xml` stays English-only.
- JSON-LD: a `WebPage` node with `inLanguage: "ja"` on every page, plus the page's own entity (SportsEvent with
  `inLanguage`, Person / SportsTeam / SportsActivityLocation with the Japanese rendering as `alternateName`) and a
  Japanese BreadcrumbList.
- Every internal link resolves through `jaHref()`: a Japanese page or no link. The only English links are the
  explicit language switch and the footer 英語版 link (`hreflang="en"`). Tested: no link leaves `/ja`, none is dead.
- Times are Japan Standard Time, rendered at build (`2026年10月11日(日) 21:00（日本時間）`); app.js never re-renders
  them. Birth dates are calendar dates (never shifted by a zone).
- Japan rules: no Kalshi / prediction-market / sportsbook / referral modules or links, no partner footer, no picks,
  no betting CTA. Membership CTA → `https://propbetedge.ai/ja/pro?via=f1` (月額 US$29, unchanged). 特定商取引法に基づく表記
  linked in every footer. No account/auth client, no soft-nav router on Japanese pages.
- Names: Latin source spelling (`translate="no"`) unless a standard Japanese rendering is certain (`NAME_JA`,
  `TEAM_JA`, `CIRCUIT_JA`, `GP_JA`); heroes show the Latin spelling under the Japanese one. Numbers are identical.
- Japanese-only CSS ships in its own hashed stylesheet (`src/web/ja.css` + vendored `pbe-locale.css`), linked only by
  the Japanese layout.

## Matrix

Status: **LIVE-READY** = built, tested, in this PR (ships when merged). **DEFERRED** = eligible later, English-only for
now (no Japanese page, no hreflang, no switch). **NOT ELIGIBLE** = deliberately not offered in Japanese.

| English route | Japanese route | Pages (ja) | Indexable (ja) | Status | Notes |
|---|---|---:|---:|---|---|
| `/` | `/ja` | 1 | 1 | LIVE-READY | Landing: next race (JST), standings top 10, latest podium, Japan module, explore links, All Access explanation |
| `/standings` | `/ja/standings` | 1 | 1 | LIVE-READY | Current drivers' + constructors' standings |
| `/standings/{year}` | `/ja/standings/{year}` | 76 | 76 | LIVE-READY | Every season with standings; dropped-score note translated |
| `/races` | `/ja/races` | 1 | 1 | LIVE-READY | Current calendar: JST dates, status, winner, pole |
| `/seasons/{year}` | `/ja/seasons/{year}` | 76 | 76 | LIVE-READY | Season archive calendars |
| `/races/{slug}` | `/ja/races/{slug}` | 1176 | 1176 | LIVE-READY | Header, key facts, every session classification (決勝/スプリント/予選/スプリント予選/フリー走行), JST schedule, championship after the round, recent winners at the circuit. Omitted vs English: Kalshi Market Pulse (Japan rule), Circuit Fit top-3 preview and weather line (replaced by the Race Lab explanation) |
| `/drivers` | `/ja/drivers` | 1 | 1 | LIVE-READY | Current grid cards + all-time index with filter |
| `/drivers/{slug}` | `/ja/drivers/{slug}` | 850 | 578 | LIVE-READY | Career totals, recent races, by-season table. noindex mirrors English (<3 entries). Omitted vs English: current-car figure and the English-prose crew/milestone modules |
| `/teams` | `/ja/teams` | 1 | 1 | LIVE-READY | Current teams by standing + all constructors |
| `/teams/{id}` | `/ja/teams/{id}` | 183 | 155 | LIVE-READY | Totals, titles, current lineup, current car photo with credit, lineage timeline, by-season table. noindex mirrors English (<2 races). Omitted vs English: Car Explorer, power unit, people, historical car gallery, lineage notes (English prose) |
| `/circuits` | `/ja/circuits` | 1 | 1 | LIVE-READY | Current venues + historic circuits |
| `/circuits/{slug}` | `/ja/circuits/{slug}` | 77 | 77 | LIVE-READY | Layout facts, next race link, winners (25 latest) |
| `/methodology` | `/ja/methodology` | 1 | 1 | LIVE-READY | Full translation except the prediction-market price section (not offered in Japanese; stated on the page) |
| `/data-coverage` | `/ja/data-coverage` | 1 | 1 | LIVE-READY | Translated coverage table |
| `/pbecast`, `/pbecast/{event}` | — | 0 | 0 | DEFERRED | Live board is a client app with English UI and a Kalshi module; PBEcast logic is owned by another workstream (f1 PBEcast issue). A Japanese board needs a localized client + no market module. Owed |
| `/matchups`, `/matchup/{a}/{b}` | — | 0 | 0 | DEFERRED | Matchup semantics owned by another workstream; English prose. Owed |
| `/people`, `/people/{id}`, `/power-units` | — | 0 | 0 | DEFERRED | Generated English prose (people summaries, machine registry); needs a Japanese generator + review |
| `/intelligence`, `/intelligence/*` | — | 0 | 0 | DEFERRED | Hub mixes projection modules with newsroom cards; sub-pages are upsell shells only |
| `/all-access` | (`/ja#all-access` → `propbetedge.ai/ja/pro`) | 0 | 0 | NOT ELIGIBLE | English page hosts sign-in/checkout flows; Japanese explanation lives on `/ja` and the network's Japanese /pro page. No price/billing change |
| `/race-lab` | — | 0 | 0 | NOT ELIGIBLE | Member-only client app (server-verified entitlements); Japanese pages explain it and link to /ja/pro |
| `/picks`, `/track-record` | — | 0 | 0 | NOT ELIGIBLE | Picks / betting-adjacent; Japan rule: no picks on Japanese pages |
| `/news`, `/news/{slug}` | — | 0 | 0 | NOT ELIGIBLE (now) | No validated Japanese translations exist; nothing is machine-translated or faked. Japanese pages do not link the newsroom |
| `/404` | — | 0 | 0 | — | Shared English 404 |

Totals (this build): **2,446 Japanese pages, 2,146 indexable**; 2,446 English pages carry the EN / 日本語 switch,
2,146 of them with reciprocal `hreflang`.

## Owed

- Native-speaker review of all copy and the name renderings (`NAME_JA`, `TEAM_JA`, `CIRCUIT_JA`, `GP_JA`). Not done.
- Japanese PBEcast (live board, session transitions, geometry/fallback) after the PBEcast emergency work lands.
- Matchups, people/power units, intelligence hub: Japanese generators.
- Search Console: submit `https://f1.propbetedge.ai/sitemap-ja.xml`; check hreflang reports after crawl.
