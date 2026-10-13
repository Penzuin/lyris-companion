# Moonwell Square: replace the straight full-width steps (x294-296) with a crescent of shallow half-steps that
# curves round the Moonwell (centre on the pier axis z -2423), flanked by planted grass banks with a dry-stone kerb.
# Walk level = 70 + 0.5*k, k = ceil(x - 293.5 + o(dz)), clamped 0..6. o(dz) bows every contour round the well.
import sys, math, json
sys.path.insert(0, '/home/claude/lyris-companion/workshop')
import edit as W

ZC, WELL = -2423, (289, -2423)
X0, X1, Z0, Z1 = 290, 299, -2440, -2407

def smooth(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)
def off(dz):
    dz = abs(dz)
    return 0.06 * dz * dz if dz <= 8 else 3.84 * (1 - smooth((dz - 8) / 6.0))
def h01(x, z, s):
    v = math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453
    return v - math.floor(v)
def wob(z): return 0.45 * math.sin(z * 0.55 + 1.7) + 0.25 * math.sin(z * 1.3 + 3.4)

def level(x, z):
    dz = z - ZC
    w = 0.0 if abs(dz) <= 8 or abs(dz) >= 15 else wob(z)
    k = max(0, min(6, math.ceil(x - 293.5 + off(dz) + w - 1e-9)))
    return 70.0 + 0.5 * k, k

e = W.Edit('moonwell-steps', 'Moonwell Square: crescent steps round the Moonwell, planted banks')
plants = 0
for z in range(Z0, Z1 + 1):
    dz = abs(z - ZC)
    for x in range(X0, X1 + 1):
        lvl, k = level(x, z)
        if math.hypot(x - WELL[0], z - WELL[1]) <= 4.6: continue        # never touch the Moonwell rings
        if k == 0:
            if x >= 294:                                                  # old step cells that become plaza
                for y in range(70, 77): e.put(x, y, z, 'air')
                e.put(x, 69, z, 'polished_andesite' if h01(x, z, 1) < 0.5 else 'cobblestone')
            continue
        paved = dz <= 6 or dz >= 15          # the crescent, and the front-row walks at both ends
        if not paved: lvl = math.ceil(lvl)                                # banks are whole-block grass terraces
        whole = int(math.floor(lvl)); half = (lvl - whole) > 0.25
        for y in range(69, 77): e.put(x, y, z, 'air')
        for y in range(69, whole): e.put(x, y, z, 'stone' if y < whole - 2 else ('stone_bricks' if paved else 'dirt'))
        if paved:
            if half: e.put(x, whole, z, 'stone_brick_slab[type=bottom]')                 # half rows: stone brick
            else:
                top = 'polished_andesite'                                                   # whole rows: pale nosing
                if k == 6 and x == 299 and dz <= 2: top = 'calcite'                         # moonstone sill on the top row
                e.put(x, whole - 1, z, top)
        else:
            sy = whole - 1
            # front of each bank: a low dry-stone kerb where it meets the plaza
            plaza_next = level(x - 1, z)[1] == 0 or math.hypot(x - 1 - WELL[0], z - WELL[1]) <= 4.6
            if whole == 71 and plaza_next:
                e.put(x, sy, z, 'mossy_cobblestone' if h01(x, z, 3) < 0.35 else 'cobblestone'); continue
            e.put(x, sy, z, 'grass_block')
            # planting in drifts on the banks (not on the strip right beside the steps, not at the very top edge)
            if 9 <= dz <= 13 and x <= 298:
                drift = 0.5 + 0.5 * math.sin(z * 0.7 + x * 0.5)
                p = h01(x, z, 9)
                if p < 0.10 + 0.22 * drift:
                    q = h01(x, z, 5)
                    pl = ('azalea' if q < 0.2 else 'flowering_azalea' if q < 0.32 else 'fern' if q < 0.5 else
                          'lily_of_the_valley' if q < 0.66 else 'cornflower' if q < 0.78 else 'short_grass')
                    e.put(x, sy + 1, z, pl); plants += 1
                elif p < 0.5:
                    e.put(x, sy + 1, z, 'short_grass'); plants += 1
            elif dz <= 8 and h01(x, z, 7) < 0.35:
                e.put(x, sy + 1, z, 'short_grass'); plants += 1

json.dump({f'{a},{b},{c}': v for (a, b, c), v in e.B.items()}, open('/tmp/claude-0/moonwell_B.json', 'w'))
print('blocks', len(e.B), 'plants', plants)
if '--publish' in sys.argv:
    eid, sha, man = e.publish(fix_connections=False, push='--push' in sys.argv, checks=6)
    print(eid, man['box'], sha)
