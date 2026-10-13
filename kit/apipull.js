// Lyris DevKit: pull a plugin's API class files from a jar on the server, with method bodies stripped,
// gzipped + base64 so it fits in one tool result. The workspace rebuilds a compile-only jar from it.
// Usage (panel tab):  await apipull('/plugins/nexo-1.28.jar', ['com/nexomc/nexo/api/', 'com/nexomc/nexo/items/'])
(() => {
  const H = () => ({ 'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)[1]), 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' });
  const KEEP = new Set(['Signature', 'Exceptions', 'Deprecated', 'InnerClasses', 'EnclosingMethod', 'RuntimeVisibleAnnotations',
                        'AnnotationDefault', 'ConstantValue', 'MethodParameters', 'Record', 'PermittedSubclasses', 'NestHost', 'NestMembers']);
  function strip(u8) {           // drop Code and debug attributes; keep everything javac reads
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let p = 8;
    const n = dv.getUint16(p); p += 2; const utf = {};
    for (let i = 1; i < n; i++) {
      const t = u8[p++];
      if (t === 1) { const l = dv.getUint16(p); utf[i] = new TextDecoder().decode(u8.subarray(p + 2, p + 2 + l)); p += 2 + l; }
      else if (t === 5 || t === 6) { p += 8; i++; }
      else if (t === 7 || t === 8 || t === 16 || t === 19 || t === 20) p += 2;
      else if (t === 15) p += 3;
      else p += 4;
    }
    const out = [u8.subarray(0, p)]; const head = p; p += 6; const ni = dv.getUint16(p); p += 2 + ni * 2;
    out.push(u8.subarray(head, p));
    const attrs = () => {   // copy kept attributes, return [bytes]
      const cnt = dv.getUint16(p); p += 2; const kept = [];
      for (let i = 0; i < cnt; i++) { const nm = utf[dv.getUint16(p)], len = dv.getUint32(p + 2); if (KEEP.has(nm)) kept.push(u8.subarray(p, p + 6 + len)); p += 6 + len; }
      const c = new Uint8Array(2); new DataView(c.buffer).setUint16(0, kept.length); return [c, ...kept];
    };
    for (const kind of [0, 1]) {   // fields, methods: drop private members entirely
      const cnt = dv.getUint16(p); p += 2; const items = [];
      for (let i = 0; i < cnt; i++) {
        const fl = dv.getUint16(p), start = u8.subarray(p, p + 6); p += 6; const a = attrs();
        if (!(fl & 0x0002)) items.push([start, ...a]);
      }
      const c = new Uint8Array(2); new DataView(c.buffer).setUint16(0, items.length); out.push(c, ...items.flat());
    }
    out.push(...attrs());
    const len = out.reduce((s, b) => s + b.length, 0), r = new Uint8Array(len); let o = 0; for (const b of out) { r.set(b, o); o += b.length; } return r;
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
