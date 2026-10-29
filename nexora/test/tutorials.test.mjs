import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { REPO, runNode, withTempDir } from './helpers.mjs';
import { elfFixture, peFixture, machFixture } from './phase3-fixtures.mjs';

const guides = ['README.md','docs/milestones.md','docs/roadmap.md','docs/architecture/README.md','docs/tutorials/README.md','docs/tutorials/ghidra.md',
  ...['windows','linux','macos','from-source'].map(n=>`docs/installation/${n}.md`),
  ...['README','codex','claude','generic-client'].map(n=>`docs/mcp/${n}.md`),'examples/tutorial/README.md','CODE_OF_CONDUCT.md'];
test('developer guides: local Markdown links exist and JSON configuration examples parse', async () => {
  for (const name of guides) {
    const path=join(REPO,name),text=await readFile(path,'utf8');
    for (const [,target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(target)) continue;
      const destination=resolve(dirname(path),target.split('#')[0]);
      assert.ok(destination.startsWith(REPO),target);await access(destination);
    }
    for (const [,json] of text.matchAll(/```json\r?\n([\s\S]*?)```/g)) assert.doesNotThrow(()=>JSON.parse(json),name);
  }
});
async function cli(command,input) {
  const r=await runNode(['nexora/bin/nexora.mjs',command,input]);assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout);
}
test('tutorial CLI commands match the documented source, dependency, cycle and synthetic Ghidra invariants',async()=>{
  const source=await cli('analyze-source','examples/tutorial/project/main.js');
  assert.equal(source.schema,'nexora-source-analysis/v1');assert.ok(source.symbols.some(s=>s.name==='start'));
  assert.ok(source.calls.some(c=>c.name==='format'&&c.resolution==='unique-name-candidate'));
  const project=await cli('analyze-project','examples/tutorial/project');
  assert.ok(project.architecture.edges.some(e=>e.from==='main.js'&&e.to==='worker.js'));
  const cycle=await cli('analyze-project','examples/tutorial/cycle');assert.deepEqual(cycle.architecture.cycles[0].members,['a.js','b.js']);
  const ghidra=await cli('ghidra-report','examples/tutorial/ghidra.synthetic.jsonl');
  assert.equal(ghidra.functions[0].name,'example');assert.equal(ghidra.provider.version,'synthetic-example');
});
test('tutorial binary command: deterministic ELF, PE and Mach-O metadata examples',async()=>withTempDir(async dir=>{
  for(const [format,create] of [['ELF',elfFixture],['PE',peFixture],['Mach-O',machFixture]]) {
    const file=join(dir,'sample.bin');await writeFile(file,create());
    const r=await cli('analyze-binary',file);assert.equal(r.format,format);assert.equal(r.input.sha256.length,64);assert.ok(r.sections.length);
  }
}));
