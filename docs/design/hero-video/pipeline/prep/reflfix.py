import cv2,numpy as np
def hp(x,s=8): return x-cv2.GaussianBlur(x,(0,0),s)
def refl_replace(I,rect_orig,scr_new,R,tw,th,blur=1.5,sig=14,gmax=1.3):
    h,w=I.shape[:2]
    Po=cv2.warpPerspective(cv2.GaussianBlur(rect_orig,(0,0),blur),R,(w,h))
    Pn=cv2.warpPerspective(cv2.GaussianBlur(scr_new,(0,0),blur),R,(w,h))
    M=cv2.warpPerspective(np.ones((th,tw),np.float32),R,(w,h))
    hi=hp(I).sum(2); hpo=hp(Po).sum(2)
    num=cv2.GaussianBlur(hi*hpo,(0,0),sig); den=cv2.GaussianBlur(hpo*hpo,(0,0),sig)
    g=np.clip(num/(den+400.0),0,gmax)*M
    g=cv2.GaussianBlur(g,(0,0),4)[...,None]
    out=I-g*Po+g*Pn
    return out,g[...,0]
