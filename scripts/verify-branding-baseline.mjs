import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const baseline='0968dfeea5f14c7094e2d955b75bca838f8aeb5c';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
const normalize=s=>s.replace(/\r\n/g,'\n').replace(/\b(?:REA|NEXORA ENGINE)\b/g,'PRODUCT');
const changed=git('diff','--name-only',baseline,'--','src','scripts','tests','nexora/test/fork-identity.test.mjs').trim().split('\n').filter(Boolean);
const documentationFiles=['scripts/verify-github-docs.mjs','scripts/verify-branding-baseline.mjs','scripts/verify-legacy-branding.mjs','scripts/nexora-engine.mjs','tests/conformance/readmeConsistency.test.ts','tests/boundary/cli/githubActionsExample.test.ts'];
const inputs=changed.filter(f=>!documentationFiles.includes(f));
const blobs=execFileSync('git',['cat-file','--batch'],{cwd:root,input:inputs.map(f=>`${baseline}:${f}\n`).join(''),maxBuffer:32*1024*1024,windowsHide:true});
const original=new Map();let offset=0;
for(const file of inputs){const end=blobs.indexOf(10,offset),header=blobs.subarray(offset,end).toString(),size=Number(header.split(' ').at(-1));assert.ok(Number.isInteger(size),header);offset=end+1;original.set(file,blobs.subarray(offset,offset+size).toString());offset+=size+1;}
let verified=0;
for(const file of changed){
 if(documentationFiles.includes(file))continue;
 let before=original.get(file),after=readFileSync(new URL('../'+file,import.meta.url),'utf8');
 if(file==='nexora/test/fork-identity.test.mjs')before=before.replace('assert.equal(PRODUCT_IDENTITY.cliBinary, "rea", "rea binary kept for backwards compatibility");','assert.equal(PRODUCT_IDENTITY.cliBinary, "nexora-engine", "primary CLI uses the product name; package retains the rea alias");');
 if(file==='src/identity.ts')before=before.replace('cliBinary: "rea"','cliBinary: "nexora-engine"');
 if(file==='scripts/rea.mjs'){
  before=before.replace(/`REA's compiled runtime is missing\.[^\n]+/,after.match(/`NEXORA ENGINE's compiled runtime is missing\.[^\n]+/)[0]);
 }
 if(file==='scripts/plugin-mcp-launcher.mjs')before=before.replace('npm ci && npm run build:cached','npm ci --ignore-scripts; follow docs/installation/from-source.md; npm run build');
 assert.equal(normalize(after),normalize(before),`Non-branding source change: ${file}`);verified++;
}
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const oldPkg=JSON.parse(git('show',`${baseline}:package.json`));
for(const key of ['dependencies','devDependencies','optionalDependencies','scripts','engines','private','nexora'])assert.deepEqual(pkg[key],oldPkg[key],`Package contract changed: ${key}`);
console.log(JSON.stringify({baseline,filesWithOnlyProductTextChanges:verified,algorithmChanges:0,dependencyChanges:0}));
