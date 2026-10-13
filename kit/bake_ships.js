// Bake the Moonharbor Charter ship (lb_ch2) and brig (lb_br2) display pieces into merged models. Look unchanged:
// pieces are only merged when they share the exact same rotation and scale at every bob step, so the merged model
// is the same geometry moved into one frame. Runs in the panel tab (needs window._ship = the lyris_barges ship
// functions, see graphics/bake/README.md). bake.build() computes + validates, bake.write() uploads.
(() => {
  const SID = '07638c3c', API = `/api/client/servers/${SID}/`;
  const SRC = '/plugins/Nexo/pack/external_packs/lyris_barges/assets/lyris_barge/';
  const OUT = '/plugins/Nexo/pack/external_packs/lyris_bake/assets/lyris_bake/';
  const FN = '/world/datapacks/lyris_barges/data/lyris_barges/function/ships/';
  const H = () => ({ 'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)[1]), 'X-Requested-With': 'XMLHttpRequest' });
  const get = async p => { const r = await fetch(API + 'files/contents?file=' + encodeURIComponent(p)); if (!r.ok) throw new Error(r.status + ' ' + p); return r.text(); };
  const put = async (p, body) => (await fetch(API + 'files/write?file=' + encodeURIComponent(p), { method: 'POST', headers: { ...H(), 'Content-Type': 'text/plain' }, body })).status;
  const f = a => a.split(',').map(x => parseFloat(x));
  const isRig = m => /rope|shroud|_stay_/.test(m);
  // quaternion helpers [x,y,z,w]
  const qmul = (a, b) => [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
  const qinv = q => { const n = q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]; return [-q[0]/n, -q[1]/n, -q[2]/n, q[3]/n]; };
  const rot = (q, v) => { const n = Math.hypot(...q); const u = q.map(x => x / n); const r = qmul(qmul(u, [v[0], v[1], v[2], 0]), [-u[0], -u[1], -u[2], u[3]]); return [r[0], r[1], r[2]]; };
  const add = (a, b) => a.map((x, i) => x + b[i]), sub = (a, b) => a.map((x, i) => x - b[i]), mul = (a, s) => a.map(x => x * s);
  const ry = v => [-v[0], v[1], -v[2]];
  const r4 = x => Math.round(x * 10000) / 10000, r5 = x => x.toFixed(5);
  // world-local position of model point m for a display with transform (t, q, s)
  const world = (t, q, s, m) => add(t, rot(q, mul(ry(mul(sub(m, [8, 8, 8]), 1 / 16)), s)));

  function parse() {
    const re = /^summon minecraft:item_display ([\d.-]+) ([\d.-]+) ([\d.-]+) \{Tags:\["lyris_ship","(lb_(ch2|br2)_p\d+)","lb_\w+"\].*?item_model":"([^"]+)".*?translation:\[([^\]]+)\],left_rotation:\[([^\]]+)\],right_rotation:\[([^\]]+)\],scale:\[([^\]]+)\]/;
    const parts = [];
    for (const l of window._ship['place_2.mcfunction'].split('\n')) {
      const m = l.match(re); if (!m) continue;
      parts.push({ line: l, pos: m[1] + ' ' + m[2] + ' ' + m[3], tag: m[4], ship: m[5], model: m[6], s: f(m[10]), r: m[9] });
    }
    const steps = [0, 1, 2, 3].map(k => { const o = {}; for (const l of window._ship[`step/${k}.mcfunction`].split('\n')) { const m = l.match(/tag=(lb_\w+)\].*?translation:\[([^\]]+)\],left_rotation:\[([^\]]+)\],right_rotation:\[([^\]]+)\],scale:\[([^\]]+)\]/); if (m) o[m[1]] = { line: l, t: f(m[2]), q: f(m[3]), s: f(m[5]) }; } return o; });
    return { parts, steps };
  }

  async function build() {
    const { parts, steps } = parse();
    for (const p of parts) for (const k of [0, 1, 2, 3]) if (!steps[k][p.tag]) throw new Error('no step ' + k + ' for ' + p.tag);
    // which pieces can merge: same ship + spawn pos, lyris_barge model without parent, same rotation+scale at all 4 steps
    const models = {};
    for (const m of new Set(parts.filter(p => p.model.startsWith('lyris_barge:')).map(p => p.model)))
      models[m] = JSON.parse((window._mcache = window._mcache || {})[m] || (window._mcache[m] = await get(SRC + 'models/item/' + m.split(':')[1] + '.json')));
    const groups = new Map(); const single = [];
    for (const p of parts) {
      const mj = models[p.model];
      if (!mj || mj.parent || !mj.elements || p.r !== '0f,0f,0f,1f' || [0,1,2,3].some(k => new Set(steps[k][p.tag].s).size !== 1)) { single.push(p); continue; }
      const key = [p.ship, p.pos, isRig(p.model) ? 'rig' : 'body', ...[0, 1, 2, 3].map(k => steps[k][p.tag].q.join(',') + '/' + steps[k][p.tag].s.join(','))].join('|');
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p);
    }
    const out = []; let n = { ch2: 0, br2: 0 }, maxErr = 0, elements = 0;
    for (const [key, ps] of groups) {
      if (ps.length < 2) { single.push(...ps); continue; }
      const rig = key.split('|')[2] === 'rig', ship = ps[0].ship;
      const s0 = steps[0][ps[0].tag], q0 = s0.q, sc = s0.s[0], t0 = s0.t;
      // move every piece's elements into the first piece's frame
      const els = [], tex = {}, texKey = {};
      ps.forEach(p => {
        const mj = models[p.model], d = mul(rot(qinv(q0), sub(steps[0][p.tag].t, t0)), 1 / sc), off = mul(ry(d), 16);
        const keyMap = {};
        for (const [k, v] of Object.entries(mj.textures || {})) { if (k === 'particle') continue; if (!texKey[v]) { texKey[v] = 't' + Object.keys(texKey).length; tex[texKey[v]] = v; } keyMap['#' + k] = '#' + texKey[v]; }
        for (const e of mj.elements) {
          const ne = JSON.parse(JSON.stringify(e)); ne.from = add(e.from, off); ne.to = add(e.to, off);
          if (ne.rotation && ne.rotation.origin) ne.rotation.origin = add(ne.rotation.origin, off);
          for (const fc of Object.values(ne.faces || {})) { if (keyMap[fc.texture]) fc.texture = keyMap[fc.texture]; delete fc.cullface; }
          ne._src = p.tag; els.push(ne);
        }
      });
      // centre and shrink into -16..32
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const e of els) for (const v of [e.from, e.to].concat(e.rotation && e.rotation.origin ? [e.rotation.origin] : [])) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); }
      const c = lo.map((x, i) => (x + hi[i]) / 2), half = Math.max(...hi.map((x, i) => (x - lo[i]) / 2));
      const k = Math.max(1, half / 23.9);
      const shrink = v => v.map((x, i) => r4(8 + (x - c[i]) / k));
      const final = els.map(e => { const ne = { ...e, from: shrink(e.from), to: shrink(e.to) }; if (e.rotation) ne.rotation = { ...e.rotation, ...(e.rotation.origin ? { origin: shrink(e.rotation.origin) } : {}) }; delete ne._src; return ne; });
      // group transform at each step: t_gk = t_pk - L_k L_0^-1 (t_p0 - t_g0)
      const tg0 = add(t0, rot(q0, mul(ry(mul(sub(c, [8, 8, 8]), 1 / 16)), sc)));
      const gsteps = [0, 1, 2, 3].map(kk => { const st = steps[kk][ps[0].tag]; return { t: sub(st.t, rot(qmul(st.q, qinv(q0)), sub(t0, tg0))), q: st.q, s: st.s[0] * k }; });
      // validate: every element corner, every step, original vs baked
      els.forEach((e, i) => {
        for (const kk of [0, 1, 2, 3]) {
          const st = steps[kk][e._src], g = gsteps[kk];
          const mOrig = sub(e.from, mul(ry(mul(rot(qinv(q0), sub(steps[0][e._src].t, t0)), 1 / sc)), 16));   // back to the piece's own model coords
          const a = world(st.t, st.q, st.s[0], mOrig), b = world(g.t, g.q, g.s, final[i].from);
          maxErr = Math.max(maxErr, Math.hypot(...sub(a, b)));
        }
      });
      elements += final.length;
      const name = (rig ? 'rig_' : '') + ship + '_' + String(n[ship]++).padStart(2, '0');
      const model = { textures: { ...tex, particle: tex.t0 }, elements: final };
      out.push({ name, ship, rig, parts: ps, model, gsteps, k });
    }
    window._bake = { out, single, parts, steps };
    return { pieces: parts.length, groups: out.length, kept: single.length, entitiesAfter: out.length + single.length, elements, maxErrBlocks: maxErr, maxShrink: Math.max(...out.map(o => o.k)), rigGroups: out.filter(o => o.rig).length };
  }

  function fnText() {
    const { out, single, steps } = window._bake;
    const merged = new Set(out.flatMap(o => o.parts.map(p => p.tag)));
    const tf = (t, q, s) => `transformation:{translation:[${t.map(r5).join('f,')}f],left_rotation:[${q.map(r5).join('f,')}f],right_rotation:[0f,0f,0f,1f],scale:[${[s, s, s].map(r5).join('f,')}f]}`;
    const place = ['scoreboard players set #baked lyris_barges 1'];
    for (const l of window._ship['place_2.mcfunction'].split('\n')) {
      const m = l.match(/"(lb_(?:ch2|br2)_p\d+)"/);
      if (m && merged.has(m[1])) continue;
      place.push(l);
    }
    // baked summons go just before the forceload removes at the end
    const at = place.findIndex(l => l.startsWith('forceload remove'));
    const summons = out.map(o => {
      const p = o.parts[0], g = o.gsteps[0];
      return p.line.replace(`"${p.tag}"`, `"lb_bake","${p.tag.slice(0, 6)}b${o.name.slice(-2)}${o.rig ? 'r' : ''}"`)
        .replace(/"minecraft:item_model":"[^"]+"/, `"minecraft:item_model":"lyris_bake:${o.name}"`)
        .replace(/transformation:\{.*\}\}$/, tf(g.t, g.q, g.s) + '}');
    });
    place.splice(at < 0 ? place.length : at, 0, ...summons);
    const bstep = [0, 1, 2, 3].map(kk => {
      const lines = Object.entries(steps[kk]).filter(([tag]) => !merged.has(tag)).map(([, v]) => v.line);
      for (const o of out) { const g = o.gsteps[kk]; const tag = `${o.parts[0].tag.slice(0, 6)}b${o.name.slice(-2)}${o.rig ? 'r' : ''}`; lines.push(`execute as @e[type=minecraft:item_display,tag=${tag}] run data merge entity @s {start_interpolation:0,interpolation_duration:30,${tf(g.t, g.q, g.s)}}`); }
      return lines.join('\n') + '\n';
    });
    return { place: place.join('\n'), bstep };
  }

  async function write() {
    const { out } = window._bake; const res = {};
    for (const o of out) {
      res[o.name] = [await put(OUT + 'models/item/' + o.name + '.json', JSON.stringify(o.model)),
                     await put(OUT + 'items/' + o.name + '.json', JSON.stringify({ model: { type: 'minecraft:model', model: 'lyris_bake:item/' + o.name } }))].join('/');
    }
    const fx = fnText(); const w = {};
    const place0 = window._ship['place.mcfunction'];
    // keep the originals (as they are right now) as ostep, dispatch on #baked
    for (const kk of [0, 1, 2, 3]) {
      w['ostep' + kk] = await put(FN + `ostep/${kk}.mcfunction`, window._ship[`step/${kk}.mcfunction`]);
      w['bstep' + kk] = await put(FN + `bstep/${kk}.mcfunction`, fx.bstep[kk]);
      w['step' + kk] = await put(FN + `step/${kk}.mcfunction`, `execute if score #baked lyris_barges matches 1 run function lyris_barges:ships/bstep/${kk}\nexecute unless score #baked lyris_barges matches 1 run function lyris_barges:ships/ostep/${kk}\n`);
    }
    w.bplace_2 = await put(FN + 'bplace_2.mcfunction', fx.place);
    w.place_baked = await put(FN + 'place_baked.mcfunction', place0.replace('ships/place_2', 'ships/bplace_2'));
    w.unbake = await put(FN + 'unbake.mcfunction', 'scoreboard players set #baked lyris_barges 0\nfunction lyris_barges:ships/place\n');
    return { models: Object.keys(res).length, modelWrites: [...new Set(Object.values(res))], fn: w };
  }

  window.bake = { build, write, fnText };
})();
