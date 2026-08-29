"""Regenerate every Harina mark from the 3D medallion.

One source of truth — assets-src/crowned-h-medallion.obj — rendered once and
cut into the shapes each surface needs. The old flat artwork these replace had
drifted: its crimson was a darker maroon than the brand token, in the same way
the app palette had drifted before the token generator landed.

Three treatments, matching how the previous set was built:

  full-bleed  the disc touches the canvas edge, corners transparent. Used where
              something else supplies the backdrop.
  masked      the mark inset into the central safe zone over a flat field, for
              Android launchers that crop to a circle or squircle.
  opaque      the disc on canvas cream with no alpha at all, because iOS
              rejects transparency in an app icon.

Run: python3 scripts/build-brand-marks.py
"""
import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import medallion_raster as raster

ROOT = os.path.join(HERE, "..")
CANVAS = (245, 241, 233)          # --color-canvas
MASTER = 1024

def render(size, fill):
    """Face-on, the pose the splash and the animation both start from."""
    return raster.render(0.0, size, fill=fill)

def opaque(mark, size, bg=CANVAS):
    out = Image.new("RGB", (size, size), bg)
    out.paste(mark, (0, 0), mark)
    return out

def inset(mark, size, fraction, bg=None):
    """The mark centred at `fraction` of the canvas, for maskable icons."""
    inner = int(size * fraction)
    small = mark.resize((inner, inner), Image.LANCZOS)
    base = Image.new("RGBA", (size, size), (*bg, 255) if bg else (0, 0, 0, 0))
    off = (size - inner) // 2
    base.paste(small, (off, off), small)
    return base

def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("  ", os.path.relpath(path, ROOT))

def main():
    print("rendering master…")
    bleed = render(MASTER, fill=0.99)     # disc touches the edge
    print("writing marks:")

    app = ("apps", "customer-mobile", "assets")
    # iOS forbids alpha in the app icon; Android's adaptive layer wants it.
    save(opaque(bleed, MASTER), *app, "icon.png")
    save(inset(bleed, MASTER, 0.66), *app, "adaptive-icon.png")

    web = ("public", "harina")
    save(bleed.resize((512, 512), Image.LANCZOS), *web, "icon-512.png")
    save(bleed.resize((192, 192), Image.LANCZOS), *web, "icon-192.png")
    save(inset(bleed, 512, 0.62, bg=CANVAS), *web, "icon-maskable-512.png")
    save(bleed.resize((256, 256), Image.LANCZOS), *web, "badge.png")

    save(opaque(bleed.resize((180, 180), Image.LANCZOS), 180), "app", "apple-icon.png")
    save(bleed.resize((256, 256), Image.LANCZOS), "app", "icon.png")
    ico = os.path.join(ROOT, "app", "favicon.ico")
    bleed.resize((64, 64), Image.LANCZOS).save(
        ico, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
    )
    print("   app/favicon.ico")

    # The wordmark lockup: swap the mark, keep the type.
    for dest in [os.path.join(ROOT, "public", "harina", "logo.png"),
                 os.path.join(ROOT, *app, "logo.png")]:
        lockup = Image.open(dest).convert("RGBA")
        box = (73, 2, 153, 82)                       # measured from the original
        w, h = box[2] - box[0], box[3] - box[1]
        cleared = Image.new("RGBA", lockup.size, (0, 0, 0, 0))
        cleared.paste(lockup, (0, 0))
        cleared.paste(Image.new("RGBA", (w, h), (0, 0, 0, 0)), box)
        cleared.paste(bleed.resize((w, h), Image.LANCZOS), box, bleed.resize((w, h), Image.LANCZOS))
        cleared.save(dest)
        print("  ", os.path.relpath(dest, ROOT))

if __name__ == "__main__":
    main()
