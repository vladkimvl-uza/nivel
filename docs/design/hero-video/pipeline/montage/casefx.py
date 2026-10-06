# 13075121 for step "03 Тест": mirror (case to the right of the copy), level horizon, crop in, lamp vignette over wall/plant.
# brand variant: rainbow fans -> warm white/amber at ~35 % saturation, yellow wall muted.
import sys,cv2,numpy as np
sys.path.insert(0,r'C:/Users/v.kim/AppData/Local/Temp/claude/C--Users-v-kim/29922206-569a-4b39-90a7-6ac35168e528/scratchpad/hero-media/owner/work')
from grade import brand
ROT=3.2; Z=1.32; CX,CY=1045,560; PX,PY=0.66,0.52
def geom(fr):
    fr=cv2.flip(fr,1)
    W,H=1920,1080; ww,wh=W/Z,H/Z
    x0=CX-PX*ww; y0=CY-PY*wh
    # affine: rotate about case centre, then crop window -> output
    R=cv2.getRotationMatrix2D((CX,CY),ROT,1.0); R=np.vstack([R,[0,0,1]])
    S=np.float32([[Z,0,-x0*Z],[0,Z,-y0*Z],[0,0,1]])
    M=(S@R)[:2]
    return cv2.warpAffine(fr,M,(W,H),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REFLECT)
_m=None
def vig():
    global _m
    if _m is None:
        yy,xx=np.mgrid[0:1080,0:1920].astype(np.float32)
        d=np.sqrt(((xx-0.64*1920)/(0.50*1920))**2+((yy-0.52*1080)/(0.62*1080))**2)
        pool=np.clip(1.15-d,0,1)**1.1
        right=np.clip((xx/1920-0.86)/0.14,0,1)        # plant at the right edge
        left=np.clip((0.30-xx/1920)/0.30,0,1)          # yellow wall (mirrored to the left)
        m=(0.10+0.90*pool)*(1-0.75*right)*(1-0.72*left)
        _m=m[...,None]
    return _m
def night(fr):
    x=(fr.astype(np.float32)/255)**2.2
    x=x*0.78*vig()
    return (np.clip(x,0,1)**(1/2.2)*255).astype(np.uint8)
def tame(img_u8):
    x=img_u8.astype(np.float32)/255.0
    hsv=cv2.cvtColor(x,cv2.COLOR_BGR2HSV); H,S,V=cv2.split(hsv)
    d=np.abs(((H-28+180)%360)-180)                    # distance from amber
    off=np.clip((d-14)/30,0,1)                         # 0 = already warm
    w=np.clip((S-0.12)/0.25,0,1)*off
    H=np.where(w>0,28+0*H,H)*w+H*(1-w)
    S=S*(1-w*0.66)
    yel=np.clip(1-np.abs(H-52)/18,0,1)*np.clip((S-0.3)/0.3,0,1)
    S=S*(1-0.5*yel); V=V*(1-0.35*yel)
    V=V*(1-0.18*w*np.clip((V-0.6)/0.4,0,1))            # neon highlights a bit lower
    return (np.clip(cv2.cvtColor(cv2.merge([H,S,V]),cv2.COLOR_HSV2BGR),0,1)*255).astype(np.uint8)
def both(fr):
    o=night(geom(fr))
    return o,brand(tame(o))
if __name__=='__main__':
    im=cv2.imread(sys.argv[1]); o,b=both(im)
    cv2.imwrite(sys.argv[2]+'-orig.jpg',cv2.resize(o,(960,540))); cv2.imwrite(sys.argv[2]+'-brand.jpg',cv2.resize(b,(960,540)))
