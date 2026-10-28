import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withTempDir} from './helpers.mjs';
import {ghidraReport} from '../lib/ghidra-report.mjs';
import {analyzeProject} from '../lib/project-analysis.mjs';
test('retention: byte budget caps pseudocode independently of item count',async()=>withTempDir(async dir=>{
 const p=join(dir,'r.jsonl');const rows=[{kind:'header',schema:'nexora-ghidra-export/v1',binarySha256:'d'.repeat(64)},...Array.from({length:20},(_,i)=>({kind:'function',address:String(i),name:'x',status:'ok',pseudocode:'x'.repeat(4000)})),{kind:'footer',functions:20,complete:true}];await writeFile(p,rows.map(JSON.stringify).join('\n'));
 const r=await ghidraReport(p,{limits:{maxOutputBytes:10000}});assert.equal(r.functions.length,2);assert.equal(r.coverage.dropped.functions,18);assert.equal(r.coverage.reportComplete,false);
 await writeFile(join(dir,'a.js'),'function a(){}');const project=await analyzeProject(dir,{limits:{maxOutputBytes:1}});assert.equal(project.files.length,0);assert.equal(project.symbols.length,0);assert.equal(project.coverage.traversalTruncated,true);assert.equal(project.coverage.dropped.files,1);
}));
