import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTempDir } from './helpers.mjs';
import { scanBundle } from '../lib/bundle-scan.mjs';
test('bundle: calls spanning every small chunk are counted once',async()=>withTempDir(async dir=>{
 const p=join(dir,'bundle.js');await writeFile(p,'fetch("/api/v1/a"); axios.get("/api/v1/b"); '.repeat(150));
 for(const chunkBytes of [1,7,31,4096]) {const r=await scanBundle(p,{limits:{chunkBytes}});assert.equal(r.httpCallStyles.find(x=>x.value==='fetch').count,150);assert.equal(r.httpCallStyles.find(x=>x.value==='axios.get').count,150);assert.equal(r.apiPaths[0].count,150);}
}));
