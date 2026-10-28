import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {mapSession} from './nexora-backend-map.mjs';
test('redacts urls, private values and normalizes routes', async()=>{
 const f=path.join(os.tmpdir(),`nexora-map-${process.pid}.jsonl`);
 try {
 fs.writeFileSync(f,[
 JSON.stringify({kind:'page',section:'spot',path:'/exchange/MX_USDT?token=secret',at:'2026-10-22T01:00:00Z',balance:'9999'}),
 JSON.stringify({kind:'ui-summary',section:'spot',summary:{tabs:[{label:'Limit'},{label:'Order Book'}]},private:'secret'}),
 JSON.stringify({kind:'page',section:'futures',path:'/futures/BTC_USDT',at:'2026-10-22T01:01:00Z'}),
 '{garbage'
 ].join('\n'));
 const r=await mapSession(f); const json=JSON.stringify(r);
 assert.equal(r.stats.events,3);assert.equal(r.stats.invalid,1);
 assert.deepEqual(r.stats.normalizedRoutes,['/exchange/:symbol','/futures/:symbol']);
 assert.equal(json.includes('secret'),false);assert.equal(json.includes('9999'),false);
 assert.ok(r.architectureEvidence.some(e=>e.component==='Order types'));
 } finally {fs.rmSync(f,{force:true});}
});
