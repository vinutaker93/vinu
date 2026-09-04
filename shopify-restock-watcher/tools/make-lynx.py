#!/usr/bin/env python3
"""Génère la caricature de lynx VINULOG (assets/vinulog-lynx.png).

Aucune dépendance : rendu maison dans un framebuffer RGBA, écriture PNG via
zlib. Chaque forme n'est échantillonnée que dans sa boîte englobante, avec un
sur-échantillonnage 3x3 pour l'anticrénelage.

Usage : python3 tools/make-lynx.py
"""

import math
import struct
import zlib

S = 512  # côté de l'image
SUB = 3  # sur-échantillonnage par axe

# Palette
NIGHT = (0x17, 0x1A, 0x21)
AMBER = (0xF0, 0xB4, 0x29)
FUR = (0xC9, 0x8A, 0x4B)
FUR_DARK = (0xB9, 0x79, 0x3F)
FUR_LIGHT = (0xE8, 0xC9, 0xA0)
FUR_SHADOW = (0x8A, 0x5A, 0x33)
INNER_EAR = (0x7A, 0x4A, 0x2C)
BLACK = (0x12, 0x14, 0x1A)
MUZZLE = (0xF3, 0xE7, 0xD6)
NOSE = (0x7A, 0x3B, 0x34)
EYE = (0xF7, 0xC9, 0x48)
WHITE = (0xFF, 0xFF, 0xFF)
BROWN = (0x3A, 0x2C, 0x22)

buf = bytearray(S * S * 4)


def blend(x, y, color, alpha):
    if alpha <= 0:
        return
    i = (y * S + x) * 4
    dst_a = buf[i + 3] / 255
    out_a = alpha + dst_a * (1 - alpha)
    if out_a <= 0:
        return
    for c in range(3):
        src = color[c] / 255
        dst = buf[i + c] / 255
        buf[i + c] = int(round(((src * alpha + dst * dst_a * (1 - alpha)) / out_a) * 255))
    buf[i + 3] = int(round(out_a * 255))


def draw(inside, bbox, color, alpha=1.0):
    """Peint `color` là où `inside(x, y)` est vrai, dans la boîte donnée."""
    x0, y0, x1, y1 = bbox
    x0 = max(0, int(x0) - 1)
    y0 = max(0, int(y0) - 1)
    x1 = min(S, int(x1) + 2)
    y1 = min(S, int(y1) + 2)
    step = 1.0 / SUB
    offsets = [(i + 0.5) * step for i in range(SUB)]
    total = SUB * SUB

    for py in range(y0, y1):
        for px in range(x0, x1):
            hits = 0
            for oy in offsets:
                sy = py + oy
                for ox in offsets:
                    if inside(px + ox, sy):
                        hits += 1
            if hits:
                blend(px, py, color, alpha * hits / total)


def ellipse(cx, cy, rx, ry):
    def inside(x, y):
        return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0

    return inside, (cx - rx, cy - ry, cx + rx, cy + ry)


def ring(cx, cy, r_in, r_out):
    def inside(x, y):
        d = math.hypot(x - cx, y - cy)
        return r_in <= d <= r_out

    return inside, (cx - r_out, cy - r_out, cx + r_out, cy + r_out)


def polygon(points):
    def inside(x, y):
        hit = False
        n = len(points)
        j = n - 1
        for i in range(n):
            xi, yi = points[i]
            xj, yj = points[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
        return hit

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return inside, (min(xs), min(ys), max(xs), max(ys))


def polyline(points, thickness):
    half = thickness / 2

    def dist_seg(px, py, ax, ay, bx, by):
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        t = 0.0 if length == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    def inside(x, y):
        for i in range(len(points) - 1):
            ax, ay = points[i]
            bx, by = points[i + 1]
            if dist_seg(x, y, ax, ay, bx, by) <= half:
                return True
        return False

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return inside, (min(xs) - half, min(ys) - half, max(xs) + half, max(ys) + half)


def bezier(p0, p1, p2, steps=16):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        pts.append(
            (
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            )
        )
    return pts


def mirror(points):
    return [(S - x, y) for x, y in points]


def clip_disc(shape, cx=256, cy=256, r=236):
    """Restreint une forme au disque du fond (les touffes d'oreilles, elles,
    débordent volontairement de l'anneau)."""
    inside, bbox = shape

    def clipped(x, y):
        return inside(x, y) and math.hypot(x - cx, y - cy) <= r

    x0, y0, x1, y1 = bbox
    return clipped, (max(x0, cx - r), max(y0, cy - r), min(x1, cx + r), min(y1, cy + r))


# ---------------------------------------------------------------- fond
draw(*ellipse(256, 256, 246, 246), NIGHT)
draw(*ring(256, 256, 236, 246), AMBER)

# ---------------------------------------------------------------- oreilles
for flip in (False, True):
    ear = [(150, 205), (104, 52), (222, 150)]
    inner = [(157, 196), (124, 92), (198, 158)]
    tuft = [(106, 58), (92, 2), (136, 78)]
    if flip:
        ear, inner, tuft = mirror(ear), mirror(inner), mirror(tuft)
    draw(*polygon(tuft), BLACK)
    draw(*polygon(ear), FUR_DARK)
    draw(*polygon(inner), INNER_EAR)

# ---------------------------------------------------------------- collerette
for flip in (False, True):
    spikes = [
        [(126, 292), (52, 306), (132, 344)],
        [(128, 342), (44, 388), (144, 386)],
        [(142, 384), (74, 452), (170, 424)],
        [(166, 416), (148, 474), (214, 446)],
    ]
    for spike in spikes:
        draw(*clip_disc(polygon(mirror(spike) if flip else spike)), FUR_LIGHT)

# ---------------------------------------------------------------- tête
draw(*ellipse(256, 300, 166, 152), FUR)

# rayures du front
for flip in (False, True):
    stripes = [
        [(246, 168), (266, 168), (270, 232), (242, 232)],
        [(200, 182), (218, 176), (232, 234), (212, 240)],
        [(160, 214), (176, 204), (196, 250), (178, 258)],
    ]
    for stripe in stripes:
        draw(*polygon(mirror(stripe) if flip else stripe), FUR_SHADOW)

# ---------------------------------------------------------------- sourcils
for flip in (False, True):
    brow = [(148, 248), (230, 272), (228, 292), (146, 268)]
    draw(*polygon(mirror(brow) if flip else brow), BLACK)

# ---------------------------------------------------------------- yeux
for cx in (194, 318):
    draw(*ellipse(cx, 312, 54, 40), BLACK)
    draw(*ellipse(cx, 312, 46, 32), EYE)
    draw(*ellipse(cx, 312, 13, 27), BLACK)
    draw(*ellipse(cx - 15, 300, 8, 7), WHITE)

# ---------------------------------------------------------------- museau
draw(*ellipse(214, 392, 58, 44), MUZZLE)
draw(*ellipse(298, 392, 58, 44), MUZZLE)

draw(*polygon([(228, 358), (284, 358), (256, 394)]), NOSE)
draw(*ellipse(256, 360, 28, 13), NOSE)

draw(*polyline([(256, 392), (256, 414)], 7), BROWN)
draw(*polyline(bezier((256, 412), (232, 436), (200, 420)), 7), BROWN)
draw(*polyline(bezier((256, 412), (280, 436), (312, 420)), 7), BROWN)

# ---------------------------------------------------------------- moustaches
for flip in (False, True):
    whiskers = [
        [(170, 378), (46, 344)],
        [(166, 398), (38, 396)],
        [(170, 416), (52, 448)],
    ]
    for whisker in whiskers:
        draw(*clip_disc(polyline(mirror(whisker) if flip else whisker, 5)), BROWN)


def write_png(path):
    rows = bytearray()
    for y in range(S):
        rows.append(0)  # filtre None
        rows += buf[y * S * 4 : (y + 1) * S * 4]

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(png)
    print(f"{path} — {S}x{S}, {len(png) // 1024} Ko")


if __name__ == "__main__":
    write_png("assets/vinulog-lynx.png")
