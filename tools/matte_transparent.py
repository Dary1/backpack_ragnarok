#!/usr/bin/env python3
"""
matte_transparent.py -- Background removal for flat/solid-backdrop SD illustrations.

Uses rembg (U2Net) with alpha matting + mask post-processing enabled. Plain
rembg.remove() leaves large soft/uncertain regions (e.g. wispy ice-drip
splash effects) at partial alpha, which shows as a grey 'ghost' smear once
composited onto a real background. alpha_matting cleans up edge quality
(proper antialiasing instead of jagged pixels); post_process_mask removes
the soft-uncertain interior/edge regions via morphological cleanup. Using
BOTH together (this script's default) gave the cleanest result in testing --
alpha_matting alone or post_process_mask alone each fixed only half the
problem. See content/proposals/monsters-002/transparent_test/ for the
comparison grid this was decided from.

Usage:
  python3 tools/matte_transparent.py --in path/in.png --out path/out.png
  python3 tools/matte_transparent.py --in-dir raw/ --out-dir transparent/
"""
import argparse
import glob
import os
from rembg import remove, new_session
from PIL import Image

_session = None

def get_session():
    global _session
    if _session is None:
        _session = new_session('u2net')
    return _session

def matte(path_in, path_out):
    im = Image.open(path_in)
    out = remove(
        im,
        session=get_session(),
        alpha_matting=True,
        alpha_matting_foreground_threshold=250,
        alpha_matting_background_threshold=5,
        alpha_matting_erode_size=5,
        post_process_mask=True,
    )
    out.save(path_out)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp')
    ap.add_argument('--out')
    ap.add_argument('--in-dir')
    ap.add_argument('--out-dir')
    a = ap.parse_args()
    if a.inp:
        matte(a.inp, a.out)
        print(f'OK {a.inp} -> {a.out}')
    else:
        os.makedirs(a.out_dir, exist_ok=True)
        for f in sorted(glob.glob(os.path.join(a.in_dir, '*.png'))):
            name = os.path.basename(f)
            matte(f, os.path.join(a.out_dir, name))
            print('OK', name, flush=True)
        print('ALLDONE', flush=True)

if __name__ == '__main__':
    main()
