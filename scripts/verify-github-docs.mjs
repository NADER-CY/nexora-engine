import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const authored=['README.md','CONTRIBUTING.md','CODE_OF_CONDUCT.md','assets/brand/README.md','docs/start-here.md','docs/nexora-roadmap.md','docs/milestones.md','docs/github-experience-verification.md','docs/github-settings.md','docs/launch-announcement.md','docs/demos/README.md','docs/architecture/README.md','examples/tutorial/README.md',
 ...['windows','linux','macos','from-source'].map(n=>`docs/installation/${n}.md`),...['README','codex','claude','generic-client'].map(n=>`docs/mcp/${n}.md`),'docs/tutorials/README.md','docs/tutorials/ghidra.md'];
const slug=s=>s.toLowerCase().replace(/<[^>]*>/g,'').replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s/g,'-');
async function checkLink(name,target){
 if(/^(https?:|mailto:)/.test(target))return false;
 const [file,anchor]=target.split('#'),destination=resolve(dirname(join(root,name)),decodeURIComponent(file));
 assert.ok(!relative(root,destination).startsWith('..'),'Link escapes repository: '+target);await access(destination);
 if(anchor&&destination.endsWith('.md')){
  const text=await readFile(destination,'utf8'),ids=new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m=>slug(m[1])));
  for(const m of text.matchAll(/\bid=["']([^"']+)["']/g))ids.add(m[1]);
  assert.ok(ids.has(anchor),`${name}: missing anchor ${target}`);
 }
 return true;
}
let links=0,jsonBlocks=0;
for(const name of authored){
 const text=await readFile(join(root,name),'utf8');
 // Historical upstream contribution links are preserved; check newly added prefix only.
 const scoped=name==='CONTRIBUTING.md'?text.split('# Contributing to REA')[0]:text;
 for(const [,target]of scoped.matchAll(/\]\(([^)]+)\)/g))if(await checkLink(name,target))links++;
 for(const [,target]of scoped.matchAll(/(?:href|src|srcset)="([^"]+)"/g))if(await checkLink(name,target))links++;
 for(const [,json]of text.matchAll(/```json\r?\n([\s\S]*?)```/g)){JSON.parse(json);jsonBlocks++;}
}
let svgCount=0;
for(const name of await readdir(join(root,'assets/brand'))){if(!name.endsWith('.svg'))continue;const svg=await readFile(join(root,'assets/brand',name),'utf8');
 assert.ok(svg.includes('<title')&&svg.includes('viewBox='),name);assert.ok(!/<script|foreignObject|onload=|<image|(?:href|src)=["']https?:/i.test(svg),name);svgCount++;}
const png=await readFile(join(root,'assets/brand/social-preview.png'));assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),1280);assert.equal(png.readUInt32BE(20),640);
const run=async(command,input)=>{
 const r=await execute(process.execPath,['nexora/bin/nexora.mjs',command,input],{cwd:root,timeout:20000,maxBuffer:4*1024*1024,windowsHide:true});return JSON.parse(r.stdout);
};
const source=await run('analyze-source','examples/tutorial/project/main.js');assert.ok(source.symbols.some(s=>s.name==='format'));assert.ok(source.calls.some(c=>c.name==='format'&&c.resolution==='unique-name-candidate'));
const project=await run('analyze-project','examples/tutorial/project');assert.ok(project.architecture.edges.some(e=>e.from==='main.js'&&e.to==='worker.js'));
const cycle=await run('analyze-project','examples/tutorial/cycle');assert.deepEqual(cycle.architecture.cycles[0].members,['a.js','b.js']);assert.equal(cycle.architecture.coverage.complete,true);
const synthetic=await run('ghidra-report','examples/tutorial/ghidra.synthetic.jsonl');assert.equal(synthetic.provider.version,'synthetic-example');assert.equal(synthetic.functions[0].name,'example');
for(const [name,actual]of [['source',source],['project',project],['cycle',cycle],['ghidra-synthetic',synthetic]]){
 const recorded=JSON.parse(await readFile(join(root,`docs/demos/${name}.json`),'utf8'));assert.equal(recorded.schema,actual.schema);assert.equal(recorded.input?.sha256,actual.input?.sha256);}
const readme=await readFile(join(root,'README.md'),'utf8');assert.ok(readme.includes('PR #1 is not merged or released'));assert.ok(readme.includes('No official npm package'));assert.ok(readme.includes('Copyright (c) 2026 morluto'));
const {stdout:engineDiff}=await execute('git',['diff','origin/main','--','src','nexora','bridge','native','package.json','package-lock.json','LICENSE','NOTICE.md','THIRD_PARTY_NOTICES.md'],{cwd:root,maxBuffer:1024*1024});assert.equal(engineDiff,'','Engine/package/license files must remain unchanged');
const {stdout:untrackedEngine}=await execute('git',['ls-files','--others','--exclude-standard','--','src','nexora','bridge','native'],{cwd:root});assert.equal(untrackedEngine,'','Do not add engine files in the documentation branch');
console.log(JSON.stringify({markdownFiles:authored.length,localReferencesChecked:links,jsonExamplesParsed:jsonBlocks,svgAssetsChecked:svgCount,socialPreview:'1280x640',offlineCliExamplesPassed:4,engineAndLicenseDiff:'unchanged',node:process.version},null,2));
