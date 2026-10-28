import { NexoraError } from './errors.mjs';
import { withInput, inventory, evidence, invalid } from './analysis-io.mjs';
const hex = n => `0x${n.toString(16)}`;
function number64(b, at, le) { const n = le ? b.readBigUInt64LE(at) : b.readBigUInt64BE(at); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid('File offset exceeds safe integer range'); return Number(n); }
export async function analyzeBinary(file, opts = {}) {
  return withInput(file, opts, async io => {
    const { size, limits, check } = io, cap = limits.maxInventoryItems;
    const retained = { remaining: limits.maxOutputBytes };
    const sections = inventory(cap, retained), symbols = inventory(cap, retained), dependencies = inventory(cap, retained), warnings = [];
    const relocations = inventory(cap, retained), debugRecords = inventory(cap, retained);
    let records = 0;
    const tick = () => { check(); if (++records > limits.maxRecords) throw new NexoraError('limit_exceeded', 'Binary record budget exceeded'); };
    // Eight fixed pages bound random-access caching independently of file size.
    const cache = new Map();
    const read = async (at, n) => {
      check();
      if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(n) || n < 0 || at > size - n) throw invalid('Binary table range outside file');
      if (n > 65536) return io.read(at, n);
      const page = Math.floor(at / 65536) * 65536;
      if (at + n > page + 65536) return io.read(at, n);
      let data = cache.get(page);
      if (!data) { data = await io.read(page, Math.min(65536, size - page)); if (cache.size === 8) cache.delete(cache.keys().next().value); cache.set(page, data); }
      return data.subarray(at - page, at - page + n);
    };
    const range = (at, n) => { if (!Number.isSafeInteger(at) || !Number.isSafeInteger(n) || at < 0 || n < 0 || at > size - n) throw invalid('Binary data range outside file'); };
    const string = async (at, end = size) => {
      if (at < 0 || at >= end || end > size) throw invalid('String offset outside table');
      const b = await read(at, Math.min(2048, end - at)); const nul = b.indexOf(0);
      return { name: b.subarray(0, nul < 0 ? b.length : nul).toString('utf8'), truncated: nul < 0, evidence: evidence(at, nul < 0 ? b.length : nul + 1) };
    };
    const first = await read(0, Math.min(size, 64));
    let metadata;
    if (first.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) metadata = await elf();
    else if (first.toString('ascii', 0, 2) === 'MZ') metadata = await pe();
    else metadata = await macho();
    cache.clear(); await io.eachChunk();
    for (const section of sections.items) if (/^(\.debug|\.zdebug|__debug)/.test(section.name)) debugRecords.add({ kind: 'debug-section', name: section.name, evidence: section.evidence, interpretation: 'section-name-only; debug payload not decoded' });
    return { schema: 'nexora-binary-analysis/v1', ...metadata, sections: sections.items, symbols: symbols.items, dependencies: dependencies.items, relocations: relocations.items, debugRecords: debugRecords.items, warnings,
      coverage: { records, instructionAnalysis: 'not-performed', relocationDecoding: metadata.format === 'PE' ? 'PE-base-relocation-entries' : 'not-performed', dropped: { sections: sections.dropped, symbols: symbols.dropped, dependencies: dependencies.dropped, relocations: relocations.dropped, debugRecords: debugRecords.dropped } },
      limitations: ['Metadata only; no target execution or instruction disassembly.', 'Stripped, packed and encrypted files may omit symbols. Indirect calls and runtime dependencies remain unknown.', 'Mach-O universal containers, ELF extended section numbering and PE delay imports are not decoded.'] };

    async function elf() {
      if (first.length < 52 || ![1, 2].includes(first[4]) || ![1, 2].includes(first[5])) throw invalid('Invalid ELF identity');
      const wide = first[4] === 2, le = first[5] === 1, header = await read(0, wide ? 64 : 52);
      const u16 = (b, n) => le ? b.readUInt16LE(n) : b.readUInt16BE(n), u32 = (b, n) => le ? b.readUInt32LE(n) : b.readUInt32BE(n);
      const word = (b, n) => wide ? number64(b, n, le) : u32(b, n);
      const addr = (b, n) => wide ? hex(le ? b.readBigUInt64LE(n) : b.readBigUInt64BE(n)) : hex(u32(b, n));
      const shoff = word(header, wide ? 40 : 32), entsize = u16(header, wide ? 58 : 46), count = u16(header, wide ? 60 : 48), namesIndex = u16(header, wide ? 62 : 50);
      if (count > cap) throw invalid('ELF section count exceeds inventory budget');
      if (shoff && !count) throw invalid('ELF extended section numbering is unsupported');
      if (count && (entsize < (wide ? 64 : 40) || namesIndex >= count)) throw invalid('Invalid ELF section table');
      range(shoff, count * entsize);
      const table = [];
      for (let i = 0; i < count; i++) {
        tick(); const at = shoff + i * entsize, b = await read(at, wide ? 64 : 40);
        const s = { index: i, nameOffset: u32(b, 0), type: u32(b, 4), flags: wide ? hex(le ? b.readBigUInt64LE(8) : b.readBigUInt64BE(8)) : hex(u32(b, 8)), address: addr(b, wide ? 16 : 12), offset: word(b, wide ? 24 : 16), size: word(b, wide ? 32 : 20), link: u32(b, wide ? 40 : 24), entrySize: word(b, wide ? 56 : 36), evidence: evidence(at, wide ? 64 : 40) };
        if (s.type !== 8) range(s.offset, s.size); table.push(s);
      }
      const names = table[namesIndex];
      for (const s of table) { s.name = names && s.nameOffset < names.size ? (await string(names.offset + s.nameOffset, names.offset + names.size)).name : ''; sections.add(s); }
      for (const s of table) {
        if (![2, 6, 11].includes(s.type)) continue;
        try {
          const strings = table[s.link]; if (!strings || strings.type !== 3) throw invalid('ELF table has invalid string-table link');
          const min = s.type === 6 ? (wide ? 16 : 8) : (wide ? 24 : 16);
          if (s.entrySize < min || s.size % s.entrySize) throw invalid('Invalid ELF entry size');
          for (let at = s.offset; at < s.offset + s.size; at += s.entrySize) {
            tick(); const b = await read(at, min);
            if (s.type === 6) {
              const tag = word(b, 0); if (tag === 0) break;
              if (tag === 1) { const index = word(b, wide ? 8 : 4); dependencies.add({ ...await string(strings.offset + index, strings.offset + strings.size), relation: 'DT_NEEDED', entryEvidence: evidence(at, min) }); }
            } else {
              const nameAt = u32(b, 0); if (!nameAt) continue;
              const info = b[wide ? 4 : 12], section = u16(b, wide ? 6 : 14);
              symbols.add({ ...await string(strings.offset + nameAt, strings.offset + strings.size), address: addr(b, wide ? 8 : 4), binding: info >> 4, type: info & 15, symbolRole: (info & 15) === 2 ? 'function-symbol' : 'other-symbol', size: addr(b, wide ? 16 : 8), section, undefined: section === 0, table: s.name, entryEvidence: evidence(at, min) });
            }
          }
        } catch (e) { if (e.code !== 'invalid_argument') throw e; warnings.push({ table: s.index, message: e.message, evidence: s.evidence }); }
      }
      return { format: 'ELF', bits: wide ? 64 : 32, endian: le ? 'little' : 'big', machine: u16(header, 18), entryPoint: addr(header, 24), headerEvidence: evidence(0, header.length) };
    }

    async function pe() {
      if (first.length < 64) throw invalid('Truncated DOS header');
      const at = first.readUInt32LE(60), coff = await read(at, 24);
      if (coff.readUInt32LE(0) !== 0x4550) throw invalid('Invalid PE signature');
      const count = coff.readUInt16LE(6), optionalSize = coff.readUInt16LE(20);
      if (count > cap || optionalSize < 96) throw invalid('Invalid PE header limits');
      const optional = await read(at + 24, optionalSize), magic = optional.readUInt16LE(0), wide = magic === 0x20b;
      if (![0x10b, 0x20b].includes(magic) || optionalSize < (wide ? 112 : 96)) throw invalid('Invalid PE optional header');
      const directory = wide ? 112 : 96, directories = Math.min(optional.readUInt32LE(directory - 4), Math.floor((optionalSize - directory) / 8));
      let coffStrings;
      if (coff.readUInt32LE(12)) {
        try {
          const offset = coff.readUInt32LE(12) + coff.readUInt32LE(16) * 18;
          const bytes = (await read(offset, 4)).readUInt32LE(0);
          if (bytes < 4) throw invalid('Invalid COFF string table size');
          range(offset, bytes); coffStrings = { offset, bytes };
        } catch (e) { if (e.code !== 'invalid_argument') throw e; warnings.push({ table: 'COFF-string-table', message: e.message }); }
      }
      const table = [];
      for (let i = 0; i < count; i++) {
        tick(); const pos = at + 24 + optionalSize + i * 40, b = await read(pos, 40);
        const s = { name: b.toString('ascii', 0, 8).replace(/\0.*$/, ''), virtualSize: b.readUInt32LE(8), rva: b.readUInt32LE(12), size: b.readUInt32LE(16), offset: b.readUInt32LE(20), flags: hex(b.readUInt32LE(36)), evidence: evidence(pos, 40) };
        if (/^\/[0-9]+$/.test(s.name)) {
          s.rawName = s.name;
          try {
            const index = Number(s.name.slice(1));
            if (!coffStrings || index < 4 || index >= coffStrings.bytes) throw invalid('Invalid COFF section name reference');
            const decoded = await string(coffStrings.offset + index, coffStrings.offset + coffStrings.bytes);
            s.name = decoded.name; s.nameEvidence = decoded.evidence; s.nameTruncated = decoded.truncated;
          } catch (e) { if (e.code !== 'invalid_argument') throw e; warnings.push({ table: 'COFF-section-name', message: e.message, evidence: s.evidence }); }
        }
        range(s.offset, s.size); table.push(s); sections.add(s);
      }
      const headersSize = optional.readUInt32LE(60);
      const rva = (value, n = 1) => {
        if (value < headersSize && value + n <= headersSize) { range(value, n); return value; }
        const matches = table.filter(s => value >= s.rva && value + n <= s.rva + s.size);
        if (matches.length !== 1) throw invalid('Unmapped or ambiguous PE RVA');
        return matches[0].offset + value - matches[0].rva;
      };
      const dir = i => i < directories ? { rva: optional.readUInt32LE(directory + i * 8), size: optional.readUInt32LE(directory + i * 8 + 4) } : { rva: 0, size: 0 };
      for (const kind of ['imports', 'exports']) {
        try {
          const d = dir(kind === 'imports' ? 1 : 0); if (!d.rva || !d.size) continue;
          if (kind === 'imports') {
            let terminated = false;
            for (let off = 0; off + 20 <= d.size; off += 20) {
              tick(); const pos = rva(d.rva + off, 20), b = await read(pos, 20);
              if (b.every(x => !x)) { terminated = true; break; }
              const dependency = await string(rva(b.readUInt32LE(12)));
              dependencies.add({ ...dependency, relation: 'PE-import', entryEvidence: evidence(pos, 20) });
              const thunk = b.readUInt32LE(0) || b.readUInt32LE(16), width = wide ? 8 : 4;
              for (let i = 0; ; i++) {
                tick(); const p = rva(thunk + i * width, width), t = await read(p, width), v = wide ? t.readBigUInt64LE(0) : BigInt(t.readUInt32LE(0));
                if (!v) break;
                const ordinal = (v & (1n << BigInt(wide ? 63 : 31))) !== 0n;
                const name = ordinal ? { name: `ordinal:${v & 65535n}`, evidence: evidence(p, width) } : await string(rva(Number(v) + 2));
                symbols.add({ ...name, kind: 'import', library: dependency.name, entryEvidence: evidence(p, width) });
              }
            }
            if (!terminated) warnings.push({ table: kind, message: 'Import descriptor terminator absent within directory' });
          } else {
            const pos = rva(d.rva, 40), b = await read(pos, 40), total = b.readUInt32LE(20), named = b.readUInt32LE(24), ordinalBase = b.readUInt32LE(16);
            for (let i = 0; i < named; i++) {
              tick(); const np = rva(b.readUInt32LE(32) + i * 4, 4), nameRva = (await read(np, 4)).readUInt32LE(0);
              const op = rva(b.readUInt32LE(36) + i * 2, 2), ordinal = (await read(op, 2)).readUInt16LE(0);
              if (ordinal >= total) throw invalid('Export ordinal outside address table');
              const ep = rva(b.readUInt32LE(28) + ordinal * 4, 4), address = (await read(ep, 4)).readUInt32LE(0);
              symbols.add({ ...await string(rva(nameRva)), kind: 'export', ordinal: ordinalBase + ordinal, rva: hex(address), forwarder: address >= d.rva && address < d.rva + d.size ? (await string(rva(address))).name : null, entryEvidence: evidence(ep, 4) });
            }
          }
        } catch (e) { if (e.code !== 'invalid_argument') throw e; warnings.push({ table: kind, message: e.message }); }
      }
      for (const kind of ['base-relocations', 'debug']) {
        try {
          const d = dir(kind === 'base-relocations' ? 5 : 6); if (!d.rva || !d.size) continue;
          if (kind === 'base-relocations') {
            let consumed = 0;
            while (consumed < d.size) {
              tick(); if (d.size - consumed < 8) throw invalid('Truncated PE relocation block header');
              const pos = rva(d.rva + consumed, 8), head = await read(pos, 8), page = head.readUInt32LE(0), length = head.readUInt32LE(4);
              if (length < 8 || length % 2 || length > d.size - consumed) throw invalid('Invalid PE relocation block size');
              for (let offset = 8; offset < length; offset += 2) {
                tick(); const at = rva(d.rva + consumed + offset, 2), value = (await read(at, 2)).readUInt16LE(0), type = value >>> 12;
                if (type === 0) continue; // ABSOLUTE padding, not a patch site.
                const target = page + (value & 4095); if (target > 0xffffffff) throw invalid('PE relocation RVA overflow');
                const record = { type, targetRva: hex(target), method: 'PE-base-relocation-table', interpretation: 'architecture-specific raw type; not applied', evidence: evidence(at, 2) };
                if (type === 4) {
                  if (offset + 2 >= length) throw invalid('Truncated HIGHADJ relocation pair');
                  record.adjustmentWord = (await read(rva(d.rva + consumed + offset + 2, 2), 2)).readUInt16LE(0);
                  record.evidence.byteLength = 4; offset += 2;
                }
                relocations.add(record);
              }
              consumed += length;
            }
          } else {
            if (d.size % 28) throw invalid('Invalid PE debug directory size');
            for (let offset = 0; offset < d.size; offset += 28) {
              tick(); const at = rva(d.rva + offset, 28), row = await read(at, 28), type = row.readUInt32LE(12), bytes = row.readUInt32LE(16), pointer = row.readUInt32LE(24);
              range(pointer, bytes);
              const record = { kind: 'PE-debug-directory', type, bytes, payloadOffset: pointer, evidence: evidence(at, 28) };
              if (type === 2 && bytes >= 24) {
                const head = await read(pointer, 24);
                if (head.toString('ascii', 0, 4) === 'RSDS') {
                  record.codeView = { signature: 'RSDS', guidBytes: head.subarray(4, 20).toString('hex'), age: head.readUInt32LE(20), pdbPath: bytes > 24 ? await string(pointer + 24, pointer + bytes) : null };
                }
              }
              debugRecords.add(record);
            }
          }
        } catch (e) { if (e.code !== 'invalid_argument') throw e; warnings.push({ table: kind, message: e.message }); }
      }
      const dll = optional.readUInt16LE(70);
      return { format: 'PE', bits: wide ? 64 : 32, endian: 'little', machine: coff.readUInt16LE(4), entryPointRva: hex(optional.readUInt32LE(16)), imageBase: wide ? hex(optional.readBigUInt64LE(24)) : hex(optional.readUInt32LE(28)), mitigations: { dynamicBaseFlag: !!(dll & 64), nxCompatFlag: !!(dll & 256), highEntropyVAFlag: !!(dll & 32), note: 'Header flags only; not proof of effective runtime protections.' }, headerEvidence: evidence(at, 24 + optionalSize) };
    }

    async function macho() {
      if (first.length < 28) throw invalid('Unrecognized or truncated binary');
      const magic = first.readUInt32LE(0), le = magic === 0xfeedface || magic === 0xfeedfacf, wide = magic === 0xfeedfacf || magic === 0xcffaedfe;
      if (![0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) throw invalid('Unsupported binary magic (thin ELF/PE/Mach-O required)');
      const u32 = (b, n) => le ? b.readUInt32LE(n) : b.readUInt32BE(n), u16 = (b, n) => le ? b.readUInt16LE(n) : b.readUInt16BE(n);
      const headerSize = wide ? 32 : 28, header = await read(0, headerSize), count = u32(header, 16), commandSize = u32(header, 20), end = headerSize + commandSize;
      range(headerSize, commandSize); let pos = headerSize, symtab;
      for (let i = 0; i < count; i++) {
        tick(); if (pos + 8 > end) throw invalid('Mach-O load commands exceed declared size');
        const h = await read(pos, 8), cmd = u32(h, 0), length = u32(h, 4);
        if (length < 8 || length % 4 || pos + length > end) throw invalid('Invalid Mach-O load command size');
        if (cmd === 2) { if (length < 24) throw invalid('Truncated LC_SYMTAB'); const b = await read(pos, 24); symtab = { offset: u32(b, 8), count: u32(b, 12), strings: u32(b, 16), stringSize: u32(b, 20) }; }
        else if ([12, 0x80000018, 0x8000001f, 0x80000023, 0x20].includes(cmd)) {
          if (length < 24) throw invalid('Truncated dylib command'); const b = await read(pos, 24), offset = u32(b, 8);
          if (offset < 24 || offset >= length) throw invalid('Invalid dylib name offset');
          dependencies.add({ ...await string(pos + offset, pos + length), relation: 'Mach-O-dylib', command: hex(cmd), entryEvidence: evidence(pos, 24) });
        } else if (cmd === 1 || cmd === 0x19) {
          const is64 = cmd === 0x19, fixed = is64 ? 72 : 56, sectionSize = is64 ? 80 : 68;
          if (length < fixed) throw invalid('Truncated segment command'); const b = await read(pos, fixed), n = u32(b, is64 ? 64 : 48);
          if (n > Math.floor((length - fixed) / sectionSize)) throw invalid('Mach-O sections exceed command');
          for (let j = 0; j < n; j++) {
            tick(); const p = pos + fixed + j * sectionSize, s = await read(p, sectionSize), flags = u32(s, is64 ? 64 : 56), sectionType = flags & 255;
            const offset = u32(s, is64 ? 48 : 40), bytes = is64 ? number64(s, 40, le) : u32(s, 36);
            if (![1, 12, 18].includes(sectionType)) range(offset, bytes);
            sections.add({ name: s.toString('ascii', 0, 16).replace(/\0.*$/, ''), segment: s.toString('ascii', 16, 32).replace(/\0.*$/, ''), offset, size: bytes, flags: hex(flags), relocationOffset: u32(s, is64 ? 56 : 48), relocationCount: u32(s, is64 ? 60 : 52), evidence: evidence(p, sectionSize) });
          }
        }
        pos += length;
      }
      if (pos !== end) warnings.push({ message: 'Unexamined bytes at end of load-command region' });
      if (symtab) {
        const width = wide ? 16 : 12; range(symtab.offset, symtab.count * width); range(symtab.strings, symtab.stringSize);
        for (let i = 0; i < symtab.count; i++) {
          tick(); const p = symtab.offset + i * width, b = await read(p, width), index = u32(b, 0); if (!index) continue;
          symbols.add({ ...await string(symtab.strings + index, symtab.strings + symtab.stringSize), type: b[4], debugSymbol: !!(b[4] & 0xe0), section: b[5], description: u16(b, 6), address: wide ? hex(le ? b.readBigUInt64LE(8) : b.readBigUInt64BE(8)) : hex(u32(b, 8)), undefined: (b[4] & 14) === 0, entryEvidence: evidence(p, width) });
        }
      }
      return { format: 'Mach-O', bits: wide ? 64 : 32, endian: le ? 'little' : 'big', cpuType: u32(header, 4), fileType: u32(header, 12), flags: hex(u32(header, 24)), headerEvidence: evidence(0, headerSize) };
    }
  });
}
