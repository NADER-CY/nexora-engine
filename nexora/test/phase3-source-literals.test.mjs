// Regression: punctuation and keywords inside strings are data, not structure.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withTempDir} from './helpers.mjs';
import {analyzeSource} from '../lib/source-analysis.mjs';
test('source: strings never become braces, keywords or declarations; xrefs are linked',async()=>withTempDir(async dir=>{
 const p=join(dir,'x.js');await writeFile(p,'function leaf(){const a="}"; const b="import";const c="fake-module";} function root(){leaf();}');const r=await analyzeSource(p,{limits:{chunkBytes:1}});assert.deepEqual(r.symbols.map(x=>x.name),['leaf','root']);assert.equal(r.dependencies.length,0);assert.deepEqual(r.symbols[0].incomingCalls,[r.calls[0].id]);assert.deepEqual(r.symbols[1].outgoingCalls,[r.calls[0].id]);assert.equal(r.coverage.unclosedFunctions,0);
}));
