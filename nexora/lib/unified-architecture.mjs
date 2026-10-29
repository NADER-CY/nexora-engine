import { budget, inventory } from './analysis-io.mjs';
import { NexoraError } from './errors.mjs';
import { analyzeProject } from './project-analysis.mjs';

const compare=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
const label=value=>Array.from(String(value)).map(c=>/[a-zA-Z0-9 /._-]/.test(c)?c:`&#${c.codePointAt(0)};`).join('');

export function renderArchitectureMermaid(graph,{maxBytes=64*1024*1024,check=()=>{}}={}) {
  const lines=[],aliases=new Map();let bytes=0;
  const add=line=>{check();bytes+=Buffer.byteLength(line)+1;if(bytes>maxBytes)throw new NexoraError('limit_exceeded','Mermaid output exceeds byte budget');lines.push(line);};
  add('flowchart TD');add(`  %% Static candidates; coverage ${graph.coverage.completeWithinScope?'complete within declared scope':'partial or unresolved'}`);
  for(const [i,node]of graph.nodes.entries()){const id=`n${i}`;aliases.set(node.id,id);add(`  ${id}["${label(node.label)}"]`);}
  for(const edge of graph.relationships){const from=aliases.get(edge.from),to=aliases.get(edge.to);if(from&&to)add(`  ${from} -->|${label(edge.kind)}| ${to}`);}
  return lines.join('\n');
}

// Project/source owners parse facts once. This projection only adds identity and graph structure.
export function buildArchitectureGraph(project,opts={}) {
  const b=opts.budget??budget(opts),retained={remaining:b.limits.maxOutputBytes};
  const nodes=inventory(b.limits.maxInventoryItems,retained),relationships=inventory(b.limits.maxInventoryItems,retained),nodeIndex=new Map();
  const files=new Map(project.files.filter(f=>!f.failed&&f.input).map(f=>[f.path,f]));
  let omittedRelationships=0,unresolved=0;
  const sourceIncomplete=project.coverage.traversalTruncated||project.failures.length>0||Object.values(project.coverage.dropped).some(Boolean)||project.files.some(f=>f.failed||f.coverage?.dynamicScope||f.coverage?.unterminatedLexeme||f.coverage?.unclosedFunctions||f.coverage?.longHeaders||f.coverage?.droppedTokens||Object.values(f.coverage?.dropped??{}).some(Boolean));
  const node=value=>{b.check();if(nodeIndex.has(value.id))return nodeIndex.get(value.id);const added=nodes.add(value);if(added)nodeIndex.set(value.id,added);return added;};
  const provenance=(file,range)=>({file,sha256:files.get(file)?.input.sha256??null,range});
  const edge=(value)=>{
    b.check();if(!nodeIndex.has(value.from)||!nodeIndex.has(value.to)){omittedRelationships++;return;}
    if(value.coverage==='unresolved')unresolved++;
    relationships.add({...value,sourceCoverage:sourceIncomplete?'partial-source':'retained-source'});
  };
  const moduleId=file=>`module:${file}`;
  const sourceMethod=project.semanticCoverage?'babel-ast-lexical-scopes':'streaming-lexical-candidates';
  for(const f of [...files.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0))node({id:moduleId(f.path),kind:'module',label:f.path,identity:{file:f.path,...f.input}});
  for(const s of [...project.symbols].sort(compare)){
    node({id:s.id,kind:'symbol',label:s.name,identity:{file:s.file,sha256:files.get(s.file)?.input.sha256??null},symbolKind:s.kind??'lexical-function'});
  }
  for(const s of [...project.symbols].sort(compare))edge({id:`declares:${s.id}`,kind:'declares',from:s.parent&&nodeIndex.has(s.parent)?s.parent:moduleId(s.file),to:s.id,
    evidence:[provenance(s.file,s.evidence)],method:sourceMethod,confidence:'medium',coverage:'candidate'});
  const dependencies=[...project.dependencies].sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:(a.evidence?.byteOffset??0)-(b.evidence?.byteOffset??0));
  for(const [i,d]of dependencies.entries()){
    b.check();const target=d.target&&files.has(d.target)?moduleId(d.target):`unresolved-module:${JSON.stringify([d.file,d.name])}`;
    const resolved=d.resolution==='local-path-candidate'&&files.has(d.target);
    if(!resolved)node({id:target,kind:'unresolved-module',label:d.name,identity:null});
    edge({id:`dependency:${d.file}:${d.evidence?.byteOffset??i}`,kind:'depends-on',from:moduleId(d.file),to:target,evidence:[provenance(d.file,d.evidence)],method:d.method??'relative-path-lexical-candidate',confidence:resolved?'medium':'low',coverage:resolved?'candidate':'unresolved',resolution:d.resolution});
  }
  for(const c of [...project.calls].sort(compare)){
    b.check();const resolved=!!c.callee&&nodeIndex.has(c.callee),target=resolved?c.callee:`unresolved-call:${c.id}`;
    if(!resolved)node({id:target,kind:'unresolved-call',label:c.name,identity:null});
    const proof=[provenance(c.file,c.evidence)];
    if(c.relationshipEvidence){proof.push(provenance(c.file,c.relationshipEvidence.import),{file:c.relationshipEvidence.targetFile,sha256:c.relationshipEvidence.targetSha256,range:c.relationshipEvidence.export});}
    edge({id:`call:${c.id}`,kind:'call-candidate',from:c.caller&&nodeIndex.has(c.caller)?c.caller:moduleId(c.file),to:target,evidence:proof,method:sourceMethod,confidence:resolved?'medium':'low',coverage:resolved?'candidate':'unresolved',resolution:c.resolution});
  }
  for(const f of [...files.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0))for(const [i,o]of (f.module?.observations??[]).entries()){
    b.check();const id=`observation:${f.path}:${o.evidence.byteOffset}:${i}`,from=o.owner&&nodeIndex.has(`${f.path}#${o.owner}`)?`${f.path}#${o.owner}`:moduleId(f.path);
    const target=o.instance?`${f.path}#${o.instance.id}:${JSON.stringify([o.kind==='api-route-declaration'?o.method:'event',o.name])}`:`configuration:${o.name}`;
    node({id:target,kind:o.kind==='configuration-reference'?'configuration':o.kind==='api-route-declaration'?'api-route':'event',label:o.kind==='api-route-declaration'?`${o.method.toUpperCase()} ${o.name}`:o.name,identity:o.kind==='configuration-reference'?null:{file:f.path,sha256:f.input.sha256}});
    const proof=[provenance(f.path,o.evidence)];if(o.instance)proof.push(provenance(f.path,o.instance.importEvidence),provenance(f.path,o.instance.factoryEvidence));
    edge({id,kind:o.kind,from,to:target,evidence:proof,method:o.analysisMethod??o.method,confidence:o.confidence,coverage:'candidate'});
    if(o.handler){const handler=`${f.path}#${o.handler}`;edge({id:`handler:${id}`,kind:'handler-candidate',from:target,to:handler,evidence:proof,method:'babel-handler-binding-candidate',confidence:'medium',coverage:'candidate'});}
  }
  const cycles=project.architecture.cycles.filter(c=>c.members.every(file=>nodeIndex.has(moduleId(file)))),droppedCycles=project.architecture.cycles.length-cycles.length;
  const graph={schema:'nexora-unified-architecture/v1',nodes:[...nodes.items].sort(compare),relationships:[...relationships.items].sort(compare),
    cycles,
    coverage:{scope:project.semanticCoverage?'JS/TS AST declarations, direct ESM call candidates and supported registration syntax':'lexical declarations, file dependencies and per-file call candidates',
      completeWithinScope:!sourceIncomplete&&!nodes.dropped&&!relationships.dropped&&!omittedRelationships&&!droppedCycles&&!unresolved&&project.architecture.coverage.complete,
      sourceIncomplete,unresolvedRelationships:unresolved,dropped:{nodes:nodes.dropped,relationships:relationships.dropped,relationshipsWithMissingNodes:omittedRelationships,cycles:droppedCycles},source:project.coverage},
    limitations:['Static evidence and candidate relationships only; no live-system access or traffic collection.',
      'No inferred service/database boundaries, WebSocket message schemas or runtime call guarantees. Binary instruction CFGs are not reconstructed by this source graph.',
      'Unknown targets and omitted/truncated input cannot establish absence of relationships or cycles.']};
  graph.mermaid=renderArchitectureMermaid(graph,{maxBytes:retained.remaining,check:()=>b.check()});
  return graph;
}

export async function analyzeArchitecture(root,opts={}) {
  const b=budget(opts);let project;
  if(opts.semantic){const {analyzeSemanticProject}=await import('./semantic-project.mjs');project=await analyzeSemanticProject(root,opts);}
  else project=await analyzeProject(root,opts);
  b.check();return buildArchitectureGraph(project,{...opts,budget:b});
}
