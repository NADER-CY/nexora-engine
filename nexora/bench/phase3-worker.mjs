// One workload per process; peak RSS and CPU include imports, elapsedAnalysisMs does not.
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { analyzeSource } from '../lib/source-analysis.mjs';
import { analyzeBinary } from '../lib/binary-analysis.mjs';
import { analyzeProject } from '../lib/project-analysis.mjs';
import { ghidraReport } from '../lib/ghidra-report.mjs';
import { scanBundle } from '../lib/bundle-scan.mjs';
import { ConcurrencyGate } from '../lib/limits.mjs';
const [mode,file,baseline]=process.argv.slice(2), start=performance.now();
let result;
if(mode==='baseline-bundle')result=await(await import(pathToFileURL(baseline).href)).scanBundle(file);
else if(mode==='bundle')result=await scanBundle(file);
else if(mode==='source')result=await analyzeSource(file);
else if(mode==='binary')result=await analyzeBinary(file);
else if(mode==='project')result=await analyzeProject(file);
else if(mode==='ghidra')result=await ghidraReport(file);
else if(mode==='gate') {const gate=new ConcurrencyGate({concurrency:2,maxQueue:32});for(let i=0;i<10000;i++)await gate.run(async()=>1);result={operations:10000,stats:gate.stats};}
else throw new Error('Unknown benchmark workload');
const elapsedAnalysisMs=performance.now()-start;
const normalized={...result,elapsedMs:undefined};
const json=JSON.stringify(normalized), usage=process.resourceUsage();
console.log(JSON.stringify({mode,elapsedAnalysisMs,cpuMs:(usage.userCPUTime+usage.systemCPUTime)/1000,peakRssMiB:usage.maxRSS/1024,reportBytes:Buffer.byteLength(json),resultDigest:createHash('sha256').update(json).digest('hex'),coverage:result.coverage,counts:{symbols:result.symbols?.length,calls:result.calls?.length,dependencies:result.dependencies?.length,functions:result.functions?.length,references:result.references?.length},input:result.input}));
