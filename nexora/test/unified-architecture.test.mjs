import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withTempDir,runNode} from './helpers.mjs';
import {analyzeArchitecture,renderArchitectureMermaid,buildArchitectureGraph} from '../lib/unified-architecture.mjs';
import {analyzeSemanticSource} from '../lib/semantic-source.mjs';

test('architecture CLI: JSON and raw Mermaid preserve dependency cycles, source identity and evidence',async()=>{
 const r=await runNode(['nexora/bin/nexora.mjs','architecture-report','examples/tutorial/cycle']);assert.equal(r.code,0,r.stderr);
 const graph=JSON.parse(r.stdout);assert.equal(graph.schema,'nexora-unified-architecture/v1');assert.deepEqual(graph.cycles[0].members,['a.js','b.js']);
 assert.equal(graph.coverage.completeWithinScope,true);const nodes=new Set(graph.nodes.map(n=>n.id));
 for(const e of graph.relationships){assert.ok(nodes.has(e.from)&&nodes.has(e.to));assert.ok(e.method&&e.confidence&&e.coverage);assert.ok(e.evidence.every(p=>p.sha256.length===64&&p.range.byteLength>0));}
 const diagram=await runNode(['nexora/bin/nexora.mjs','architecture-report','examples/tutorial/cycle','--format','mermaid']);assert.equal(diagram.code,0,diagram.stderr);assert.equal(diagram.stdout,graph.mermaid+'\n');assert.ok(diagram.stdout.startsWith('flowchart TD\n'));
});

test('architecture AST: direct ESM call relationships include call/import/export identities',async()=>withTempDir(async dir=>{
 await writeFile(join(dir,'a.ts'),'import {leaf as run} from "./b.ts"; export function root(){run();}');await writeFile(join(dir,'b.ts'),'export function leaf(){}');
 const graph=await analyzeArchitecture(dir,{semantic:true}),call=graph.relationships.find(e=>e.kind==='call-candidate'&&e.resolution==='cross-file-export-candidate');
 assert.equal(call.evidence.length,3);assert.equal(call.evidence[2].file,'b.ts');assert.equal(call.evidence[2].sha256,graph.nodes.find(n=>n.id==='module:b.ts').identity.sha256);
 assert.ok(call.evidence.every(p=>p.range.byteLength>0));
}));

test('architecture AST: import-bound route/event registrations and ambient configuration references',async()=>withTempDir(async dir=>{
 const source='import express from "express"; import {EventEmitter} from "node:events"; const app=express(); const bus=new EventEmitter(); function handler(){} app.get("/items",handler); bus.on("ready",handler);bus.emit("ready",handler); process.env.PORT;';
 await writeFile(join(dir,'app.js'),source);const graph=await analyzeArchitecture(dir,{semantic:true});
 for(const kind of ['api-route-declaration','event-publisher','event-consumer','configuration-reference'])assert.ok(graph.relationships.some(e=>e.kind===kind),kind);
 const handlers=graph.relationships.filter(e=>e.kind==='handler-candidate');assert.equal(handlers.length,2,'Publisher payload functions are not handler invocations');
 const event=graph.nodes.find(n=>n.kind==='event');assert.ok(graph.relationships.some(e=>e.to===event.id&&e.kind==='event-consumer'));assert.ok(graph.relationships.some(e=>e.to===event.id&&e.kind==='event-publisher'));
 assert.equal(graph.coverage.completeWithinScope,false,'External packages and indirect/member calls remain unresolved');
 const api=graph.relationships.find(e=>e.kind==='api-route-declaration');assert.equal(api.evidence.length,3);assert.ok(api.evidence.every(p=>p.sha256.length===64));
}));

test('architecture observations: names alone, shadowing, mutation and type-only imports establish no routes/events',async()=>withTempDir(async dir=>{
 const file=join(dir,'x.ts');
 for(const source of [
  'const app={};app.get("/fake",handler);',
  'import type express from "express";const app=express();app.get("/fake",handler);',
  'import express from "express";const app=express();app.get=other;app.get("/fake",handler);',
  'function f(process:any){process.env.SECRET;}']){
   await writeFile(file,source);const r=await analyzeSemanticSource(file);assert.equal(r.module.observations.length,0,source);
 }
}));

test('architecture: malformed peers, truncation, output budgets, cancellation and Mermaid label injection',async()=>withTempDir(async dir=>{
 await writeFile(join(dir,'a.js'),'function leaf(){} leaf();');await writeFile(join(dir,'bad.js'),'function (');
 const partial=await analyzeArchitecture(dir,{semantic:true});assert.equal(partial.coverage.sourceIncomplete,true);assert.equal(partial.coverage.completeWithinScope,false);assert.ok(partial.nodes.some(n=>n.label==='leaf'));
 const capped=await analyzeArchitecture(dir,{limits:{maxInventoryItems:1}});assert.equal(capped.coverage.completeWithinScope,false);const ids=new Set(capped.nodes.map(n=>n.id));assert.ok(capped.relationships.every(e=>ids.has(e.from)&&ids.has(e.to)));
 const ac=new AbortController();ac.abort();await assert.rejects(analyzeArchitecture(dir,{signal:ac.signal}),e=>e.code==='cancelled');
 assert.throws(()=>renderArchitectureMermaid(partial,{maxBytes:10}),e=>e.code==='limit_exceeded');
 const hostile=renderArchitectureMermaid({coverage:{completeWithinScope:false},nodes:[{id:'untrusted',label:'x"]\n evil --> hack["<script>`'}],relationships:[]});
 assert.ok(!hostile.includes('evil --> hack'));assert.ok(!hostile.includes('<script>'));assert.equal(hostile.split('\n').length,3);
 assert.throws(()=>buildArchitectureGraph({files:[],symbols:[],calls:[],dependencies:[],failures:[],architecture:{cycles:[],coverage:{complete:true}},coverage:{traversalTruncated:false,dropped:{}}},{limits:{maxOutputBytes:1}}),e=>e.code==='limit_exceeded');
}));
