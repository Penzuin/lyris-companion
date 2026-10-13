# Minimal NBT writer for Minecraft structure files (place template).
import struct, gzip, io

def _s(b, s): e = s.encode(); b.write(struct.pack('>H', len(e))); b.write(e)
def _tag(v):
    if isinstance(v, bool): return 1
    if isinstance(v, Byte): return 1
    if isinstance(v, int): return 3
    if isinstance(v, float): return 6
    if isinstance(v, str): return 8
    if isinstance(v, IntList): return 9
    if isinstance(v, list): return 9
    if isinstance(v, dict): return 10
    raise TypeError(type(v))
class Byte(int): pass
class IntList(list): pass

def _payload(b, v):
    t = _tag(v)
    if t == 1: b.write(struct.pack('>b', int(v)))
    elif t == 3: b.write(struct.pack('>i', v))
    elif t == 6: b.write(struct.pack('>d', v))
    elif t == 8: _s(b, v)
    elif t == 9:
        et = _tag(v[0]) if v else 0
        b.write(struct.pack('>bi', et, len(v)))
        for x in v: _payload(b, x)
    elif t == 10:
        for k, x in v.items():
            b.write(struct.pack('>b', _tag(x))); _s(b, k); _payload(b, x)
        b.write(b'\x00')

def write(root, path=None):
    b = io.BytesIO(); b.write(b'\x0a'); _s(b, ''); _payload(b, root)
    data = gzip.compress(b.getvalue(), 9)
    if path: open(path, 'wb').write(data)
    return data

def parse_state(s):
    s = s if ':' in s.split('[')[0] else 'minecraft:' + s
    if '[' not in s: return s, {}
    n, p = s[:-1].split('[', 1)
    return n, dict(kv.split('=') for kv in p.split(',') if kv)

def structure(blocks, data_version=4903, block_nbt=None):
    """blocks: {(x,y,z): state}, coordinates >= 0 relative to the structure origin. 'air' entries clear; missing = untouched."""
    block_nbt = block_nbt or {}
    xs = [k[0] for k in blocks]; ys = [k[1] for k in blocks]; zs = [k[2] for k in blocks]
    size = [max(xs) + 1, max(ys) + 1, max(zs) + 1]
    pal, idx, out = [], {}, []
    for pos, st in sorted(blocks.items(), key=lambda kv: (kv[0][1], kv[0][2], kv[0][0])):
        n, props = parse_state(st)
        key = (n, tuple(sorted(props.items())))
        if key not in idx:
            idx[key] = len(pal)
            e = {'Name': n}
            if props: e['Properties'] = dict(sorted(props.items()))
            pal.append(e)
        b = {'pos': [int(pos[0]), int(pos[1]), int(pos[2])], 'state': idx[key]}
        if pos in block_nbt: b['nbt'] = block_nbt[pos]
        out.append(b)
    return {'DataVersion': data_version, 'size': size, 'palette': pal, 'blocks': out, 'entities': []}
