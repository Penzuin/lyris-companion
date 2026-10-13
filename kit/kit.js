// Lyris Spawn Workshop: the browser half. Loaded into the panel tab with:
//   eval(await (await fetch('https://raw.githubusercontent.com/Penzuin/lyris-companion/<sha>/kit/kit.js')).text())
// Then: await kit.apply('<sha>', '<edit id>'), kit.undo('<edit id>'), kit.read([x0,y0,z0,x1,y1,z1]).
// Many edits at once (token-cheap): kit.batch(sha, [ids], 'k') -> wait with ONE Bash sleep -> kit.job('k').
// Lamps/props: await kit.placer(sha, 'list.txt', [x0,z0,x1,z1]).
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
    // ---- plugin deploys (sdk/build.py --deploy) ----------------------------------------------------------------
    // Uploads deploy/<name>/<jar> from the drop branch, checks its sha256 on the server, moves the old jar(s) of the
    // same plugin to /plugins/_old/ (one jar per plugin), and uploads any extra files. The jar loads at the next restart.
    async deploy(sha, name) {
      const t0 = Date.now(), out = [];
      const m = JSON.parse(await raw(sha, `deploy/${name}/manifest.json`));
      const buf = await raw(sha, `deploy/${name}/${m.jar}`, true);
      const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
      if (hex(await crypto.subtle.digest('SHA-256', buf)) !== m.sha256) throw new Error('jar from GitHub does not match the build hash');
      const list = (await (await call('files/list?directory=' + encodeURIComponent('/plugins'))).json()).data.map(f => f.attributes).filter(f => f.is_file);
      const base = n => n.toLowerCase().replace(/\.jar$/, '').replace(/[-_ ]?v?\d+(\.\d+)*([-.][a-z0-9]+)*$/, '');
      const olds = list.filter(f => f.name.endsWith('.jar') && f.name !== m.jar && base(f.name) === m.name.toLowerCase());
      out.push(`${m.name} ${m.version}: ${await write('/plugins/' + m.jar, buf, true)}`);
      // read it back and compare
      const r = await (await call('files/download?file=' + encodeURIComponent('/plugins/' + m.jar))).json();
      const back = await (await fetch(r.attributes.url)).arrayBuffer();
      if (hex(await crypto.subtle.digest('SHA-256', back)) !== m.sha256) throw new Error('uploaded jar hash mismatch, check /plugins/' + m.jar);
      out.push('hash ok');
      for (const o of olds) {
        await call('files/create-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: '/plugins', name: '_old' }) });
        const st = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
        const rr = await call('files/rename', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: '/plugins', files: [{ from: o.name, to: `_old/${o.name}.${st}` }] }) });
        out.push(`old ${o.name} -> _old/ (${rr.status})`); await sl(900);
      }
      for (const f of (m.files || [])) out.push(`${f.dst.split('/').pop()}: ${await write(f.dst, await raw(sha, `deploy/${name}/${f.src}`, f.binary), f.binary)}`);
      out.push(`done in ${Math.round((Date.now() - t0) / 1000)}s. Loads at the next restart (ask the owner; claim server:restart).`);
      return out.join(' | ');
    },
    // who is online (for picking a restart moment)
    async online() { await cmd('list'); await sl(1200); return (await log(6)).filter(l => /players online|online:/i.test(l)).slice(-2); },
    // after a restart: this plugin's enable line and any errors that mention it
    async check(name) {
      const L = await log(4000);
      return L.filter(l => l.toLowerCase().includes(name.toLowerCase()) && /Enabling|Disabling|ERROR|WARN|Exception|Could not load|Error occurred/i.test(l)).slice(-15);
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
    // compare the live blocks of an edit's box with its before.json ('before') or expected.json ('expected').
    // Benign drift is ignored: air/cave_air, grass<->dirt, dirt_path->dirt, and '?' cells.
    async probe(sha, id, which = 'expected') {
      const man = JSON.parse(await raw(sha, `edits/${id}/manifest.json`));
      const ref = JSON.parse(await raw(sha, `edits/${id}/${which}.json`));
      const exp = which === 'before' ? JSON.parse(await raw(sha, `edits/${id}/expected.json`)) : null;
      const r = JSON.parse(await kit.read(man.box));
      const [x0, y0, z0, x1, y1, z1] = r.box, nx = x1 - x0 + 1, nz = z1 - z0 + 1;
      const pal = r.palette.map(p => p.replace('minecraft:', '').split('[')[0]);
      const flat = new Int32Array(nx * (y1 - y0 + 1) * nz); let i = 0;
      for (let k = 0; k < r.rle.length; k += 2) { flat.fill(r.rle[k + 1], i, i + r.rle[k]); i += r.rle[k]; }
      const eq = (a, b) => a === b || b === '?' || (a === 'air' && b === 'cave_air') || (a === 'cave_air' && b === 'air') ||
        (a === 'dirt' && (b === 'grass_block' || b === 'dirt_path')) || (a === 'grass_block' && b === 'dirt');
      let n = 0, bad = 0, done = 0; const samp = [];
      for (const key in ref) {
        const [x, y, z] = key.split(',').map(Number), live = pal[flat[((y - y0) * nz + (z - z0)) * nx + (x - x0)]]; n++;
        if (eq(live, ref[key])) continue;
        if (exp && eq(live, exp[key])) { done++; continue; }
        bad++; if (samp.length < 6) samp.push(key + ':' + ref[key] + '->' + live);
      }
      return `${id} ${which}: ${n} cells, ${bad} differ` + (exp ? `, ${done} already done` : '') + (samp.length ? ' e.g. ' + samp.join(' ') : '');
    },
    // the whole safe apply as ONE background job: probe every edit against before.json, stop if the world drifted,
    // apply them in order, then verify against expected.json. Start it, then wait (one sleep) and read kit.job(key).
    batch(sha, ids, key = 'job', opts = {}) {
      const J = kit.jobs[key] = { state: 'running', lines: [], t0: Date.now() };
      const say = s => J.lines.push(s);
      (async () => {
        try {
          if (!opts.skipProbe) {
            for (const id of ids) say(await kit.probe(sha, id, 'before'));
            if (J.lines.some(l => !/ 0 differ/.test(l))) { J.state = 'stopped: live world changed since the read'; return; }
          }
          for (const id of ids) say(await kit.apply(sha, id));
          for (const id of ids) say(await kit.probe(sha, id, 'expected'));
          J.state = J.lines.some(l => / expected: .* [1-9]\d* differ/.test(l)) ? 'done with differences' : 'done';
        } catch (e) { J.state = 'error: ' + e; }
      })();
      return `${key} started: ${ids.length} edits`;
    },
    jobs: {},
    // short status of a background job (keeps tool output small): state, minutes, and only lines that need attention
    job(key = 'job', all = false) {
      const J = kit.jobs[key]; if (!J) return 'no job ' + key;
      const mins = ((Date.now() - J.t0) / 60000).toFixed(1);
      const lines = all ? J.lines : J.lines.filter(l => !/ 0 differ| checks passed|no checks/.test(l));
      return `${key}: ${J.state} after ${mins} min, ${J.lines.length} steps` + (lines.length ? '\n' + lines.join('\n') : '');
    },
    // upload a LyrisPlacer list from the drop branch (placer/<file>) and run it with the box forceloaded
    async placer(sha, file, box) {
      const body = await raw(sha, 'placer/' + file);
      await write('/plugins/LyrisPlacer/' + file, body, false);
      if (box) { await cmd(`forceload add ${box[0]} ${box[1]} ${box[2]} ${box[3]}`); await sl(12000); }
      await cmd('lyrisplace run ' + file); await sl(4000);
      if (box) await cmd(`forceload remove ${box[0]} ${box[1]} ${box[2]} ${box[3]}`);
      return (await log(80)).filter(l => l.includes('LyrisPlacer run ' + file)).slice(-1)[0] || 'no result line yet';
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
