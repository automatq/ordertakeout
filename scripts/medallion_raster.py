"""Software turntable rasteriser for the crowned-H medallion.

No GPU and no Blender: numpy and a z-buffer. Enough for a logo, and it means
the sprite sheet can be rebuilt anywhere Python and Pillow are installed.

Run scripts/build-medallion-sheet.py to regenerate assets/medallion-sheet.webp
and assets/badge.png from assets-src/crowned-h-medallion.obj."""
import numpy as np, os, sys
from PIL import Image

OBJ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets-src", "crowned-h-medallion.obj")
SS = 2                      # supersample factor

# albedo (sRGB), metallic, roughness-as-exponent
MATERIALS = {
    "gold_leaf":       ((1.00, 0.77, 0.27), 1.0, 40),
    "crimson_enamel":  ((0.81, 0.25, 0.14), 0.0, 90),
    "crimson_dark":    ((0.66, 0.20, 0.11), 0.0, 60),
    "terracotta_bead": ((0.85, 0.44, 0.28), 0.0, 40),
}

def load(path):
    verts, norms, tris, mats = [], [], [], []
    cur = None
    for line in open(path):
        if line.startswith("v "):
            verts.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vn "):
            norms.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("usemtl"):
            cur = line.split()[1]
        elif line.startswith("f "):
            idx = []
            for tok in line.split()[1:]:
                p = tok.split("/")
                v = int(p[0]) - 1
                n = int(p[2]) - 1 if len(p) > 2 and p[2] else v
                idx.append((v, n))
            for i in range(1, len(idx) - 1):
                tris.append([idx[0][0], idx[i][0], idx[i + 1][0],
                             idx[0][1], idx[i][1], idx[i + 1][1]])
                mats.append(cur)
    return np.array(verts), np.array(norms), np.array(tris), mats

V, VN, T, M = load(OBJ)
V = V - V.mean(0)
V = V / np.abs(V).max()                      # normalise to unit box

names = sorted(set(M))
mat_id = np.array([names.index(m) for m in M])
# sRGB in the table, linear for the maths. Lighting an sRGB value and then
# applying the display transform brightens it twice, which is how a crimson
# enamel disc came out salmon pink.
ALB = np.array([MATERIALS[n][0] for n in names]) ** 2.2
METAL = np.array([MATERIALS[n][1] for n in names])
SHINE = np.array([MATERIALS[n][2] for n in names])

LIGHT = np.array([-0.45, 0.62, 0.75]); LIGHT /= np.linalg.norm(LIGHT)
FILL  = np.array([0.55, -0.25, 0.40]); FILL /= np.linalg.norm(FILL)
VIEW  = np.array([0.0, 0.0, 1.0])

def render(angle, size, fill=0.92):
    px = size * SS
    ca, sa = np.cos(angle), np.sin(angle)
    R = np.array([[ca, 0, sa], [0, 1, 0], [-sa, 0, ca]])
    P = V @ R.T
    Nn = VN @ R.T

    # Orthographic, y up. `fill` is the fraction of the canvas the disc's
    # diameter spans: 0.92 leaves the sheet its breathing room, 0.99 pushes the
    # rim to the edge for an icon that something else will mask.
    scale = px * fill / 2
    sx = P[:, 0] * scale + px / 2
    sy = -P[:, 1] * scale + px / 2
    sz = P[:, 2]

    # Per-vertex shading (Gouraud), per material.
    ndl = np.clip(Nn @ LIGHT, 0, 1)
    ndf = np.clip(Nn @ FILL, 0, 1)
    half = LIGHT + VIEW; half /= np.linalg.norm(half)
    ndh = np.clip(Nn @ half, 0, 1)
    # Schlick Fresnel. Without it a flat disc facing the camera sits entirely
    # inside the highlight and washes to pink; with it, the face shows its own
    # colour and only the bevels and rim catch the light.
    ndv = np.clip(Nn @ VIEW, 0, 1)
    fres = (1.0 - ndv) ** 5

    color = np.zeros((px, px, 3), np.float32)
    zbuf = np.full((px, px), -1e9, np.float32)
    alpha = np.zeros((px, px), np.float32)

    a, b, c = T[:, 0], T[:, 1], T[:, 2]
    na, nb, nc = T[:, 3], T[:, 4], T[:, 5]
    # Back-face cull in screen space (y is flipped, so the sign inverts).
    area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a])
    keep = np.where(area < -1e-9)[0]

    for t in keep:
        i0, i1, i2 = a[t], b[t], c[t]
        x0, x1, x2 = sx[i0], sx[i1], sx[i2]
        y0, y1, y2 = sy[i0], sy[i1], sy[i2]
        xmin = max(int(np.floor(min(x0, x1, x2))), 0)
        xmax = min(int(np.ceil(max(x0, x1, x2))), px - 1)
        ymin = max(int(np.floor(min(y0, y1, y2))), 0)
        ymax = min(int(np.ceil(max(y0, y1, y2))), px - 1)
        if xmin > xmax or ymin > ymax:
            continue
        xs = np.arange(xmin, xmax + 1) + 0.5
        ys = np.arange(ymin, ymax + 1) + 0.5
        gx, gy = np.meshgrid(xs, ys)
        d = area[t]
        w0 = ((x1 - gx) * (y2 - gy) - (x2 - gx) * (y1 - gy)) / d
        w1 = ((x2 - gx) * (y0 - gy) - (x0 - gx) * (y2 - gy)) / d
        w2 = 1.0 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not inside.any():
            continue
        z = w0 * sz[i0] + w1 * sz[i1] + w2 * sz[i2]
        sub = zbuf[ymin:ymax + 1, xmin:xmax + 1]
        win = inside & (z > sub)
        if not win.any():
            continue
        m = mat_id[t]
        alb, metal, shn = ALB[m], METAL[m], SHINE[m]
        vd = w0 * ndl[na[t]] + w1 * ndl[nb[t]] + w2 * ndl[nc[t]]
        vf = w0 * ndf[na[t]] + w1 * ndf[nb[t]] + w2 * ndf[nc[t]]
        vh = w0 * ndh[na[t]] + w1 * ndh[nb[t]] + w2 * ndh[nc[t]]
        vfr = w0 * fres[na[t]] + w1 * fres[nb[t]] + w2 * fres[nc[t]]
        shade = 0.21 + 0.86 * vd + 0.22 * vf
        # Metals have no diffuse and tint their own highlight; dielectrics keep
        # their colour and take a small white one.
        f0 = alb if metal > 0.5 else np.array([0.04, 0.04, 0.04])
        refl = f0 + (1.0 - f0) * vfr[..., None]
        spec = refl * (vh ** shn)[..., None] * (1.6 if metal > 0.5 else 0.7)
        diffuse = 0.0 if metal > 0.5 else 1.0
        rgb = alb[None, None, :] * (shade[..., None] * diffuse) + spec
        if metal > 0.5:
            rgb = rgb + alb[None, None, :] * (0.16 + 0.60 * vd[..., None])
        tgt = color[ymin:ymax + 1, xmin:xmax + 1]
        tgt[win] = np.clip(rgb, 0, 1)[win]
        sub[win] = z[win]
        alpha[ymin:ymax + 1, xmin:xmax + 1][win] = 1.0

    rgba = np.dstack([np.clip(color, 0, 1) ** (1 / 2.2), alpha])
    img = Image.fromarray((rgba * 255).astype(np.uint8), "RGBA")
    return img.resize((size, size), Image.LANCZOS)

if __name__ == "__main__":
    ang = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
    out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/medallion/test.png"
    render(np.radians(ang), 288).save(out)
    print("wrote", out)
