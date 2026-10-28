import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,dirname,delimiter} from 'node:path';
import {REPO,withTempDir,runNode} from './helpers.mjs';
import {peFixture} from './phase3-fixtures.mjs';
import {analyzeBinary} from '../lib/binary-analysis.mjs';
import {ghidraReport} from '../lib/ghidra-report.mjs';
const exec=promisify(execFile);
function extendedPE() {
 const b=peFixture();const dir=152+112;
 b.writeUInt32LE(0x1500,dir+5*8);b.writeUInt32LE(12,dir+5*8+4);
 b.writeUInt32LE(0x1000,1792);b.writeUInt32LE(12,1796);b.writeUInt16LE(0xa020,1800);
 b.writeUInt32LE(0x1540,dir+6*8);b.writeUInt32LE(28,dir+6*8+4);
 b.writeUInt32LE(2,1856+12);b.writeUInt32LE(36,1856+16);b.writeUInt32LE(1920,1856+24);
 b.write('RSDS',1920);b.fill(1,1924,1940);b.writeUInt32LE(3,1940);b.write('sample.pdb\0',1944);return b;
}
test('binary: PE relocations and CodeView metadata retain exact evidence and malformed-table isolation',async()=>withTempDir(async dir=>{
 const p=join(dir,'x.dll'),bytes=extendedPE();await writeFile(p,bytes);const r=await analyzeBinary(p);
 assert.equal(r.relocations[0].targetRva,'0x1020');assert.equal(r.relocations[0].type,10);
 assert.equal(bytes.readUInt16LE(r.relocations[0].evidence.byteOffset),0xa020);
 assert.equal(r.debugRecords[0].codeView.age,3);assert.equal(r.debugRecords[0].codeView.pdbPath.name,'sample.pdb');
 bytes.writeUInt32LE(0,1796);await writeFile(p,bytes);const malformed=await analyzeBinary(p);
 assert.ok(malformed.warnings.some(w=>w.table==='base-relocations'));assert.ok(malformed.symbols.length);
 bytes.writeUInt32LE(12,1796);bytes.writeUInt16LE(0x4020,1800);bytes.writeUInt16LE(0xf123,1802);await writeFile(p,bytes);
 const paired=await analyzeBinary(p);assert.equal(paired.relocations.length,1);assert.equal(paired.relocations[0].adjustmentWord,0xf123);
 const bounded=await analyzeBinary(p,{limits:{maxInventoryItems:1}});assert.ok(bounded.relocations.length<=1);
}));
test('Ghidra CLI: independently hash supplied binary, reject mismatches and preserve partial-coverage status',async()=>withTempDir(async dir=>{
 const bin=join(dir,'x.bin'),file=join(dir,'x.jsonl'),bytes=peFixture();await writeFile(bin,bytes);
 const hash=createHash('sha256').update(bytes).digest('hex');
 const rows=[{kind:'header',schema:'nexora-ghidra-export/v1',binarySha256:hash.toUpperCase(),version:'synthetic'}, {kind:'function',address:'1000',name:'f',status:'ok',pseudocode:'int f(){return 1;}'}];
 await writeFile(file,rows.map(x=>JSON.stringify(x)).join('\n'));
 const r=await runNode(['nexora/bin/nexora.mjs','ghidra-report',file,'--binary',bin]);assert.equal(r.code,0,r.stderr);
 const report=JSON.parse(r.stdout);assert.equal(report.binaryIdentity.status,'matched-supplied-binary');assert.equal(report.coverage.reportComplete,false);
 await writeFile(bin,'changed');const mismatch=await runNode(['nexora/bin/nexora.mjs','ghidra-report',file,'--binary',bin]);assert.equal(mismatch.code,2);assert.equal(mismatch.stdout,'');assert.match(mismatch.stderr,/SHA-256/);
 await assert.rejects(ghidraReport(file,{binaryFile:bin,limits:{maxFileBytes:1}}),e=>e.code==='limit_exceeded');
 const bad=await runNode(['nexora/bin/nexora.mjs','analyze-binary',bin,'--binary',bin]);assert.equal(bad.code,2);
}));
test('real compiler-produced binary: exported symbol, debug sections and PE relocations agree with objdump',async t=>withTempDir(async dir=>{
 const windows=process.platform==='win32';const compiler=process.env.NEXORA_TEST_CC??(windows?'C:/msys64/ucrt64/bin/gcc.exe':'cc');
 const file=join(dir,windows?'example.dll':'example'),source=join(REPO,'examples/tutorial/sample.c');
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toLowerCase()!=='path'));env.PATH=dirname(compiler)+delimiter+(process.env.PATH??process.env.Path??'');
 try {await exec(compiler,[...(windows?['-shared']:[]),'-g',source,'-o',file],{env,timeout:30000,maxBuffer:1048576,windowsHide:true});}
 catch(e){if(e.code==='ENOENT'){t.skip('No local test compiler; no installation attempted');return;}throw e;}
 const report=await analyzeBinary(file);assert.ok(report.sections.length);assert.ok(report.debugRecords.some(r=>r.kind==='debug-section'));
 if(windows){
  assert.equal(report.format,'PE');assert.ok(report.symbols.some(s=>s.kind==='export'&&s.name==='nexora_example'));assert.ok(report.relocations.length);
  const tool=process.env.NEXORA_TEST_OBJDUMP??join(dirname(compiler),'objdump.exe');
  const oracle=await exec(tool,['-p',file],{env,timeout:10000,maxBuffer:2097152,windowsHide:true});assert.match(oracle.stdout,/nexora_example/);assert.match(oracle.stdout,/DIR64/);
 }
 assert.equal(report.warnings.length,0,JSON.stringify(report.warnings));
}));
