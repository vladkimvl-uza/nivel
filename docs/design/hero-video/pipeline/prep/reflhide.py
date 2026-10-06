import cv2,numpy as np
def refl_hide(I,rect_orig,R,tw,th,thr=60,dil=14,sig=9,fe=6):
    """Obscure reflected screen content: mask bright/saturated reflected parts, replace with blurred, desaturated local surround."""
    h,w=I.shape[:2]
    b,g,r=cv2.split(rect_orig)
    lum=0.3*r+0.59*g+0.11*b
    src=((lum>thr)|((r+b)/2-g>60)|((b-r>45)&(g>70))).astype(np.float32)
    
    m=cv2.warpPerspective(src,R,(w,h))
    m=cv2.dilate((m>0.3).astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(dil,dil))).astype(np.float32)
    mf=cv2.GaussianBlur(m,(0,0),fe)
    # background estimate: normalized blur of pixels outside mask (inpaint-like), then add blurred residual texture lightly
    keep=1-np.clip(m,0,1)
    num=cv2.GaussianBlur(I*keep[...,None],(0,0),sig*2.5); den=cv2.GaussianBlur(keep,(0,0),sig*2.5)[...,None]
    bg=num/np.maximum(den,1e-3)
    bl=cv2.GaussianBlur(I,(0,0),sig)
    # mix: mostly surround colour, a little of blurred original luminance (keeps glow, no shapes)
    fill=0.75*bg+0.25*bl
    # tame magenta in fill
    gray=fill.mean(2,keepdims=True); fill=gray+(fill-gray)*0.7
    a=np.clip(mf*1.3,0,1)[...,None]
    return I*(1-a)+fill*a, a[...,0]
