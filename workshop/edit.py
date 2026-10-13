# Lyris Spawn Workshop: the Python half. Build one piece as a block dict, publish it to the drop branch,
# then the panel tab runs  await kit.apply(sha, id)  which uploads the structure, snapshots the area,
# and drops the piece in with a single `place template` (no datapack reload, nothing slow).
import os, json, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import nbt

DROP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STRUCT_DIR = '/world/generated/minecraft/structures/'
REG = os.path.join(DROP, 'edits', 'registry.json')

def registry():
    return json.load(open(REG)) if os.path.exists(REG) else {'next': 1, 'edits': {}}

class Edit:
    def __init__(self, name, title=''):
        self.name, self.title = name, title or name
        self.B, self.nbt = {}, {}
        self.extra_run, self.extra_checks, self.pre_run, self.ents = [], [], [], []
        self.notes = {}
    # --- drawing helpers (absolute world coordinates) ---
    def put(self, x, y, z, b, nbt_=None):
        self.B[(x, y, z)] = b
        if nbt_: self.nbt[(x, y, z)] = nbt_
    def fill(self, x0, y0, z0, x1, y1, z1, b):
        for x in range(min(x0, x1), max(x0, x1) + 1):
            for y in range(min(y0, y1), max(y0, y1) + 1):
                for z in range(min(z0, z1), max(z0, z1) + 1): self.B[(x, y, z)] = b
    def clear(self, x0, y0, z0, x1, y1, z1): self.fill(x0, y0, z0, x1, y1, z1, 'air')
    def entity(self, x, y, z, nbt_):
        self.ents.append(((x, y, z), nbt_))
    def merge(self, blocks, dx=0, dy=0, dz=0):
        for (x, y, z), b in blocks.items(): self.B[(x + dx, y + dy, z + dz)] = b
    # --- publish ---
    def publish(self, fix_connections=True, push=True, checks=6):
        reg = registry()
        if self.name in reg['edits']:
            eid, slot = reg['edits'][self.name]['id'], reg['edits'][self.name]['slot']
        else:
            n = reg['next']; reg['next'] += 1
            eid, slot = f'e{n:04d}-{self.name}', n
        B = self.B
        if fix_connections:
            sys.path.insert(0, '/home/claude/mh2')
            import connect
            B = connect.fix({k: v for k, v in B.items()})
        xs = [k[0] for k in B]; ys = [k[1] for k in B]; zs = [k[2] for k in B]
        x0, y0, z0, x1, y1, z1 = min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)
        rel = {(x - x0, y - y0, z - z0): b for (x, y, z), b in B.items()}
        relnbt = {(x - x0, y - y0, z - z0): v for (x, y, z), v in self.nbt.items()}
        d = os.path.join(DROP, 'edits', eid); os.makedirs(d, exist_ok=True)
        # a new structure name every publish, so the server never serves a cached older copy
        ver = reg['edits'].get(self.name, {}).get('ver', 0) + 1
        sname = f'spawn_{eid.replace("-", "_")}_v{ver}'
        relents = [((x - x0, y - y0, z - z0), e) for (x, y, z), e in self.ents]
        nbt.write(nbt.structure(rel, block_nbt=relnbt, entities=relents), os.path.join(d, sname + '.nbt'))
        solid = [(p, b) for p, b in sorted(B.items()) if b != 'air']
        step = max(1, len(solid) // checks)
        chk = [f'{x} {y} {z} minecraft:{b.split("[")[0].replace("minecraft:", "")}' for (x, y, z), b in solid[::step][:checks]] + self.extra_checks
        man = {'id': eid, 'title': self.title, 'slot': slot, 'box': [x0, y0, z0, x1, y1, z1],
               'files': [{'src': sname + '.nbt', 'dst': STRUCT_DIR + sname + '.nbt', 'binary': True}],
               'run': self.pre_run + [f'place template minecraft:{sname} {x0} {y0} {z0}'] + self.extra_run,
               'checks': chk, 'blocks': len(B), 'entities': len(self.ents), **self.notes}
        json.dump(man, open(os.path.join(d, 'manifest.json'), 'w'), indent=1)
        reg['edits'][self.name] = {'id': eid, 'slot': slot, 'ver': ver, 'title': self.title, 'box': man['box']}
        json.dump(reg, open(REG, 'w'), indent=1)
        sha = push_drop(f'{eid}: {self.title}') if push else None
        return eid, sha, man

def push_drop(msg):
    run = lambda *a: subprocess.run(a, cwd=DROP, check=True, capture_output=True, text=True).stdout.strip()
    run('git', 'add', '-A')
    subprocess.run(['git', 'commit', '-qm', msg], cwd=DROP, capture_output=True)
    run('git', 'push', '-q', 'origin', 'spawn-drop')
    return run('git', 'rev-parse', 'HEAD')

def browser_line(sha, eid):
    return f"await kit.apply('{sha}','{eid}')"
