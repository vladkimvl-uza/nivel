# 14203522, frames 205-393: new clean screens (no site header), dim left screen, light spill on stand/desk, grain.
import sys,os
WORK=r'C:/Users/v.kim/AppData/Local/Temp/claude/C--Users-v-kim/29922206-569a-4b39-90a7-6ac35168e528/scratchpad/hero-media/owner/work'
W2=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,WORK); os.chdir(WORK)
import cv2,numpy as np,subprocess
from comp import *
A,B=205,393
OUT=sys.argv[1]
test=[int(x) for x in sys.argv[2].split(',')] if len(sys.argv)>2 else None
Hm,(mw,mh),_=tracks_H('trk_142_main.json',9)
Hl,(lw,lh),_=tracks_H('trk_142_left3.json',11)
dK,QK=load('trk_142_left4.json'); SK=smooth(QK,11)
TL=np.float32([[0,0],[lw,0],[lw,lh],[0,lh]])
Hw,(ww,wh),dw=tracks_H('trk_142_wall.json',15)
Tw=np.float32([[0,0],[ww,0],[ww,wh],[0,wh]]); Hr_w=cv2.getPerspectiveTransform(np.float32(dw['refquad']),Tw)
posters=[[[122,28],[480,52],[480,595],[125,605]],[[618,93],[896,126],[896,570],[620,570]],[[1000,135],[1218,150],[1218,466],[1002,460]]]
ui_main=prep_ui(W2+'/ui-main.png',mw,mh); ui_left=prep_ui(W2+'/ui-left.png',lw,lh)
cap=cv2.VideoCapture('src-14203522.mp4')
frames=range(A,B+1) if test is None else test
if test is None:
    enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','25','-i','-','-c:v','libx264','-preset','medium','-crf','10','-pix_fmt','yuv420p',OUT],stdin=subprocess.PIPE)
def spill(emit,mask):
    # light from the screen onto stand, desk and wall: wide soft glow, pushed downwards, only outside the screens
    e=cv2.resize(emit,(480,270),interpolation=cv2.INTER_AREA)
    g1=cv2.GaussianBlur(e,(0,0),9); g2=cv2.GaussianBlur(e,(0,0),30)
    M=np.float32([[1,0,0],[0,1,7]]); g1=cv2.warpAffine(g1,M,(480,270))
    g=cv2.resize(g1*0.55+g2*0.45,(1920,1080),interpolation=cv2.INTER_LINEAR)
    return g*(1-mask)
for i in frames:
    cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read(); fr=f.astype(np.float32)
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
    logo=map_poly(Hmi,[[0.40*mw,1.003*mh],[0.60*mw,1.003*mh],[0.60*mw,1.075*mh],[0.40*mw,1.075*mh]])
    fr=masked_blur(fr,poly_mask(fr.shape,[logo]),4,dark=0.9,feather=2)
    llogo=map_poly(HL,[[0.40*lw,1.004*lh],[0.66*lw,1.004*lh],[0.66*lw,1.06*lh],[0.40*lw,1.06*lh]])
    fr=masked_blur(fr,poly_mask(fr.shape,[llogo]),4,dark=0.9,feather=2)
    z=np.zeros_like(fr)
    orig=rect_from(f.astype(np.float32),HL,lw,lh)
    scrL=screen_look(ui_left,orig,white=0.62,refl=0.12,ambient=0.14)   # left screen sits under the site headline: dimmer
    fr,mk=warp_screen(fr,scrL,HL,lw,lh,expand=0.006); eL,_=warp_screen(z,scrL,HL,lw,lh,expand=0.006)
    orig=rect_from(f.astype(np.float32),Hmi,mw,mh)
    scrM=screen_look(ui_main,orig,black=(7,7,8),white=1.0,refl=0.09,ambient=0.05)
    fr,mk2=warp_screen(fr,scrM,Hmi,mw,mh,expand=0.004); eM,_=warp_screen(z,scrM,Hmi,mw,mh,expand=0.004)
    ms=np.maximum(mk,mk2)
    # screen glow: slight bloom inside + spill outside
    fr=fr+spill(eM+eL*0.7,ms)*0.55*np.float32([0.92,0.98,1.06])
    fr=fr+cv2.GaussianBlur(np.clip(eM-120,0,None),(0,0),2.2)*0.22*ms
    fr=grain(fr,ms,2.4,seed=i)
    o=np.clip(fr,0,255).astype(np.uint8)
    if test is None: enc.stdin.write(o.tobytes())
    else: cv2.imwrite(W2+f'/t142_{i}.png',o)
if test is None: enc.stdin.close(); enc.wait()
