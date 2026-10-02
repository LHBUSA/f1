// Frozen fact packets. A story is written ONLY from its packet: every value a reader sees is a fact (id, raw value,
// display, label, source) and every linked name is an entity (key, type, ref, name). Derived facts carry a
// 'derived:' source naming the facts they were computed from, so the evidence ledger shows how each was made.
import { createHash } from 'node:crypto';

export const PACKET_VERSION = 'f1-packet@1.0.0';

export class Packet {
  constructor(type, topic, { event_id = null, as_of } = {}) {
    this.version = PACKET_VERSION;
    this.type = type;
    this.topic = topic;
    this.event_id = event_id;
    this.as_of = as_of;
    this.facts = [];
    this.entities = [];
    this.charts = [];
    this.chart_data = {};
    this.limits = [];
    this.context = { signals: [] };
  }
  fact(id, value, display, label, source) {
    if (value == null || display == null || display === '') return null;
    if (this.facts.some((f) => f.id === id)) throw new Error(`duplicate fact ${id}`);
    const f = { id, value, display: String(display), label, source };
    this.facts.push(f);
    return f;
  }
  derive(id, value, display, label, { from = [], rule = null } = {}) {
    return this.fact(id, value, display, label, `derived: ${rule ? `${rule} from ` : 'from '}${from.join(', ')}`);
  }
  entity(key, type, ref, name) {
    if (!ref || !name) return null;
    const have = this.entities.find((x) => x.key === key);
    if (have) return have;
    const x = { key, type, ref, name };
    this.entities.push(x);
    return x;
  }
  chart(id, data) {
    if (!this.charts.includes(id)) this.charts.push(id);
    this.chart_data[id] = data;
  }
  limit(text) { if (!this.limits.includes(text)) this.limits.push(text); }
  signal(name, detail = {}) { this.context.signals.push({ name, ...detail }); }
  has(id) { return this.facts.some((f) => f.id === id); }
  get(id) { return this.facts.find((f) => f.id === id) || null; }
  freeze() {
    const body = { version: this.version, type: this.type, topic: this.topic, event_id: this.event_id, facts: this.facts, entities: this.entities, charts: this.charts, chart_data: this.chart_data, limits: this.limits, context: this.context };
    // the hash covers content, never the build time: an unchanged race rebuilds to the same packet
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
    return Object.freeze({ ...body, as_of: this.as_of, hash });
  }
}

// ---------- display helpers (facts own their wording; prose never formats a number) ----------
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const countWord = (n) => (Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
export const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
export const gridText = (g) => (g === 1 ? 'pole position' : g ? `P${g}` : null);
export const posText = (p) => (p ? `P${p}` : null);
export const pts = (p) => (p == null ? null : `${Number.isInteger(p) ? p : p.toFixed(1)} point${p === 1 ? '' : 's'}`);
export const fmtLap = (ms) => { if (!ms) return null; const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000; return `${m}:${s.toFixed(3).padStart(6, '0')}`; };
export const secs = (ms) => (ms == null ? null : `${(ms / 1000).toFixed(3)} seconds`);
export const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null);
export const plural = (n, one, many = `${one}s`) => `${countWord(n)} ${n === 1 ? one : many}`;
// "+3.210" -> 3210 ms; lapped gaps are not time gaps
export const gapMs = (g) => { const m = /^\+?(\d+(?:\.\d+)?)s?$/.exec(String(g ?? '').trim()); return m ? Math.round(Number(m[1]) * 1000) : null; };
