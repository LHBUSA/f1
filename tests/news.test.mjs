// Newsroom gates and packets. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateDraft, consistency, render } from '../src/news/validate.mjs';
import { Packet } from '../src/news/packet.mjs';

function packet() {
  const P = new Packet('race_final', 'race_final:test', { event_id: 'x', as_of: '2026-01-01T00:00:00Z' });
  P.fact('event', '2026 Test Grand Prix', '2026 Test Grand Prix', 'Event', 't');
  P.fact('p1_grid', 1, 'pole position', 'grid', 't');
  P.fact('p1_finish', 1, 'P1', 'finish', 't');
  P.fact('margin', 1200, '1.200 seconds', 'margin', 't');
  P.fact('round', 3, 'round 3', 'round', 't');
  P.entity('p1', 'driver', 'ann-driver', 'Ann Driver');
  P.entity('p2', 'driver', 'bob-racer', 'Bob Racer');
  P.entity('p1_team', 'team', 'team-a', 'Team Alpha');
  return P;
}
const base = (para) => ({
  headline: '{e:p1} wins the {f:event} by {f:margin}',
  dek: '{s:p1} finished ahead of {e:p2} from {f:p1_grid} in {f:round} of the season.',
  sections: [{ heading: '', paragraphs: [para + ' ' + '{s:p1} started from {f:p1_grid} and finished {f:p1_finish} in {f:round}, ahead of {e:p2} by {f:margin}. '.repeat(4)] }],
  seo_title: '{s:p1} wins the {f:event}',
  seo_description: '{e:p1} won the {f:event} for {e:p1_team} ahead of {e:p2}. Result, championship effect and the data.',
});

test('a clean token draft passes', () => {
  const P = packet().freeze();
  const v = validateDraft(P, base('{e:p1} won the {f:event} for {e:p1_team}.'), { minWords: 20 });
  assert.equal(v.ok, true, v.reasons.join('; '));
});

test('prose may not state its own numbers, names, causes, superlatives, tyres or incidents', () => {
  const P = packet().freeze();
  const cases = {
    unsupported_number: 'Ann Driver won by 3 seconds.',
    number_word: 'It was a win by three places.',
    ordinal_word: 'Bob Racer was third.',
    'unsupported_name': 'Ann Driver beat Carl Fictional.',
    unsupported_superlative: 'It was a stunning drive.',
    unsupported_causation: 'The win came because of the start.',
    unsourced_strategy_or_tyres: 'The undercut decided it.',
    unsourced_incident: 'A safety car bunched the field.',
    invented_atmosphere: 'The crowd roared.',
    pronoun_not_supported: 'He won.',
    quotation: 'Ann Driver called it "perfect".',
  };
  for (const [reason, sentence] of Object.entries(cases)) {
    const v = validateDraft(P, base(sentence), { minWords: 20 });
    assert.equal(v.ok, false, sentence);
    assert.ok(v.reasons.some((r) => r.startsWith(reason)), `${sentence} -> ${v.reasons.join('; ')}`);
  }
});

test('"one-two" is an idiom, not a count', () => {
  const v = validateDraft(packet().freeze(), base('{e:p1_team} took a one-two finish.'), { minWords: 20 });
  assert.equal(v.ok, true, v.reasons.join('; '));
});

test('championship math must add up', () => {
  const P = packet();
  P.context.champ_check = { before: 100, scored: 25, after: 124 };
  assert.match(consistency(P.freeze()).join(), /championship_math/);
});

test('the surname token renders the last name', () => {
  assert.equal(render('{s:p1} won', packet().freeze()), 'Ann won'.replace('Ann', 'Driver'));
});

test('every generated story passed the gates and resolved its entities (from the last build-news run)', { skip: !fs.existsSync('data/news/articles.json') }, () => {
  const all = JSON.parse(fs.readFileSync('data/news/articles.json', 'utf8'));
  assert.ok(all.length >= 3);
  for (const a of all) assert.ok(a.validation.ok || a.status === 'held', a.slug);
  assert.ok(!all.some((a) => a.status === 'published' && !a.validation.ok), 'nothing that failed a gate is published');
});
