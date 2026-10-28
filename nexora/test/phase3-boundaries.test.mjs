import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,rename,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {withTempDir,runNode} from './helpers.mjs';
import {analyzeSource} from '../lib/source-analysis.mjs';
import {analyzeBinary} from '../lib/binary-analysis.mjs';
import {analyzeProject} from '../lib/project-analysis.mjs';
import {ghidraReport} from '../lib/ghidra-report.mjs';
import {elfFixture} from './phase3-fixtures.mjs';

test('source: nested ownership, qualified unresolved calls, C angle includes',async()=>withTempDir(async dir=>{
  const p=join(dir,'a.cpp');await writeFile(p,'#include <vector>\nint outer(){ int nested(){ return leaf(); } obj.leaf(); } int leaf(){}');
  const r=await analyzeSource(p);assert.equal(r.dependencies[0].name,'vector');assert.equal(r.symbols[1].parent,r.symbols[0].id);assert.equal(r.calls[0].caller,r.symbols[1].id);assert.equal(r.calls[1].resolution,'qualified-unknown');assert.equal(r.calls[1].callee,null);
}));
test('budgets: token and binary record exhaustion fail rather than silently claiming completeness',async()=>withTempDir(async dir=>{
  const p=join(dir,'a.js');await writeFile(p,'function a(){}');await assert.rejects(analyzeSource(p,{limits:{maxRecords:2}}),e=>e.code==='limit_exceeded');await writeFile(p,elfFixture());await assert.rejects(analyzeBinary(p,{limits:{maxRecords:6}}),e=>e.code==='limit_exceeded');
}));
test('descriptor ownership: cancelled analysis releases file and rejects changed input',async()=>withTempDir(async dir=>{
  const p=join(dir,'a.js');await writeFile(p,'x'.repeat(10000));const ac=new AbortController();await assert.rejects(analyzeSource(p,{limits:{chunkBytes:17},signal:ac.signal,onProgress:()=>ac.abort()}));await rename(p,join(dir,'released.js'));
  await writeFile(p,'function a(){}');await assert.rejects(analyzeSource(p,{onProgress:async()=>{await writeFile(p,'changed input with different length');}}),/changed|end of file/);
}));
test('project: changed file fails in isolation and preserves other results',async()=>withTempDir(async dir=>{
  const one=join(dir,'one.js'),two=join(dir,'two.js');await writeFile(one,'function valid(){}');await writeFile(two,'function other(){}');let changed=false;
  const r=await analyzeProject(dir,{onProgress:async()=>{if(!changed){changed=true;await writeFile(one,'function valid(){} // changed');await writeFile(two,'function other(){} // changed');}}});
  assert.equal(r.failures.length,1);assert.equal(r.symbols.length,1);assert.equal(r.files.length,2);
}));
test('Ghidra: footer cannot turn missing or oversized functions into complete report',async()=>withTempDir(async dir=>{
  const p=join(dir,'r.jsonl'),head={kind:'header',schema:'nexora-ghidra-export/v1',binarySha256:'b'.repeat(64)};
  await writeFile(p,[head,{kind:'footer',functions:1,complete:true}].map(JSON.stringify).join('\n'));const r=await ghidraReport(p);assert.equal(r.coverage.producerComplete,true);assert.equal(r.coverage.reportComplete,false);
}));
test('CLI: binary, project and Ghidra commands execute offline',async()=>withTempDir(async dir=>{
  const binary=join(dir,'sample.elf');await writeFile(binary,elfFixture());const a=await runNode(['nexora/bin/nexora.mjs','analyze-binary',binary]);assert.equal(a.code,0,a.stderr);assert.equal(JSON.parse(a.stdout).format,'ELF');
  await writeFile(join(dir,'a.rs'),'fn main(){}');const b=await runNode(['nexora/bin/nexora.mjs','analyze-project',dir]);assert.equal(b.code,0,b.stderr);assert.equal(JSON.parse(b.stdout).symbols[0].name,'main');
  const exportFile=join(dir,'export.jsonl');await writeFile(exportFile,[{kind:'header',schema:'nexora-ghidra-export/v1',binarySha256:'c'.repeat(64)},{kind:'footer',functions:0,complete:true}].map(JSON.stringify).join('\n'));const c=await runNode(['nexora/bin/nexora.mjs','ghidra-report',exportFile]);assert.equal(c.code,0,c.stderr);assert.equal(JSON.parse(c.stdout).coverage.reportComplete,true);
}));
