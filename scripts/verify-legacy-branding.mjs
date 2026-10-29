import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const main=await read('README.md');
const mentions=[...main.matchAll(/\bREA\b/g)];assert.ok(mentions.length<=1);
for(const mention of mentions)assert.ok(main.indexOf('## Origin & License')>=0&&mention.index>main.indexOf('## Origin & License'));
assert.ok(!/https?:\/\/(?:www\.)?(?:rea\.tools|github\.com\/morluto\/rea)/.test(main));
const pages=['NEXORA_README_FA.md','native/windows/README.md','docs/agent-environments-quickstart.md','docs/android-analysis.md','docs/ida-provider.md',
 ...['from-source','windows','linux','macos','updating'].map(n=>`docs/installation/${n}.md`),
 ...['README','codex','claude','generic-client'].map(n=>`docs/mcp/${n}.md`),
 ...(await readdir(new URL('../docs/readme/',import.meta.url))).filter(n=>/^README_.*\.md$/.test(n)).map(n=>'docs/readme/'+n)];
for(const file of pages){const text=await read(file);assert.ok(!/\bREA\b|rea-agents|https?:\/\/(?:www\.)?rea\.tools/.test(text),file);}
for(const file of ['UPSTREAM_README.md','docs/history/upstream-installation.md']){
 const text=await read(file);assert.ok(text.includes('morluto'));assert.ok(!/npx |npm (?:install|pack)|shields\.io|rea\.tools|star-history/.test(text),file);
}
const pkg=JSON.parse(await read('package.json'));assert.equal(pkg.name,'nexora-engine');assert.equal(pkg.private,true);assert.equal(pkg.bin['nexora-engine'],'scripts/nexora-engine.mjs');assert.equal(pkg.bin.rea,'scripts/rea.mjs');assert.equal(pkg.nexora.upstream.repository,'https://github.com/morluto/rea');
for(const file of ['.codex-plugin/plugin.json','.claude-plugin/plugin.json','.agents/plugins/marketplace.json','.claude-plugin/marketplace.json','server.json']){
 const text=await read(file);JSON.parse(text);assert.ok(!/\bREA\b|rea-agents|rea\.tools/.test(text),file);
}
for(const file of await readdir(new URL('../assets/brand/',import.meta.url))){if(!file.endsWith('.svg'))continue;assert.ok(!/\bREA\b|rea\.tools/.test(await read('assets/brand/'+file)),file);}
assert.deepEqual(await readFile(new URL('../assets/rea-plugin.png',import.meta.url)),await readFile(new URL('../assets/brand/mark.png',import.meta.url)));
assert.equal(await read('docs/assets/rea-showcases-dark.svg'),await read('assets/brand/hero-dark.svg'));
assert.equal(await read('docs/assets/rea-showcases.svg'),await read('assets/brand/hero-light.svg'));
const baseline='6d6f7412d9cb3b2b0b0fa1897dac7aa9429fa883';
const diff=execFileSync('git',['diff',baseline,'--','src','nexora','bridge','native/windows/src','package.json','package-lock.json','LICENSE','NOTICE.md','THIRD_PARTY_NOTICES.md','licenses','third_party','scripts/rea.mjs','scripts/nexora-engine.mjs','scripts/plugin-mcp-launcher.mjs'],{cwd:root,encoding:'utf8'});
assert.equal(diff,'','Engine algorithms, compatibility launchers, package and legal files must be unchanged');
console.log(JSON.stringify({currentUserPagesChecked:pages.length,pluginMetadataFiles:5,engineAlgorithms:'unchanged',compatibilityLaunchers:'unchanged',licenseAndNotices:'unchanged',upstreamMarketing:'removed from origin records'},null,2));
