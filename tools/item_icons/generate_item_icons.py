"""Generates the item icon set for the turret prototype.

Usage:
    python3 tools/item_icons/generate_item_icons.py [--out DIR] [--size PX] [--font PATH]

Requires Pillow (pip install pillow). Output: transparent `{item_id}.png` per item
in assets/items, plus `contact_sheet.png` next to this script for review.

Adapted from the jigsaw project's achievement icon generator: same procedural
Pillow approach, but every item gets its own motif. Art is drawn on a 100x100
unit grid at 512px, given a dark silhouette outline and drop shadow, then
downscaled. The tier is shown by the slot border in the UI, so icons carry no
frame. Item ids are read from js/data.js so missing icons fail the run.
"""
import argparse
import math
import os
import re
import sys
from contextlib import contextmanager

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DEFAULT_FONT = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"
S = 512
U = S / 100.0
OLW = 1.5

OUT = (20, 22, 28)
HOLE = (28, 31, 36)
WHITE = (241, 243, 245)
STEEL = (173, 181, 189)
STEEL_L = (222, 226, 230)
STEEL_D = (110, 118, 128)
CHAR = (64, 70, 80)
RED = (255, 107, 107)
RED_D = (201, 42, 42)
BLOOD = (224, 49, 49)
MEAT = (214, 84, 84)
MEAT_L = (240, 128, 120)
ORANGE = (255, 146, 43)
ORANGE_D = (232, 89, 12)
YELLOW = (255, 212, 59)
GOLD = (250, 176, 5)
GOLD_L = (255, 224, 102)
GREEN = (105, 219, 124)
GREEN_D = (47, 158, 68)
LIME = (169, 227, 75)
TOXIC = (130, 201, 30)
OLIVE = (130, 150, 80)
MINT = (99, 230, 190)
BLUE = (116, 192, 252)
BLUE_D = (28, 126, 214)
CYAN = (102, 217, 232)
ICE = (197, 246, 250)
GLASS = (208, 235, 255)
PURPLE = (177, 151, 252)
VIOLET = (204, 93, 232)
VOID = (132, 46, 166)
VOID_L = (230, 150, 255)
PINK = (247, 131, 172)
PINK_L = (252, 194, 215)
PINK_D = (200, 80, 130)
BROWN = (166, 110, 60)
BROWN_L = (204, 154, 102)
BROWN_D = (110, 70, 35)
RUST = (196, 98, 42)
COPPER = (224, 130, 70)
COPPER_D = (168, 86, 40)
BONE = (248, 240, 220)
LUNAR = (165, 216, 255)
LUNAR_D = (76, 110, 245)

TIER_COLORS = [(233, 236, 239), (105, 219, 124), (255, 107, 107), (116, 192, 252), (255, 212, 59), (204, 93, 232),
               (255, 146, 43)]

_font_path = DEFAULT_FONT


def font(size):
    return ImageFont.truetype(_font_path, size)


# --------------------------------------------------------------------------- geometry

def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c[:3])


def pol(cx, cy, r, a):
    return (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))


def arcpts(cx, cy, rx, ry, a0, a1, n=None):
    n = n or max(8, int(abs(a1 - a0) / 5))
    out = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        out.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
    return out


def bez(p0, p1, p2, n=24):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
    return out


def taper(path, width):
    """Polygon around `path` whose half-width at fraction t is width(t)."""
    left, right = [], []
    n = len(path) - 1
    for i, (x, y) in enumerate(path):
        ax, ay = path[max(0, i - 1)]
        bx, by = path[min(n, i + 1)]
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy) or 1
        nx, ny = -dy / ln, dx / ln
        w = width(i / n)
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    return left + right[::-1]


def hexpts(cx, cy, r, rot=30):
    return [pol(cx, cy, r, rot + 60 * k) for k in range(6)]


def shield_pts(cx, cy, w, h):
    return ([(cx - w, cy - h * 0.75), (cx, cy - h), (cx + w, cy - h * 0.75), (cx + w, cy)]
            + bez((cx + w, cy), (cx + w * 0.9, cy + h * 0.65), (cx, cy + h))[1:]
            + bez((cx, cy + h), (cx - w * 0.9, cy + h * 0.65), (cx - w, cy))[1:])


# --------------------------------------------------------------------------- pen

class Pen:
    """Draws in 0..100 unit space with a transform stack; every fill gets a dark outline."""

    def __init__(self, img):
        self.d = ImageDraw.Draw(img, "RGBA")
        self.m = (0.0, 0.0, 0.0, 1.0)
        self.noline = False

    @contextmanager
    def at(self, x, y, ang=0, s=1):
        old = self.m
        (wx, wy), = self._tf([(x, y)], old)
        self.m = (wx, wy, old[2] + ang, old[3] * s)
        try:
            yield
        finally:
            self.m = old

    def union(self, fn):
        """Draws fn twice so overlapping parts read as one outlined shape."""
        fn()
        self.noline = True
        try:
            fn()
        finally:
            self.noline = False

    def _tf(self, seq, m=None):
        tx, ty, a, s = m or self.m
        c, sn = math.cos(math.radians(a)), math.sin(math.radians(a))
        return [(tx + s * (x * c - y * sn), ty + s * (x * sn + y * c)) for x, y in seq]

    def _px(self, seq):
        return [(x * U, y * U) for x, y in self._tf(seq)]

    def _w(self, w):
        return max(1, int(round(w * self.m[3] * U)))

    def _stroke(self, pts, fill, width):
        self.d.line(pts, fill=fill, width=width, joint="curve")
        r = width / 2.0
        for x, y in (pts[0], pts[-1]):
            self.d.ellipse((x - r, y - r, x + r, y + r), fill=fill)

    def poly(self, seq, fill, ol=True):
        pts = self._px(seq)
        self.d.polygon(pts, fill=fill)
        if ol and not self.noline:
            self.d.line(pts + [pts[0], pts[1]], fill=OUT, width=self._w(OLW), joint="curve")

    def line(self, seq, fill, w, ol=True):
        pts = self._px(seq)
        if ol and not self.noline:
            self._stroke(pts, OUT, self._w(w + 2 * OLW))
        self._stroke(pts, fill, self._w(w))

    def lines(self, segs, fill, w, ol=True):
        if ol and not self.noline:
            for seg in segs:
                self._stroke(self._px(seg), OUT, self._w(w + 2 * OLW))
        for seg in segs:
            self._stroke(self._px(seg), fill, self._w(w))

    def ellipse(self, cx, cy, rx, ry, fill, ol=True):
        self.poly(arcpts(cx, cy, rx, ry, 0, 360, 72)[:-1], fill, ol)

    def circle(self, cx, cy, r, fill, ol=True):
        self.ellipse(cx, cy, r, r, fill, ol)

    def rect(self, x0, y0, x1, y1, fill, r=0, ol=True):
        if r <= 0:
            self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], fill, ol)
            return
        pts = (arcpts(x1 - r, y0 + r, r, r, 270, 360, 6) + arcpts(x1 - r, y1 - r, r, r, 0, 90, 6)
               + arcpts(x0 + r, y1 - r, r, r, 90, 180, 6) + arcpts(x0 + r, y0 + r, r, r, 180, 270, 6))
        self.poly(pts, fill, ol)

    def arc(self, cx, cy, r, a0, a1, fill, w, ol=True):
        self.line(arcpts(cx, cy, r, r, a0, a1), fill, w, ol)

    def star(self, cx, cy, r, fill, n=5, inner=0.45, rot=-90, ol=True):
        pts = [pol(cx, cy, r if k % 2 == 0 else r * inner, rot + k * 180.0 / n) for k in range(2 * n)]
        self.poly(pts, fill, ol)

    def shine(self, cx, cy, rx, ry, alpha=130):
        self.ellipse(cx, cy, rx, ry, (255, 255, 255, alpha), ol=False)

    def glow(self, cx, cy, r, col, alpha=60):
        self.ellipse(cx, cy, r, r, col[:3] + (alpha,), ol=False)

    def text(self, cx, cy, s, size, fill):
        (x, y), = self._px([(cx, cy)])
        self.d.text((x, y), s, font=font(int(size * U * self.m[3])), fill=fill, anchor="mm",
                    stroke_width=self._w(OLW), stroke_fill=OUT)


# --------------------------------------------------------------------------- shared motifs

def drop(g, cx, cy, r, col):
    h = r * 2.4
    a = math.degrees(math.acos(r / h))
    g.poly([(cx, cy - h)] + arcpts(cx, cy, r, r, 270 + a, 270 - a + 360), col)


def plus(g, cx, cy, a, col, ol=True):
    b = a / 3.0
    g.poly([(cx - b, cy - a), (cx + b, cy - a), (cx + b, cy - b), (cx + a, cy - b), (cx + a, cy + b),
            (cx + b, cy + b), (cx + b, cy + a), (cx - b, cy + a), (cx - b, cy + b), (cx - a, cy + b),
            (cx - a, cy - b), (cx - b, cy - b)], col, ol)


def spark(g, cx, cy, r, col=YELLOW):
    g.star(cx, cy, r, col, n=4, inner=0.32)


def up_arrow(g, cx, cy, s, col):
    g.poly([(cx, cy - s), (cx + s * 0.8, cy), (cx + s * 0.32, cy), (cx + s * 0.32, cy + s),
            (cx - s * 0.32, cy + s), (cx - s * 0.32, cy), (cx - s * 0.8, cy)], col)


def bolt(g, cx, cy, s=1.0, col=YELLOW):
    with g.at(cx, cy, 0, s):
        g.poly([(4, -24), (-12, 4), (-1, 4), (-5, 24), (12, -6), (1, -6), (8, -24)], col)


def flame(g, cx, cy, s=1.0, outer=ORANGE, inner=YELLOW):
    pts = [(0, -26), (6, -14), (14, -6), (17, 4), (15, 13), (8, 19), (0, 21), (-8, 19), (-15, 13),
           (-17, 4), (-14, -6), (-9, -12), (-7, -4), (-3, -14)]
    with g.at(cx, cy, 0, s):
        g.poly(pts, outer)
        g.poly([(x * 0.55, y * 0.55 + 8) for x, y in pts], inner, ol=False)


def snowflake(g, cx, cy, r, col, w=3.0):
    segs = []
    for k in range(6):
        a = k * 60 - 90
        segs.append([(cx, cy), pol(cx, cy, r, a)])
        bx, by = pol(cx, cy, r * 0.58, a)
        segs.append([(bx, by), pol(bx, by, r * 0.32, a - 45)])
        segs.append([(bx, by), pol(bx, by, r * 0.32, a + 45)])
    g.lines(segs, col, w)


def skull(g, cx, cy, s=1.0, col=BONE, eye=HOLE):
    with g.at(cx, cy, 0, s):
        g.rect(-9, 4, 9, 18, col, r=3)
        g.circle(0, -4, 17, col)
        g.circle(-6.5, -2, 5, eye, ol=False)
        g.circle(6.5, -2, 5, eye, ol=False)
        g.poly([(0, 4), (-2.5, 8.5), (2.5, 8.5)], eye, ol=False)
        g.lines([[(x, 13.5), (x, 17.5)] for x in (-4.5, 0, 4.5)], OUT, 1.2, ol=False)


def heart(g, cx, cy, s, col, ol=True):
    pts = []
    for i in range(72):
        t = 2 * math.pi * i / 72
        x = 16 * math.sin(t) ** 3
        y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((cx + x * s / 16, cy + y * s / 16))
    g.poly(pts, col, ol)


def gem(g, cx, cy, r, col):
    top, mid = cy - r * 0.65, cy - r * 0.15
    g.poly([(cx - r * 0.6, top), (cx + r * 0.6, top), (cx + r, mid), (cx, cy + r), (cx - r, mid)], col)
    g.poly([(cx - r * 0.5, top + 1), (cx + r * 0.5, top + 1), (cx + r * 0.3, mid), (cx - r * 0.3, mid)],
           shade(col, 1.25), ol=False)
    g.poly([(cx + r * 0.35, mid), (cx + r * 0.9, mid), (cx, cy + r * 0.9)], shade(col, 0.78), ol=False)
    g.lines([[(cx - r, mid), (cx + r, mid)], [(cx - r * 0.35, mid), (cx, cy + r)],
             [(cx + r * 0.35, mid), (cx, cy + r)]], OUT, 0.9, ol=False)


def dagger(g, blade=STEEL_L, guard=GOLD, grip=BROWN):
    """Local axis +x, spans -32..38."""
    g.rect(-24, -4, -9, 4, grip, r=2)
    g.circle(-27, 0, 5, guard)
    g.poly([(-8, -6), (24, -5), (38, 0), (24, 5), (-8, 6)], blade)
    g.line([(-4, 0), (26, 0)], shade(blade, 0.75), 1.2, ol=False)
    g.rect(-11, -12, -6, 12, guard, r=2)


def bullet(g, tip=STEEL_L, case=GOLD):
    """Local axis -y, spans -22..18."""
    g.rect(-6, -5, 6, 16, case, r=1)
    g.rect(-7, 14, 7, 18, shade(case, 0.8), r=1)
    g.poly([(-6, -5), (-6, -10), (0, -22), (6, -10), (6, -5)], tip)


def missile(g, body=WHITE, tip=RED, fin=RED):
    """Local axis +x, spans -28..23."""
    g.poly([(-17, -3), (-28, 0), (-17, 3)], ORANGE)
    g.poly([(-8, -4), (-17, -12), (-22, -12), (-18, -4)], fin)
    g.poly([(-8, 4), (-17, 12), (-22, 12), (-18, 4)], fin)
    g.rect(-18, -5, 12, 5, body, r=2)
    g.poly([(11, -5), (23, 0), (11, 5)], tip)
    g.line([(2, -5), (2, 5)], STEEL_D, 1.2, ol=False)


def key(g, col):
    """Local axis +x, spans -24..22."""
    g.rect(12, 2, 16, 10, col)
    g.rect(17.5, 2, 21, 8, col)
    g.rect(-6, -3.5, 22, 3.5, col)
    g.circle(-14, 0, 10, col)
    g.circle(-14, 0, 4.5, HOLE)


def band(g, ring, stone, emblem=None):
    g.circle(50, 60, 25, ring)
    g.circle(50, 60, 15, HOLE)
    g.shine(36, 52, 3, 5)
    g.circle(50, 32, 15, stone)
    if emblem:
        emblem(50, 32)
    g.shine(44, 26, 4, 2.6)


def glasses(g, frame, lens, pupil=None):
    g.line([(17, 47), (9, 38)], frame, 3.5)
    g.line([(83, 47), (91, 38)], frame, 3.5)
    g.arc(50, 52, 8, 200, 340, frame, 3.5)
    for x in (31, 69):
        g.circle(x, 52, 16, frame)
        g.circle(x, 52, 11, lens)
        if pupil:
            g.circle(x, 53, 4.5, pupil, ol=False)
        g.shine(x - 4, 47, 4, 2.6)


def ukulele(g, body, dark, accent):
    with g.at(48, 54, -40):
        g.rect(8, -3.5, 34, 3.5, dark)
        g.rect(32, -6, 44, 6, dark, r=2)
        g.union(lambda: (g.circle(4, 0, 10, body), g.circle(-13, 0, 15, body)))
        g.circle(-3, 0, 4.5, HOLE)
        g.rect(-21, -5, -17, 5, dark)
        g.lines([[(-19, y), (40, y)] for y in (-2, 0, 2)], BONE, 0.6, ol=False)
    bolt(g, 78, 28, 0.55, accent)


def flask(g, liquid, cx=50, cy=60, r=22):
    g.rect(cx - 7, cy - r - 14, cx + 7, cy - r + 4, GLASS)
    g.rect(cx - 9, cy - r - 20, cx + 9, cy - r - 12, BROWN_L, r=2)
    g.circle(cx, cy, r, GLASS)
    rr = r - 1.6
    a = math.degrees(math.asin(-4 / rr))
    g.poly(arcpts(cx, cy, rr, rr, a, 180 - a), liquid, ol=False)
    g.shine(cx - 9, cy - 9, 5, 4)


def pauldron(g, col, dark, spikes=False):
    if spikes:
        for a in (220, 270, 320):
            g.poly([pol(50, 66, 30, a - 9), pol(50, 66, 46, a), pol(50, 66, 30, a + 9)], STEEL_L)
    g.poly(arcpts(50, 66, 32, 30, 180, 360) + [(82, 74), (18, 74)], col)
    g.arc(50, 66, 21, 200, 340, dark, 3, ol=False)
    g.rect(16, 70, 84, 80, dark, r=3)


def gear(g, cx, cy, r, col, teeth=8):
    def body():
        g.circle(cx, cy, r, col)
        for k in range(teeth):
            with g.at(cx, cy, k * 360.0 / teeth):
                g.rect(r - 5, -5, r + 7, 5, col, r=1.5)
    g.union(body)
    g.circle(cx, cy, r * 0.42, HOLE)


def crescent(g, c1, r1, c2, r2, col):
    th = math.atan2(c1[1] - c2[1], c1[0] - c2[0])
    steps = [math.pi * (i / 90.0 - 1) for i in range(181)]
    outer = [(c1[0] + r1 * math.cos(th + t), c1[1] + r1 * math.sin(th + t)) for t in steps]
    outer = [p for p in outer if math.hypot(p[0] - c2[0], p[1] - c2[1]) > r2]
    inner = [(c2[0] + r2 * math.cos(th - t), c2[1] + r2 * math.sin(th - t)) for t in steps]
    inner = [p for p in inner if math.hypot(p[0] - c1[0], p[1] - c1[1]) < r1]
    g.poly(outer + inner, col)


def leaf(g, cx, cy, ang, length, width, col):
    with g.at(cx, cy, ang):
        top = [(length * i / 16, -width * math.sin(math.pi * i / 16)) for i in range(17)]
        bot = [(length * i / 16, width * math.sin(math.pi * i / 16)) for i in range(16, 0, -1)]
        g.poly(top + bot, col)
        g.line([(1, 0), (length * 0.8, 0)], shade(col, 0.7), 1.2, ol=False)


def perforator(g, col, dark):
    g.poly([(36, 16), (64, 16), (58, 42), (50, 88), (42, 42)], col)
    g.poly([(50, 18), (62, 18), (56, 42), (50, 80)], shade(col, 1.25), ol=False)
    g.lines([[(38, 26), (62, 26)], [(41, 40), (59, 40)]], dark, 2.5, ol=False)


def drone(g, body, eye):
    g.lines([[(36, 44), (22, 30)], [(64, 44), (78, 30)]], STEEL_D, 3)
    g.ellipse(22, 28, 13, 4, STEEL_L)
    g.ellipse(78, 28, 13, 4, STEEL_L)
    g.rect(46, 60, 54, 72, CHAR)
    g.circle(50, 50, 17, body)
    g.circle(50, 50, 7, eye)
    g.shine(44, 42, 4, 3)


def orb(g, cx, cy, r, col):
    g.circle(cx, cy, r, col)
    g.shine(cx - r * 0.35, cy - r * 0.38, r * 0.3, r * 0.2)


def wavy(cx, y0, length, amp, phase=0.0, n=14):
    return [(cx + amp * math.sin(phase + i * 0.9), y0 + length * i / n) for i in range(n + 1)]


# --------------------------------------------------------------------------- item icons

ICONS = {}


def icon(item_id):
    def deco(fn):
        ICONS[item_id] = fn
        return fn
    return deco


# Common

@icon("syringe")
def _(g):
    with g.at(50, 50, -45):
        g.rect(-46, -6, -40, 6, STEEL, r=1.5)
        g.line([(-40, 0), (-28, 0)], STEEL, 4)
        g.rect(-30, -13, -26, 13, STEEL, r=1.5)
        g.rect(-26, -9, 18, 9, GLASS, r=2)
        g.rect(-23, -6, 10, 6, RED, ol=False)
        g.lines([[(x, -9), (x, -4)] for x in (-14, -5, 4)], OUT, 1.2, ol=False)
        g.rect(18, -4, 25, 4, STEEL)
        g.line([(25, 0), (40, 0)], STEEL_L, 2.5)


@icon("glasses")
def _(g):
    glasses(g, CHAR, BLUE)


@icon("tritip")
def _(g):
    with g.at(44, 56, -45):
        dagger(g)
    drop(g, 76, 64, 4.5, BLOOD)
    drop(g, 64, 80, 3.6, BLOOD)
    drop(g, 84, 80, 3, BLOOD)


@icon("crowbar")
def _(g):
    g.line([(30, 84), (22, 82)], RED, 6)
    g.line([(30, 84), (60, 28)] + arcpts(70, 28, 10, 10, 180, 360) + [(81, 36)], RED, 8)
    g.line([(34, 74), (54, 36)], (255, 170, 170), 1.5, ol=False)


@icon("focus")
def _(g):
    for k in range(12):
        g.arc(50, 50, 37, k * 30, k * 30 + 17, PINK_L, 2.5)
    g.circle(50, 50, 21, RED)
    g.circle(52, 52, 13, (255, 150, 150), ol=False)
    g.shine(43, 42, 6, 4)


@icon("apr")
def _(g):
    with g.at(38, 58, 30):
        bullet(g)
    with g.at(64, 48, 30):
        bullet(g)


def bomb(g, cx, cy, r, col=CHAR):
    g.line([(cx + 2, cy - r - 4), (cx + 9, cy - r - 13), (cx + 17, cy - r - 11)], BROWN_L, 2.5)
    g.rect(cx - 6, cy - r - 6, cx + 6, cy - r + 4, STEEL_D, r=1.5)
    g.circle(cx, cy, r, col)
    g.shine(cx - r * 0.4, cy - r * 0.4, r * 0.25, r * 0.18)
    g.star(cx + 18, cy - r - 12, 7, YELLOW, n=8, inner=0.45)


@icon("sticky")
def _(g):
    bomb(g, 48, 58, 22)
    g.ellipse(48, 77, 19, 6, LIME)
    g.circle(36, 86, 3.5, LIME)
    g.circle(60, 87, 3, LIME)
    g.ellipse(34, 52, 6, 4, LIME)


@icon("gasoline")
def _(g):
    g.rect(36, 18, 58, 34, RED, r=4)
    g.rect(41, 23, 53, 29, HOLE, r=2)
    g.line([(64, 30), (72, 16)], STEEL, 5)
    g.rect(26, 28, 74, 86, RED, r=6)
    g.lines([[(33, 38), (67, 78)], [(67, 38), (33, 78)]], RED_D, 3, ol=False)
    g.shine(34, 36, 4, 3)


@icon("tooth")
def _(g):
    g.line(bez((14, 20), (50, 36), (86, 20)), BROWN_L, 2.5)
    g.poly([(32, 26), (68, 26), (70, 38)] + bez((70, 38), (62, 66), (48, 90))[1:]
           + bez((48, 90), (42, 60), (30, 38))[1:], BONE)
    g.shine(40, 38, 4, 7)


@icon("steak")
def _(g):
    with g.at(50, 54, -15):
        g.ellipse(0, 0, 35, 25, (250, 222, 200))
        g.ellipse(-2, 2, 29, 20, MEAT, ol=False)
        g.lines([[(-20, -6), (-10, 12)], [(-6, -12), (4, 10)], [(8, -12), (16, 4)]], BROWN_D, 3, ol=False)
        g.circle(20, -6, 6.5, BONE)
        g.circle(20, -6, 2.6, PINK_L, ol=False)


@icon("slug")
def _(g):
    g.line([(79, 46), (72, 31)], GREEN, 2.5)
    g.line([(83, 47), (90, 34)], GREEN, 2.5)
    g.circle(72, 31, 3, GREEN)
    g.circle(90, 34, 3, GREEN)
    g.union(lambda: (g.rect(12, 64, 84, 80, GREEN, r=8), g.line([(76, 72), (81, 50)], GREEN, 12)))
    g.circle(83, 52, 2, OUT, ol=False)
    g.circle(44, 50, 22, BROWN_L)
    spiral = [(44 + 18 * (1 - t / 15.0) * math.cos(t * 1.1), 50 + 18 * (1 - t / 15.0) * math.sin(t * 1.1))
              for t in range(15)]
    g.line(spiral, BROWN_D, 3, ol=False)


@icon("tougher")
def _(g):
    g.ellipse(50, 82, 22, 11, BROWN)
    g.union(lambda: (g.circle(31, 27, 9, BROWN), g.circle(69, 27, 9, BROWN), g.circle(50, 48, 23, BROWN)))
    g.circle(31, 27, 4, BROWN_L, ol=False)
    g.circle(69, 27, 4, BROWN_L, ol=False)
    g.ellipse(50, 57, 11, 8, BROWN_L)
    g.ellipse(50, 53, 4.5, 3.2, OUT, ol=False)
    g.circle(40, 42, 3, OUT, ol=False)
    g.circle(60, 42, 3, OUT, ol=False)


@icon("plate")
def _(g):
    g.poly(hexpts(50, 50, 33), STEEL)
    g.poly(hexpts(50, 50, 23), STEEL_L, ol=False)
    for x, y in hexpts(50, 50, 28):
        g.circle(x, y, 2.4, STEEL_D, ol=False)
    g.shine(42, 36, 7, 3)


@icon("pennies")
def _(g):
    for y in (76, 66, 56, 46):
        g.ellipse(50, y + 5, 25, 8, COPPER_D)
        g.ellipse(50, y, 25, 8, COPPER)
    g.ellipse(50, 46, 15, 4.5, shade(COPPER, 1.15), ol=False)


@icon("mortar")
def _(g):
    g.line([(48, 60), (58, 82)], STEEL, 3)
    g.rect(18, 80, 64, 87, STEEL_D, r=2)
    with g.at(36, 72, -60):
        g.rect(-4, -8, 34, 8, CHAR, r=2)
        g.rect(30, -10, 36, 10, STEEL_D, r=1.5)
    for x, y in ((62, 26), (68, 20)):
        g.circle(x, y, 1.8, WHITE, ol=False)
    with g.at(78, 22, 30):
        g.poly([(-12, -4), (-7, 0), (-12, 4)], STEEL_D)
        g.ellipse(0, 0, 9, 5.5, OLIVE)


@icon("stungren")
def _(g):
    g.arc(30, 26, 5.5, 0, 360, STEEL, 2)
    g.rect(38, 38, 62, 84, OLIVE, r=5)
    g.rect(39.5, 52, 60.5, 56, shade(OLIVE, 0.75), ol=False)
    g.rect(39.5, 66, 60.5, 70, shade(OLIVE, 0.75), ol=False)
    g.rect(41, 26, 59, 39, STEEL, r=2)
    g.line([(59, 30), (67, 36), (66, 62)], STEEL, 3.5)
    spark(g, 20, 52, 9)
    spark(g, 82, 76, 7)
    spark(g, 80, 18, 8)


@icon("taser")
def _(g):
    with g.at(44, 56, -15):
        g.rect(-26, 6, -12, 30, CHAR, r=3)
        g.lines([[(14, -6), (26, -6)], [(14, 6), (26, 6)]], STEEL, 3)
        g.rect(-28, -12, 16, 12, YELLOW, r=4)
        g.rect(-6, -10.5, -2, 10.5, CHAR, ol=False)
        g.line([(26, -6), (32, -2), (28, 1), (34, 6)], CYAN, 2.5)
    bolt(g, 82, 36, 0.45, CYAN)


@icon("nugget")
def _(g):
    g.ellipse(34, 62, 16, 13, MEAT)
    g.ellipse(62, 58, 17, 14, MEAT_L)
    g.ellipse(48, 78, 15, 10, MEAT)
    g.shine(30, 57, 4, 3)
    g.shine(58, 52, 5, 3)
    plus(g, 74, 26, 11, GREEN)


@icon("lantern")
def _(g):
    g.glow(50, 56, 36, YELLOW, 55)
    g.arc(50, 26, 10, 180, 360, STEEL, 3)
    g.poly([(36, 34), (64, 34), (57, 25), (43, 25)], CHAR)
    g.rect(37, 34, 63, 72, GOLD_L)
    flame(g, 50, 56, 0.5, ORANGE, YELLOW)
    g.rect(33, 72, 67, 80, CHAR, r=2)


@icon("medkit")
def _(g):
    g.rect(38, 22, 62, 40, STEEL_D, r=4)
    g.rect(43, 27, 57, 36, HOLE, r=1.5, ol=False)
    g.rect(20, 34, 80, 80, WHITE, r=6)
    plus(g, 50, 57, 14, RED)


@icon("barbed")
def _(g):
    s1 = [(x, 50 + 9 * math.sin((x - 14) / 72.0 * 3 * math.pi)) for x in range(14, 88, 2)]
    s2 = [(x, 50 - 9 * math.sin((x - 14) / 72.0 * 3 * math.pi)) for x in range(14, 88, 2)]
    g.line(s1, STEEL, 3.5)
    g.line(s2, STEEL_L, 3.5)
    segs = []
    for x in (26, 50, 74):
        segs += [[(x - 6, 44), (x + 6, 56)], [(x - 6, 56), (x + 6, 44)]]
    g.lines(segs, STEEL_L, 2.5)


@icon("fireshield")
def _(g):
    g.poly(shield_pts(50, 50, 28, 36), RED)
    g.poly(shield_pts(50, 50, 21, 28), RED_D, ol=False)
    flame(g, 50, 54, 0.8)


@icon("spikestrip")
def _(g):
    for x in (22, 36, 50, 64, 78):
        g.poly([(x - 6, 68), (x, 42), (x + 6, 68)], STEEL_L)
    g.rect(12, 66, 88, 78, CHAR, r=3)
    g.rect(14, 70, 86, 74, YELLOW, ol=False)


@icon("bitter")
def _(g):
    leaf(g, 48, 30, -115, 22, 7, GREEN)
    leaf(g, 52, 30, -65, 24, 8, GREEN_D)
    g.line([(39, 50), (26, 58)], BROWN_L, 2)
    g.line([(60, 52), (72, 62)], BROWN_L, 2)
    g.poly([(36, 30), (64, 30), (62, 46), (54, 70), (48, 88), (45, 72), (37, 48)], BROWN_L)
    g.lines([[(40, 42), (60, 42)], [(42, 56), (56, 56)], [(46, 70), (53, 70)]], BROWN, 2, ol=False)


@icon("opal")
def _(g):
    for x, y in ((50, 19), (50, 81), (27, 50), (73, 50)):
        g.circle(x, y, 4, GOLD)
    g.ellipse(50, 50, 22, 30, (225, 205, 255))
    g.ellipse(45, 43, 12, 16, (175, 225, 255), ol=False)
    g.ellipse(57, 60, 10, 12, (185, 250, 205), ol=False)
    g.ellipse(52, 34, 6, 5, (255, 200, 220), ol=False)
    g.shine(42, 34, 5, 7)


@icon("elixir")
def _(g):
    flask(g, RED)
    plus(g, 50, 66, 7, WHITE)


@icon("watch")
def _(g):
    g.rect(40, 12, 60, 88, BROWN, r=4)
    g.rect(71, 46, 77, 54, GOLD, r=1)
    g.circle(50, 50, 23, GOLD)
    g.circle(50, 50, 17, WHITE)
    g.line([(50, 50), (50, 38)], OUT, 2.5, ol=False)
    g.line([(50, 50), (58, 54)], OUT, 2, ol=False)
    g.line([(38, 40), (44, 46), (41, 52), (46, 58)], STEEL_D, 1.2, ol=False)


@icon("shieldgen")
def _(g):
    g.arc(50, 72, 34, 180, 360, CYAN, 4)
    g.arc(50, 72, 25, 195, 345, BLUE, 3)
    g.rect(32, 60, 68, 86, STEEL_D, r=4)
    g.circle(50, 73, 6, CYAN)


@icon("topaz")
def _(g):
    g.line([(14, 74), (86, 30)], STEEL, 2.5)
    g.ellipse(50, 52, 26, 22, GOLD)
    gem(g, 50, 52, 16, ORANGE)


@icon("chronic")
def _(g):
    for y, col in ((70, ORANGE_D), (52, ORANGE), (34, YELLOW)):
        g.poly([(26, y + 6), (50, y - 12), (74, y + 6), (74, y + 16), (50, y - 2), (26, y + 16)], col)


@icon("warbanner")
def _(g):
    g.line([(30, 88), (30, 16)], BROWN, 4)
    g.poly([(32, 20), (82, 26), (72, 38), (82, 52), (32, 48)], ORANGE)
    g.star(52, 35, 9, YELLOW)
    g.circle(30, 14, 4.5, GOLD)


@icon("fireworks")
def _(g):
    def rocket(cx, cy, ang, col):
        with g.at(cx, cy, ang):
            g.line([(0, 14), (0, 36)], BROWN_L, 2.5)
            g.rect(-6, -12, 6, 16, col, r=1.5)
            g.poly([(-7, -12), (0, -24), (7, -12)], YELLOW)
            g.rect(-4.5, 2, 4.5, 6, WHITE, ol=False)
    rocket(34, 48, -18, RED)
    rocket(66, 48, 18, BLUE)
    rocket(50, 42, 0, GREEN)
    g.rect(38, 68, 62, 74, ORANGE, r=2)
    spark(g, 18, 18, 6)
    spark(g, 84, 16, 6, PINK_L)


@icon("echo")
def _(g):
    g.circle(50, 50, 9, PINK)
    for r, col in ((19, PINK), (29, VIOLET), (39, PURPLE)):
        g.arc(50, 50, r, -40, 40, col, 4)
        g.arc(50, 50, r, 140, 220, col, 4)


@icon("savings")
def _(g):
    bag = (214, 180, 110)
    g.poly([(40, 38), (60, 38), (68, 22), (57, 27), (50, 20), (43, 27), (32, 22)], bag)
    g.circle(50, 62, 25, bag)
    g.rect(39, 35, 61, 41, BROWN, r=2)
    g.text(50, 63, "$", 30, GREEN_D)


@icon("rustedkey")
def _(g):
    with g.at(50, 52, -35, 1.35):
        key(g, RUST)
        g.circle(4, -1, 2, BROWN_D, ol=False)
        g.circle(13, 1, 1.5, BROWN_D, ol=False)
        g.circle(-18, 4, 2, BROWN_D, ol=False)


# Uncommon

@icon("ukulele")
def _(g):
    ukulele(g, BROWN_L, BROWN_D, YELLOW)


@icon("atg")
def _(g):
    g.circle(22, 80, 6, (225, 225, 225))
    g.circle(31, 71, 4.5, (225, 225, 225))
    with g.at(56, 46, -45, 1.4):
        missile(g)


@icon("wisp")
def _(g):
    g.rect(34, 22, 66, 33, BROWN, r=3)
    g.rect(30, 32, 70, 84, (190, 225, 255, 120), r=10)
    flame(g, 50, 62, 0.85, (255, 120, 60), YELLOW)
    g.shine(38, 46, 3, 10)


@icon("scythe")
def _(g):
    g.line([(30, 88), (60, 18)], BROWN, 5)
    g.poly(bez((60, 18), (34, 4), (10, 38)) + bez((10, 38), (32, 20), (58, 30))[1:], STEEL_L)


@icon("predatory")
def _(g):
    for k in (-1, 0, 1):
        path = bez((30 + 15 * k, 16), (54 + 15 * k, 42), (48 + 15 * k, 86))
        g.poly(taper(path, lambda t: 1 + 5 * math.sin(math.pi * t)), RED)


@icon("seed")
def _(g):
    g.line([(50, 46), (50, 28)], GREEN_D, 3)
    leaf(g, 50, 30, -150, 18, 6, GREEN)
    leaf(g, 50, 30, -30, 20, 7, GREEN)
    g.ellipse(50, 62, 17, 21, (120, 170, 60))
    g.line(bez((50, 44), (40, 62), (50, 80)), BLOOD, 2.5, ol=False)
    drop(g, 76, 74, 5, BLOOD)


@icon("chrono")
def _(g):
    g.arc(50, 21, 4.5, 0, 360, STEEL, 2)
    g.rect(44, 25, 56, 32, GOLD, r=1.5)
    g.circle(50, 56, 25, BLUE)
    for k in range(12):
        x0, y0 = pol(50, 56, 20, k * 30)
        x1, y1 = pol(50, 56, 23, k * 30)
        g.line([(x0, y0), (x1, y1)], WHITE, 1.2, ol=False)
    g.lines([[(50, 56), (50, 40)], [(50, 56), (61, 62)]], WHITE, 3)
    g.shine(40, 44, 5, 3)


@icon("magazine")
def _(g):
    with g.at(46, 22, 90, 0.8):
        bullet(g)
    with g.at(50, 30, 90, 0.8):
        bullet(g)
    g.poly([(32, 36), (64, 36), (70, 82), (40, 84)], STEEL_D)
    g.poly([(36, 80), (72, 78), (73, 88), (37, 90)], CHAR)
    g.text(82, 54, "+1", 16, YELLOW)


@icon("pauldron")
def _(g):
    pauldron(g, RED, RED_D, spikes=True)


@icon("kjaro")
def _(g):
    band(g, ORANGE_D, RED, lambda x, y: flame(g, x, y + 1, 0.42, YELLOW, WHITE))


@icon("runald")
def _(g):
    band(g, BLUE_D, CYAN, lambda x, y: snowflake(g, x, y, 9, WHITE, 1.6))


@icon("infusion")
def _(g):
    g.line(bez((50, 62), (50, 82), (70, 86)), RED_D, 3)
    g.rect(30, 16, 70, 64, (255, 205, 205), r=9)
    g.rect(32.5, 34, 67.5, 61.5, RED, r=7, ol=False)
    g.circle(50, 23, 3, HOLE, ol=False)
    plus(g, 50, 48, 7, WHITE)
    g.shine(38, 30, 3, 5)


@icon("guillotine")
def _(g):
    g.lines([[(28, 86), (28, 18)], [(72, 86), (72, 18)]], BROWN, 6)
    g.line([(22, 16), (78, 16)], BROWN, 7)
    g.poly([(31, 24), (69, 24), (69, 34), (31, 48)], STEEL_L)
    g.rect(31, 62, 69, 76, BROWN_L)
    g.circle(50, 64, 6, HOLE)
    g.rect(18, 82, 82, 89, BROWN_D, r=2)


@icon("boxing")
def _(g):
    g.ellipse(31, 54, 9, 12, RED)
    g.ellipse(55, 46, 25, 23, RED)
    g.rect(36, 64, 70, 86, WHITE, r=4)
    g.lines([[(42, 70), (64, 70)], [(42, 77), (64, 77)]], STEEL, 1.5, ol=False)
    g.shine(48, 34, 7, 4)


@icon("thorn")
def _(g):
    path = bez((18, 86), (24, 30), (84, 20), 40)
    for i, side in ((6, 1), (13, -1), (20, 1), (27, -1), (34, 1)):
        (ax, ay), (bx, by) = path[i - 1], path[i + 1]
        ln = math.hypot(bx - ax, by - ay)
        tx, ty = (bx - ax) / ln, (by - ay) / ln
        x, y = path[i]
        g.poly([(x - tx * 4, y - ty * 4), (x - ty * 11 * side + tx * 3, y + tx * 11 * side + ty * 3),
                (x + tx * 4, y + ty * 4)], VIOLET)
    g.poly(taper(path, lambda t: 4.5 - 3 * t), GREEN_D)
    drop(g, 86, 32, 3.5, VIOLET)


@icon("toxicworm")
def _(g):
    path = bez((16, 80), (44, 94), (68, 44), 7)
    for i, (x, y) in enumerate(path):
        g.circle(x, y, 6 + i * 0.8, TOXIC if i % 2 else GREEN)
    g.circle(64, 40, 3, WHITE)
    g.circle(73, 40, 3, WHITE)
    g.circle(64.5, 40.5, 1.4, OUT, ol=False)
    g.circle(73.5, 40.5, 1.4, OUT, ol=False)
    drop(g, 82, 70, 4, LIME)


@icon("shuriken")
def _(g):
    with g.at(50, 50, 15):
        g.star(0, 0, 37, STEEL_L, n=4, inner=0.3)
        g.star(0, 0, 20, STEEL, n=4, inner=0.35, ol=False)
        g.circle(0, 0, 6, HOLE)


@icon("chargefield")
def _(g):
    g.arc(50, 50, 30, 0, 360, YELLOW, 5)
    for a in (45, 135, 225, 315):
        x, y = pol(50, 50, 30, a)
        bolt(g, x, y, 0.4)
    g.circle(50, 50, 10, BLUE_D)
    g.circle(50, 50, 4, CYAN, ol=False)


@icon("goldengun")
def _(g):
    with g.at(50, 52, -12):
        g.poly([(-24, -2), (-8, -2), (-4, 24), (-20, 26)], GOLD)
        g.arc(-1, 2, 7, 0, 180, GOLD, 2.5)
        g.rect(-28, -14, 28, -1, GOLD_L, r=2)
        g.rect(28, -11, 33, -4, GOLD, r=1)
        g.lines([[(x, -12.5), (x, -2.5)] for x in (4, 10, 16)], GOLD, 1.5, ol=False)
    spark(g, 80, 26, 9, WHITE)


@icon("energycell")
def _(g):
    g.rect(42, 14, 58, 24, STEEL, r=2)
    g.rect(32, 22, 68, 88, CHAR, r=5)
    for y, col in ((70, LIME), (56, LIME), (42, YELLOW), (28, HOLE)):
        g.rect(37, y, 63, y + 11, col, r=2, ol=False)


@icon("heart")
def _(g):
    heart(g, 50, 50, 32, BLUE)
    heart(g, 50, 52, 20, (160, 215, 255), ol=False)
    g.shine(36, 36, 6, 4)


@icon("kinetic")
def _(g):
    g.arc(50, 50, 39, 200, 340, CYAN, 2.5)
    g.arc(50, 50, 39, 20, 160, CYAN, 2.5)
    g.poly(hexpts(50, 50, 26), BLUE_D)
    g.poly(hexpts(50, 50, 18), BLUE, ol=False)
    bolt(g, 50, 50, 0.6)


@icon("razorwire")
def _(g):
    for k in range(8):
        a = k * 45
        g.poly([pol(50, 50, 24, a - 14), pol(50, 50, 40, a + 18), pol(50, 50, 24, a + 14)], STEEL_L)
    g.circle(50, 50, 26, STEEL)
    g.circle(50, 50, 15, HOLE)


@icon("panicmines")
def _(g):
    for a in (205, 240, 300, 335):
        g.line([pol(50, 66, 22, a), pol(50, 66, 32, a)], STEEL, 3)
    g.rect(18, 64, 82, 76, CHAR, r=4)
    g.poly(arcpts(50, 66, 26, 24, 180, 360), STEEL_D)
    g.glow(50, 50, 13, RED, 80)
    g.circle(50, 50, 6, RED)


@icon("timekeeper")
def _(g):
    g.poly([(32, 24), (68, 24), (54, 50), (68, 76), (32, 76), (46, 50)], GLASS)
    g.poly([(38, 30), (62, 30), (52, 46), (48, 46)], GOLD_L, ol=False)
    g.poly([(35, 75), (65, 75), (50, 62)], GOLD_L, ol=False)
    g.rect(24, 15, 76, 24, GOLD, r=3)
    g.rect(24, 76, 76, 85, GOLD, r=3)
    snowflake(g, 82, 50, 8, ICE, 2)


@icon("transmitter")
def _(g):
    g.lines([[(50, 24), (34, 86)], [(50, 24), (66, 86)], [(42, 54), (58, 54)], [(38, 70), (62, 70)],
             [(42, 54), (62, 70)], [(58, 54), (38, 70)]], STEEL_D, 3)
    for r in (13, 21):
        g.arc(50, 22, r, 145, 215, RED, 3)
        g.arc(50, 22, r, -35, 35, RED, 3)
    g.circle(50, 22, 6, RED)


@icon("ignition")
def _(g):
    g.rect(44, 18, 56, 30, STEEL, r=2)
    g.rect(30, 26, 70, 86, ORANGE_D, r=10)
    g.rect(31.5, 40, 68.5, 45, shade(ORANGE_D, 0.75), ol=False)
    g.rect(31.5, 70, 68.5, 75, shade(ORANGE_D, 0.75), ol=False)
    g.circle(50, 58, 8, WHITE)
    g.line([(50, 58), (55, 53)], RED_D, 2, ol=False)
    flame(g, 76, 24, 0.45)


@icon("deathmark")
def _(g):
    skull(g, 50, 56, 1.35, BONE, eye=RED_D)
    drop(g, 18, 34, 5, BLOOD)
    flame(g, 82, 30, 0.33)
    g.circle(50, 14, 5, TOXIC)


@icon("ghor")
def _(g):
    g.rect(28, 22, 78, 82, BONE, r=3)
    g.rect(22, 18, 72, 78, BROWN, r=4)
    g.rect(23.5, 19.5, 30, 76.5, BROWN_D, r=2, ol=False)
    g.circle(51, 46, 12, GOLD)
    g.text(51, 47, "$", 15, GOLD_L)
    g.circle(80, 82, 7, GOLD)


@icon("smartshopper")
def _(g):
    g.rect(40, 22, 54, 34, GREEN)
    g.rect(52, 18, 66, 34, ORANGE)
    g.line([(12, 20), (24, 28)], STEEL_D, 4)
    g.poly([(24, 30), (82, 30), (72, 62), (32, 62)], STEEL)
    g.lines([[(38, 30), (42, 62)], [(52, 30), (52, 62)], [(66, 30), (62, 62)], [(28, 46), (78, 46)]],
            STEEL_D, 1.5, ol=False)
    g.line([(32, 62), (30, 70), (74, 70)], STEEL_D, 3)
    g.circle(36, 78, 6, CHAR)
    g.circle(68, 78, 6, CHAR)


@icon("compulsion")
def _(g):
    g.arc(28, 32, 9, 90, 270, GOLD, 3.5)
    g.arc(72, 32, 9, -90, 90, GOLD, 3.5)
    g.rect(45, 46, 55, 66, GOLD)
    g.poly(arcpts(50, 20, 23, 30, 0, 180), GOLD_L)
    g.star(50, 32, 8, WHITE)
    g.rect(34, 64, 66, 74, GOLD, r=2)
    g.rect(30, 74, 70, 84, BROWN, r=2)


@icon("salestar")
def _(g):
    g.star(64, 40, 21, GOLD)
    g.star(42, 58, 27, YELLOW)
    g.shine(38, 50, 4, 3)
    spark(g, 82, 78, 7, WHITE)


@icon("chancedoll")
def _(g):
    g.lines([[(40, 72), (34, 88)], [(56, 72), (62, 88)], [(38, 52), (22, 62)], [(58, 52), (72, 44)]],
            BROWN_L, 5)
    g.rect(36, 46, 60, 76, BROWN_L, r=6)
    g.rect(41, 56, 49, 64, PINK, r=1)
    g.circle(48, 32, 15, BROWN_L)
    g.circle(43, 30, 2.6, OUT, ol=False)
    g.circle(53, 30, 2.6, OUT, ol=False)
    g.line([(42, 38), (54, 38)], BROWN_D, 1.5, ol=False)
    up_arrow(g, 80, 30, 13, GREEN)


@icon("shipping")
def _(g):
    g.poly([(20, 34), (50, 46), (50, 84), (20, 72)], BROWN)
    g.poly([(50, 46), (80, 34), (80, 72), (50, 84)], (140, 90, 48))
    g.poly([(50, 22), (80, 34), (50, 46), (20, 34)], BROWN_L)
    g.line([(35, 28), (65, 40)], BONE, 5, ol=False)
    g.poly([(58, 56), (72, 50), (72, 62), (58, 68)], WHITE)


@icon("squid")
def _(g):
    for i, x in enumerate((35, 43, 50, 57, 65)):
        g.line(wavy(x, 52, 34, 3, i), (230, 120, 200), 4)
    g.poly([(50, 12), (68, 36), (66, 56), (34, 56), (32, 36)], (240, 150, 215))
    g.circle(42, 44, 5, WHITE)
    g.circle(58, 44, 5, WHITE)
    g.circle(42, 45, 2.2, OUT, ol=False)
    g.circle(58, 45, 2.2, OUT, ol=False)


# Legendary

@icon("behemoth")
def _(g):
    g.star(50, 50, 39, ORANGE, n=12, inner=0.62)
    g.star(50, 50, 25, YELLOW, n=10, inner=0.6, ol=False)
    g.circle(50, 50, 10, WHITE, ol=False)


@icon("dagger")
def _(g):
    for r in (30, 38):
        g.arc(50, 52, r, 110, 160, PINK_L, 2)
    with g.at(52, 50, -60, 1.15):
        dagger(g, blade=PINK_L, guard=GOLD, grip=VIOLET)
    g.circle(41, 66, 3.5, RED)


@icon("justice")
def _(g):
    g.line([(26, 86), (56, 34)], BROWN, 5)
    with g.at(58, 32, -30):
        g.rect(-24, -11, 22, 11, STEEL, r=2)
        g.rect(-22.5, -9.5, -15, 9.5, STEEL_D, ol=False)
    for pts in (((70, 62), (80, 58), (76, 70)), ((82, 76), (90, 72), (86, 84)), ((62, 78), (70, 76), (66, 86))):
        g.poly(list(pts), ICE)


@icon("scope")
def _(g):
    g.arc(50, 50, 27, 0, 360, RED, 4)
    g.lines([[(50, 12), (50, 36)], [(50, 64), (50, 88)], [(12, 50), (36, 50)], [(64, 50), (88, 50)]], RED, 4)
    g.circle(50, 50, 5, RED)


@icon("clover")
def _(g):
    g.line(bez((50, 52), (54, 74), (66, 88)), GREEN_D, 4)
    for a in (0, 90, 180, 270):
        with g.at(50, 46, a):
            heart(g, 0, -15, 15, GREEN)
    g.circle(50, 46, 3, GREEN_D, ol=False)


@icon("teslacoil")
def _(g):
    g.rect(34, 76, 66, 88, CHAR, r=2)
    g.rect(42, 38, 58, 78, COPPER, r=2)
    g.lines([[(43.5, y), (56.5, y)] for y in range(44, 76, 6)], COPPER_D, 1.5, ol=False)
    g.line([(31, 33), (22, 26), (26, 20), (14, 14)], CYAN, 2.5)
    g.line([(69, 33), (78, 40), (74, 46), (86, 52)], CYAN, 2.5)
    g.ellipse(50, 33, 19, 8, STEEL)


@icon("rack")
def _(g):
    def antlers():
        for s in (-1, 1):
            g.line([(50 + s * 4, 84), (50 + s * 12, 60), (50 + s * 24, 40), (50 + s * 30, 16)], GREEN, 5)
            g.line([(50 + s * 12, 60), (50 + s * 30, 58)], GREEN, 4)
            g.line([(50 + s * 23, 42), (50 + s * 14, 24)], GREEN, 4)
    g.union(antlers)
    g.circle(50, 84, 7, BROWN)


@icon("meathook")
def _(g):
    g.arc(58, 22, 6, 0, 360, STEEL, 3)
    g.line([(58, 28), (58, 64)] + arcpts(44, 64, 14, 14, 0, 180)[1:], STEEL_L, 6)
    g.poly([(24, 66), (30, 48), (36, 66)], STEEL_L)
    drop(g, 44, 88, 3.5, BLOOD)


@icon("boomerang")
def _(g):
    g.arc(50, 64, 42, 200, 235, WHITE, 2)
    g.arc(50, 64, 42, 305, 340, WHITE, 2)
    g.line([(18, 40), (50, 70), (82, 40)], CYAN, 12)
    g.line([(18, 40), (50, 70), (82, 40)], BLUE_D, 3.5, ol=False)
    bolt(g, 50, 36, 0.5)


@icon("runiclens")
def _(g):
    g.line([(60, 60), (82, 82)], BROWN, 8)
    g.circle(44, 44, 25, GOLD)
    g.circle(44, 44, 19, (150, 80, 210))
    g.star(44, 44, 11, GOLD_L, n=5, inner=0.4)
    g.line([(70, 8), (82, 20)], ORANGE, 2.5, ol=False)
    g.circle(84, 22, 6, ORANGE)


@icon("lopper")
def _(g):
    g.line([(26, 88), (62, 18)], BROWN, 5)
    g.poly([(52, 24), (76, 10), (90, 36), (68, 46), (60, 36)], STEEL_L)
    g.line([(77, 13), (87, 34)], WHITE, 2, ol=False)


@icon("telescope")
def _(g):
    g.lines([[(50, 56), (34, 88)], [(50, 56), (66, 88)], [(50, 56), (50, 88)]], BROWN_D, 3)
    with g.at(48, 44, -25):
        g.rect(-32, -7, -8, 7, BROWN)
        g.rect(-8, -9, 14, 9, GOLD)
        g.rect(14, -12, 34, 12, BROWN, r=1.5)


@icon("permafrost")
def _(g):
    g.poly([(20, 32), (50, 46), (50, 84), (20, 70)], ICE)
    g.poly([(50, 46), (80, 32), (80, 70), (50, 84)], CYAN)
    g.poly([(50, 18), (80, 32), (50, 46), (20, 32)], (235, 252, 255))
    snowflake(g, 35, 59, 9, WHITE, 1.8)


@icon("plasmachain")
def _(g):
    for i in range(4):
        with g.at(24 + i * 17.5, 76 - i * 17.5, -45):
            g.ellipse(0, 0, 13, 7.5, PINK if i % 2 else VIOLET)
            g.ellipse(0, 0, 7.5, 3, HOLE)
    spark(g, 16, 86, 6, VOID_L)
    spark(g, 86, 14, 6, VOID_L)


@icon("thallium")
def _(g):
    flask(g, TOXIC)
    skull(g, 50, 66, 0.5)


@icon("atg2")
def _(g):
    for x, y, a in ((30, 52, -80), (50, 50, -45), (56, 72, -10)):
        with g.at(x, y, a, 0.85):
            missile(g)


@icon("hyperthreader")
def _(g):
    dots = [(18, 74), (44, 26), (68, 66), (86, 24)]
    g.line(dots, RED, 4)
    g.line(dots, PINK_L, 1.5, ol=False)
    for x, y in dots[1:]:
        g.circle(x, y, 6, RED_D)


@icon("heavencracker")
def _(g):
    with g.at(48, 52, -45, 1.15):
        g.rect(-38, -6, -28, 6, STEEL_D, r=1)
        g.rect(-30, -11, -20, 11, GOLD, r=2)
        g.poly([(-20, -12), (34, 0), (-20, 12)], STEEL_L)
        g.lines([[(-12, -10), (-4, 8)], [(0, -7), (8, 5)], [(12, -4), (18, 3)]], STEEL_D, 1.5, ol=False)


@icon("laserturbine")
def _(g):
    g.circle(50, 50, 32, CHAR)
    g.circle(50, 50, 26, HOLE, ol=False)
    for k in range(6):
        with g.at(50, 50, k * 60):
            g.poly([(4, -3), (24, -11), (26, 0), (6, 4)], MINT)
    g.circle(50, 50, 7, STEEL)


@icon("resonance")
def _(g):
    g.arc(50, 50, 38, 150, 210, WHITE, 2)
    g.arc(50, 50, 38, 330, 390, WHITE, 2)
    g.circle(50, 50, 30, STEEL_D)
    g.circle(50, 50, 22, CYAN, ol=False)
    for a in (0, 90, 180, 270):
        x, y = pol(50, 50, 26, a + 45)
        g.circle(x, y, 3, HOLE)
    g.circle(50, 50, 10, STEEL_D)


@icon("scorpion")
def _(g):
    seg = (190, 70, 120)
    pts = arcpts(52, 54, 26, 28, 130, 330, 8)
    for i, (x, y) in enumerate(pts):
        g.circle(x, y, 9.5 - i * 0.5, seg if i % 2 == 0 else shade(seg, 0.8))
    g.poly([(70, 38), (82, 34), (80, 58)], BONE)


@icon("frostrelic")
def _(g):
    snowflake(g, 50, 50, 36, ICE, 5)
    g.circle(50, 50, 8, WHITE)


@icon("hitlist")
def _(g):
    with g.at(50, 50, 6):
        g.rect(-24, -34, 24, 34, BONE, r=3)
        for k, y in enumerate((-20, -7, 6, 19)):
            g.line([(-6, y), (16, y)], BROWN_L, 2, ol=False)
            if k < 2:
                g.lines([[(-18, y - 4), (-10, y + 4)], [(-18, y + 4), (-10, y - 4)]], RED, 2.2)
            else:
                g.circle(-14, y, 2.2, STEEL_D, ol=False)


@icon("dio")
def _(g):
    g.union(lambda: (g.ellipse(50, 30, 13, 16, GOLD), g.rect(44, 42, 56, 88, GOLD, r=2),
                     g.rect(24, 44, 76, 55, GOLD, r=2)))
    g.ellipse(50, 30, 6, 9, HOLE)
    g.shine(44, 60, 2, 8)


@icon("aegis")
def _(g):
    g.poly(shield_pts(50, 50, 30, 38), GOLD)
    g.poly(shield_pts(50, 50, 20, 28), BLUE)
    g.shine(42, 36, 5, 4)


@icon("microbots")
def _(g):
    drone(g, STEEL_D, CYAN)
    g.line([(56, 62), (76, 80)], CYAN, 2, ol=False)
    g.star(80, 84, 8, ORANGE, n=7, inner=0.5)


@icon("mask")
def _(g):
    g.ellipse(50, 50, 29, 34, BONE)
    g.arc(38, 46, 7, 200, 340, OUT, 4, ol=False)
    g.arc(62, 46, 7, 200, 340, OUT, 4, ol=False)
    g.poly(arcpts(50, 58, 16, 13, 0, 180), HOLE, ol=False)
    g.circle(31, 60, 4, PINK_L, ol=False)
    g.circle(69, 60, 4, PINK_L, ol=False)


@icon("deskplant")
def _(g):
    for a, l in ((-150, 22), (-120, 26), (-60, 26), (-30, 22)):
        leaf(g, 50, 58, a, l, 6, GREEN)
    g.line([(50, 58), (50, 32)], GREEN_D, 3)
    g.circle(50, 26, 7, PINK)
    g.poly([(34, 62), (66, 62), (62, 86), (38, 86)], COPPER)
    g.rect(30, 57, 70, 65, COPPER_D, r=2)


@icon("brainstalks")
def _(g):
    g.union(lambda: (g.ellipse(39, 50, 20, 25, PINK), g.ellipse(61, 50, 20, 25, PINK)))
    segs = [[(50, 28), (50, 74)]]
    segs += [bez((28, 40), (38, 32), (42, 44)), bez((26, 58), (36, 52), (40, 64)),
             bez((72, 40), (62, 32), (58, 44)), bez((74, 58), (64, 52), (60, 64))]
    g.lines(segs, PINK_D, 2.2, ol=False)


@icon("whispers")
def _(g):
    g.arc(50, 18, 5, 180, 360, GOLD, 3)
    g.poly(arcpts(50, 40, 16, 20, 180, 360) + [(66, 40), (70, 66), (80, 72), (20, 72), (30, 66), (34, 40)], GOLD)
    g.circle(50, 78, 6, GOLD_L)
    for s in (-1, 1):
        g.arc(50, 50, 38, 90 - s * 70 - 20, 90 - s * 70 + 20, GOLD_L, 2.5)


@icon("spareparts")
def _(g):
    gear(g, 50, 50, 26, STEEL_D, teeth=9)
    g.circle(50, 50, 5, ORANGE)


@icon("nkuhana")
def _(g):
    flame(g, 28, 40, 0.55, GREEN, LIME)
    flame(g, 72, 40, 0.55, GREEN, LIME)
    skull(g, 50, 54, 1.35, (190, 245, 200), eye=GREEN_D)


@icon("warbonds")
def _(g):
    g.rect(16, 32, 84, 76, (215, 235, 195), r=3)
    g.rect(21, 37, 79, 71, GREEN_D, r=2, ol=False)
    g.rect(23, 39, 77, 69, (215, 235, 195), r=2, ol=False)
    g.star(50, 54, 12, GOLD)
    with g.at(76, 26, -40, 0.6):
        missile(g)


@icon("icbm")
def _(g):
    with g.at(50, 52, 30):
        g.poly([(-6, 26), (0, 42), (6, 26)], ORANGE)
        g.poly([(-9, 12), (-18, 30), (-9, 26)], RED)
        g.poly([(9, 12), (18, 30), (9, 26)], RED)
        g.rect(-9, -22, 9, 28, WHITE, r=2)
        g.poly([(-9, -22), (0, -38), (9, -22)], RED)
        g.rect(-7.5, 4, 7.5, 9, RED_D, ol=False)


@icon("oldbox")
def _(g):
    g.line([(50, 54), (42, 48), (58, 42), (42, 36), (50, 32)], STEEL, 2.5)
    g.circle(50, 24, 12, WHITE)
    g.poly([(40, 16), (50, 2), (60, 16)], RED)
    g.circle(50, 26, 3, RED, ol=False)
    g.circle(45, 21, 1.8, OUT, ol=False)
    g.circle(55, 21, 1.8, OUT, ol=False)
    g.rect(24, 52, 76, 88, BROWN_L, r=3)
    g.text(50, 70, "?", 20, YELLOW)


# Lunar

@icon("glass")
def _(g):
    heart(g, 50, 48, 32, (200, 232, 255, 220))
    g.line([(50, 30), (44, 42), (54, 52), (46, 64), (50, 78)], STEEL_D, 1.6, ol=False)
    g.shine(36, 34, 6, 4, alpha=170)


@icon("crown")
def _(g):
    g.poly([(18, 70), (18, 32), (34, 50), (50, 24), (66, 50), (82, 32), (82, 70)], GOLD_L)
    g.rect(18, 64, 82, 78, GOLD, r=2)
    for x in (32, 50, 68):
        g.circle(x, 71, 4, LUNAR_D, ol=False)
    g.line([(58, 30), (54, 44), (60, 52), (56, 64)], OUT, 1.4, ol=False)


@icon("corpsebloom")
def _(g):
    for k in range(6):
        with g.at(50, 50, k * 60):
            g.ellipse(0, -19, 9, 16, (110, 100, 210))
    g.circle(50, 50, 11, (60, 40, 90))
    for k in range(5):
        x, y = pol(50, 50, 5, k * 72)
        g.circle(x, y, 1.6, BONE, ol=False)


@icon("ego")
def _(g):
    g.line(arcpts(50, 50, 36, 14, 0, 360), LUNAR, 2)
    orb(g, 50, 50, 16, LUNAR_D)
    for a in (30, 150, 270):
        x, y = 50 + 36 * math.cos(math.radians(a)), 50 + 14 * math.sin(math.radians(a))
        orb(g, x, y, 6.5, LUNAR)


@icon("eulogy")
def _(g):
    crescent(g, (48, 52), 30, (62, 42), 25, LUNAR)
    g.star(72, 30, 9, WHITE, n=4, inner=0.35)
    g.star(80, 56, 5, WHITE, n=4, inner=0.35)


@icon("lightflux")
def _(g):
    pauldron(g, LUNAR, LUNAR_D)
    g.circle(50, 54, 10, WHITE)
    g.lines([[(50, 54), (50, 47)], [(50, 54), (55, 57)]], OUT, 1.6, ol=False)


@icon("stoneflux")
def _(g):
    pauldron(g, STEEL_D, CHAR)
    g.lines([[(32, 54), (40, 60), (38, 68)], [(62, 48), (68, 56)]], CHAR, 1.6, ol=False)
    heart(g, 50, 54, 9, RED)


@icon("purity")
def _(g):
    g.line(arcpts(50, 22, 18, 6, 0, 360), GOLD_L, 3)
    orb(g, 50, 58, 22, WHITE)
    g.circle(50, 58, 13, (220, 238, 255), ol=False)


@icon("transcendence")
def _(g):
    for x, upper, lower in ((46, 205, 160), (54, -25, 20)):
        leaf(g, x, 50, upper, 38, 13, LUNAR)
        leaf(g, x, 56, lower, 28, 9, (200, 230, 255))
    orb(g, 50, 53, 11, CYAN)


@icon("rachis")
def _(g):
    g.line(arcpts(50, 76, 30, 9, 0, 360), RED, 3)
    g.poly([(50, 10), (62, 48), (50, 80), (38, 48)], LUNAR_D)
    g.poly([(50, 14), (59, 48), (50, 48)], LUNAR, ol=False)


# Boss

@icon("knurl")
def _(g):
    g.poly([(24, 40), (36, 20), (60, 16), (80, 32), (84, 56), (70, 80), (44, 86), (22, 72), (16, 54)], (128, 140, 120))
    g.lines([[(36, 36), (48, 48), (44, 62)], [(62, 30), (66, 44)], [(56, 66), (68, 72)]], LIME, 2.2, ol=False)
    g.shine(40, 30, 7, 3)


@icon("pearl")
def _(g):
    g.poly(arcpts(50, 64, 33, 22, 0, 180), PINK_L)
    g.lines([[(50, 64), pol(50, 64, 30, a)] for a in (40, 70, 110, 140)], PINK, 1.6, ol=False)
    orb(g, 50, 50, 18, (248, 246, 255))


@icon("irradiant")
def _(g):
    for k in range(8):
        a = k * 45 + 22.5
        g.line([pol(50, 50, 28, a), pol(50, 50, 39, a)], YELLOW if k % 2 else CYAN, 3)
    orb(g, 50, 50, 21, (200, 255, 245))
    g.circle(54, 54, 11, (255, 210, 245), ol=False)
    g.shine(43, 42, 6, 4)


@icon("gland")
def _(g):
    shell = (120, 160, 60)
    legs = []
    for y in (48, 60, 72):
        legs += [[(40, y), (24, y - 6)], [(60, y), (76, y - 6)]]
    g.lines(legs, CHAR, 3)
    g.lines([[(44, 24), (38, 14)], [(56, 24), (62, 14)]], CHAR, 3)
    g.circle(50, 28, 10, shade(shell, 0.75))
    g.ellipse(50, 60, 20, 26, shell)
    g.line([(50, 36), (50, 86)], OUT, 1.5, ol=False)
    g.shine(42, 48, 4, 6)


@icon("empathy")
def _(g):
    g.arc(50, 50, 32, 200, 250, GOLD_L, 2.5)
    g.arc(50, 50, 32, 20, 70, GOLD_L, 2.5)
    orb(g, 34, 60, 14, RED)
    orb(g, 66, 40, 14, BLUE)


@icon("nucleus")
def _(g):
    g.poly([(50, 14), (84, 78), (16, 78)], STEEL_D)
    g.poly([(50, 32), (70, 70), (30, 70)], CYAN, ol=False)
    g.circle(50, 56, 8, WHITE)
    g.circle(50, 56, 4, OUT, ol=False)


@icon("genesis")
def _(g):
    g.star(50, 50, 40, CYAN, n=12, inner=0.78)
    g.circle(50, 50, 27, BLUE_D)
    g.circle(50, 50, 16, HOLE)
    g.arc(50, 50, 21.5, 200, 300, LUNAR, 2.5, ol=False)


@icon("planula")
def _(g):
    for i, x in enumerate((34, 42, 50, 58, 66)):
        g.line(wavy(x, 46, 40, 3, i * 1.3), (255, 180, 100), 3)
    g.poly(arcpts(50, 48, 26, 26, 180, 360), ORANGE)
    g.arc(50, 48, 18, 210, 330, (255, 200, 120), 2.5, ol=False)


@icon("urn")
def _(g):
    jade = (70, 110, 80)
    g.line(bez((50, 20), (66, 4), (86, 16)), RED, 2.5)
    g.circle(86, 16, 4, RED)
    g.rect(42, 18, 58, 32, jade, r=2)
    g.ellipse(50, 58, 24, 27, jade)
    g.rect(38, 80, 62, 88, GOLD, r=2)
    g.rect(37, 16, 63, 22, GOLD, r=2)
    g.rect(27, 52, 73, 57, GOLD, ol=False)


@icon("perforatorC")
def _(g):
    perforator(g, BLUE, BLUE_D)
    bolt(g, 74, 62, 0.55)


@icon("perforatorM")
def _(g):
    perforator(g, ORANGE, ORANGE_D)
    for x, y, r in ((24, 64, 6), (76, 58, 7), (70, 82, 5)):
        g.circle(x, y, r, RED_D)
        g.circle(x - r * 0.25, y - r * 0.25, r * 0.5, YELLOW, ol=False)


@icon("shatterspleen")
def _(g):
    for a in (200, 250, 300, 345):
        g.poly([pol(50, 54, 20, a - 10), pol(50, 54, 40, a), pol(50, 54, 20, a + 10)], BONE)
    with g.at(50, 54, -20):
        g.ellipse(0, 0, 28, 20, BLOOD)
        g.ellipse(4, -10, 8, 5, HOLE, ol=False)
        g.shine(-12, -6, 6, 3)


@icon("ifrit")
def _(g):
    path = bez((28, 84), (18, 30), (80, 16), 30)
    g.poly(taper(path, lambda t: 11 * (1 - t) + 0.5), ORANGE_D)
    g.poly(taper(path[:12], lambda t: 3), shade(ORANGE_D, 0.7), ol=False)
    flame(g, 30, 74, 0.5, YELLOW, WHITE)


# Void

@icon("needletick")
def _(g):
    path = [(22 + 58 * i / 20.0, 80 - 60 * i / 20.0) for i in range(21)]
    g.poly(taper(path, lambda t: 5 * (1 - t) + 0.4), VIOLET)
    g.ellipse(26, 76, 3, 1.5, HOLE, ol=False)
    for x, y, r in ((70, 66, 6), (82, 78, 4), (58, 84, 3.5)):
        g.circle(x, y, r, VOID)


@icon("lostseer")
def _(g):
    glasses(g, VOID, VOID_L, VOID)


@icon("safer")
def _(g):
    g.circle(50, 52, 32, (200, 140, 240, 90))
    g.arc(50, 52, 32, 0, 360, VIOLET, 3)
    g.poly(shield_pts(50, 52, 14, 18), PURPLE)
    g.shine(36, 36, 6, 4)


@icon("encrusted")
def _(g):
    with g.at(50, 52, -35, 1.35):
        key(g, VIOLET)
        for x, y, r in ((2, -3, 2.6), (10, 0, 2), (-20, -6, 2.4), (-9, 7, 2.2)):
            g.circle(x, y, r, VOID_L)


@icon("polylute")
def _(g):
    ukulele(g, VIOLET, VOID, VOID_L)


@icon("tentabauble")
def _(g):
    for i, x in enumerate((38, 46, 54, 62)):
        g.line(wavy(x, 62, 26, 3, i * 1.5, 10), VOID, 4)
    g.arc(50, 21, 4.5, 0, 360, STEEL, 2)
    g.rect(44, 25, 56, 32, GOLD, r=1.5)
    orb(g, 50, 52, 22, VIOLET)


@icon("shrimp")
def _(g):
    body = (240, 140, 200)
    g.lines([[(70, 34), (90, 16)], [(70, 34), (92, 30)]], VOID_L, 1.5)
    pts = arcpts(50, 52, 24, 24, -60, 150, 7)
    for i, (x, y) in enumerate(pts):
        g.circle(x, y, 10 - i * 0.8, body if i % 2 == 0 else VIOLET)
    g.poly([(30, 66), (18, 58), (16, 74)], body)
    g.circle(65, 34, 2, OUT, ol=False)


@icon("singularity")
def _(g):
    def hole(x, y):
        g.arc(x, y, 9, 200, 450, VIOLET, 1.8, ol=False)
        g.circle(x, y, 5, (20, 10, 30), ol=False)
    band(g, VOID, (40, 20, 60), hole)


@icon("voidsent")
def _(g):
    flame(g, 50, 54, 1.25, VIOLET, VOID_L)


@icon("benthic")
def _(g):
    for k in range(5):
        with g.at(50, 54, k * 72):
            g.ellipse(0, -18, 10, 16, VIOLET)
    g.circle(50, 54, 10, PINK)
    up_arrow(g, 80, 22, 11, GREEN)


@icon("larva")
def _(g):
    pts = arcpts(52, 52, 22, 22, 140, 400, 8)
    for i, (x, y) in enumerate(pts):
        g.circle(x, y, 11 - i * 0.6, VIOLET if i % 2 == 0 else VOID)
    hx, hy = pts[0]
    g.circle(hx, hy, 11, PINK)
    g.circle(hx - 4, hy - 2, 2, OUT, ol=False)


# Movement

def boot(g, col, sole, cuff=None):
    g.poly([(30, 14), (56, 14), (56, 56), (82, 64), (86, 76), (30, 76)], col)
    g.rect(26, 74, 88, 84, sole, r=3)
    if cuff:
        g.rect(27, 12, 59, 22, cuff, r=2)
    g.lines([[(56, 58), (62, 50)], [(64, 61), (70, 53)]], shade(col, 0.7), 1.6, ol=False)


def mushroom(g, cap, spots, stem=BONE):
    g.rect(40, 50, 60, 84, stem, r=6)
    g.poly(arcpts(50, 52, 38, 34, 180, 360) + [(88, 56), (12, 56)], cap)
    for x, y, r in ((34, 36, 5.5), (56, 28, 6.5), (70, 42, 4.5), (46, 46, 3.5)):
        g.circle(x, y, r, spots, ol=False)


@icon("hoof")
def _(g):
    g.rect(36, 12, 64, 50, BROWN_L, r=8)
    g.union(lambda: (g.ellipse(36, 72, 18, 18, BROWN_D), g.ellipse(64, 72, 18, 18, BROWN_D)))
    g.line([(50, 58), (50, 88)], HOLE, 3, ol=False)
    g.rect(32, 46, 68, 56, BROWN, r=3)
    g.shine(44, 22, 4, 7)


@icon("energydrink")
def _(g):
    g.rect(28, 14, 72, 22, STEEL_L, r=3)
    g.rect(26, 20, 74, 86, (255, 120, 40), r=6)
    g.rect(26, 74, 74, 86, STEEL, r=3)
    bolt(g, 50, 48, 0.95, YELLOW)
    g.shine(34, 32, 3, 8)


@icon("mocha")
def _(g):
    for x in (38, 52, 66):
        g.line(wavy(x, 8, 18, 2.5, x * 0.2, 8), (255, 255, 255, 180), 2.5, ol=False)
    g.poly([(22, 34), (78, 34), (70, 84), (30, 84)], WHITE)
    g.arc(80, 54, 11, -90, 90, WHITE, 5)
    g.rect(24, 44, 76, 56, BROWN, ol=False)
    g.ellipse(50, 34, 28, 6, BROWN_D)


@icon("fungus")
def _(g):
    mushroom(g, GREEN, (190, 245, 190))
    plus(g, 80, 80, 10, GREEN_D)


@icon("headstompers")
def _(g):
    boot(g, STEEL_D, CHAR, STEEL)
    with g.at(78, 28, 180):
        up_arrow(g, 0, 0, 13, ORANGE)


@icon("feather")
def _(g):
    with g.at(50, 50, -50):
        top = [(-38 + 76 * i / 20, -15 * math.sin(math.pi * i / 20) ** 0.7) for i in range(21)]
        bot = [(-38 + 76 * i / 20, 13 * math.sin(math.pi * i / 20) ** 0.7) for i in range(20, -1, -1)]
        g.poly(top + bot, MINT)
        g.line([(-46, 0), (36, 0)], BONE, 2.2)
        g.lines([[(x, 0), (x + 7, -11)] for x in (-22, -8, 6, 20)], shade(MINT, 0.75), 1.2, ol=False)


@icon("quail")
def _(g):
    g.ellipse(46, 60, 30, 22, YELLOW)
    g.circle(70, 38, 14, YELLOW)
    g.poly([(82, 36), (94, 40), (82, 44)], ORANGE)
    g.circle(73, 35, 2.4, OUT, ol=False)
    g.poly([(30, 58), (56, 54), (44, 70)], GOLD, ol=False)
    g.lines([[(66, 22), (62, 12)], [(70, 22), (72, 12)]], BROWN_D, 1.8)
    g.lines([[(40, 80), (36, 90)], [(54, 80), (56, 90)]], ORANGE, 2.2)


@icon("whip")
def _(g):
    g.rect(14, 70, 34, 80, BROWN, r=3)
    g.line(bez((32, 74), (66, 84), (78, 50)) + bez((78, 50), (88, 22), (58, 18))[1:], RED, 4)
    g.circle(57, 18, 3, RED_D)


@icon("buckler")
def _(g):
    g.circle(50, 52, 34, STEEL)
    g.circle(50, 52, 26, (230, 73, 128), ol=False)
    for k in range(5):
        with g.at(50, 52, k * 72):
            g.ellipse(0, -9, 7, 10, PINK_L)
    g.circle(50, 52, 6, (200, 30, 90))
    g.shine(38, 36, 6, 3)


@icon("harpoon")
def _(g):
    with g.at(50, 50, -45):
        g.line([(-42, 0), (22, 0)], BROWN_L, 4)
        g.poly([(20, -5), (44, 0), (20, 5)], STEEL_L)
        g.poly([(22, -4), (12, -12), (16, -2)], STEEL)
        g.poly([(22, 4), (12, 12), (16, 2)], STEEL)
        g.line(wavy(-30, 0, 30, 3, 0, 8), STEEL_D, 1.5, ol=False)
    g.circle(78, 22, 7, RED_D)


@icon("stealthkit")
def _(g):
    g.rect(18, 30, 82, 82, OLIVE, r=6)
    g.rect(18, 30, 82, 42, shade(OLIVE, 0.75), r=4)
    g.rect(40, 22, 60, 32, CHAR, r=2)
    g.ellipse(50, 62, 18, 9, HOLE)
    g.circle(50, 62, 5, MINT, ol=False)


@icon("jetpack")
def _(g):
    flame(g, 34, 82, 0.55, BLUE, ICE)
    flame(g, 66, 82, 0.55, BLUE, ICE)
    g.rect(22, 18, 46, 70, STEEL, r=10)
    g.rect(54, 18, 78, 70, STEEL, r=10)
    g.rect(40, 30, 60, 56, CHAR, r=3)
    g.shine(30, 30, 3, 8)
    g.shine(62, 30, 3, 8)


@icon("antlers")
def _(g):
    for side in (-1, 1):
        stem = [(50 + side * 6, 86), (50 + side * 18, 56), (50 + side * 34, 20)]
        g.line(bez(*stem), MINT, 5)
        g.lines([[(50 + side * 18, 58), (50 + side * 38, 50)],
                 [(50 + side * 26, 40), (50 + side * 12, 24)],
                 [(50 + side * 30, 30), (50 + side * 44, 26)]], MINT, 4)


@icon("faraday")
def _(g):
    g.arc(42, 50, 26, 90, 270, STEEL_L, 6)
    g.line([(42, 24), (60, 24)], STEEL_L, 6)
    g.line([(42, 76), (60, 76)], STEEL_L, 6)
    g.line([(66, 50), (74, 50)], STEEL, 4)
    g.star(82, 50, 12, GOLD, n=8, inner=0.4)
    bolt(g, 36, 50, 0.6, CYAN)


@icon("afterburner")
def _(g):
    g.glow(50, 50, 42, CYAN, 50)
    g.arc(50, 50, 30, 0, 360, CYAN, 6)
    for k in range(3):
        with g.at(50, 50, k * 120):
            g.poly([(26, -8), (36, 0), (26, 8)], ICE)
    g.circle(50, 50, 12, BLUE_D)
    g.circle(50, 50, 6, ICE, ol=False)


@icon("headset")
def _(g):
    g.rect(38, 10, 62, 44, STEEL_D, r=5)
    g.circle(50, 46, 8, CHAR)
    g.line([(50, 52), (44, 58), (56, 64), (44, 70), (56, 76), (50, 80)], GOLD, 3)
    g.rect(26, 80, 74, 90, CHAR, r=3)
    g.circle(50, 26, 6, RED)


@icon("boots")
def _(g):
    flame(g, 64, 70, 1.0)
    boot(g, RED, CHAR, YELLOW)


@icon("strides")
def _(g):
    def foot(x, y, a):
        with g.at(x, y, a):
            g.ellipse(0, 6, 9, 15, LUNAR_D)
            for k, (fx, fy) in enumerate(((-7, -13), (-2, -16), (3, -16), (8, -13))):
                g.circle(fx, fy, 3 - k * 0.2, LUNAR_D)
    foot(36, 66, -12)
    foot(64, 36, 12)


@icon("witness")
def _(g):
    flame(g, 50, 46, 1.3, ORANGE, YELLOW)
    g.ellipse(50, 60, 22, 13, BONE)
    g.circle(50, 60, 9, RED)
    g.circle(50, 60, 4, OUT, ol=False)


@icon("disciple")
def _(g):
    g.poly([(30, 40), (70, 40), (74, 84), (62, 76), (50, 86), (38, 76), (26, 84)], STEEL_L)
    g.circle(50, 38, 20, STEEL_L)
    g.circle(43, 36, 3.5, CYAN, ol=False)
    g.circle(57, 36, 3.5, CYAN, ol=False)
    flame(g, 82, 22, 0.4, CYAN, ICE)
    flame(g, 18, 26, 0.35, CYAN, ICE)


@icon("weeping")
def _(g):
    mushroom(g, VIOLET, VOID_L, PINK_L)
    drop(g, 18, 80, 5, VOID_L)
    drop(g, 82, 78, 4, VOID_L)


# Equipment support

@icon("fuelcell")
def _(g):
    g.rect(40, 10, 60, 20, STEEL_D, r=2)
    g.rect(28, 18, 72, 88, STEEL, r=8)
    g.rect(33, 26, 67, 80, ORANGE, r=5)
    g.rect(33, 58, 67, 80, ORANGE_D, r=5, ol=False)
    bolt(g, 50, 52, 0.8, YELLOW)
    g.shine(38, 34, 2.5, 8)


@icon("bottledchaos")
def _(g):
    flask(g, VIOLET, 50, 62, 26)
    spark(g, 42, 64, 7, VOID_L)
    spark(g, 60, 72, 5, YELLOW)
    spark(g, 80, 24, 9, VOID_L)
    spark(g, 20, 34, 6, YELLOW)


# Equipment

@icon("fruit")
def _(g):
    g.circle(50, 58, 30, (224, 49, 90))
    g.poly([(42, 30), (46, 22), (50, 28), (54, 22), (58, 30)], RED_D)
    leaf(g, 54, 24, -40, 26, 8, GREEN)
    for x, y in ((40, 52), (54, 64), (62, 48), (44, 70)):
        g.circle(x, y, 2.4, PINK_L, ol=False)
    g.shine(36, 44, 5, 8)


@icon("dml")
def _(g):
    for k, y in enumerate((30, 50, 70)):
        with g.at(60 - k * 4, y, -20):
            missile(g)
    g.rect(14, 40, 40, 84, OLIVE, r=4)
    g.rect(18, 46, 36, 56, HOLE, r=2)
    g.rect(18, 62, 36, 72, HOLE, r=2)


@icon("capacitor")
def _(g):
    g.rect(30, 50, 70, 88, COPPER, r=4)
    for y in (58, 68, 78):
        g.line([(30, y), (70, y)], COPPER_D, 2.5, ol=False)
    g.rect(26, 44, 74, 52, GOLD, r=2)
    g.star(50, 34, 16, GOLD, n=5, inner=0.5)
    bolt(g, 50, 30, 0.9, CYAN)


@icon("sawmerang")
def _(g):
    g.star(50, 50, 40, STEEL_L, n=12, inner=0.78, rot=0)
    g.circle(50, 50, 26, STEEL)
    g.arc(50, 50, 18, 200, 320, STEEL_L, 3, ol=False)
    g.circle(50, 50, 9, HOLE)
    g.shine(36, 36, 5, 3)


@icon("cube")
def _(g):
    g.glow(50, 50, 46, VOID, 70)
    g.poly([(50, 14), (82, 30), (50, 46), (18, 30)], VOID_L)
    g.poly([(18, 30), (50, 46), (50, 86), (18, 70)], VOID)
    g.poly([(82, 30), (50, 46), (50, 86), (82, 70)], shade(VOID, 0.65))
    g.circle(50, 30, 6, HOLE, ol=False)


@icon("molotov")
def _(g):
    g.rect(40, 26, 60, 46, GLASS)
    g.poly([(40, 44), (60, 44), (72, 60), (72, 88), (28, 88), (28, 60)], GLASS)
    g.poly([(30, 66), (70, 66), (70, 86), (30, 86)], ORANGE, ol=False)
    g.rect(38, 18, 62, 28, BONE, r=2)
    flame(g, 50, 6, 0.55)
    g.shine(36, 60, 2.5, 6)


@icon("preon")
def _(g):
    g.glow(50, 50, 46, CYAN, 70)
    g.arc(50, 50, 34, 0, 360, BLUE_D, 5)
    g.circle(50, 50, 22, CYAN)
    g.circle(50, 50, 12, ICE, ol=False)
    for a in (30, 150, 270):
        spark(g, *pol(50, 50, 38, a), 8, ICE)


@icon("minefield")
def _(g):
    for x, y, s in ((32, 64, 1.0), (68, 66, 0.9), (50, 32, 0.85)):
        with g.at(x, y, 0, s):
            for k in range(6):
                with g.at(0, 0, k * 60):
                    g.rect(-3, -22, 3, -14, STEEL_D)
            g.circle(0, 0, 16, CHAR)
            g.circle(0, 0, 5, RED, ol=False)


@icon("goldbomb")
def _(g):
    bomb(g, 48, 58, 30, GOLD)
    g.text(48, 60, "$", 26, GOLD_L)


@icon("lostdoll")
def _(g):
    g.poly([(36, 50), (64, 50), (78, 88), (22, 88)], (200, 80, 110))
    g.circle(50, 34, 20, BONE)
    g.lines([[(42, 30), (46, 34)], [(46, 30), (42, 34)]], OUT, 1.6, ol=False)
    g.circle(57, 32, 3.5, OUT, ol=False)
    g.line([(43, 44), (57, 44)], RED_D, 1.6, ol=False)
    g.lines([[(32, 18), (38, 12)], [(68, 18), (62, 12)]], BROWN_D, 4)
    g.lines([[(30, 70), (70, 70)]], PINK_L, 2, ol=False)


@icon("elephant")
def _(g):
    jade = (56, 217, 169)
    g.union(lambda: (g.ellipse(46, 56, 30, 20, jade), g.circle(74, 44, 15, jade)))
    for x in (26, 40, 54, 64):
        g.rect(x - 5, 66, x + 5, 86, shade(jade, 0.85), r=2)
    g.line(bez((84, 48), (94, 66), (86, 82)), jade, 6)
    g.ellipse(64, 42, 9, 12, shade(jade, 0.8))
    g.circle(78, 40, 2.4, OUT, ol=False)


@icon("blastshower")
def _(g):
    g.line([(80, 14), (80, 30), (58, 30)], STEEL, 5)
    g.poly([(30, 30), (62, 22), (66, 40), (34, 48)], STEEL_L)
    for k, (x, y) in enumerate(((34, 62), (48, 60), (62, 56), (40, 80), (56, 78), (70, 72))):
        drop(g, x, y, 4.5, BLUE)


@icon("unstablewatch")
def _(g):
    g.rect(44, 6, 56, 16, GOLD, r=2)
    g.circle(50, 54, 36, GOLD)
    g.circle(50, 54, 29, ICE)
    g.line([(50, 54), (50, 34)], OUT, 2.5, ol=False)
    g.line([(50, 54), (64, 60)], OUT, 2.5, ol=False)
    g.line([(28, 40), (40, 52), (36, 62), (46, 74)], BLUE_D, 1.8, ol=False)
    g.shine(38, 40, 6, 3)


@icon("buddy")
def _(g):
    g.rect(16, 10, 84, 90, BONE, r=3)
    g.circle(50, 34, 13, (255, 255, 255), ol=False)
    g.arc(50, 34, 13, 0, 360, OUT, 1.8, ol=False)
    g.circle(45, 32, 2, OUT, ol=False)
    g.circle(55, 32, 2, OUT, ol=False)
    g.arc(50, 36, 6, 20, 160, OUT, 1.6, ol=False)
    g.lines([[(50, 47), (50, 68)], [(34, 54), (66, 56)], [(50, 68), (38, 84)], [(50, 68), (62, 84)]], OUT, 1.8,
            ol=False)


@icon("safelantern")
def _(g):
    g.glow(50, 56, 44, GOLD_L, 80)
    g.arc(50, 18, 10, 180, 360, STEEL_D, 3)
    g.rect(32, 20, 68, 28, STEEL_D, r=2)
    g.rect(34, 28, 66, 78, GOLD_L)
    g.lines([[(42, 28), (42, 78)], [(58, 28), (58, 78)]], STEEL_D, 2.5, ol=False)
    g.rect(30, 78, 70, 88, STEEL_D, r=2)
    flame(g, 50, 56, 0.5)


@icon("egg")
def _(g):
    flame(g, 50, 40, 1.6, ORANGE_D, ORANGE)
    g.ellipse(50, 58, 22, 28, RED_D)
    g.line([(34, 50), (44, 58), (40, 66), (50, 74)], YELLOW, 2.2, ol=False)
    g.line([(60, 40), (56, 52), (66, 60)], YELLOW, 2.2, ol=False)
    g.shine(42, 46, 4, 7)


@icon("vase")
def _(g):
    g.poly([(40, 14), (60, 14), (56, 26), (74, 44), (70, 74), (58, 88), (42, 88), (30, 74), (26, 44), (44, 26)],
           PURPLE)
    g.rect(36, 10, 64, 18, shade(PURPLE, 0.75), r=2)
    g.arc(50, 56, 12, 0, 300, VOID_L, 3, ol=False)
    g.shine(36, 46, 3, 8)


@icon("amethyst")
def _(g):
    gem(g, 50, 50, 40, VIOLET)
    spark(g, 80, 20, 9, VOID_L)


@icon("ocular")
def _(g):
    glasses(g, STEEL_D, CYAN, BLUE_D)
    g.lines([[(20, 66), (40, 66)], [(60, 66), (82, 66)]], RED, 1.6, ol=False)
    g.star(31, 52, 6, RED, n=4, inner=0.2, ol=False)


@icon("opus")
def _(g):
    g.rect(22, 40, 78, 82, RED_D, r=4)
    g.lines([[(22, 46), (50, 80)], [(50, 46), (78, 80)], [(50, 46), (22, 80)], [(78, 46), (50, 80)]], GOLD, 2,
            ol=False)
    g.ellipse(50, 40, 28, 9, BONE)
    g.lines([[(30, 10), (46, 36)], [(72, 10), (56, 36)]], BROWN_L, 3.5)
    g.circle(30, 10, 4, BROWN_D)
    g.circle(72, 10, 4, BROWN_D)


@icon("leech")
def _(g):
    body = bez((16, 70), (46, 96), (60, 56)) + bez((60, 56), (72, 22), (88, 36))[1:]
    g.line(body, (150, 30, 50), 16)
    g.line(body, (200, 60, 80), 8, ol=False)
    g.circle(86, 34, 8, (120, 20, 40))
    g.circle(86, 34, 3.5, RED, ol=False)
    for p in body[4:-4:5]:
        g.circle(p[0], p[1], 1.6, PINK_L, ol=False)


@icon("backup")
def _(g):
    for x, y, s in ((26, 30, 0.42), (74, 30, 0.42)):
        with g.at(x, y, 0, s), g.at(-50, -50):
            drone(g, ORANGE, YELLOW)
    with g.at(50, 62, 0, 0.62), g.at(-50, -50):
        drone(g, ORANGE, YELLOW)


@icon("jar")
def _(g):
    g.rect(32, 12, 68, 22, BROWN_L, r=2)
    g.rect(24, 22, 76, 88, GLASS, r=10)
    for x, y in ((40, 48), (60, 62), (44, 74)):
        g.ellipse(x, y, 8, 10, (255, 255, 255, 220))
        g.circle(x - 3, y - 2, 1.6, OUT, ol=False)
        g.circle(x + 3, y - 2, 1.6, OUT, ol=False)
    g.shine(32, 34, 3, 8)


@icon("brooch")
def _(g):
    g.poly([(38, 52), (30, 90), (44, 82), (50, 92), (56, 82), (70, 90), (62, 52)], BLUE_D)
    g.circle(50, 40, 28, GOLD)
    g.star(50, 40, 20, GOLD_L, n=5, inner=0.45)
    g.circle(50, 40, 5, RED, ol=False)


@icon("meteorite")
def _(g):
    g.line([(86, 14), (52, 48)], (165, 216, 255, 160), 22, ol=False)
    g.line([(80, 20), (52, 48)], ICE, 10, ol=False)
    g.poly([(26, 52), (40, 34), (60, 36), (70, 56), (60, 78), (36, 80), (22, 68)], LUNAR_D)
    for x, y, r in ((40, 52, 5), (54, 66, 4), (56, 48, 3)):
        g.circle(x, y, r, shade(LUNAR_D, 0.65), ol=False)
    g.shine(36, 44, 4, 3)


@icon("tonic")
def _(g):
    g.rect(42, 10, 58, 20, BROWN_L, r=2)
    g.rect(44, 18, 56, 36, GLASS)
    g.poly([(44, 34), (56, 34), (74, 56), (68, 88), (32, 88), (26, 56)], GLASS)
    g.poly([(30, 60), (70, 60), (66, 84), (34, 84)], LUNAR, ol=False)
    gem(g, 50, 70, 10, LUNAR_D)
    g.shine(36, 54, 2.5, 6)


# --------------------------------------------------------------------------- output

def render(fn, size):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fn(Pen(layer))
    alpha = layer.getchannel("A")
    sil = alpha.filter(ImageFilter.GaussianBlur(4)).point(lambda v: 255 if v > 10 else 0)
    shadow = Image.new("L", (S, S), 0)
    shadow.paste(sil.filter(ImageFilter.GaussianBlur(6)).point(lambda v: int(v * 0.45)), (0, int(2 * U)))
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dark = Image.new("RGBA", (S, S), (0, 0, 0, 255))
    dark.putalpha(shadow)
    out.alpha_composite(dark)
    edge = Image.new("RGBA", (S, S), OUT + (255,))
    edge.putalpha(sil)
    out.alpha_composite(edge)
    out.alpha_composite(layer)
    return fit(out).resize((size, size), Image.LANCZOS)


def fit(img, fill=0.94):
    """Crops to the drawn area and scales it to fill the canvas, so every icon reads at the same size."""
    x0, y0, x1, y1 = img.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    crop = img.crop((x0, y0, x1, y1))
    k = S * fill / max(x1 - x0, y1 - y0)
    crop = crop.resize((max(1, int((x1 - x0) * k)), max(1, int((y1 - y0) * k))), Image.LANCZOS)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.alpha_composite(crop, ((S - crop.width) // 2, (S - crop.height) // 2))
    return out


def read_items():
    with open(os.path.join(ROOT, "js", "data.js")) as fh:
        src = fh.read()
    pattern = re.compile(r"\{ id: '([^']+)', name: (\"[^\"]*\"|'(?:[^'\\]|\\.)*'), icon: '[^']*', tier: (\d)")
    return [(m.group(1), m.group(2)[1:-1].replace("\\'", "'"), int(m.group(3))) for m in pattern.finditer(src)]


def contact_sheet(rendered, path, cols=12, thumb=64):
    label_h, pad = 22, 8
    cell_w, cell_h = thumb + 34, thumb + label_h + pad
    rows = (len(rendered) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w + pad, rows * cell_h + pad), (14, 16, 19))
    d = ImageDraw.Draw(sheet)
    small = font(10)
    for i, (item_id, name, tier, img) in enumerate(rendered):
        r, c = divmod(i, cols)
        x, y = pad + c * cell_w, pad + r * cell_h
        bx = x + (cell_w - pad - thumb) // 2
        d.rounded_rectangle((bx - 3, y - 3, bx + thumb + 3, y + thumb + 3), radius=6, fill=(28, 31, 36),
                            outline=TIER_COLORS[tier], width=2)
        sheet.paste(img.resize((thumb, thumb), Image.LANCZOS), (bx, y), img.resize((thumb, thumb), Image.LANCZOS))
        d.text((x + (cell_w - pad) / 2, y + thumb + 12), name[:16], font=small, fill=(200, 205, 210), anchor="mm")
    sheet.save(path)


def main():
    global _font_path
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(ROOT, "assets", "items"))
    parser.add_argument("--size", type=int, default=128)
    parser.add_argument("--font", default=DEFAULT_FONT)
    args = parser.parse_args()
    _font_path = args.font
    if not os.path.exists(_font_path):
        sys.exit("Font not found: %s (pass --font)" % _font_path)

    items = read_items()
    missing = [i for i, _, _ in items if i not in ICONS]
    unused = sorted(set(ICONS) - set(i for i, _, _ in items))
    if missing or unused:
        sys.exit("Missing icons: %s\nIcons without item: %s" % (missing, unused))

    os.makedirs(args.out, exist_ok=True)
    rendered = []
    for item_id, name, tier in items:
        img = render(ICONS[item_id], args.size)
        img.save(os.path.join(args.out, item_id + ".png"), optimize=True)
        rendered.append((item_id, name, tier, img))
    contact_sheet(rendered, os.path.join(os.path.dirname(os.path.abspath(__file__)), "contact_sheet.png"))
    print("Generated %d item icons in %s" % (len(rendered), args.out))


if __name__ == "__main__":
    main()
