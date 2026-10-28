import { mkdir, open, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { elfFixture,peFixture,machFixture } from '../test/phase3-fixtures.mjs';
const [dataArg,baselineArg,outArg]=process.argv.slice(2);
if(!dataArg||!baselineArg||!outArg)throw new Error('Usage: node nexora/bench/phase3.mjs DATA_DIR PHASE2_BUNDLE_MODULE OUTPUT.json');
const data=resolve(dataArg),baseline=resolve(baselineArg),worker=fileURLToPath(new URL('./phase3-worker.mjs',import.meta.url));await mkdir(data,{recursive:true});
const fixtures={};
async function padded(name,prelude,mb,tail='') {
 const path=join(data,name),handle=await open(path,'w');try {await handle.write(prelude);const chunk=Buffer.alloc(1048576); for(let at=0;at<chunk.length;at+=23)chunk.write('benchmark padding line\n',at,Math.min(23,chunk.length-at));for(let i=0;i<mb;i++)await handle.write(chunk);await handle.write(tail);}finally{await handle.close();}return path;
}
fixtures.small=await padded('source-2m.js','function leaf(){} function root(){leaf();} /*',2,'*/ function tail(){root();}');
fixtures.large=await padded('source-64m.js','function leaf(){} function root(){leaf();} /*',64,'*/ function tail(){root();}');
fixtures.huge=await padded('source-256m.js','function leaf(){} function root(){leaf();} /*',256,'*/ function tail(){root();}');
fixtures.bundle=await padded('bundle-16m.js','fetch("/api/v1/a");',16,'fetch("/api/v1/b");');
fixtures.dense=join(data,'dense.js');await writeFile(fixtures.dense,'function leaf(){} function root(){leaf();} '.repeat(50000));
fixtures.boundary=join(data,'boundary.js');await writeFile(fixtures.boundary,'fetch("/api/v1/a"); axios.get("/api/v1/b"); '.repeat(50000));
for(const [name,bytes] of [['elf',elfFixture()],['pe',peFixture()],['macho',machFixture()]]){fixtures[name]=join(data,name+'.bin');await writeFile(fixtures[name],bytes);}
fixtures.binaryLarge=await padded('pe-64m.bin',peFixture(),64);
fixtures.project=join(data,'project');await mkdir(fixtures.project,{recursive:true});
for(const [ext,code] of Object.entries({js:'function leaf(){} function root(){leaf();}',ts:'function leaf(x:number){return x;} function root(){leaf(1);}',go:'package p\nfunc leaf(){}\nfunc root(){leaf();}',rs:'fn leaf(){} fn root(){leaf();}',c:'void leaf(){} int root(){leaf();}',cpp:'void leaf(){} int root(){leaf();}'}))await writeFile(join(fixtures.project,'sample.'+ext),code);
fixtures.ghidra=join(data,'ghidra.jsonl');const h=await open(fixtures.ghidra,'w');try{await h.write(JSON.stringify({kind:'header',schema:'nexora-ghidra-export/v1',binarySha256:'a'.repeat(64),version:'synthetic'})+'\n');for(let i=0;i<10000;i++)await h.write(JSON.stringify({kind:'function',address:i.toString(16),name:'function_'+i,status:i%100?'ok':'failed',pseudocode:'int sample(){return 1;}'})+'\n');await h.write(JSON.stringify({kind:'footer',functions:10000,complete:true})+'\n');}finally{await h.close();}
const jobs=[['Phase2 bundle 16MiB','baseline-bundle',fixtures.bundle],['Phase3A bundle 16MiB','bundle',fixtures.bundle],['Phase2 dense bundle','baseline-bundle',fixtures.boundary],['Phase3A dense bundle','bundle',fixtures.boundary],['source 2MiB','source',fixtures.small],['source 64MiB','source',fixtures.large],['source 256MiB','source',fixtures.huge],['source dense 2MiB','source',fixtures.dense],['ELF metadata','binary',fixtures.elf],['PE metadata','binary',fixtures.pe],['Mach-O metadata','binary',fixtures.macho],['PE 64MiB','binary',fixtures.binaryLarge],['real host Node binary','binary',process.execPath],['project six languages','project',fixtures.project],['Ghidra 10000 functions','ghidra',fixtures.ghidra],['gate 10000 operations','gate','unused']];
const runs=[];
for(const [label,mode,file]of jobs)for(let repeat=0;repeat<3;repeat++){
 const started=performance.now();const record=await new Promise((ok,bad)=>{const child=spawn(process.execPath,['--max-old-space-size=128',worker,mode,file,baseline],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill(),45000);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',bad);child.on('close',code=>{clearTimeout(timer);if(code)bad(new Error(label+': '+stderr));else ok(JSON.parse(stdout));});});
 runs.push({label,repeat,cacheLabel:repeat===0?'first-run (cache not controlled)':'repeat (new process, warm OS cache)',endToEndMs:performance.now()-started,...record});process.stderr.write(`${label} #${repeat+1}: ${record.elapsedAnalysisMs.toFixed(1)} ms, ${record.peakRssMiB.toFixed(1)} MiB\n`);
}
const output={schema:'nexora-phase3a-benchmark/v1',node:process.version,platform:process.platform,architecture:process.arch,heapLimitMiB:128,method:'Three sequential new processes per workload. No OS cache flushing; first-run is not a guaranteed cold-cache measurement. RSS/CPU are process totals; workload time excludes static imports. No subprocesses in analysis workers.',runs};
await writeFile(resolve(outArg),JSON.stringify(output,null,2)+'\n');
