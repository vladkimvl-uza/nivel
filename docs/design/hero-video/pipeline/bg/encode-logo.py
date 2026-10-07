# Finale logo ("Fit to tolerance", night) for the in-flow brand block above the footer. Round 8 (06.10.2026).
# Replaces encode-logo.sh: the old full-screen frames were scaled down in a clipped box and showed a light rectangle
# with hard edges and an oval "glow" behind the mark.
#  - crop to a band around the lockup: desktop 1280x480 (from 1280x720, y 120..600), phone 540x406 (from 720x1280, y 370..912, x0.75)
#  - lamp light falls on the plate as a cone from above (as in the desk scene); outside the cone the plate goes dark
#  - every edge dissolves into the footer colour #0B0A09 with nothing left over (16-22 % feather), no CSS mask needed
#  - H.264 High, no B-frames, keyframe every 6 frames, +faststart, no audio
# Run: py -3.14 encode-logo.py <framesDir from render-logo.cjs> <outDir>
import sys, os, glob, subprocess, tempfile, shutil
import cv2, numpy as np

F, O = sys.argv[1], sys.argv[2]
os.makedirs(O, exist_ok=True)
BG = np.float32([9, 10, 11])  # BGR of #0B0A09

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

LAY = {
    'd': dict(crop=(0, 120, 1280, 480), size=(1280, 480), apex=(640, -40), hw0=90, slope=1.15, soft=170, fx=0.16),
    'm': dict(crop=(0, 370, 720, 542), size=(540, 406), apex=(266, -30), hw0=40, slope=0.62, soft=90, fx=0.22),
}

def light(L):
    W, H = L['size']
    x = np.arange(W, dtype=np.float32)[None, :]
    y = np.arange(H, dtype=np.float32)[:, None]
    ax, ay = L['apex']
    hw = L['hw0'] + L['slope'] * (y - ay)                  # cone half-width grows downwards
    d = np.abs(x - ax) - hw                                # >0 outside the cone
    cone = 1 - sstep(-L['soft'] * 0.35, L['soft'], d)
    fall = 1 - 0.38 * sstep(0, 1, y / H)                  # the lamp is above: the lower plate gets less light
    lit = 0.22 + 0.78 * cone * fall
    ex = sstep(0, L['fx'], x / W) * sstep(0, L['fx'], 1 - x / W)
    ey = sstep(0, 0.22, y / H) * sstep(0, 0.22, 1 - y / H)
    return lit[..., None].astype(np.float32), (ex * ey)[..., None].astype(np.float32)

def frame(img, L, lit, edge):
    x, y, w, h = L['crop']
    c = img[y:y + h, x:x + w]
    if (w, h) != L['size']:
        c = cv2.resize(c, L['size'], interpolation=cv2.INTER_AREA)
    c = c.astype(np.float32) * lit
    c = BG + (c - BG) * edge
    return np.clip(c + 0.5, 0, 255).astype(np.uint8)

X264 = ['-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-g', '6', '-keyint_min', '6',
        '-sc_threshold', '0', '-bf', '0', '-an', '-movflags', '+faststart']
JOBS = [('d', 'intro', 25, 28), ('d', 'loop', 25, 30), ('m', 'intro', 25, 28), ('m', 'loop', 20, 31)]
for k, mode, fps, crf in JOBS:
    L = LAY[k]; lit, edge = light(L)
    tmp = tempfile.mkdtemp()
    files = sorted(glob.glob(os.path.join(F, f'{k}-{mode}', '*.png')))
    for i, f in enumerate(files):
        cv2.imwrite(os.path.join(tmp, f'{i:04d}.png'), frame(cv2.imread(f), L, lit, edge))
        if mode == 'intro' and i in (0, len(files) - 1):
            cv2.imwrite(os.path.join(O, ('fin0' if i == 0 else 'fin') + f'-{k}.webp'), frame(cv2.imread(f), L, lit, edge), [cv2.IMWRITE_WEBP_QUALITY, 82])
    out = os.path.join(O, f'fin-{mode}-{k}.mp4')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(fps), '-i', os.path.join(tmp, '%04d.png')] + X264 + ['-crf', str(crf), out], check=True)
    shutil.rmtree(tmp)
    print(out, len(files), 'frames', os.path.getsize(out) // 1024, 'KB')
