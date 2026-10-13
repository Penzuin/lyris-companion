// Lyris Spawn Workshop: the browser half. Loaded into the panel tab with:
//   eval(await (await fetch('https://raw.githubusercontent.com/Penzuin/lyris-companion/<sha>/kit/kit.js')).text())
// Then: await kit.apply('<sha>', '<edit id>'), kit.undo('<edit id>'), kit.read([x0,y0,z0,x1,y1,z1]).
(() => {
  const REPO = 'https://raw.githubusercontent.com/Penzuin/lyris-companion/';
  const SID = '07638c3c', API = `/api/client/servers/${SID}/`;
  const STRUCT_DIR = '/world/generated/minecraft/structures/';
  const WORLD = '/world/dimensions/minecraft/overworld/';
  const VAULT_X = 60000, VAULT_Z = -2400, SLOT = 112;   // snapshot vault, far from anything
  const sl = ms => new Promise(r => setTimeout(r, ms));
  const H = () => ({ 'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)[1]), 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' });
  async function call(path, opts = {}, tries = 4) {
    for (let a = 0; a < tries; a++) {
      const r = await fetch(API + path, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
      if (r.status !== 429 && r.status < 500) return r;
      await sl(2500 * (a + 1));
    }
    throw new Error('panel call failed: ' + path);
  }
  async function cmd(c) {
    if (/^\s*\/?(minecraft:)?reload\b/i.test(c)) throw new Error('blocked: /reload breaks this server'); const r = await call('command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: c }) }); await sl(350); return r.status; }
  async function log(n = 40) { const t = await (await call('files/contents?file=/logs/latest.log')).text(); return t.split('\n').slice(-n); }
  async function write(path, body, binary) {
    const r = await call('files/write?file=' + encodeURIComponent(path), { method: 'POST', headers: { 'Content-Type': binary ? 'application/octet-stream' : 'text/plain' }, body });
    await sl(900); return r.status;
  }
  async function raw(sha, p, binary) { const r = await fetch(REPO + sha + '/' + p); if (!r.ok) throw new Error('drop fetch ' + r.status + ' ' + p); return binary ? await r.arrayBuffer() : await r.text(); }
  const chunks = b => [b[0] >> 4, b[2] >> 4, b[3] >> 4, b[5] >> 4];
  async function forceload(b, on) { await cmd(`forceload ${on ? 'add' : 'remove'} ${b[0]} ${b[2]} ${b[3]} ${b[5]}`); }
  function vaultBox(slot, b) { const vx = VAULT_X + (slot % 40) * SLOT, vz = VAULT_Z + Math.floor(slot / 40) * SLOT; return [vx, b[1], vz, vx + (b[3] - b[0]), b[4], vz + (b[5] - b[2])]; }
  async function cloneBox(src, dst) {
    // clone in y-slabs that stay under the block limit
    const area = (src[3] - src[0] + 1) * (src[5] - src[2] + 1), step = Math.max(1, Math.floor(30000 / area));
    for (let y = src[1]; y <= src[4]; y += step) {
      const y2 = Math.min(src[4], y + step - 1), dy = dst[1] - src[1];
      await cmd(`clone ${src[0]} ${y} ${src[2]} ${src[3]} ${y2} ${src[5]} ${dst[0]} ${y + dy} ${dst[2]} replace force`);
    }
  }
  async function tests(checks) {
    if (!checks || !checks.length) return 'no checks';
    for (const c of checks) await cmd('execute if block ' + c);
    await sl(1500);
    const L = (await log(checks.length + 20)).filter(l => /Test (passed|failed)/.test(l)).slice(-checks.length);
    return L.filter(l => l.includes('passed')).length + '/' + checks.length + ' checks passed';
  }
  const kit = {
    cmd, log,
    // apply one edit from the drop branch
    async apply(sha, id) {
      const t0 = Date.now(), out = [];
      const m = JSON.parse(await raw(sha, `edits/${id}/manifest.json`));
      const b = m.box;
      // 1. upload its files (structures are binary .nbt, functions are text)
      for (const f of m.files) {
        const body = await raw(sha, `edits/${id}/${f.src}`, f.binary);
        out.push(`${f.dst.split('/').pop()}: ${await write(f.dst, body, f.binary)}`);
      }
      // never /reload: on this server it breaks plugins (owner's rule). Edits use place template, which needs no reload.
      // 2. load the chunks (edit box + its vault slot), snapshot what is there now
      await forceload(b, true);
      const vb = vaultBox(m.slot, b);
      if (m.snapshot !== false) await forceload(vb, true);
      await sl(m.wait || 9000);
      if (m.snapshot !== false) { await cloneBox(b, vb); out.push('snapshot -> vault slot ' + m.slot); }
      // 3. place
      for (const c of m.run) await cmd(c);
      await sl(1500);
      out.push(await tests(m.checks));
      await forceload(b, false); if (m.snapshot !== false) await forceload(vb, false);
      out.push(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
      return `${id} (${m.title}): ` + out.join(' | ');
    },
    // put an edit's box back the way it was before the edit
    async undo(sha, id) {
      const m = JSON.parse(await raw(sha, `edits/${id}/manifest.json`));
      const b = m.box, vb = vaultBox(m.slot, b);
      await forceload(b, true); await forceload(vb, true); await sl(9000);
      await cloneBox(vb, b);
      await sl(1000); await forceload(b, false); await forceload(vb, false);
      return `${id} undone from vault slot ${m.slot}`;
    },
    // run a list of console commands (small fixes) with an optional box to load first
    async run(commands, box, checks) {
      if (box) { await forceload(box, true); await sl(8000); }
      for (const c of commands) await cmd(c);
      const res = await tests(checks);
      if (box) await forceload(box, false);
      return res;
    },
    // read the live blocks in a box straight from the region files -> compact JSON (palette + run-length data, order y,z,x)
    async read(box) {
      await cmd('save-all flush'); await sl(5000);
      const [x0, y0, z0, x1, y1, z1] = box, W = x1 - x0 + 1, D = z1 - z0 + 1, Hh = y1 - y0 + 1;
      const grid = new Array(W * D * Hh).fill(0), pal = ['minecraft:air'], palIdx = { 'minecraft:air': 0 };
      const regions = {};
      for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
        const key = (cx >> 5) + '.' + (cz >> 5); (regions[key] = regions[key] || []).push([cx, cz]);
      }
      for (const [key, list] of Object.entries(regions)) {
        const r = await (await call('files/download?file=' + encodeURIComponent(WORLD + 'region/r.' + key + '.mca'))).json();
        const buf = new Uint8Array(await (await fetch(r.attributes.url)).arrayBuffer()); const dv = new DataView(buf.buffer);
        for (const [cx, cz] of list) {
          const i = 4 * ((cx & 31) + (cz & 31) * 32), off = (dv.getUint32(i) >>> 8) * 4096;
          if (!off) continue;
          const len = dv.getUint32(off), comp = buf[off + 4];
          const ds = new DecompressionStream(comp === 1 ? 'gzip' : 'deflate');
          const data = new Uint8Array(await new Response(new Blob([buf.slice(off + 5, off + 4 + len)]).stream().pipeThrough(ds)).arrayBuffer());
          const nbt = parseNBT(data);
          for (const sec of (nbt.sections || [])) {
            const sy = sec.Y; if (sy * 16 + 15 < y0 || sy * 16 > y1) continue;
            const bs = sec.block_states; if (!bs) continue;
            const names = bs.palette.map(p => p.Name + (p.Properties ? '[' + Object.entries(p.Properties).sort().map(([k, v]) => k + '=' + v).join(',') + ']' : ''));
            const ids = names.map(n => (n in palIdx) ? palIdx[n] : (palIdx[n] = pal.push(n) - 1));
            const bits = Math.max(4, Math.ceil(Math.log2(names.length))), per = Math.floor(64 / bits), longs = bs.data;
            for (let ly = 0; ly < 16; ly++) {
              const y = sy * 16 + ly; if (y < y0 || y > y1) continue;
              for (let lz = 0; lz < 16; lz++) {
                const z = cz * 16 + lz; if (z < z0 || z > z1) continue;
                for (let lx = 0; lx < 16; lx++) {
                  const x = cx * 16 + lx; if (x < x0 || x > x1) continue;
                  let v = 0;
                  if (names.length > 1) {
                    const n = ly * 256 + lz * 16 + lx, L = longs[Math.floor(n / per)], sh = BigInt((n % per) * bits);
                    v = Number((L >> sh) & ((1n << BigInt(bits)) - 1n));
                  }
                  grid[((y - y0) * D + (z - z0)) * W + (x - x0)] = ids[v];
                }
              }
            }
          }
        }
      }
      const rle = []; let prev = grid[0], cnt = 0;
      for (const v of grid) { if (v === prev) cnt++; else { rle.push(cnt, prev); prev = v; cnt = 1; } }
      rle.push(cnt, prev);
      return JSON.stringify({ box, palette: pal, rle });
    },
  };
  // minimal NBT reader (big-endian, uncompressed)
  function parseNBT(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let p = 0;
    const str = () => { const n = dv.getUint16(p); p += 2; const s = new TextDecoder().decode(u8.subarray(p, p + n)); p += n; return s; };
    const read = t => {
      switch (t) {
        case 1: return dv.getInt8(p++);
        case 2: { const v = dv.getInt16(p); p += 2; return v; }
        case 3: { const v = dv.getInt32(p); p += 4; return v; }
        case 4: { const v = dv.getBigInt64(p); p += 8; return v; }
        case 5: { const v = dv.getFloat32(p); p += 4; return v; }
        case 6: { const v = dv.getFloat64(p); p += 8; return v; }
        case 7: { const n = dv.getInt32(p); p += 4; const v = u8.subarray(p, p + n); p += n; return v; }
        case 8: return str();
        case 9: { const et = u8[p++], n = dv.getInt32(p); p += 4; const a = []; for (let i = 0; i < n; i++) a.push(read(et)); return a; }
        case 10: { const o = {}; for (;;) { const tt = u8[p++]; if (tt === 0) break; const k = str(); o[k] = read(tt); } return o; }
        case 11: { const n = dv.getInt32(p); p += 4; const a = []; for (let i = 0; i < n; i++) { a.push(dv.getInt32(p)); p += 4; } return a; }
        case 12: { const n = dv.getInt32(p); p += 4; const a = []; for (let i = 0; i < n; i++) { a.push(dv.getBigInt64(p)); p += 8; } return a; }
      }
      throw new Error('nbt tag ' + t);
    };
    const t = u8[p++]; str(); return read(t);
  }
  window.kit = kit;
  return 'kit loaded';
})();
