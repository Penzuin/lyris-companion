// Lyris DevKit: pull a plugin's API class files from a jar on the server, with method bodies stripped,
// gzipped + base64 so it fits in one tool result. The workspace rebuilds a compile-only jar from it.
// Usage (panel tab):  await apipull('/plugins/nexo-1.28.jar', ['com/nexomc/nexo/api/', 'com/nexomc/nexo/items/'])
(() => {
  const H = () => ({ 'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)[1]), 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' });
  // Rebuild each class with only what javac reads: header, kept members (no private ones), and the attributes
  // Signature / Exceptions / InnerClasses / ConstantValue / EnclosingMethod / NestHost / NestMembers / PermittedSubclasses /
  // MethodParameters / Deprecated. Code, debug info and annotations go, and the constant pool is rebuilt with only what is used.
  function strip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let p = 8;
    const n = dv.getUint16(p); p += 2; const cp = [null];
    for (let i = 1; i < n; i++) {
      const t = u8[p], st = p; p++;
      if (t === 1) { const l = dv.getUint16(p); p += 2 + l; }
      else if (t === 5 || t === 6) p += 8;
      else if (t === 7 || t === 8 || t === 16 || t === 19 || t === 20) p += 2;
      else if (t === 15) p += 3;
      else p += 4;
      cp.push({ t, raw: u8.subarray(st, p) });
      if (t === 5 || t === 6) { cp.push(null); i++; }
    }
    const utf = i => new TextDecoder().decode(cp[i].raw.subarray(3));
    const map = new Map(), order = [];
    const use = i => {           // pull a constant (and what it points to) into the new pool
      if (!i) return 0; if (map.has(i)) return map.get(i);
      const c = cp[i]; const d = new DataView(c.raw.buffer, c.raw.byteOffset, c.raw.byteLength); let raw;
      if (c.t === 7 || c.t === 8 || c.t === 16 || c.t === 19 || c.t === 20) { const k = use(d.getUint16(1)); raw = new Uint8Array([c.t, k >> 8, k & 255]); }
      else if (c.t === 12) { const a = use(d.getUint16(1)), b = use(d.getUint16(3)); raw = new Uint8Array([12, a >> 8, a & 255, b >> 8, b & 255]); }
      else raw = c.raw.slice();
      const ni = order.reduce((s, x) => s + ((x[0] === 5 || x[0] === 6) ? 2 : 1), 1); map.set(i, ni); order.push(raw); return ni;
    };
    const u16 = v => new Uint8Array([v >> 8, v & 255]), u32 = v => new Uint8Array([v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
    const access = dv.getUint16(p), thisC = dv.getUint16(p + 2), superC = dv.getUint16(p + 4); p += 6;
    const ni = dv.getUint16(p); p += 2; const ifs = []; for (let i = 0; i < ni; i++) { ifs.push(dv.getUint16(p)); p += 2; }
    const body = [u16(access), null, null, u16(ni)];
    const T = use(thisC), S = use(superC); body[1] = u16(T); body[2] = u16(S); for (const x of ifs) body.push(u16(use(x)));
    const attrs = (skip) => {
      const cnt = dv.getUint16(p); p += 2; const kept = [];
      for (let i = 0; i < cnt; i++) {
        const nm = utf(dv.getUint16(p)), len = dv.getUint32(p + 2), a = p + 6; p += 6 + len;
        if (skip) continue;
        const g = o => dv.getUint16(a + o); let parts = null;
        if (nm === 'Signature' || nm === 'ConstantValue' || nm === 'NestHost') parts = [u16(use(g(0)))];
        else if (nm === 'Deprecated') parts = [];
        else if (nm === 'Exceptions' || nm === 'NestMembers' || nm === 'PermittedSubclasses') { const c = g(0); parts = [u16(c)]; for (let k = 0; k < c; k++) parts.push(u16(use(g(2 + 2 * k)))); }
        else if (nm === 'EnclosingMethod') parts = [u16(use(g(0))), u16(use(g(2)))];
        else if (nm === 'InnerClasses') { const c = g(0); parts = [u16(c)]; for (let k = 0; k < c; k++) { const o = 2 + 8 * k; parts.push(u16(use(g(o))), u16(use(g(o + 2))), u16(use(g(o + 4))), u16(g(o + 6))); } }
        else if (nm === 'MethodParameters') { const c = u8[a]; parts = [new Uint8Array([c])]; for (let k = 0; k < c; k++) parts.push(u16(use(g(1 + 4 * k))), u16(g(3 + 4 * k))); }
        if (!parts) continue;
        const L = parts.reduce((s, x) => s + x.length, 0); kept.push([u16(use(dv.getUint16(a - 6))), u32(L), ...parts]);
      }
      return [u16(kept.length), ...kept.flat()];
    };
    for (const kind of [0, 1]) {
      const cnt = dv.getUint16(p); p += 2; const items = [];
      for (let i = 0; i < cnt; i++) {
        const fl = dv.getUint16(p), nmI = dv.getUint16(p + 2), dsI = dv.getUint16(p + 4); p += 6;
        if (fl & 0x1002) { attrs(true); continue; }     // private or synthetic: skip
        items.push([u16(fl), u16(use(nmI)), u16(use(dsI)), ...attrs()]);
      }
      body.push(u16(items.length), ...items.flat());
    }
    body.push(...attrs());
    const pool = [u16(order.reduce((s, x) => s + ((x[0] === 5 || x[0] === 6) ? 2 : 1), 1)), ...order];
    const all = [u8.subarray(0, 8), ...pool, ...body]; const len = all.reduce((s, b) => s + b.length, 0), r = new Uint8Array(len); let o = 0; for (const b of all) { r.set(b, o); o += b.length; } return r;
  }
  window.apipull = async (jar, prefixes, skipPrivateClasses = true) => {
    const r = await (await fetch('/api/client/servers/07638c3c/files/download?file=' + encodeURIComponent(jar), { headers: H() })).json();
    const buf = new Uint8Array(await (await fetch(r.attributes.url)).arrayBuffer()); const dv = new DataView(buf.buffer);
    let e = buf.length - 22; while (dv.getUint32(e, true) !== 0x06054b50) e--;
    let p = dv.getUint32(e + 16, true); const n = dv.getUint16(e + 10, true); const parts = []; let count = 0, raw = 0;
    for (let i = 0; i < n; i++) {
      const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const nm = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (!nm.endsWith('.class') || !prefixes.some(x => nm.startsWith(x))) continue;
      const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true), d = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + cs);
      let cls = m === 0 ? d : new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      if (skipPrivateClasses && cls.length > 9) { /* keep all; javac ignores what it doesn't need */ }
      const s = strip(cls); raw += s.length; count++;
      const name = new TextEncoder().encode(nm), hdr = new Uint8Array(6); const hv = new DataView(hdr.buffer); hv.setUint16(0, name.length); hv.setUint32(2, s.length);
      parts.push(hdr, name, s);
    }
    const gz = new Uint8Array(await new Response(new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let b = ''; for (let i = 0; i < gz.length; i += 0x8000) b += String.fromCharCode(...gz.subarray(i, i + 0x8000));
    return 'APIPULL ' + jar + ' ' + count + ' classes ' + raw + ' bytes\n' + btoa(b);
  };
  return 'apipull ready';
})();
