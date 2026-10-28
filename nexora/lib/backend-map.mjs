/**
 * NEXORA ENGINE offline evidence-to-architecture mapper (logic unchanged from
 * v0.4; input now read with the bounded JSONL reader). Offline: no network,
 * browser or secrets. Output separates observed UI facts from candidate
 * backend modules and an explicit list of unverified questions.
 */
import { readJsonl } from "./jsonl.mjs";
import { checkedInputFile } from "./fs-safe.mjs";
import { resolveLimits } from "./limits.mjs";

export async function mapSession(file, opts = {}) {
  const limits = resolveLimits(opts.limits);
  const { path: input } = await checkedInputFile(file, { maxBytes: limits.maxFileBytes, roots: opts.roots });
  const readStats = {};
  const counts = {}, sections = new Set(), paths = new Set(), controls = new Set();
  const tabLabels = new Set(), transitions = new Map(), sectionPairs = new Map();
  let events = 0, invalid = 0, first = null, last = null, lastSection = null;
  for await (const { record: e } of readJsonl(input, { maxLineBytes: limits.maxLineBytes, maxRecords: limits.maxRecords, chunkBytes: limits.chunkBytes, maxHeapBytes: limits.maxHeapBytes, signal: opts.signal, stats: readStats })) {
    events++;
    const kind = typeof e.kind === 'string' ? e.kind.slice(0,80) : 'unknown';
    counts[kind] = (counts[kind] || 0) + 1;
    const at = typeof e.at === 'string' && /^\d{4}-\d\d-\d\dT/.test(e.at) ? e.at : null;
    if (at) { first ??= at; last = at; }
    const section = ['spot','futures','chart','orderbook','wallet','assets','other'].includes(e.section) ? e.section : null;
    if (section) sections.add(section);
    // Only accept path-like strings: never include query strings, fragments or user-provided identifiers.
    if (kind === 'page' && typeof e.path === 'string') {
      const safe = e.path.split(/[?#]/)[0];
      if (/^\/(exchange|futures)(\/|$)/.test(safe) && safe.length < 120 && !/%/.test(safe)) {
        const normalized = safe.replace(/\/[A-Z0-9]{2,25}_[A-Z0-9]{2,25}$/i, '/:symbol');
        paths.add(normalized);
      }
      if (section && lastSection && lastSection !== section) {
        const key=`${lastSection} -> ${section}`; transitions.set(key,(transitions.get(key)||0)+1);
      }
      if(section) lastSection=section;
    }
    if (kind === 'click' && typeof e.control==='string' && /^[a-z-]{1,40}$/.test(e.control)) controls.add(e.control);
    if (kind === 'ui-summary' && Array.isArray(e.summary?.tabs)) {
      for(const t of e.summary.tabs) {
        const label=typeof t?.label === 'string' ? t.label.trim() : '';
        if (/^(chart|order book|market trades|spot|futures|limit|market|tp\/sl|order history|trade history)$/i.test(label)) tabLabels.add(label);
      }
      if (section) sectionPairs.set(section,(sectionPairs.get(section)||0)+1);
    }
  }
  const facts = [];
  if(sections.has('spot') || paths.has('/exchange/:symbol')) facts.push({component:'Spot Trading UI',evidence:'observed',basis:'Spot route or UI events',frontend:'Symbol screen, chart, orderbook, trade form',backendCandidate:'instrument catalog, market data adapter, spot order API'});
  if(sections.has('futures') || paths.has('/futures/:symbol')) facts.push({component:'Futures Trading UI',evidence:'observed',basis:'Futures route or UI events',frontend:'Contract screen, position & margin controls',backendCandidate:'contract registry, risk and margin service'});
  if(counts['chart-wheel']) facts.push({component:'Chart interactions',evidence:'observed',basis:`${counts['chart-wheel']} wheel events`,frontend:'Chart viewport and gestures',backendCandidate:'OHLCV history and streaming candles (not verified)'});
  if(tabLabels.has('Order Book')) facts.push({component:'Order book view',evidence:'observed',basis:'Visible tab',frontend:'Depth table & layout selection',backendCandidate:'L2 snapshot/delta stream (not verified)'});
  if(tabLabels.has('Limit') || tabLabels.has('Market')) facts.push({component:'Order types',evidence:'observed',basis:'Visible Limit/Market UI controls',frontend:'Order form modes and validation',backendCandidate:'order lifecycle and validation rules (not verified)'});
  if(tabLabels.has('TP/SL')) facts.push({component:'Conditional orders',evidence:'observed',basis:'Visible TP/SL control',frontend:'Trigger input UI',backendCandidate:'conditional order trigger service (not verified)'});
  const unanswered = ['Actual API endpoint paths, request/response schemas and authentication','WebSocket channel names, payload shapes and reconnect behavior','Order state transitions (new, partial, filled, cancelled, rejected)','Authoritative balances, ledger posting and custody integration','Spot matching engine execution, idempotency and consistency','Futures margin, funding, liquidation and ADL algorithms','Rate limits, error codes and server-side validation'];
  invalid = readStats.invalidJson + readStats.nonObject + readStats.oversizedLines;
  return {project:'NEXORA ENGINE',generator:'offline-backend-map',confidenceNotice:'Client-side UI activity does not disclose private server implementation.',stats:{events,invalid,oversizedLines:readStats.oversizedLines,truncatedAtMaxRecords:readStats.truncatedAtMaxRecords,first,last,kinds:counts,observedSections:[...sections].sort(),normalizedRoutes:[...paths].sort(),recognizedControls:[...controls].sort(),recognizedTabs:[...tabLabels].sort(),sectionTransitions:[...transitions].map(([transition,count])=>({transition,count}))},architectureEvidence:facts,backendProposals:[{area:'Reference data',modules:['instrument registry','symbol metadata','tick/lot precision'],status:'candidate'},{area:'Market data',modules:['candles','order book snapshots/deltas','recent trades','WS fanout'],status:'candidate'},{area:'Trading',modules:['OMS API','risk validation','order events','order history'],status:'candidate'},{area:'Futures',modules:['position accounting','margin','funding','liquidation'],status:'candidate'}],unverified:unanswered,privacy:'No raw URLs with queries, form values, headers, tokens, balances, order IDs or raw network payloads emitted.'};
}
