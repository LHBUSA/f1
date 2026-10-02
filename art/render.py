"""PropBetEdge F1 backdrop renderer — original procedural raster artwork (no SVG, no photography).

Builds four candidate directions (A night neon, B carbon + red telemetry, C silver/cyan precision,
D black + gold) with a shared engine: perspective racing lines with bloom, light trails, haze,
telemetry grid, carbon weave, an abstract aerodynamic blade, vignette and film grain (dithering
against banding). Every image is rendered at its final aspect (desktop and portrait mobile are
separate compositions, not crops).

usage: python art/render.py <outdir> [A B C D] [--scale 1.0]
"""
import sys, os, math
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

RNG = np.random.default_rng(20261001)

def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)

PALETTES = {
    'A': dict(name='night-race-neon', base0='#04060d', base1='#0b1230', haze='#1b2a6b', line='#ff3d6e', line2='#3ad6ff', glow='#ff7a45', grid='#3a5bd9', form='#9fb4ff', spec='#ffffff', carbon=0.0, grid_a=0.05),
    'B': dict(name='carbon-red-telemetry', base0='#060607', base1='#141416', haze='#2a0d10', line='#ff2a2a', line2='#ff6a3d', glow='#ff3b2e', grid='#ff4d4d', form='#5a5f6a', spec='#e9edf2', carbon=1.0, grid_a=0.035),
    'C': dict(name='silver-cyan-precision', base0='#07090c', base1='#151b22', haze='#123040', line='#7fe9ff', line2='#c9d4e2', glow='#38d6ff', grid='#5ad7ff', form='#8e9aa8', spec='#ffffff', carbon=0.35, grid_a=0.045),
    'D': dict(name='black-gold-grand-prix', base0='#050403', base1='#15110a', haze='#2b1f0c', line='#f2c063', line2='#ffe2a3', glow='#d99a2b', grid='#c99a45', form='#6d5a3a', spec='#fff3d6', carbon=0.25, grid_a=0.03),
}

# ---------- primitives ----------
def canvas(w, h, p):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = x / w, y / h
    b0, b1 = hexrgb(p['base0']), hexrgb(p['base1'])
    t = np.clip(0.55 * v + 0.45 * (1 - np.hypot(u - 0.78, v - 0.55) * 1.3), 0, 1)[..., None]
    return (b0 * (1 - t) + b1 * t).astype(np.float32), u, v

def lowfreq(h, w, sigma):
    n = RNG.standard_normal((h, w)).astype(np.float32)
    n = gaussian_filter(n, sigma)
    n -= n.min(); n /= max(n.max(), 1e-6)
    return n

def stroke(acc, pts, width, intensity, color, w, h):
    """Additively draw an anti-aliased polyline (pts in pixel coords) with per-point intensity/width arrays."""
    pts = np.asarray(pts, np.float32)
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        wd = width[i] if np.ndim(width) else width
        it = intensity[i] if np.ndim(intensity) else intensity
        if it <= 0.002: continue
        pad = int(wd * 3 + 2)
        xa, xb = int(max(0, min(x0, x1) - pad)), int(min(w, max(x0, x1) + pad))
        ya, yb = int(max(0, min(y0, y1) - pad)), int(min(h, max(y0, y1) + pad))
        if xa >= xb or ya >= yb: continue
        yy, xx = np.mgrid[ya:yb, xa:xb].astype(np.float32)
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy + 1e-6
        t = np.clip(((xx - x0) * dx + (yy - y0) * dy) / L2, 0, 1)
        d = np.hypot(xx - (x0 + t * dx), yy - (y0 + t * dy))
        a = np.clip(1.0 - (d - wd * 0.5), 0, 1) * it
        np.maximum(acc[ya:yb, xa:xb], a[..., None] * color, out=acc[ya:yb, xa:xb])

def bezier(p0, p1, p2, p3, n=400):
    t = np.linspace(0, 1, n)[:, None]
    return ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3

def bloom(layer, sigmas=(2, 8, 28), weights=(1.0, 0.7, 0.45)):
    out = layer.copy()
    for s, wgt in zip(sigmas, weights):
        out += gaussian_filter(layer, sigma=(s, s, 0)) * wgt
    return out

def carbon(h, w, scale):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    s = 7.0 * scale
    a = ((np.floor(x / s) + np.floor(y / s)) % 2).astype(np.float32)
    tw = np.sin((x + y) / s * math.pi) * 0.5 + 0.5
    weave = 0.5 * a * tw + 0.5 * (1 - a) * (1 - tw)
    return (weave - 0.5)  # zero-mean

def grain(h, w, amt):
    return (RNG.standard_normal((h, w, 1)).astype(np.float32)) * amt

# ---------- motorsport structures ----------
def offset_curve(pts, dist):
    d = np.gradient(pts, axis=0)
    n = np.stack([-d[:, 1], d[:, 0]], 1)
    n /= (np.linalg.norm(n, axis=1, keepdims=True) + 1e-6)
    return pts + n * dist[:, None]

def track_ribbon(img, pts, w, h, S, p, strength, kerb=True):
    """Asphalt band between two edges, widening toward the viewer, with faint edge lines and apex kerbs."""
    t = np.linspace(0, 1, len(pts))
    half = (18 + 120 * t ** 1.6) * S
    left, right = offset_curve(pts, -half), offset_curve(pts, half)
    band = np.zeros((h, w, 3), np.float32)
    asphalt = np.array([0.30, 0.32, 0.37], np.float32)
    for k in np.linspace(-1, 1, 23):
        stroke(band, offset_curve(pts, half * k), half * 0.11 + 1.5, 0.16 * strength * (1 - abs(k) * 0.3), asphalt, w, h)
    img += gaussian_filter(band, (3 * S + 1, 3 * S + 1, 0))
    edge = np.zeros((h, w, 3), np.float32)
    for e in (left, right):
        stroke(edge, e, 1.2 * S + 0.6, 0.30 * strength * np.sin(t * math.pi) ** 0.7, np.array([0.85, 0.88, 0.95], np.float32), w, h)
    img += bloom(edge, sigmas=(1.5 * S + 0.5, 6 * S + 1), weights=(0.6, 0.3))
    if kerb:
        apex = int(len(pts) * 0.55)
        kb = np.zeros((h, w, 3), np.float32)
        inner = offset_curve(pts, -half * 1.06)
        white = np.array([0.9, 0.9, 0.92], np.float32)
        for i in range(apex - 60, apex + 60, 6):
            col = hexrgb(p['line']) if (i // 6) % 2 == 0 else white
            stroke(kb, inner[i:i + 4], half[i] * 0.10 + 1.2, 0.45 * strength, col, w, h)
        img += gaussian_filter(kb, (0.8, 0.8, 0)) * 0.9

def wet_reflections(img, lights, w, h, S, strength):
    """Vertical light smears below each light source (wet asphalt)."""
    refl = np.zeros((h, w, 3), np.float32)
    for gx, gy, col in lights:
        for k in range(3):
            stroke(refl, [(gx + RNG.normal(0, 2), gy + 10 * S), (gx + RNG.normal(0, 4), min(h - 1, gy + (220 + 80 * k) * S))], (2.5 + k) * S, 0.18 * strength / (k + 1), col, w, h)
    img += gaussian_filter(refl, (6 * S + 1, 2 * S + 1, 0))

def speed_trace(img, w, h, S, p, strength, y0, y1, x0=0.0, x1=1.0):
    """Telemetry speed trace: straights plateau, braking zones dip sharply, sector ticks."""
    n = 900
    xs = np.linspace(x0 * w, x1 * w, n)
    sp = np.zeros(n, np.float32)
    vel = 0.6
    brakes = [(0.13, 0.016), (0.36, 0.010), (0.44, 0.006), (0.66, 0.020), (0.88, 0.012)]  # (position, braking length)
    for i in range(n):
        f = i / n
        braking = any(0 <= f - b < L for b, L in brakes)
        target = 0.36 if braking else 0.92
        vel += (target - vel) * (0.07 if target < vel else 0.010)  # hard braking, long traction-limited exit
        sp[i] = vel
    ys = (y1 - (y1 - y0) * sp) * h
    tr = np.zeros((h, w, 3), np.float32)
    stroke(tr, np.stack([xs, ys], 1), 1.2 * S + 0.6, 0.30 * strength, hexrgb(p['line']), w, h)
    for b, _ in brakes[::2]:
        bx = (x0 + (x1 - x0) * b) * w
        stroke(tr, [(bx, y0 * h - 6 * S), (bx, y1 * h + 6 * S)], 1.0 * S + 0.4, 0.16 * strength, hexrgb(p['grid']), w, h)
    img += bloom(tr, sigmas=(1.5 * S + 0.5, 7 * S + 1), weights=(0.7, 0.35))

# A fictional circuit layout (not any real track): main straight, hairpin, esses, chicane. Normalized coords.
LAYOUT = [(0.00, 0.62), (0.55, 0.62), (0.70, 0.58), (0.78, 0.48), (0.74, 0.40), (0.62, 0.38), (0.56, 0.30), (0.62, 0.20),
          (0.80, 0.16), (0.96, 0.22), (1.00, 0.36), (0.94, 0.48), (0.90, 0.62), (0.98, 0.78), (0.90, 0.90), (0.70, 0.92),
          (0.52, 0.86), (0.44, 0.92), (0.30, 0.94), (0.12, 0.88), (0.02, 0.76)]

def chaikin(pts, it=4):
    P = np.asarray(pts, np.float32)
    for _ in range(it):
        Q = 0.75 * P + 0.25 * np.roll(P, -1, 0)
        R = 0.25 * P + 0.75 * np.roll(P, -1, 0)
        P = np.empty((len(P) * 2, 2), np.float32)
        P[0::2], P[1::2] = Q, R
    return np.vstack([P, P[:1]])

def circuit_outline(img, w, h, S, p, strength, cx, cy, rx, ry, tilt=0.55, seed=7):
    """Fictional circuit drawn as a thin line, tilted into perspective."""
    P = chaikin(LAYOUT, 5)
    xs = cx * w + (P[:, 0] - 0.5) * 2 * rx * w
    ys = cy * h + (P[:, 1] - 0.55) * 2 * ry * h * tilt
    o = np.zeros((h, w, 3), np.float32)
    stroke(o, np.stack([xs, ys], 1), 1.3 * S + 0.6, 0.45 * strength, hexrgb(p['line2']), w, h)
    img += bloom(o, sigmas=(1.2 * S + 0.5, 5 * S + 1), weights=(0.6, 0.3))

def bodywork(img, w, h, S, p, strength, portrait):
    """Large smooth metallic surface with an anisotropic specular band (abstract aero bodywork)."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = x / w, y / h
    cx, cy = (0.78, 0.86) if not portrait else (0.62, 0.92)
    d = ((u - cx) / 0.62) ** 2 + ((v - cy) / 0.38) ** 2
    body = np.clip(1 - d, 0, 1) ** 0.6
    band = np.exp(-((v - (cy - 0.22 + 0.25 * (u - cx))) / 0.018) ** 2) * body
    img += (body[..., None] * hexrgb(p['form']) * 0.22) * strength
    img += gaussian_filter((band[..., None] * hexrgb(p['spec']) * 0.55 * strength).astype(np.float32), (2 * S + 1, 6 * S + 1, 0))
    rim = np.exp(-((np.sqrt(d) - 1) / 0.004) ** 2) * (v < cy) * np.clip((u - (cx - 0.18)) / 0.25, 0, 1) * np.clip(((cx + 0.45) - u) / 0.2, 0, 1)
    img += gaussian_filter((rim[..., None] * hexrgb(p['line']) * 0.32 * strength).astype(np.float32), (1.5 * S + 0.5, 1.5 * S + 0.5, 0))

def direction_layers(img, p, w, h, S, kind, portrait, copy):
    D = p['key']
    st = {'hero': 1.0, 'race': 0.75, 'cast': 0.6, 'site': 0.45, 'data': 0.3}[kind]
    if D == 'A':
        if portrait:
            tp = bezier(np.array([w * 1.15, h * 0.52]), np.array([w * 0.55, h * 0.56]), np.array([w * 0.15, h * 0.70]), np.array([w * 0.30, h * 1.08]), 500)
            spots = [(0.35, 0.40), (0.60, 0.37), (0.85, 0.41)]
        else:
            tp = bezier(np.array([w * 1.1, h * 0.44]), np.array([w * 0.72, h * 0.47]), np.array([w * 0.48, h * 0.62]), np.array([w * 0.56, h * 1.1]), 500)
            spots = [(0.70, 0.30), (0.80, 0.27), (0.90, 0.31), (0.97, 0.26)]
        if kind in ('hero', 'race', 'cast'):
            track_ribbon(img, tp, w, h, S, p, 0.9 * st)
        lights = [(w * x, h * y, hexrgb(p['glow']) if i % 2 else hexrgb(p['line2'])) for i, (x, y) in enumerate(spots)]
        fl = np.zeros((h, w, 3), np.float32)
        yy, xx = np.ogrid[0:h, 0:w]
        for gx, gy, col in lights:
            fl += (np.exp(-((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * (5 * S) ** 2))[..., None] * col).astype(np.float32)
        img += bloom(fl, sigmas=(3 * S + 1, 16 * S + 2, 60 * S + 4), weights=(0.8, 0.5, 0.35)) * st
        wet_reflections(img, lights, w, h, S, st)
    elif D == 'B':
        cb = carbon(h, w, max(S, 0.6))
        img += (cb * 0.05 * st * (1 - 0.7 * copy))[..., None]
        if portrait:
            speed_trace(img, w, h, S, p, st, 0.80, 0.92, 0.04, 0.96)
        else:
            speed_trace(img, w, h, S, p, st, 0.76, 0.90, 0.54, 0.99)
        if kind in ('hero', 'race'):
            bodywork(img, w, h, S, {**p, 'form': '#3a3d44', 'spec': '#d9dde4'}, 0.7 * st, portrait)
    elif D == 'C':
        if kind in ('hero', 'race', 'cast'):
            bodywork(img, w, h, S, p, st, portrait)
        if portrait:
            circuit_outline(img, w, h, S, p, 0.5 * st, 0.62, 0.50, 0.28, 0.10)
        else:
            circuit_outline(img, w, h, S, p, 0.5 * st, 0.80, 0.26, 0.12, 0.22)
    elif D == 'D':
        if portrait:
            circuit_outline(img, w, h, S, p, 0.38 * st, 0.62, 0.50, 0.28, 0.10, tilt=0.5)
        else:
            circuit_outline(img, w, h, S, p, 0.38 * st, 0.82, 0.30, 0.11, 0.20, tilt=0.5)
        if kind in ('hero', 'race'):
            bodywork(img, w, h, S, {**p, 'line': p['line2']}, 0.55 * st, portrait)

# ---------- composition ----------
def compose(p, w, h, kind, portrait=False):
    p = {**p, 'key': [k for k, val in PALETTES.items() if val['name'] == p['name']][0]}
    img, u, v = canvas(w, h, p)
    S = min(w, h) / 1000.0
    # Copy zone mask (keep dark): hero copy lives upper-left on desktop, top on mobile.
    if portrait:
        copy = np.clip(1 - np.hypot((u - 0.45) / 0.75, (v - 0.22) / 0.30), 0, 1)
    else:
        copy = np.clip(1 - np.hypot((u - 0.24) / 0.42, (v - 0.40) / 0.48), 0, 1)
    copy = copy ** 1.4
    hero = kind == 'hero'
    quiet = {'hero': 1.0, 'site': 0.42, 'data': 0.30, 'race': 0.55, 'cast': 0.5}[kind]

    # Haze
    hz = lowfreq(h // 4, w // 4, 18 * S + 4)
    hz = np.array(Image.fromarray((hz * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255
    focus = np.clip(1 - np.hypot((u - (0.55 if portrait else 0.72)) / 0.8, (v - (0.70 if portrait else 0.58)) / 0.7), 0, 1)
    img += hexrgb(p['haze'])[None, None, :] * (hz * focus)[..., None] * (0.55 * quiet)

    # Carbon weave (subtle, masked away from copy)
    if p['carbon'] > 0:
        cb = carbon(h, w, max(S, 0.6))
        img += (cb * 0.022 * p['carbon'] * (0.6 + 0.4 * focus) * (1 - 0.6 * copy))[..., None]

    # Telemetry grid in perspective (floor plane receding to a horizon off-centre)
    hx, hy = (0.62, 0.42) if not portrait else (0.6, 0.48)
    grid = np.zeros((h, w, 3), np.float32)
    gcol = hexrgb(p['grid'])
    for k in range(-16, 17):
        x_far, x_near = hx * w + k * 6 * S, hx * w + k * 260 * S
        stroke(grid, [(x_far, hy * h), (x_near, h * 1.05)], 1.0 * S + 0.6, p['grid_a'] * 2.2, gcol, w, h)
    for j in range(1, 14):
        yy = hy * h + (h * (1.05 - hy)) * (j / 14) ** 2.1
        stroke(grid, [(0, yy), (w, yy)], 1.0 * S + 0.6, p['grid_a'] * 1.6 * (j / 14), gcol, w, h)
    gmask = np.clip((v - hy) / (1 - hy), 0, 1) ** 0.8 * (1 - copy * 0.85)
    img += grid * gmask[..., None] * (1.0 if hero else 0.8) * quiet

    # Racing lines + light trails (bezier sweeps through the focus region)
    lines = np.zeros((h, w, 3), np.float32)
    c1, c2 = hexrgb(p['line']), hexrgb(p['line2'])
    n_trails = {'A': 20, 'B': 6, 'C': 12, 'D': 16}[p['key']] if hero else {'A': 9, 'B': 3, 'C': 5, 'D': 7}[p['key']]
    for i in range(n_trails):
        jitter = RNG.normal(0, 1, 6).astype(np.float32)
        if portrait:
            p0 = np.array([w * (-0.2 + 0.05 * jitter[0]), h * (0.98 + 0.04 * jitter[1])])
            p1 = np.array([w * (0.35 + 0.06 * jitter[2]), h * (0.66 + 0.05 * jitter[3])])
            p2 = np.array([w * (0.95 + 0.05 * jitter[4]), h * (0.62 + 0.04 * jitter[5])])
            p3 = np.array([w * 1.3, h * (0.40 + 0.04 * jitter[0])])
        else:
            p0 = np.array([w * (0.30 + 0.05 * jitter[0]), h * (1.08 + 0.03 * jitter[1])])
            p1 = np.array([w * (0.52 + 0.05 * jitter[2]), h * (0.72 + 0.05 * jitter[3])])
            p2 = np.array([w * (0.80 + 0.04 * jitter[4]), h * (0.50 + 0.04 * jitter[5])])
            p3 = np.array([w * 1.15, h * (0.30 + 0.05 * jitter[0])])
        pts = bezier(p0, p1, p2, p3, 360)
        t = np.linspace(0, 1, len(pts))
        primary = i < 2
        env = np.sin(np.clip((t - RNG.uniform(0, 0.25)) / RNG.uniform(0.5, 0.95), 0, 1) * math.pi) ** (1.2 if primary else 2.2)
        inten = env * (1.0 if primary else RNG.uniform(0.18, 0.5)) * quiet
        width = (3.2 if primary else RNG.uniform(0.8, 1.6)) * S * (0.6 + 0.8 * t)
        col = c1 if (i % 3 != 1) else c2
        stroke(lines, pts, width, inten, col, w, h)
    lines *= (1 - copy * 0.9)[..., None]
    img += bloom(lines, sigmas=(2 * S + 1, 9 * S + 2, 34 * S + 4), weights=(1.0, 0.8, 0.55))

    # Aerodynamic blade: a long curved surface with rim light, off-centre (hero + race variants only)
    if kind in ('hero', 'race', 'cast'):
        form = np.zeros((h, w, 3), np.float32)
        fc, sc = hexrgb(p['form']), hexrgb(p['spec'])
        if portrait:
            a0, a1, a2, a3 = (w * 0.05, h * 0.86), (w * 0.45, h * 0.70), (w * 0.80, h * 0.74), (w * 1.1, h * 0.62)
        else:
            a0, a1, a2, a3 = (w * 0.50, h * 0.80), (w * 0.66, h * 0.60), (w * 0.86, h * 0.60), (w * 1.05, h * 0.48)
        edge = bezier(np.array(a0), np.array(a1), np.array(a2), np.array(a3), 500)
        tt = np.linspace(0, 1, len(edge))
        for k in range(26):
            off = k * 3.2 * S
            shade = (1 - k / 26) ** 2.2 * 0.16 * (0.9 if kind == 'hero' else 0.5)
            stroke(form, edge + np.array([0, off]), 3.4 * S + 1, shade * np.sin(tt * math.pi) ** 0.8, fc, w, h)
        rim = np.zeros((h, w, 3), np.float32)
        stroke(rim, edge, 1.6 * S + 0.6, 0.85 * np.sin(tt * math.pi) ** 2.5 * (1 if kind == 'hero' else 0.6), sc, w, h)
        img += gaussian_filter(form, (1.5 * S + 0.5, 1.5 * S + 0.5, 0)) + bloom(rim, sigmas=(1.5 * S + 0.5, 6 * S + 1, 22 * S + 2), weights=(0.9, 0.6, 0.35))

    # Race-light glow: a few soft distant lights near the horizon
    glow = np.zeros((h, w, 3), np.float32)
    gl = hexrgb(p['glow'])
    for i in range({'A': 6, 'B': 2, 'C': 0, 'D': 3}[p['key']] if hero else {'A': 3, 'B': 1, 'C': 0, 'D': 1}[p['key']]):
        gx = w * ((0.62 + 0.35 * RNG.random()) if not portrait else (0.3 + 0.65 * RNG.random()))
        gy = h * ((0.38 + 0.12 * RNG.random()) if not portrait else (0.44 + 0.1 * RNG.random()))
        r = (6 + 10 * RNG.random()) * S
        yy, xx = np.ogrid[0:h, 0:w]
        glow += (np.exp(-((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * r * r))[..., None] * gl * 0.55).astype(np.float32)
    img += bloom(glow, sigmas=(6 * S + 1, 26 * S + 2), weights=(0.6, 0.4)) * quiet

    direction_layers(img, p, w, h, S, kind, portrait, copy)

    # Vignette + tone + darkening over copy zone
    vig = np.clip(1 - 0.55 * np.hypot((u - 0.6) / 0.95, (v - 0.55) / 0.85) ** 2.2, 0.25, 1)
    img *= vig[..., None]
    img *= (1 - 0.35 * copy * (1 if hero else 0.5))[..., None]
    if kind == 'data':
        img = img * 0.82
    img = 1 - np.exp(-img * 1.35)  # soft filmic shoulder
    img += grain(h, w, 0.012)
    return np.clip(img, 0, 1)

def save(img, path_noext, sizes):
    im = Image.fromarray((img * 255 + 0.5).astype(np.uint8), 'RGB')
    out = []
    for tag, (W, H), q_avif, q_webp in sizes:
        r = im if (W, H) == im.size else im.resize((W, H), Image.LANCZOS)
        pa = f"{path_noext}{tag}.avif"
        pw = f"{path_noext}{tag}.webp"
        r.save(pa, quality=q_avif, speed=4)
        r.save(pw, quality=q_webp, method=6)
        out += [(pa, W, H, os.path.getsize(pa)), (pw, W, H, os.path.getsize(pw))]
    return out

def main():
    outdir = sys.argv[1]
    dirs = [a for a in sys.argv[2:] if a in PALETTES] or list(PALETTES)
    scale = float(sys.argv[sys.argv.index('--scale') + 1]) if '--scale' in sys.argv else 1.0
    masters = os.path.join(outdir, 'masters')
    os.makedirs(masters, exist_ok=True)
    report = []
    for d in dirs:
        p = PALETTES[d]
        global RNG
        RNG = np.random.default_rng(20261001 + ord(d))
        sd = os.path.join(outdir, d)
        os.makedirs(sd, exist_ok=True)
        # Hero desktop master 3200x1500 → 2560 / 1600 webp+avif; mobile portrait master 1200x1800 → 900x1350
        hd = compose(p, int(2560 * scale), int(1200 * scale), 'hero')
        Image.fromarray((hd * 255 + 0.5).astype(np.uint8)).save(os.path.join(masters, f'{d}-hero-desktop-master.webp'), quality=95)
        report += save(hd, os.path.join(sd, 'hero-desktop'), [('-2560', (2560, 1200), 52, 80), ('-1600', (1600, 750), 50, 78)])
        hm = compose(p, int(900 * scale), int(1350 * scale), 'hero', portrait=True)
        Image.fromarray((hm * 255 + 0.5).astype(np.uint8)).save(os.path.join(masters, f'{d}-hero-mobile-master.webp'), quality=95)
        report += save(hm, os.path.join(sd, 'hero-mobile'), [('-900', (900, 1350), 50, 78)])
        for kind in ('site', 'data', 'race', 'cast'):
            bd = compose(p, int(1920 * scale), int(1200 * scale), kind)
            report += save(bd, os.path.join(sd, f'bg-{kind}-desktop'), [('-1920', (1920, 1200), 45, 72)])
            bm = compose(p, int(720 * scale), int(1280 * scale), kind, portrait=True)
            report += save(bm, os.path.join(sd, f'bg-{kind}-mobile'), [('-720', (720, 1280), 45, 72)])
        print(d, p['name'], 'done', flush=True)
    with open(os.path.join(outdir, 'assets.tsv'), 'w') as f:
        for path, W, H, size in report:
            f.write(f"{os.path.relpath(path, outdir)}\t{W}x{H}\t{size}\n")

if __name__ == '__main__':
    main()
