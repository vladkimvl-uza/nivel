# "Фирменный" night grade: blues/violets -> dark neutral / warm, neon desaturated, warm blacks.
import cv2,numpy as np
def bump(H,c,wd):
    d=np.abs(((H-c+180)%360)-180)
    return np.clip(1-(d/wd),0,1)**1.2
def brand(img_u8):
    x=img_u8.astype(np.float32)/255.0
    hsv=cv2.cvtColor(x,cv2.COLOR_BGR2HSV); H,S,V=cv2.split(hsv)
    wb=bump(H,220,55); wp=bump(H,285,45); wg=bump(H,130,50); wy=bump(H,52,22)
    sw=np.clip(S/0.35,0,1)
    S=S*np.clip(1-0.80*wb-0.50*wp-0.60*wg-0.30*wy,0.05,1)*0.88
    V=V*(1-(0.22*wb+0.10*wp+0.12*wy)*sw)
    H=(H+75*wp*sw)%360
    out=cv2.cvtColor(cv2.merge([H,S,V]),cv2.COLOR_HSV2BGR)
    # warm balance (more in shadows/mids), gentle S-curve, warm black floor (#1D1D1B-ish)
    lum=out.mean(2,keepdims=True)
    warm=np.float32([0.93,1.0,1.05])  # B,G,R
    out=out*(warm*(1-lum*0.5)+lum*0.5)
    out=np.clip(out,0,1)
    out=out*out*(3-2*out)*0.35+out*0.65
    floor=np.float32([27,29,29])/255.0*0.55
    out=floor+out*(1-floor)
    return np.clip(out*255,0,255).astype(np.uint8)
