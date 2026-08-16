#!/usr/bin/env python3
# Ícones do PWA do SP Connect (public/connect-icon-192.png e -512.png) — o
# MESMO desenho do app do Teams (quadrado azul SP + balão com três pontos),
# gerado sem lib de imagem (o container não tem PIL). O desenho tem margem
# folgada, então serve como "maskable" também (safe zone de 80%).
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


SS = 4


def dentro_rrect(x, y, cx0, cy0, cx1, cy1, r):
    if x < cx0 or x > cx1 or y < cy0 or y > cy1:
        return False
    dx = max(cx0 + r - x, 0, x - (cx1 - r))
    dy = max(cy0 + r - y, 0, y - (cy1 - r))
    return dx * dx + dy * dy <= r * r


def dentro_bolha(x, y, s):
    corpo = dentro_rrect(x, y, 0.20 * s, 0.24 * s, 0.80 * s, 0.66 * s, 0.10 * s)
    rab = (0.30 * s <= x <= 0.46 * s) and (0.64 * s <= y <= 0.80 * s) and (y - 0.64 * s) <= (0.46 * s - x)
    return corpo or rab


def cobertura(fn, px, py, s):
    hits = 0
    for i in range(SS):
        for j in range(SS):
            if fn(px + (i + 0.5) / SS, py + (j + 0.5) / SS, s):
                hits += 1
    return hits / (SS * SS)


AZUL = (14, 59, 250)
ESCURO = (9, 29, 141)


def gerar(tamanho, caminho):
    # PWA: fundo OPACO cobrindo o quadro inteiro (maskable corta em círculo).
    rows = []
    for y in range(tamanho):
        row = []
        for x in range(tamanho):
            t = y / tamanho
            bg = tuple(int(AZUL[k] * (1 - t) + ESCURO[k] * t) for k in range(3))
            cb = cobertura(dentro_bolha, x, y, tamanho)
            pontos = 0.0
            for cx in (0.36, 0.50, 0.64):
                d = math.hypot(x - cx * tamanho, y - 0.44 * tamanho)
                pontos = max(pontos, max(0.0, min(1.0, 0.040 * tamanho - d + 0.5)))
            if cb > 0 and pontos > 0:
                col = tuple(int(255 * (1 - pontos) + AZUL[k] * pontos) for k in range(3))
            elif cb > 0:
                col = tuple(int(bg[k] * (1 - cb) + 255 * cb) for k in range(3))
            else:
                col = bg
            row.append((col[0], col[1], col[2], 255))
        rows.append(row)
    open(caminho, 'wb').write(png(tamanho, tamanho, rows))


gerar(192, 'public/connect-icon-192.png')
gerar(512, 'public/connect-icon-512.png')
print('ok — public/connect-icon-192.png e -512.png gerados')
