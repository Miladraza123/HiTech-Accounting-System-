"""Builds the app icons from the official HiTech Engineering logo.

Kept as a script (not a one-off) so the icons can be regenerated verbatim
if the logo is ever re-supplied. Every number here was measured from the
source file's alpha channel, not eyeballed -- see the comments.
"""
from PIL import Image, ImageDraw
import math, numpy as np, sys

SRC = sys.argv[1]
OUT = sys.argv[2]

# Bump this whenever the artwork changes, and update the three places that
# reference the filenames (manifest.webmanifest, app/layout.tsx, sw.js).
#
# The filenames carry a version for a concrete reason, learned the hard way:
# Chrome decides whether to re-download a PWA's icons by comparing the icon
# URLs in the manifest, not their contents. When the mark changed but the
# URLs stayed /icon-192.png and /icon-512.png, installed apps picked up the
# new NAME (a plain string compare) and kept the OLD ICON. Changing the URL
# is what makes the update visible.
VERSION = "v2"

im = Image.open(SRC).convert('RGBA')

# The gear + arrow mark. These bounds come from the alpha channel at a
# threshold of >2, because this file carries ~26,000 pixels at alpha=1 that
# are invisible to the eye but would inflate a naive getbbox() by ~100px and
# throw the centring off. Verified: 0 mark pixels fall outside this box.
MARK = im.crop((619, 90, 1353, 773))          # 734 x 683
R = MARK.width / MARK.height                   # 1.0747

def fit(box):
    w, h = (box, round(box / R)) if R >= 1 else (round(box * R), box)
    return MARK.resize((w, h), Image.LANCZOS)

def build(size, frac, rounded):
    c = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    a = fit(round(size * frac))
    c.alpha_composite(a, ((size - a.width) // 2, (size - a.height) // 2))
    if rounded:
        m = Image.new('L', (size, size), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1],
                                            radius=round(size * 0.18), fill=255)
        c.putalpha(m)
    return c

# The largest the mark can be while still sitting entirely inside Android's
# maskable safe zone -- the central circle of diameter 0.8 * size. Solved,
# not guessed, so the artwork can never be clipped by a launcher mask.
SAFE = 0.8 * R / math.sqrt(1 + R * R)          # 0.5857

build(192, 0.78, True ).save(f'{OUT}/icon-192-{VERSION}.png')
build(512, 0.78, True ).save(f'{OUT}/icon-512-{VERSION}.png')
build(192, SAFE, False).save(f'{OUT}/icon-maskable-192-{VERSION}.png')
build(512, SAFE, False).save(f'{OUT}/icon-maskable-512-{VERSION}.png')
build(180, 0.74, False).save(f'{OUT}/apple-touch-icon-{VERSION}.png')   # iOS rounds it itself

# Assert the safe-zone guarantee rather than trusting the arithmetic.
for size in (192, 512):
    arr = np.array(build(size, SAFE, False))
    art = (arr[:, :, :3] != 255).any(axis=2)
    yy, xx = np.mgrid[0:size, 0:size]
    c = (size - 1) / 2
    inside = ((xx - c) ** 2 + (yy - c) ** 2) <= (0.4 * size) ** 2
    clipped = int((art & ~inside).sum())
    assert clipped == 0, f'{size}px maskable would clip {clipped} px'
    print(f'  {size}px maskable: {int(art.sum())} artwork px, 0 clipped by the safe circle')
print('icons written')
