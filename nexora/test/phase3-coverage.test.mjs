import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withTempDir} from './helpers.mjs';
import {analyzeSource} from '../lib/source-analysis.mjs';
import {analyzeBinary} from '../lib/binary-analysis.mjs';
import {readPeImports} from '../../scripts/lib/pe-imports.mjs';
test('source: truncated symbol inventories never establish unique binding',async()=>withTempDir(async dir=>{
 const p=join(dir,'x.js');await writeFile(p,'function leaf(){} function leaf(){} leaf();');const r=await analyzeSource(p,{limits:{maxInventoryItems:1}});assert.equal(r.calls[0].resolution,'truncated-symbol-inventory');assert.equal(r.calls[0].callee,null);
}));
test('real PE: host Node regular imports agree with preexisting independent parser',{skip:process.platform!=='win32'},async()=>{
 const oracle=readPeImports(await readFile(process.execPath));const actual=await analyzeBinary(process.execPath);assert.deepEqual(actual.dependencies.map(x=>x.name.toLowerCase()).sort(),oracle.imports.map(x=>x.toLowerCase()).sort());assert.equal(actual.warnings.length,0);assert.ok(actual.symbols.length>0);
});
