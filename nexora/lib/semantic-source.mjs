import { extname } from 'node:path';
import { withInput, inventory, evidence, invalid } from './analysis-io.mjs';
import { NexoraError } from './errors.mjs';
import { resolveLimits } from './limits.mjs';

export const AST_EXTENSIONS = new Set(['.js','.mjs','.cjs','.jsx','.ts','.tsx']);
const FUNCTION = new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod','ClassPrivateMethod']);
const PATTERN = new Set(['ObjectPattern','ArrayPattern','RestElement','AssignmentPattern','ObjectProperty']);
function patternNames(node) {
  const names=[], stack=[node];
  while(stack.length){const n=stack.pop();if(!n)continue;if(n.type==='Identifier')names.push(n.name);
    else if(PATTERN.has(n.type)) {
      if(n.type==='ObjectPattern')stack.push(...n.properties);
      else if(n.type==='ArrayPattern')stack.push(...n.elements);
      else stack.push(n.type==='RestElement'?n.argument:n.type==='AssignmentPattern'?n.left:n.value);
    }}
  return names;
}
function scope(parent,kind,owner=parent?.owner??null){return {parent,kind,owner,bindings:new Map()};}
function bind(s,name,value){s.bindings.set(name,s.bindings.has(name)?{kind:'ambiguous'}:value);}
function lookup(s,name){for(;s;s=s.parent)if(s.bindings.has(name))return s.bindings.get(name);return null;}
const spelling=n=>n?.name??(typeof n?.value==='string'?n.value:null);

// Bounded inert AST interpretation, deliberately separate from compiler/type checking.
export async function analyzeSemanticSource(file,opts={}) {
  if(!AST_EXTENSIONS.has(extname(file).toLowerCase()))throw invalid('AST analysis currently supports JavaScript and TypeScript only');
  let parser;
  try {parser=await import(new URL(import.meta.resolve('@babel/parser')).href);}
  catch(e){if(e.code==='ERR_MODULE_NOT_FOUND')throw new NexoraError('not_found','AST analysis needs the locked Babel dependencies; use npm ci --ignore-scripts with a supported Node version');throw e;}
  const effective=resolveLimits(opts.limits);
  return withInput(file,{...opts,limits:{...effective,maxFileBytes:Math.min(effective.maxFileBytes,2*1024*1024)}},async io=>{
    const {limits,check}=io,retained={remaining:limits.maxOutputBytes};
    const symbols=inventory(limits.maxInventoryItems,retained),calls=inventory(limits.maxInventoryItems,retained),dependencies=inventory(limits.maxInventoryItems,retained),exports=inventory(limits.maxInventoryItems,retained);
    const observations=inventory(limits.maxInventoryItems,retained);
    const chunks=[];await io.eachChunk(c=>chunks.push(Buffer.from(c)));
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw invalid('AST input must be valid UTF-8');}
    check();const ext=extname(file).toLowerCase();let ast;
    try{ast=parser.parse(text,{sourceType:'unambiguous',attachComment:false,errorRecovery:false,plugins:[...(['.ts','.tsx'].includes(ext)?['typescript']:[]),...(['.jsx','.tsx'].includes(ext)?['jsx']:[])]});}
    catch{throw invalid('JavaScript/TypeScript AST parse failed');}
    check();
    const offsets=new Uint32Array(text.length+1);let bytes=0;
    for(let i=0;i<text.length;){if((i&1023)===0)check();const cp=text.codePointAt(i),width=cp>65535?2:1;offsets[i]=bytes;if(width===2)offsets[i+1]=bytes;bytes+=Buffer.byteLength(String.fromCodePoint(cp));i+=width;offsets[i]=bytes;}
    const ev=n=>evidence(offsets[n.start],offsets[n.end]-offsets[n.start],'derived','medium');
    const root=scope(null,'program'),functionIds=new WeakMap(),functionNames=new WeakMap(),classOwners=new WeakMap(),functionBodies=new WeakMap(),pendingCalls=[],writes=[],exportRequests=[];
    const factories=[],memberWrites=[],configurationAccesses=[],globalWrites=new Set();
    let nodes=0,dynamicScope=false;
    const stack=[{node:ast.program,scope:root}];
    while(stack.length){
      check();if(++nodes>limits.maxRecords)throw new NexoraError('limit_exceeded','AST node budget exceeded');
      const task=stack.pop(),n=task.node;let s=task.scope;
      if(FUNCTION.has(n.type)) {
        const name=n.id?.name??functionNames.get(n)??(!n.computed?spelling(n.key):null)??'<anonymous>';
        const item=symbols.add({id:`function@${offsets[n.start]}`,name,kind:n.type,parent:s.owner,evidence:ev(n.id??n.key??n),incomingCalls:[],outgoingCalls:[]});
        functionIds.set(n,item?.id??null);
        if(n.type==='FunctionDeclaration'&&n.id)bind(s,n.id.name,{kind:'function',node:n});
        s=scope(s,'parameters',item?.id??null);
        if(n.body?.type==='BlockStatement')functionBodies.set(n.body,item?.id??null);
        if(n.type==='FunctionExpression'&&n.id)bind(s,n.id.name,{kind:'function',node:n});
        for(const parameter of n.params??[])for(const name of patternNames(parameter))bind(s,name,{kind:'parameter'});
      } else if(n.type==='ClassExpression')s=scope(s,'block');
      else if(['BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement','SwitchStatement','ClassBody'].includes(n.type)) {
        s=functionBodies.has(n)?scope(s,'function',functionBodies.get(n)):scope(s,'block',classOwners.get(n)??s.owner);if(n.type==='CatchClause')for(const name of patternNames(n.param))bind(s,name,{kind:'parameter'});
      }
      if(n.type==='VariableDeclarator') {
        let target=s;if(task.variableKind==='var')while(target.parent&&target.kind!=='function'&&target.kind!=='program')target=target.parent;
        for(const name of patternNames(n.id))bind(target,name, n.id.type==='Identifier'&&FUNCTION.has(n.init?.type)?{kind:'function',node:n.init}:{kind:'variable'});
        if(n.id.type==='Identifier'&&FUNCTION.has(n.init?.type))functionNames.set(n.init,n.id.name);
        if(n.id.type==='Identifier'&&['CallExpression','NewExpression'].includes(n.init?.type))factories.push({scope:target,name:n.id.name,node:n.init,id:`instance@${offsets[n.id.start]}`});
      }
      if(['ClassDeclaration','ClassExpression','TSInterfaceDeclaration','TSEnumDeclaration','TSModuleDeclaration','TSDeclareFunction'].includes(n.type)) {
        if(n.id||n.type==='ClassExpression'){const item=symbols.add({id:`declaration@${offsets[n.start]}`,name:spelling(n.id)??'<anonymous-class>',kind:n.type,parent:s.owner,evidence:ev(n.id??n),incomingCalls:[],outgoingCalls:[]});if(n.id?.type==='Identifier')bind(s,n.id.name,{kind:'type-or-class',id:item?.id});if(n.body)classOwners.set(n.body,item?.id??null);}
      }
      if(n.type==='ImportDeclaration'){
        dependencies.add({name:n.source.value,method:'babel-import-declaration',evidence:ev(n.source)});
        for(const specifier of n.specifiers)bind(s,specifier.local.name,{kind:'import',source:n.source.value,evidence:ev(specifier),imported:specifier.type==='ImportSpecifier'?spelling(specifier.imported):specifier.type==='ImportDefaultSpecifier'?'default':'*',typeOnly:n.importKind==='type'||specifier.importKind==='type'});
      }
      if(n.type==='ExportNamedDeclaration'){
        if(n.source){dependencies.add({name:n.source.value,method:'babel-re-export-declaration',evidence:ev(n.source)});exportRequests.push({exported:'*',local:null,node:n});}
        else if(n.declaration){
          const names=n.declaration.type==='VariableDeclaration'?n.declaration.declarations.flatMap(d=>patternNames(d.id)):[n.declaration.id?.name].filter(Boolean);
          for(const name of names)exportRequests.push({exported:name,local:name,node:n});
        }else for(const specifier of n.specifiers)exportRequests.push({exported:spelling(specifier.exported),local:n.exportKind==='type'||specifier.exportKind==='type'?null:spelling(specifier.local),node:specifier});
      }
      if(n.type==='ExportDefaultDeclaration')exportRequests.push({exported:'default',local:n.declaration.id?.name??null,node:n});
      if(n.type==='ExportAllDeclaration'){
        dependencies.add({name:n.source.value,method:'babel-re-export-declaration',evidence:ev(n.source)});
        exportRequests.push({exported:'*',local:null,node:n});
      }
      if(n.type==='ImportExpression'&&n.source?.type==='StringLiteral')dependencies.add({name:n.source.value,method:'babel-dynamic-import-candidate',evidence:ev(n.source)});
      if(['CallExpression','OptionalCallExpression'].includes(n.type)){
        pendingCalls.push({node:n,scope:s,caller:s.owner});if(n.callee.type==='Identifier'&&n.callee.name==='eval')dynamicScope=true;
      }
      if(n.type==='WithStatement')dynamicScope=true;
      if(n.type==='AssignmentExpression')for(const name of patternNames(n.left))writes.push({scope:s,name});
      if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&n.left.object.type==='Identifier')memberWrites.push({scope:s,name:n.left.object.name});
      if(n.type==='UpdateExpression'&&n.argument.type==='Identifier')writes.push({scope:s,name:n.argument.name});
      if(n.type==='MemberExpression'&&n.object?.type==='MemberExpression'&&!n.object.computed&&n.object.object.type==='Identifier'&&n.object.object.name==='process'&&n.object.property.name==='env')configurationAccesses.push({scope:s,node:n});
      const children=[];
      for(const [key,value]of Object.entries(n)){
        if(['loc','extra','comments','leadingComments','trailingComments','innerComments'].includes(key))continue;
        if(Array.isArray(value)){for(const child of value)if(child&&typeof child.type==='string')children.push(child);}
        else if(value&&typeof value.type==='string')children.push(value);
      }
      for(let i=children.length-1;i>=0;i--)stack.push({node:children[i],scope:s,variableKind:n.type==='VariableDeclaration'?n.kind:task.variableKind});
    }
    for(const w of writes){check();const binding=lookup(w.scope,w.name);if(binding)binding.mutated=true;else globalWrites.add(w.name);}
    for(const w of memberWrites){check();const binding=lookup(w.scope,w.name);if(binding)binding.membersMutated=true;else globalWrites.add(w.name);}
    for(const f of factories){
      check();const binding=lookup(f.scope,f.name),factory=f.node.callee.type==='Identifier'?lookup(f.scope,f.node.callee.name):null;
      if(dynamicScope||binding?.kind!=='variable'||binding.mutated||binding.membersMutated||factory?.kind!=='import'||factory.typeOnly||factory.mutated)continue;
      const kind=factory.source==='express'&&factory.imported==='default'&&f.node.type==='CallExpression'?'express-instance':
        ['node:events','events'].includes(factory.source)&&['EventEmitter','default'].includes(factory.imported)&&f.node.type==='NewExpression'?'event-emitter-instance':null;
      if(kind)binding.instance={kind,id:f.id,name:f.name,factoryEvidence:ev(f.node),importEvidence:factory.evidence};
    }
    for(const access of configurationAccesses){
      check();if(dynamicScope||lookup(access.scope,'process')||globalWrites.has('process'))continue;
      const name=access.node.computed?access.node.property.type==='StringLiteral'?access.node.property.value:null:spelling(access.node.property);
      if(name)observations.add({kind:'configuration-reference',name,owner:access.scope.owner,evidence:ev(access.node),method:'babel-unshadowed-process-env-candidate',confidence:'medium'});
    }
    for(const p of pendingCalls){
      check();const id=p.node.callee.type==='Identifier'?p.node.callee.name:null,binding=id?lookup(p.scope,id):null;
      let callee=null,resolution=!id?'qualified-or-indirect':dynamicScope?'dynamic-scope-unknown':symbols.dropped?'truncated-symbol-inventory':binding?.mutated?'mutated-binding':binding?.kind==='function'?'ast-lexical-binding-candidate':binding?.kind==='import'&&!binding.typeOnly?'import-binding-candidate':binding?'shadowed-or-noncallable':'unresolved';
      if(resolution==='ast-lexical-binding-candidate')callee=functionIds.get(binding.node)??null;
      const call={id:`call@${offsets[p.node.start]}`,name:id??p.node.callee.type,caller:p.caller,callee,resolution,evidence:ev(p.node)};
      if(resolution==='import-binding-candidate')call.import={source:binding.source,imported:binding.imported,evidence:binding.evidence};
      calls.add(call);
      const member=p.node.callee;
      if(!dynamicScope&&member.type==='MemberExpression'&&!member.computed&&member.object.type==='Identifier'){
        const instance=lookup(p.scope,member.object.name)?.instance,method=spelling(member.property),literal=p.node.arguments[0];
        if(instance&&literal?.type==='StringLiteral'){
          const kind=instance.kind==='express-instance'&&['get','post','put','patch','delete','head','options','all'].includes(method)?'api-route-declaration':
            instance.kind==='event-emitter-instance'&&method==='emit'?'event-publisher':
            instance.kind==='event-emitter-instance'&&['on','once','addListener'].includes(method)?'event-consumer':null;
          if(kind){
            const handlerNode=p.node.arguments.at(-1),handlerBinding=handlerNode?.type==='Identifier'?lookup(p.scope,handlerNode.name):null;
            const handler=kind==='event-publisher'?null:handlerBinding?.kind==='function'&&!handlerBinding.mutated?functionIds.get(handlerBinding.node):FUNCTION.has(handlerNode?.type)?functionIds.get(handlerNode):null;
            observations.add({kind,name:literal.value,method,instance,owner:p.caller,handler:handler??null,evidence:ev(p.node),analysisMethod:'babel-import-and-instance-binding-candidate',confidence:'medium'});
          }
        }
      }
    }
    for(const request of exportRequests){
      check();const binding=request.local?lookup(root,request.local):null;
      const id=binding?.kind==='function'&&!binding.mutated&&!dynamicScope&&!symbols.dropped?functionIds.get(binding.node):null;
      exports.add({name:request.exported,local:request.local,symbol:id??null,evidence:ev(request.node),resolution:id?'local-function-candidate':'unresolved'});
    }
    const index=new Map(symbols.items.map(s=>[s.id,s]));
    for(const c of calls.items){index.get(c.caller)?.outgoingCalls.push(c.id);index.get(c.callee)?.incomingCalls.push(c.id);}
    return {schema:'nexora-source-analysis-ast/v1',language:['.ts','.tsx'].includes(ext)?'typescript':'javascript',method:'babel-ast-lexical-scopes',symbols:symbols.items,calls:calls.items,dependencies:dependencies.items,module:{exports:exports.items,observations:observations.items},
      coverage:{nodes,dynamicScope,compilerTypeChecking:false,dropped:{symbols:symbols.dropped,calls:calls.dropped,dependencies:dependencies.dropped,exports:exports.dropped,observations:observations.dropped}},
      limitations:['AST lexical binding candidates, not compiler/type or runtime proof. JS/TS only; input capped at 2 MiB before parsing.',
        'Member/indirect calls, CommonJS, re-exports and runtime mutation remain unresolved. Direct eval/with conservatively invalidate local call binding.',
        'Babel parsing is synchronous; budgets are cooperative checks before/after parsing and during traversal, not hard OS limits.']};
  });
}
