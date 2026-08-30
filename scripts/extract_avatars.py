#!/usr/bin/env python3
"""Wycina pojedyncze pozy maskotki eMMy z arkuszy 3x3 i usuwa tlo szachownicy.

Wejscie : assets/source/sheet-0*.png  (siatka 3x3, tlo = szachownica przezroczystosci)
Wyjscie : public/avatars/pose-<sheet>-r<r>c<c>.png        (RGBA 512 px, przycieta, wysrodkowana)
          public/avatars/small/pose-<sheet>-r<r>c<c>.png  (RGBA 192 px, ~9 kB - uzywane przez widget)

Algorytm:
  1. wykrycie czarnych linii siatki -> podzial na 9 komorek (kafelki ze znakiem
     wodnym modelu sa pomijane - patrz WATERMARKED),
  2. flood fill od krawedzi po pikselach "szachownicowych" (neutralny szary/bialy),
  3. domkniecie dziur, wybor najwiekszej spojnej bryly (odrzuca iskierki i smieci),
     lekka erozja + rozmycie kanalu alfa (gladka krawedz),
  4. dekontaminacja koloru na krawedzi (usuwa szara obwodke),
  5. przyciecie do bbox i wysrodkowanie na kwadratowym plotnie.
"""
from __future__ import annotations

import json
import pathlib
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "source"
OUT = ROOT / "public" / "avatars"
SMALL_OUT = OUT / "small"

# Prawy dolny kafelek kazdego arkusza nosi widoczny znak wodny modelu generujacego
# (bialy, czteroramienny blysk na brzuchu maskotki). Takich poz nie publikujemy.
WATERMARKED = {('01', 3, 3), ('02', 3, 3), ('03', 3, 3), ('04', 3, 3), ('05', 3, 3)}

# Arkusze 04 i 05 przyszly od klienta tylko jako JPEG 384x512 - mniejsze i bledsze
# barwnie od pozostalych (kompresja zjada nasycenie i kontrast). Bez wyrownania
# maskotka z tych arkuszy wyglada jak inna, wyblakla pluszowa zabawka obok reszty.
# Wyrownujemy srednia i odchylenie kanalow do arkuszy wzorcowych - tylko na pikselach
# postaci, zeby nie ruszyc szachownicy, po ktorej idzie wycinanie tla.
COLOR_MATCH = {'04', '05'}
COLOR_REFERENCE = ('01', '02', '03')

CANVAS = 512          # docelowy bok kwadratu (wersja pelna)
SMALL = 192           # wersja dla widgetu (lekka, kwantyzowana)
MARGIN = 0.06         # margines wokol postaci
NEUTRAL_TOL = 20      # max roznica kanalow, zeby uznac piksel za neutralny
WHITE_MIN = 232       # jasne pole szachownicy
GRAY_LO, GRAY_HI = 170, 220   # ciemne pole szachownicy


def find_grid(gray: np.ndarray, axis: int) -> list[tuple[int, int]]:
    """Zwraca zakresy (start, end) komorek wzdluz osi, dzielac po ciemnych liniach."""
    profile = gray.mean(axis=1 - axis)
    dark = [i for i, v in enumerate(profile) if v < 110]
    bands, cur = [], []
    for i in dark:
        if cur and i == cur[-1] + 1:
            cur.append(i)
        else:
            if cur:
                bands.append((cur[0], cur[-1]))
            cur = [i]
    if cur:
        bands.append((cur[0], cur[-1]))
    # Linia siatki jest cienka w proporcji do arkusza: w arkuszu 896 px ma 3-4 px,
    # w arkuszu 384 px juz tylko 2. Staly prog gubil cala siatke mniejszego arkusza
    # i zwracal jedna komorke zamiast dziewieciu. Luzniejszy prog wchodzi dopiero
    # wtedy, gdy ostrzejszy nie znalazl podzialu - duze arkusze tna sie jak dotad.
    strict = [b for b in bands if b[1] - b[0] >= 2]
    bands = strict if len(strict) >= 2 else [b for b in bands if b[1] - b[0] >= 1]

    cells, start = [], 0
    for lo, hi in bands:
        if lo - start > 20:
            cells.append((start, lo))
        start = hi + 1
    if profile.shape[0] - start > 20:
        cells.append((start, profile.shape[0]))
    return cells


def checker_mask(rgb: np.ndarray) -> np.ndarray:
    """True tam, gdzie piksel wyglada jak pole szachownicy."""
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    v = rgb.mean(axis=2)
    neutral = (mx - mn) <= NEUTRAL_TOL
    return neutral & ((v >= WHITE_MIN) | ((v >= GRAY_LO) & (v <= GRAY_HI)))


def flood_background(candidate: np.ndarray) -> np.ndarray:
    """Flood fill od krawedzi -> maska tla (tylko tlo polaczone z brzegiem)."""
    h, w = candidate.shape
    bg = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if candidate[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if candidate[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                q.append((ny, nx))
    return bg


def fill_holes(fg: np.ndarray) -> np.ndarray:
    """Zamyka male dziury w masce postaci (np. przeswity w futrze)."""
    outside = flood_background(~fg)
    return ~outside


def largest_component(fg: np.ndarray) -> np.ndarray:
    """Zostawia tylko najwieksza spojna bryle - usuwa okruchy tla, iskierki i smieci przy krawedzi."""
    h, w = fg.shape
    label = np.zeros((h, w), dtype=np.int32)
    best_id, best_size = 0, 0
    current = 0
    for sy in range(h):
        for sx in range(w):
            if not fg[sy, sx] or label[sy, sx]:
                continue
            current += 1
            size = 0
            q = deque([(sy, sx)])
            label[sy, sx] = current
            while q:
                y, x = q.popleft()
                size += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not label[ny, nx]:
                        label[ny, nx] = current
                        q.append((ny, nx))
            if size > best_size:
                best_id, best_size = current, size
    return label == best_id


def decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Usuwa szara obwodke: rozplata kolor krawedzi z kolorem tla."""
    core = alpha > 0.92
    if not core.any():
        return rgb
    blurred = np.asarray(
        Image.fromarray(np.where(core[..., None], rgb, 0).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(4)
        )
    ).astype(float)
    weight = np.asarray(
        Image.fromarray((core * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))
    ).astype(float) / 255.0
    weight = np.maximum(weight, 1e-3)
    inner = blurred / weight[..., None]

    edge = (alpha > 0.02) & (alpha < 0.92)
    out = rgb.copy()
    out[edge] = inner[edge]
    return np.clip(out, 0, 255)


def cut_cell(cell: np.ndarray) -> Image.Image | None:
    rgb = cell.astype(float)
    bg = flood_background(checker_mask(rgb))
    fg = largest_component(fill_holes(~bg))
    if fg.sum() < 500:
        return None

    alpha = np.asarray(
        Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1))
    ).astype(float) / 255.0
    # lekka erozja progiem -> zdejmuje halo po szachownicy
    alpha = np.clip((alpha - 0.42) / 0.42, 0.0, 1.0)

    rgb = decontaminate(rgb, alpha)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)

    ys, xs = np.nonzero(alpha > 0.25)
    if not len(ys):
        return None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    cropped = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")

    inner = int(CANVAS * (1 - 2 * MARGIN))
    scale = min(inner / cropped.width, inner / cropped.height)
    cropped = cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.LANCZOS,
    )
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(cropped, ((CANVAS - cropped.width) // 2, (CANVAS - cropped.height) // 2))
    return canvas


def figure_mask(rgb: np.ndarray) -> np.ndarray:
    """True na pikselach postaci: wszystko poza szachownica i czarna siatka."""
    return ~(checker_mask(rgb) | (rgb.mean(axis=2) < 110))


def reference_stats() -> tuple[np.ndarray, np.ndarray]:
    """Srednia i odchylenie kanalow RGB na pikselach postaci w arkuszach wzorcowych."""
    samples = []
    for sheet_id in COLOR_REFERENCE:
        path = SRC / f"sheet-{sheet_id}.png"
        if not path.exists():
            continue
        rgb = np.asarray(Image.open(path).convert("RGB")).astype(float)
        samples.append(rgb[figure_mask(rgb)])
    if not samples:
        return None, None
    pool = np.concatenate(samples)
    return pool.mean(axis=0), pool.std(axis=0)


def match_colors(rgb: np.ndarray, ref_mean, ref_std) -> np.ndarray:
    """Przenosi statystyki koloru wzorca na postac, nie ruszajac tla."""
    if ref_mean is None:
        return rgb
    mask = figure_mask(rgb)
    if not mask.any():
        return rgb
    mean, std = rgb[mask].mean(axis=0), rgb[mask].std(axis=0)
    out = rgb.copy()
    out[mask] = (rgb[mask] - mean) / np.maximum(std, 1e-6) * ref_std + ref_mean
    return np.clip(out, 0, 255)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    SMALL_OUT.mkdir(parents=True, exist_ok=True)
    report = []
    ref_mean, ref_std = reference_stats()
    for sheet_path in sorted(SRC.glob("sheet-*.png")):
        sheet_id = sheet_path.stem.split("-")[1]
        img = np.asarray(Image.open(sheet_path).convert("RGB")).astype(float)
        if sheet_id in COLOR_MATCH:
            img = match_colors(img, ref_mean, ref_std)
            print(f"{sheet_path.name}: wyrownanie koloru do arkuszy {'/'.join(COLOR_REFERENCE)}")
        img = img.astype(int)
        gray = img.mean(axis=2)
        rows = find_grid(gray, axis=0)
        cols = find_grid(gray, axis=1)
        print(f"{sheet_path.name}: {len(rows)}x{len(cols)} komorek")

        for r, (ry0, ry1) in enumerate(rows, start=1):
            for c, (cx0, cx1) in enumerate(cols, start=1):
                if (sheet_id, r, c) in WATERMARKED:
                    print(f'  pominieto r{r}c{c} (widoczny znak wodny modelu)')
                    continue
                pose = cut_cell(img[ry0:ry1, cx0:cx1])
                if pose is None:
                    print(f"  pominieto r{r}c{c} (pusta komorka)")
                    continue
                name = f"pose-{sheet_id}-r{r}c{c}.png"
                pose.save(OUT / name, optimize=True)
                small = pose.resize((SMALL, SMALL), Image.LANCZOS).quantize(
                    colors=192, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG
                )
                small.save(SMALL_OUT / name, optimize=True)
                coverage = (np.asarray(pose)[..., 3] > 25).mean()
                report.append({"file": name, "sheet": sheet_id, "row": r, "col": c,
                               "coverage": round(float(coverage), 4)})
                print(f"  {name}  pokrycie={coverage:.1%}")

    (OUT / "_extraction-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"\nGotowe: {len(report)} poz w {OUT}")


if __name__ == "__main__":
    main()
