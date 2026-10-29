import { analyzeProject } from './project-analysis.mjs';
import { analyzeSemanticSource, AST_EXTENSIONS } from './semantic-source.mjs';
import { budget } from './analysis-io.mjs';

export async function analyzeSemanticProject(root,opts={}) {
  const b=budget(opts);
  const result=await analyzeProject(root,{...opts,sourceAnalyzer:analyzeSemanticSource,extensions:AST_EXTENSIONS});
  const files=new Map(result.files.map(f=>[f.path,f]));
  const symbols=new Map(result.symbols.map(s=>[s.id,s]));
  const dependencyIndex=new Map();
  for(const d of result.dependencies){const key=JSON.stringify([d.file,d.name]);const list=dependencyIndex.get(key)??[];list.push(d);dependencyIndex.set(key,list);}
  const incomplete=result.coverage.traversalTruncated||Object.values(result.coverage.dropped).some(Boolean);
  let resolved=0,unresolved=0;
  for(const call of result.calls){
    b.check();if(call.resolution!=='import-binding-candidate')continue;
    const candidates=dependencyIndex.get(JSON.stringify([call.file,call.import.source]))??[];
    const targets=[...new Set(candidates.filter(d=>d.resolution==='local-path-candidate').map(d=>d.target))];
    const file=targets.length===1?files.get(targets[0]):null;
    const exported=file?.module?.exports.filter(e=>e.name===call.import.imported)??[];
    const target=exported.length===1&&exported[0].symbol?`${file.path}#${exported[0].symbol}`:null;
    const callerFile=files.get(call.file);
    if(!incomplete&&callerFile&&!Object.values(callerFile.coverage?.dropped??{}).some(Boolean)&&file&&!file.failed&&!file.coverage?.dynamicScope&&!Object.values(file.coverage?.dropped??{}).some(Boolean)&&call.import.imported!=='*'&&target&&symbols.has(target)){
      call.callee=target;call.resolution='cross-file-export-candidate';
      call.relationshipEvidence={import:call.import.evidence,export:exported[0].evidence,targetFile:file.path,targetSha256:file.input.sha256};
      symbols.get(target).incomingCalls.push(call.id);resolved++;
    }else unresolved++;
  }
  result.schema='nexora-project-analysis-ast/v1';
  result.semanticCoverage={method:'babel-ast-lexical-scopes-and-direct-esm-exports',crossFileCandidates:resolved,unresolvedImportedCalls:unresolved,languages:['javascript','typescript'],compilerTypeChecking:false};
  result.limitations=['Bounded JS/TS AST candidates only; full compiler/type checking and runtime behavior are not established.',
    'Only direct, uniquely resolved relative ESM function exports are linked across files. Re-exports, namespace/member calls, package/tsconfig rules and other languages remain unresolved.',
    ...result.limitations.filter(s=>!s.startsWith('Calls remain'))];
  return result;
}
