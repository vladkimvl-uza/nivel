import cv2,numpy as np,subprocess
from comp import masked_blur,poly_mask,map_poly
from smooth import load,smooth
specs=[('trk_130_front.json',[[[1172,355],[1206,355],[1206,455],[1172,455]],[[1170,762],[1202,762],[1202,852],[1170,852]]]),
       ('trk_130_shroud.json',[[[605,878],[745,878],[745,925],[605,925]]])]
tr=[(smooth(load(fn)[1],7),p) for fn,p in specs]; ref=200
cap=cv2.VideoCapture('src-13075121.mp4'); N=int(cap.get(7))
enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','30','-i','-','-c:v','libx264','-preset','medium','-crf','10','-pix_fmt','yuv420p','clean-13075121.mp4'],stdin=subprocess.PIPE)
for i in range(N):
    ok,f=cap.read()
    if not ok: break
    fr=f.astype(np.float32); polys=[]
    for S,ps in tr:
        H=cv2.getPerspectiveTransform(np.float32(S[ref]),np.float32(S[i]))
        polys+=[map_poly(H,p) for p in ps]
    m=cv2.dilate(poly_mask(fr.shape,polys),np.ones((7,7),np.uint8))
    fr=masked_blur(fr,m,5,dark=0.92,feather=2.5)
    enc.stdin.write(np.clip(fr,0,255).astype(np.uint8).tobytes())
enc.stdin.close(); enc.wait()
