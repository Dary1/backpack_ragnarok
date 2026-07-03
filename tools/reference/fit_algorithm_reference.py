# Provenance: user-provided reference algorithm, trusted & NORMATIVE (REQ-0020, 2026-07-03).
# Verbatim copy of tmp/fit_algorithm.py -- do not modify; port logic elsewhere, not here.
# v2: rotation tie-break order amended per user directive 2026-07-04 (solve() now
# iterates k=(0,3,1,2) so rot0 > CW90 > CCW90 > 180 on scale ties); v1 in git history.
# -*- coding: utf-8 -*-
"""
画像修正フィットアルゴリズム
  - セル領域(100px正方セル、margin無し)に画像を
    移動 / 回転(90°単位) / 反転 / 縮小 / 拡大 でフィットさせる
  - 隣接セル(空白セル含む)が存在する面には 2px の接触不可 padding
  - 最大スケール(=最低限の縮小%)となる変換を二分探索+畳み込みで求める
"""
import numpy as np
from PIL import Image, ImageDraw
from scipy.signal import fftconvolve

CELL = 100
PAD = 2

# ---------- 1. 許容領域マスクの構築 ----------
def build_region(layout, pad_outside=False):
    """layout: 文字列リスト。'□'=フィットセル, それ以外=空白セル。
    返り値: allowed(bool HxW), cellset"""
    rows = len(layout)
    cols = max(len(r) for r in layout)
    cellset = {(r, c) for r, row in enumerate(layout)
               for c, ch in enumerate(row) if ch == '□'}
    allowed = np.zeros((rows * CELL, cols * CELL), bool)

    def needs_pad(nr, nc):
        # 言葉通りの実装:
        # 隣接セル(フィットセル)が存在しない面 → padding
        # (空白セル・グリッド外を問わず、隣にフィットセルが無ければ対象)
        return (nr, nc) not in cellset

    for r, c in cellset:
        a = np.ones((CELL, CELL), bool)
        if needs_pad(r - 1, c): a[:PAD, :] = False
        if needs_pad(r + 1, c): a[-PAD:, :] = False
        if needs_pad(r, c - 1): a[:, :PAD] = False
        if needs_pad(r, c + 1): a[:, -PAD:] = False
        allowed[r*CELL:(r+1)*CELL, c*CELL:(c+1)*CELL] = a
    return allowed, cellset

# ---------- 2. 画像 → 内容マスク ----------
def load_content(path, border=3):
    g = np.array(Image.open(path).convert('L'))
    g[:border, :] = 255; g[-border:, :] = 255   # スキャン枠ノイズ除去
    g[:, :border] = 255; g[:, -border:] = 255
    m = g < 128
    ys, xs = np.where(m)
    return m[ys.min():ys.max()+1, xs.min():xs.max()+1]

# ---------- 3. スケーリング(安全側=被覆1px以上を内容とみなす) ----------
def scaled(mask, s):
    h, w = mask.shape
    nh, nw = max(1, round(h*s)), max(1, round(w*s))
    im = Image.fromarray((mask*255).astype(np.uint8)).resize((nw, nh), Image.BILINEAR)
    return np.array(im) > 0

# ---------- 4. 配置可能判定(相関=スライディング衝突検査) ----------
def find_placement(allowed, kern):
    kh, kw = kern.shape; H, W = allowed.shape
    if kh > H or kw > W:
        return None
    blocked = (~allowed).astype(np.float32)
    conv = fftconvolve(blocked, kern[::-1, ::-1].astype(np.float32), mode='valid')
    ok = np.argwhere(conv < 0.5)          # 禁止画素との重なりゼロの左上座標
    return tuple(ok[0]) if len(ok) else None

# ---------- 5. 最大スケール探索 ----------
# 注意: セル格子との整列条件により feasible(s) は s について非単調。
#       よって上限から降順スキャンし、最初に見つかった実行可能 s を採用、
#       近傍を細かい刻みで上方向に精密化する。
def max_scale(allowed, content, floor=0.0, coarse=0.002, fine=0.0002):
    H, W = allowed.shape; h, w = content.shape
    s_hi = min(H / h, W / w)
    s = s_hi
    best = None
    while s > max(floor, 0.01):
        p = find_placement(allowed, scaled(content, s))
        if p is not None:
            best = (s, p)
            break
        s -= coarse
    if best is None:
        return None
    # 精密化: 見つかった s の直上を細刻みで再確認
    t = best[0] + fine
    while t < min(best[0] + coarse, s_hi + 1e-9):
        p = find_placement(allowed, scaled(content, t))
        if p is not None:
            best = (t, p)
        t += fine
    return best

# ---------- 6. 8方位(回転4×反転2)の全探索 ----------
def solve(allowed, content):
    best = None
    for flip in (False, True):
        m0 = content[:, ::-1] if flip else content
        for k in (0, 3, 1, 2):            # 反時計回り 90°×k
            m = np.rot90(m0, k)
            floor = best['scale'] if best else 0.0   # 既知の最良より下は探索不要
            r = max_scale(allowed, m, floor=floor)
            if r and (best is None or r[0] > best['scale']):
                best = dict(scale=r[0], rot=k*90, flip=flip, pos=r[1], mask=m)
    return best

# ---------- 6b. 任意角度回転対応の探索 ----------
def rotate_mask(mask, deg):
    """任意角度回転(反時計回り, 安全側=被覆1px以上を内容とみなす)+bbox切詰め"""
    im = Image.fromarray((mask * 255).astype(np.uint8))
    r = np.array(im.rotate(deg, resample=Image.BILINEAR, expand=True)) > 0
    ys, xs = np.where(r)
    return r[ys.min():ys.max()+1, xs.min():xs.max()+1]

def solve_any_angle(allowed, content, coarse_deg=5.0, refine=((4.0, 1.0), (0.75, 0.25))):
    """回転を任意角度に拡張した最適化。
    粗い角度刻みで全周走査 → 最良角の近傍を細刻みで精密化。
    floor(既知最良スケール)による枝刈りで高速化。"""
    best = None

    def attempt(deg, flip, floor):
        m0 = content[:, ::-1] if flip else content
        m = rotate_mask(m0, deg)
        r = max_scale(allowed, m, floor=floor)
        if r:
            return dict(scale=r[0], deg=deg % 360, flip=flip, pos=r[1], mask=m)
        return None

    for flip in (False, True):
        for deg in np.arange(0.0, 360.0, coarse_deg):
            cand = attempt(deg, flip, best['scale'] if best else 0.0)
            if cand and (best is None or cand['scale'] > best['scale']):
                best = cand
    for span, step in refine:
        if best is None:
            break
        center, flip = best['deg'], best['flip']
        for deg in np.arange(center - span, center + span + 1e-9, step):
            cand = attempt(deg, flip, best['scale'])
            if cand and cand['scale'] > best['scale']:
                best = cand
    return best

# ---------- 7. 可視化 ----------
def render(allowed, cellset, best, out):
    H, W = allowed.shape
    img = Image.new('RGB', (W, H), (225, 225, 225))
    d = ImageDraw.Draw(img)
    for r, c in cellset:
        d.rectangle([c*CELL, r*CELL, (c+1)*CELL-1, (r+1)*CELL-1], fill=(255, 255, 255))
    pad_px = np.zeros((H, W), bool)
    for r, c in cellset:
        pad_px[r*CELL:(r+1)*CELL, c*CELL:(c+1)*CELL] = ~allowed[r*CELL:(r+1)*CELL, c*CELL:(c+1)*CELL]
    a = np.array(img); a[pad_px] = (255, 190, 190); img = Image.fromarray(a)
    m = scaled(best['mask'], best['scale'])
    y, x = best['pos']
    a = np.array(img)
    a[y:y+m.shape[0], x:x+m.shape[1]][m] = (20, 20, 20)
    img = Image.fromarray(a)
    d = ImageDraw.Draw(img)
    for r, c in cellset:
        d.rectangle([c*CELL, r*CELL, (c+1)*CELL-1, (r+1)*CELL-1], outline=(120, 160, 220))
    img.save(out)

# ---------- 実行(実証テスト例) ----------
if __name__ == '__main__':
    layout = ['□　　　□',
              '□　□　□',
              '□　□　□',
              '□□□□□']
    allowed, cellset = build_region(layout)
    content = load_content('/mnt/user-data/uploads/X330610_3L1.jpg')
    best = solve(allowed, content)
    if best is None:
        print('フィット不可能')
    else:
        s = best['scale']
        h, w = best['mask'].shape
        print(f"元画像内容サイズ : {content.shape[1]}x{content.shape[0]} px")
        print(f"最適変換 : 回転 {best['rot']}°(反時計回り), 反転 {'あり' if best['flip'] else 'なし'}")
        print(f"最大スケール : {s*100:.2f}%")
        if s < 1:
            print(f"必要な最低限の縮小 : {(1-s)*100:.2f}%")
        else:
            print("縮小不要(拡大でフィット可能)")
        print(f"配置(左上座標) : x={best['pos'][1]}, y={best['pos'][0]}")
        print(f"配置後サイズ : {round(w*s)}x{round(h*s)} px")
        render(allowed, cellset, best, '/home/claude/fit_result.png')
