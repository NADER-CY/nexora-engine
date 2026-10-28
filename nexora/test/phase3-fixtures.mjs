// Deterministic format fixtures, not executable payloads.
export function elfFixture(wide = true, le = true) {
  const b = Buffer.alloc(1024), u16 = (n,v) => le ? b.writeUInt16LE(v,n) : b.writeUInt16BE(v,n), u32 = (n,v) => le ? b.writeUInt32LE(v,n) : b.writeUInt32BE(v,n);
  const word = (n,v) => wide ? (le ? b.writeBigUInt64LE(BigInt(v),n) : b.writeBigUInt64BE(BigInt(v),n)) : u32(n,v);
  Buffer.from([127,69,76,70,wide ? 2 : 1,le ? 1 : 2,1]).copy(b); u16(16,2); u16(18,wide ? 62 : 3); word(24,0x1234);
  word(wide ? 40 : 32,128); u16(wide ? 58 : 46,wide ? 64 : 40); u16(wide ? 60 : 48,5); u16(wide ? 62 : 50,1);
  const names = '\0.shstrtab\0.strtab\0.symtab\0.dynamic\0'; b.write(names,512); b.write('\0hello\0libsample.so\0',600);
  function section(i,name,type,offset,size,link=0,entry=0) { const at=128+i*(wide?64:40); u32(at,name); u32(at+4,type); word(at+(wide?24:16),offset); word(at+(wide?32:20),size); u32(at+(wide?40:24),link); word(at+(wide?56:36),entry); }
  section(0,0,0,0,0); section(1,1,3,512,names.length); section(2,11,3,600,21); section(3,19,2,700,wide?48:32,2,wide?24:16); section(4,27,6,800,wide?32:16,2,wide?16:8);
  const at=700+(wide?24:16); u32(at,1); b[at+(wide?4:12)]=18; u16(at+(wide?6:14),1); word(at+(wide?8:4),0x1234);
  word(800,1); word(800+(wide?8:4),7); return b;
}
export function peFixture(wide = true) {
  const b=Buffer.alloc(2048); b.write('MZ'); b.writeUInt32LE(128,60); b.writeUInt32LE(0x4550,128); b.writeUInt16LE(wide?0x8664:0x14c,132); b.writeUInt16LE(1,134);
  const optional=wide?240:224, op=152, dir=op+(wide?112:96); b.writeUInt16LE(optional,148); b.writeUInt16LE(wide?0x20b:0x10b,op); b.writeUInt32LE(0x1000,op+16); b.writeUInt32LE(512,op+60); b.writeUInt16LE(0x160,op+70); b.writeUInt32LE(16,dir-4);
  if(wide)b.writeBigUInt64LE(0x140000000n,op+24); else b.writeUInt32LE(0x400000,op+28);
  const s=op+optional;b.write('.rdata',s); b.writeUInt32LE(1536,s+8);b.writeUInt32LE(0x1000,s+12);b.writeUInt32LE(1536,s+16);b.writeUInt32LE(512,s+20);
  b.writeUInt32LE(0x1000,dir+8); b.writeUInt32LE(40,dir+12); b.writeUInt32LE(0x1100,512); b.writeUInt32LE(0x1080,524); b.write('sample.dll\0',640);
  if(wide)b.writeBigUInt64LE(0x1180n,768);else b.writeUInt32LE(0x1180,768);b.write('Imported\0',898);
  b.writeUInt32LE(0x1200,dir);b.writeUInt32LE(128,dir+4);const ex=1024;b.writeUInt32LE(1,ex+16);b.writeUInt32LE(1,ex+20);b.writeUInt32LE(1,ex+24);b.writeUInt32LE(0x1280,ex+28);b.writeUInt32LE(0x1290,ex+32);b.writeUInt32LE(0x12a0,ex+36);b.writeUInt32LE(0x1400,1152);b.writeUInt32LE(0x12b0,1168);b.write('Exported\0',1200);return b;
}
export function machFixture(wide = true, le = true) {
  const b=Buffer.alloc(1024), u32=(n,v)=>le?b.writeUInt32LE(v,n):b.writeUInt32BE(v,n), u16=(n,v)=>le?b.writeUInt16LE(v,n):b.writeUInt16BE(v,n), word=(n,v)=>wide?(le?b.writeBigUInt64LE(BigInt(v),n):b.writeBigUInt64BE(BigInt(v),n)):u32(n,v);
  u32(0,wide?0xfeedfacf:0xfeedface);u32(4,wide?0x1000007:7);u32(12,2);u32(16,3);
  const head=wide?32:28, fixed=wide?72:56, sec=wide?80:68, segment=fixed+sec, dylib=40;u32(20,segment+24+dylib);
  u32(head,wide?0x19:1);u32(head+4,segment);u32(head+(wide?64:48),1);const s=head+fixed;b.write('__text',s);b.write('__TEXT',s+16);word(s+(wide?40:36),4);u32(s+(wide?48:40),512);
  let p=head+segment;u32(p,2);u32(p+4,24);u32(p+8,600);u32(p+12,1);u32(p+16,700);u32(p+20,32);p+=24;u32(p,12);u32(p+4,dylib);u32(p+8,24);b.write('libsample.dylib\0',p+24);
  u32(600,1);b[604]=15;b[605]=1;u16(606,0);word(608,0x1000);b.write('\0_hello\0',700);return b;
}
