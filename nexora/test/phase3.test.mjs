import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { withTempDir, runNode } from './helpers.mjs';
import { analyzeSource } from '../lib/source-analysis.mjs';
import { analyzeBinary } from '../lib/binary-analysis.mjs';
import { analyzeProject } from '../lib/project-analysis.mjs';
import { ghidraReport } from '../lib/ghidra-report.mjs';
import { ConcurrencyGate, withTimeout } from '../lib/limits.mjs';
import { elfFixture, peFixture, machFixture } from './phase3-fixtures.mjs';

const sources = {
  js: 'import x from "./dep.js"; /* function fake() { bad(); } */ function leaf() {} function root(){ leaf(); obj.leaf(); missing(); }',
  ts: 'import type {X} from "./dep"; export function leaf(x: number): number { return x; } export function root(): void { leaf(1); }',
  go: 'package main\nimport "fmt"\nfunc leaf() {}\nfunc (r *Receiver) root() { leaf(); fmt.Println("hi") }',
  rs: 'use std::io;\nfn leaf() {}\npub fn root() { leaf(); }',
  c: '#include "dep.h"\nvoid leaf(void) {}\nint root(void) { leaf(); return 0; }',
  cpp: '#include "dep.hpp"\nnamespace sample { void leaf() {} int root() { leaf(); return 0; } }',
};
for (const [extension, source] of Object.entries(sources)) test(`source ${extension}: symbols, references, imports and byte evidence independent of chunks`, async () => withTempDir(async dir => {
  const path=join(dir,'source.'+extension); await writeFile(path,source); let baseline;
  for(const chunkBytes of [1,7,65536]) {
    const r=await analyzeSource(path,{limits:{chunkBytes}});
    assert.deepEqual(r.symbols.map(x=>x.name),['leaf','root']);
    assert.ok(r.dependencies.length); assert.ok(!r.symbols.some(x=>x.name==='fake'));
    const call=r.calls.find(x=>x.name==='leaf'); assert.equal(call.callee,r.symbols[0].id); assert.equal(call.caller,r.symbols[1].id);
    for(const s of r.symbols) assert.equal(Buffer.from(source).subarray(s.evidence.byteOffset,s.evidence.byteOffset+s.evidence.byteLength).toString(),s.name);
    assert.equal(r.input.sha256,createHash('sha256').update(source).digest('hex'));
    const stable={symbols:r.symbols,calls:r.calls,dependencies:r.dependencies,coverage:r.coverage}; if(baseline)assert.deepEqual(stable,baseline); baseline=stable;
  }
}));
test('source: UTF8 offsets, arrows, ambiguous names, long tokens, caps and incomplete input',async()=>withTempDir(async dir=>{
  const p=join(dir,'a.js');await writeFile(p,'// π\nconst arrow = () => { target(); }; function target() {} function target() {} /* open');
  const r=await analyzeSource(p,{limits:{chunkBytes:2}});assert.equal(r.symbols[0].name,'arrow');assert.equal(r.calls[0].resolution,'ambiguous');assert.equal(r.coverage.unterminatedLexeme,true);
  await writeFile(p,'function a(){} function b(){} function c(){} '+ 'z'.repeat(100000));const cap=await analyzeSource(p,{limits:{maxInventoryItems:1,chunkBytes:113}});assert.equal(cap.symbols.length,1);assert.equal(cap.coverage.dropped.symbols,2);assert.equal(cap.coverage.droppedTokens,1);
}));
for(const [format,make] of [['ELF',elfFixture],['PE',peFixture],['Mach-O',machFixture]]) for(const wide of [false,true]) for(const le of format==='PE'?[true]:[false,true]) test(`binary ${format} ${wide?64:32} ${le?'LE':'BE'} symbols and dependencies`,async()=>withTempDir(async dir=>{
  const p=join(dir,'sample.bin'),bytes=make(wide,le);await writeFile(p,bytes);const r=await analyzeBinary(p);assert.equal(r.format,format);assert.equal(r.bits,wide?64:32);assert.ok(r.symbols.length);assert.ok(r.dependencies[0].name.includes('sample'));assert.equal(r.warnings.length,0,JSON.stringify(r.warnings));assert.equal(r.input.sha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(r.symbols[0].entryEvidence.byteLength);
}));
test('binary: malformed offsets, magic, table sizes and partial-table isolation',async()=>withTempDir(async dir=>{
  const p=join(dir,'x'); for(const b of [Buffer.alloc(3),Buffer.alloc(100),elfFixture().subarray(0,160)]){await writeFile(p,b);await assert.rejects(analyzeBinary(p),e=>e.code==='invalid_argument');}
  let b=machFixture();b.writeUInt32LE(0,36);await writeFile(p,b);await assert.rejects(analyzeBinary(p),/command size/);
  b=elfFixture();b.writeUInt32LE(99,128+3*64+40);await writeFile(p,b);const partial=await analyzeBinary(p);assert.equal(partial.warnings.length,1);assert.equal(partial.dependencies.length,1);
  b=peFixture();b.writeUInt32LE(0xffffff00,152+112+8);await writeFile(p,b);const pe=await analyzeBinary(p);assert.equal(pe.warnings.length,1);assert.equal(pe.symbols[0].name,'Exported');
}));
test('binary: retained symbol bounds are explicit',async()=>withTempDir(async dir=>{
  const p=join(dir,'x');await writeFile(p,peFixture());const r=await analyzeBinary(p,{limits:{maxInventoryItems:1}});assert.equal(r.symbols.length,1);assert.equal(r.coverage.dropped.symbols,1);
}));
test('analysis: cancellation before start, during reads, deadlines, roots, resource budgets',async()=>withTempDir(async dir=>{
  const p=join(dir,'a.js');await writeFile(p,'function a(){}\n'.repeat(10000));const controller=new AbortController();controller.abort();
  for(const fn of [analyzeSource,analyzeBinary,ghidraReport])await assert.rejects(fn(p,{signal:controller.signal}),e=>e.code==='cancelled');
  const during=new AbortController();await assert.rejects(analyzeSource(p,{signal:during.signal,limits:{chunkBytes:1024},onProgress:()=>during.abort()}),e=>e.code==='cancelled');
  await assert.rejects(analyzeSource(p,{limits:{timeoutMs:1,chunkBytes:1}}),e=>e.code==='timeout');
  await assert.rejects(analyzeSource(p,{limits:{maxHeapBytes:1}}),e=>e.code==='limit_exceeded');
  await assert.rejects(analyzeSource(p,{limits:{maxFileBytes:1}}),e=>e.code==='limit_exceeded');
  await assert.rejects(analyzeSource(p,{roots:[join(dir,'not-allowed')]}),e=>e.code==='path_rejected');
}));
test('project: local dependency mapping, skipped dependency directory and traversal cap',async()=>withTempDir(async dir=>{
  await writeFile(join(dir,'a.js'),'import "./b.js"; function a(){b();}');await writeFile(join(dir,'b.js'),'function b(){}');await mkdir(join(dir,'node_modules'));await writeFile(join(dir,'node_modules','skip.js'),'function hidden(){}');
  const r=await analyzeProject(dir);assert.equal(r.files.length,2);assert.equal(r.dependencies[0].target,'b.js');assert.equal(r.calls[0].callee,null);
  const bounded=await analyzeProject(dir,{limits:{maxInventoryItems:1}});assert.equal(bounded.files.length,1);assert.equal(bounded.coverage.traversalTruncated,true);
}));
const exportRows=()=>[{kind:'header',schema:'nexora-ghidra-export/v1',binarySha256:'a'.repeat(64),version:'test-fixture'}, {kind:'function',address:'1000',name:'good',status:'ok',pseudocode:'int good(){return 1;}'}, {kind:'function',address:'2000',name:'bad',status:'failed',message:'timeout'}, {kind:'reference',from:'1010',to:'2000',type:'CALL'}, {kind:'footer',functions:2,complete:true}];
test('Ghidra: structured decompilation, failure isolation, references, footer and digest',async()=>withTempDir(async dir=>{
  const p=join(dir,'g.jsonl'), rows=exportRows();await writeFile(p,rows.map(x=>JSON.stringify(x)).join('\n'));let baseline;
  for(const chunkBytes of [1,11,65536]){const r=await ghidraReport(p,{limits:{chunkBytes}});assert.equal(r.functions.length,2);assert.equal(r.failures.length,1);assert.equal(r.references[0].to,'2000');assert.equal(r.coverage.producerComplete,true);const stable={functions:r.functions,references:r.references,coverage:r.coverage};if(baseline)assert.deepEqual(stable,baseline);baseline=stable;}
  await writeFile(p,rows.slice(0,-1).map(x=>JSON.stringify(x)).join('\n'));assert.equal((await ghidraReport(p)).coverage.footerPresent,false);
  await writeFile(p,'{}');await assert.rejects(ghidraReport(p),/header/);
}));
test('Ghidra: oversized and inventory records are explicitly incomplete',async()=>withTempDir(async dir=>{
  const p=join(dir,'g.jsonl'),r=exportRows();r[1].pseudocode='x'.repeat(5000);await writeFile(p,r.map(x=>JSON.stringify(x)).join('\n'));const out=await ghidraReport(p,{limits:{maxLineBytes:1024,maxInventoryItems:1,chunkBytes:71}});assert.equal(out.coverage.oversizedRecords,1);assert.equal(out.functions[0].name,'bad');
}));
test('lifecycle: cancelled queued permit never runs and listeners are removed on grant',async()=>{
  const gate=new ConcurrencyGate({concurrency:1,maxQueue:5});let release;const first=gate.run(()=>new Promise(r=>release=r));const ac=new AbortController();let ran=false;const next=gate.run(async()=>{ran=true;},ac.signal);release();ac.abort();await first;await assert.rejects(next,e=>e.code==='cancelled');assert.equal(ran,false);assert.equal(gate.stats.active,0);assert.equal(getEventListeners(ac.signal,'abort').length,0);
  const stopped=new AbortController();stopped.abort();await assert.rejects(withTimeout(async()=>{throw new Error('must not run');},{signal:stopped.signal}),e=>e.code==='cancelled');
});
test('CLI: new commands and stdout output cap',async()=>withTempDir(async dir=>{
  const p=join(dir,'a.js');await writeFile(p,'function leaf() {} function root(){leaf();}');const r=await runNode(['nexora/bin/nexora.mjs','analyze-source',p]);assert.equal(r.code,0,r.stderr);assert.equal(JSON.parse(r.stdout).symbols.length,2);
  const bounded=await runNode(['nexora/bin/nexora.mjs','analyze-source',p,'--max-output-mb','0.0001']);assert.equal(bounded.code,1);assert.equal(bounded.stdout,'');assert.match(bounded.stderr,/limit_exceeded/);
}));
