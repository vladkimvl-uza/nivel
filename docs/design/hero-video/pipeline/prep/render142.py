import cv2,numpy as np,json,subprocess,sys
from comp import *
A,B=205,393
OUT=sys.argv[1] if len(sys.argv)>1 else 'clean-14203522.mp4'
test=[int(x) for x in sys.argv[2].split(',')] if len(sys.argv)>2 else None
Hm,(mw,mh),_=tracks_H('trk_142_main.json',9)
Hl,(lw,lh),_=tracks_H('trk_142_left3.json',11)
# KLT fallback for left monitor (same corner order, template 800x900)
dK,QK=load('trk_142_left4.json'); SK=smooth(QK,11)
TL=np.float32([[0,0],[lw,0],[lw,lh],[0,lh]])
Hw,(ww,wh),dw=tracks_H('trk_142_wall.json',15)
Tw=np.float32([[0,0],[ww,0],[ww,wh],[0,wh]]); Hr_w=cv2.getPerspectiveTransform(np.float32(dw['refquad']),Tw)
posters=[[[122,28],[480,52],[480,595],[125,605]],[[618,93],[896,126],[896,570],[620,570]],[[1000,135],[1218,150],[1218,466],[1002,460]]]
ui_main=prep_ui('../ui/scr-cfg.png',mw,mh); ui_left=prep_ui('../ui/scr-left.png',lw,lh)
cap=cv2.VideoCapture('src-14203522.mp4')
frames=range(A,B+1) if test is None else test
if test is None:
    enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','25','-i','-','-c:v','libx264','-preset','medium','-crf','10','-pix_fmt','yuv420p',OUT],stdin=subprocess.PIPE)
for i in frames:
    cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read(); fr=f.astype(np.float32)
    # 1. posters blur (minus occluders)
    Hwall=Hw[i]@Hr_w
    P=[map_poly(Hwall,p) for p in posters]
    m=poly_mask(fr.shape,P)
    Hmi=Hm[i]
    body=map_poly(Hmi,[[-0.025*mw,-0.03*mh],[1.025*mw,-0.03*mh],[1.025*mw,1.13*mh],[-0.025*mw,1.13*mh]])
    lbar=map_poly(Hmi,[[0.11*mw,-0.085*mh],[0.82*mw,-0.085*mh],[0.82*mw,0],[0.11*mw,0]])
    HL=Hl.get(i)
    if HL is None: HL=cv2.getPerspectiveTransform(TL,np.float32(SK[i]))
    lbody=map_poly(HL,[[-0.05*lw,-0.04*lh],[1.05*lw,-0.04*lh],[1.05*lw,1.06*lh],[-0.05*lw,1.06*lh]])
    occ=poly_mask(fr.shape,[body,lbar,lbody]); occ=cv2.dilate(occ,np.ones((5,5),np.uint8))
    m=np.clip(m-occ,0,1)
    fr=masked_blur(fr,m,11,dark=0.82,feather=1.5)
    # 2. logo on main monitor chin (MSI) -> soft blur
    logo=map_poly(Hmi,[[0.40*mw,1.003*mh],[0.60*mw,1.003*mh],[0.60*mw,1.075*mh],[0.40*mw,1.075*mh]])
    fr=masked_blur(fr,poly_mask(fr.shape,[logo]),4,dark=0.9,feather=2)
    llogo=map_poly(HL,[[0.40*lw,1.004*lh],[0.66*lw,1.004*lh],[0.66*lw,1.06*lh],[0.40*lw,1.06*lh]])
    fr=masked_blur(fr,poly_mask(fr.shape,[llogo]),4,dark=0.9,feather=2)
    # 3. left monitor replacement
    orig=rect_from(f.astype(np.float32),HL,lw,lh)
    scr=screen_look(ui_left,orig,refl=0.12,ambient=0.10)
    fr,mk=warp_screen(fr,scr,HL,lw,lh,expand=0.006)
    # 4. main monitor replacement
    orig=rect_from(f.astype(np.float32),Hmi,mw,mh)
    scr=screen_look(ui_main,orig,refl=0.10,ambient=0.08)
    fr,mk2=warp_screen(fr,scr,Hmi,mw,mh,expand=0.004)
    fr=grain(fr,np.maximum(mk,mk2),2.0,seed=i)
    o=np.clip(fr,0,255).astype(np.uint8)
    if test is None: enc.stdin.write(o.tobytes())
    else: cv2.imwrite(f'test142_{i}.png',o)
if test is None: enc.stdin.close(); enc.wait()
