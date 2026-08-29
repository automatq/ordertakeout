import numpy as np, os, sys, time
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import medallion_raster as raster

FRAMES, SIZE, COLS = 36, 300, 6
SWING = np.radians(26.0)
rows = (FRAMES + COLS - 1) // COLS
sheet = Image.new("RGBA", (COLS * SIZE, rows * SIZE), (0, 0, 0, 0))

t0 = time.time()
for i in range(FRAMES):
    # A full sine period: 0 -> +swing -> 0 -> -swing -> 0. Loops seamlessly.
    ang = SWING * np.sin(2 * np.pi * i / FRAMES)
    img = raster.render(ang, SIZE)
    sheet.paste(img, ((i % COLS) * SIZE, (i // COLS) * SIZE))
    print(f"\r{i+1}/{FRAMES}", end="", file=sys.stderr)
print(f"\n{time.time()-t0:.1f}s", file=sys.stderr)

out = os.path.join(HERE, "..", "apps", "customer-mobile", "assets", "medallion-sheet.webp")
sheet.save(out, "WEBP", quality=88, method=6, lossless=False)
sheet.crop((0, 0, SIZE, SIZE)).save("/tmp/medallion/frame0.png")
print(out)
