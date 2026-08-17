#!/usr/bin/env python3
# Gera os ícones do app do Teams (teams-app/color.png 192x192 e
# teams-app/outline.png 32x32) SEM lib de imagem — o container não tem PIL,
# então o PNG é montado na mão (zlib + struct) e o desenho é procedural:
# quadrado azul SP arredondado + balão de chat branco com três pontos.
# Regra do Teams: outline é BRANCO sobre transparente, 32x32 exato.
import zlib
import struct
import math


def png(width, height, pixels):
    raw = b''
    for row in pixels:
        raw += b'\x00' + b''.join(struct.pack('4B', *p) for p in row)

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


SS = 4  # supersampling (anti-alias)


def dentro_rrect(x, y, cx0, cy0, cx1, cy1, r):
    if x < cx0 or x > cx1 or y < cy0 or y > cy1:
        return False
    dx = max(cx0 + r - x, 0, x - (cx1 - r))
    dy = max(cy0 + r - y, 0, y - (cy1 - r))
    return dx * dx + dy * dy <= r * r


def dentro_bolha(x, y, s):
    corpo = dentro_rrect(x, y, 0.16 * s, 0.20 * s, 0.84 * s, 0.68 * s, 0.12 * s)
    rab = (0.26 * s <= x <= 0.44 * s) and (0.66 * s <= y <= 0.84 * s) and (y - 0.66 * s) <= (0.44 * s - x)
    return corpo or rab


def cobertura(fn, px, py, s):
    hits = 0
    for i in range(SS):
        for j in range(SS):
            if fn(px + (i + 0.5) / SS, py + (j + 0.5) / SS, s):
                hits += 1
    return hits / (SS * SS)


AZUL = (14, 59, 250)      # #0E3BFA
ESCURO = (9, 29, 141)     # #091D8D

S = 192
rows = []
for y in range(S):
    row = []
    for x in range(S):
        cf = cobertura(lambda a, b, s: dentro_rrect(a, b, 0.02 * s, 0.02 * s, 0.98 * s, 0.98 * s, 0.18 * s), x, y, S)
        if cf == 0:
            row.append((0, 0, 0, 0))
            continue
        t = y / S
        bg = tuple(int(AZUL[k] * (1 - t) + ESCURO[k] * t) for k in range(3))
        cb = cobertura(dentro_bolha, x, y, S)
        pontos = 0.0
        for cx in (0.34, 0.50, 0.66):
            d = math.hypot(x - cx * S, y - 0.44 * S)
            pontos = max(pontos, max(0.0, min(1.0, 0.045 * S - d + 0.5)))
        if cb > 0 and pontos > 0:
            col = tuple(int(255 * (1 - pontos) + AZUL[k] * pontos) for k in range(3))
        elif cb > 0:
            col = tuple(int(bg[k] * (1 - cb) + 255 * cb) for k in range(3))
        else:
            col = bg
        row.append((col[0], col[1], col[2], int(255 * cf)))
    rows.append(row)
open('teams-app/color.png', 'wb').write(png(S, S, rows))

S2 = 32
rows = []
for y in range(S2):
    row = []
    for x in range(S2):
        cheio = cobertura(dentro_bolha, x, y, S2)
        interno = cobertura(lambda a, b, s: dentro_bolha((a - 0.5 * s) * 1.16 + 0.5 * s, (b - 0.5 * s) * 1.16 + 0.5 * s, s), x, y, S2)
        borda = max(0.0, cheio - interno)
        row.append((255, 255, 255, int(255 * min(1.0, borda * 1.6))))
    rows.append(row)
open('teams-app/outline.png', 'wb').write(png(S2, S2, rows))
print('ok — teams-app/color.png e outline.png gerados')
