import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {elfFixture} from './phase3-fixtures.mjs';
import {withTempDir} from './helpers.mjs';
import {analyzeBinary} from '../lib/binary-analysis.mjs';

function relocationFixture(wide=true,le=true,rela=true,count=1){
 const bytes=elfFixture(wide,le),u32=(p,n)=>le?bytes.writeUInt32LE(n,p):bytes.writeUInt32BE(n,p),word=(p,n)=>wide?(le?bytes.writeBigUInt64LE(BigInt(n),p):bytes.writeBigUInt64BE(BigInt(n),p)):u32(p,n);
 const width=wide?(rela?24:16):(rela?12:8),section=128+4*(wide?64:40);
 u32(section+4,rela?4:9);word(section+(wide?32:20),count*width);u32(section+(wide?40:24),3);u32(section+(wide?44:28),2);word(section+(wide?56:36),width);
 for(let i=0;i<count;i++){
  const at=800+i*width;word(at,0x1000+i*4);word(at+(wide?8:4),wide?0x100000002n:0x102);
  if(rela){if(wide)(le?bytes.writeBigInt64LE(-4n,at+16):bytes.writeBigInt64BE(-4n,at+16));else(le?bytes.writeInt32LE(-4,at+8):bytes.writeInt32BE(-4,at+8));}
 }
 return bytes;
}
for(const wide of [false,true])for(const le of [false,true])for(const rela of [false,true])test(`ELF relocations: ${wide?64:32} ${le?'LE':'BE'} ${rela?'RELA':'REL'} symbol identity and evidence`,async()=>withTempDir(async dir=>{
 const file=join(dir,'sample.elf');await writeFile(file,relocationFixture(wide,le,rela));const r=await analyzeBinary(file),rel=r.relocations[0];
 assert.equal(r.warnings.length,0,JSON.stringify(r.warnings));assert.equal(rel.kind,rela?'ELF-RELA':'ELF-REL');assert.equal(rel.type,2);assert.equal(rel.offset,'0x1000');
 assert.equal(rel.addend,rela?'-4':null);assert.equal(rel.symbolReference.name,'hello');assert.equal(rel.symbolReference.tableIndex,3);assert.equal(rel.symbolReference.index,1);assert.equal(rel.evidence.byteOffset,800);
 assert.equal(r.coverage.relocationDecoding,'ELF-section-REL-RELA-entries');
}));
test('ELF relocation malformed tables are isolated and retained entries report omissions',async()=>withTempDir(async dir=>{
 const file=join(dir,'x');const b=relocationFixture(true,true,true,6);await writeFile(file,b);const bounded=await analyzeBinary(file,{limits:{maxInventoryItems:5}});
 assert.equal(bounded.relocations.length,5);assert.equal(bounded.coverage.dropped.relocations,1);
 b.writeBigUInt64LE(0x300000002n,808);await writeFile(file,b);const malformed=await analyzeBinary(file);assert.ok(malformed.warnings.some(w=>/symbol index/.test(w.message)));assert.ok(malformed.symbols.some(s=>s.name==='hello'));
 b.writeUInt32LE(99,128+4*64+40);await writeFile(file,b);assert.ok((await analyzeBinary(file)).warnings.some(w=>/symbol-table link/.test(w.message)));
 await assert.rejects(analyzeBinary(file,{limits:{maxRecords:1}}),e=>e.code==='limit_exceeded');
}));
