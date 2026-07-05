#!/usr/bin/env python3
"""
matte_transparent.py -- Background removal for flat/solid-backdrop SD illustrations.

Segmentation model: isnet-anime (not the rembg default, u2net). u2net is
trained on general photo/human segmentation and was silently deleting real
character geometry on our cel-shaded illustrations -- e.g. it cut away most
of the frost golem's actual foot/toe shapes and thin ice-shard linework,
not just background. isnet-anime (purpose-trained on anime/illustration
art) preserved that geometry correctly in a side-by-side test. birefnet-general
(a heavier general-purpose matting model) was comparable in quality but
~8x slower on CPU (130s vs 15s per image) with no clear edge-quality win
for this art style, so isnet-anime is the better fit for a 50-monster batch.
See content/proposals/monsters-002/model_test/ for the comparison images.

alpha_matting + post_process_mask are still both enabled on top of that,
per the earlier fix: alpha_matting keeps edges smoothly antialiased,
post_process_mask removes soft/uncertain "ghost" regions (e.g. wispy
ice-drip splash effects) that plain remove() leaves at partial alpha.

Note: switching the SD *generation* checkpoint (DreamShaper_8, vanilla
SD1.5) to get a cleaner background at generation time was also tried and
did not help -- see git log for that test. Both alternate checkpoints
still bled the requested background color into the character itself (or,
for vanilla SD1.5, ignored the flat-background instruction and rendered a
full scene instead). Background separation is handled at the segmentation
step, not via generation prompting.

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
        _session = new_session('isnet-anime')
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
