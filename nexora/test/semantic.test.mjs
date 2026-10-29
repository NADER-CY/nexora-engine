import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withTempDir,runNode} from './helpers.mjs';
import {analyzeSemanticSource} from '../lib/semantic-source.mjs';
import {analyzeSemanticProject} from '../lib/semantic-project.mjs';

test('AST: parameters, blocks and var hoisting use lexical scope rather than global name matching',async()=>withTempDir(async dir=>{
 const file=join(dir,'x.ts');await writeFile(file,'function leaf(){} function caller(leaf:()=>void){ leaf(); } function root(){leaf(); {let leaf=1;leaf();} var local=()=>1;local();}');
 const r=await analyzeSemanticSource(file),calls=r.calls.filter(c=>c.name==='leaf');
 assert.equal(calls[0].resolution,'shadowed-or-noncallable');assert.equal(calls[0].callee,null);
 assert.equal(calls[1].callee,r.symbols.find(s=>s.name==='leaf').id);assert.equal(calls[2].callee,null);
 assert.ok(r.calls.find(c=>c.name==='local').callee);assert.equal(r.coverage.compilerTypeChecking,false);
}));
test('AST: UTF-8 evidence, class/interface facts, mutation and dynamic scope remain explicit',async()=>withTempDir(async dir=>{
 const file=join(dir,'x.ts');await writeFile(file,'// π\ninterface I { run():void } class C { run(){ this.other(); } } function f(){} ({f}=obj); f();');
 const r=await analyzeSemanticSource(file);assert.ok(r.symbols.some(s=>s.kind==='TSInterfaceDeclaration'));
 const klass=r.symbols.find(s=>s.kind==='ClassDeclaration'),method=r.symbols.find(s=>s.name==='run');assert.equal(method.parent,klass.id);
 assert.equal(r.calls.find(c=>c.name==='f').resolution,'mutated-binding');assert.equal(r.calls[0].resolution,'qualified-or-indirect');
 const bytes=await import('node:fs/promises').then(m=>m.readFile(file));const symbol=r.symbols.find(s=>s.name==='f');assert.equal(bytes.subarray(symbol.evidence.byteOffset,symbol.evidence.byteOffset+symbol.evidence.byteLength).toString(),'f');
 await writeFile(file,'function f(){} eval(code); f();');const dynamic=await analyzeSemanticSource(file);assert.equal(dynamic.calls.find(c=>c.name==='f').callee,null);assert.equal(dynamic.coverage.dynamicScope,true);
}));
test('AST project CLI: aliased direct ESM calls include import/export evidence and target digest',async()=>withTempDir(async dir=>{
 await writeFile(join(dir,'a.ts'),'import { leaf as run } from "./b.ts"; export function root(){run();}');await writeFile(join(dir,'b.ts'),'export function leaf(){return 1;}');
 const out=await runNode(['nexora/bin/nexora.mjs','analyze-project-ast',dir]);assert.equal(out.code,0,out.stderr);const r=JSON.parse(out.stdout),c=r.calls.find(c=>c.name==='run');
 assert.equal(c.resolution,'cross-file-export-candidate');assert.ok(c.callee.startsWith('b.ts#'));
 assert.equal(c.relationshipEvidence.targetSha256,r.files.find(f=>f.path==='b.ts').input.sha256);assert.ok(c.relationshipEvidence.import.byteLength);assert.ok(c.relationshipEvidence.export.byteLength);
 assert.ok(r.symbols.find(s=>s.id===c.callee).incomingCalls.includes(c.id));
}));
test('AST project: type-only exports, namespace calls and missing modules never become cross-file calls',async()=>withTempDir(async dir=>{
 await writeFile(join(dir,'a.ts'),'import {f} from "./b.ts"; import * as ns from "./b.ts"; import {g} from "./missing.ts"; f(); ns.f();g();');
 await writeFile(join(dir,'b.ts'),'function f(){} export type {f};');const r=await analyzeSemanticProject(dir);
 assert.equal(r.semanticCoverage.crossFileCandidates,0);assert.ok(r.calls.every(c=>c.callee===null));
}));
test('AST: malformed syntax, input ceilings, cancellation and dropped symbols fail conservatively',async()=>withTempDir(async dir=>{
 const file=join(dir,'x.js');await writeFile(file,'function broken(');await assert.rejects(analyzeSemanticSource(file),e=>e.code==='invalid_argument');
 await writeFile(file,' '.repeat(2*1024*1024+1));await assert.rejects(analyzeSemanticSource(file),e=>e.code==='limit_exceeded');
 await writeFile(file,'function a(){} function b(){} a();');const limited=await analyzeSemanticSource(file,{limits:{maxInventoryItems:1}});assert.equal(limited.calls[0].callee,null);assert.ok(limited.coverage.dropped.symbols);
 const ac=new AbortController();ac.abort();await assert.rejects(analyzeSemanticSource(file,{signal:ac.signal}),e=>e.code==='cancelled');
 await assert.rejects(analyzeSemanticSource(file,{limits:{maxRecords:1}}),e=>e.code==='limit_exceeded');
}));

test('AST: default parameter expressions cannot see function-body var declarations',async()=>withTempDir(async dir=>{
 const file=join(dir,'x.js');await writeFile(file,'function leaf(){} function root(value=leaf()){var leaf=()=>2;leaf();}');
 const report=await analyzeSemanticSource(file),calls=report.calls.filter(c=>c.name==='leaf');
 const outer=report.symbols.find(s=>s.name==='leaf'&&s.kind==='FunctionDeclaration');
 assert.equal(calls[0].callee,outer.id);assert.notEqual(calls[1].callee,outer.id);assert.ok(calls[1].callee);
}));

test('AST: wildcard re-exports and literal dynamic imports retain dependency evidence',async()=>withTempDir(async dir=>{
 const file=join(dir,'x.js');await writeFile(file,'export * from "./a.js"; import("./b.js");');
 const report=await analyzeSemanticSource(file);assert.deepEqual(report.dependencies.map(d=>d.name),['./a.js','./b.js']);
 assert.equal(report.module.exports[0].symbol,null);assert.ok(report.dependencies.every(d=>d.evidence.byteLength));
}));

test('AST: runtime TS declarations and named class expressions shadow outer function candidates',async()=>withTempDir(async dir=>{
 const file=join(dir,'x.ts');await writeFile(file,'function f(){} {enum f {value}; f();} const value=class f {run(){f();}}; f();');
 const report=await analyzeSemanticSource(file),calls=report.calls.filter(c=>c.name==='f');
 assert.equal(calls[0].callee,null);assert.equal(calls[1].callee,null);assert.ok(calls[2].callee);
}));
