# Compositing helpers: screen replacement, masked blur of posters, logo blur.
import cv2,numpy as np,json
from smooth import load,smooth
def tracks_H(fn,win=9,fallback=None):
    """returns per-frame homography template->frame (smoothed corners) and template size"""
    d,Q=load(fn)
    if fallback is not None:
        d2,Q2=load(fallback)
        # convert fallback quads (KLT quads in same corner convention) where missing
        miss=np.isnan(Q[:,0,0])&~np.isnan(Q2[:,0,0]); Q[miss]=Q2[miss]
    S=smooth(Q,win)
    tw,th=d.get('tw',1),d.get('th',1)
    T=np.float32([[0,0],[tw,0],[tw,th],[0,th]])
    Hs={}
    for i in range(len(S)):
        if not np.isnan(S[i,0,0]): Hs[i]=cv2.getPerspectiveTransform(T,np.float32(S[i]))
    return Hs,(tw,th),d
def prep_ui(path,tw,th,bez=0.006):
    ui=cv2.imread(path).astype(np.float32)
    ui=cv2.resize(ui,(tw,th),interpolation=cv2.INTER_AREA)
    return ui
def screen_look(ui,orig_rect,black=(10,10,12),white=0.94,refl=0.10,ambient=0.12,seed=0):
    """ui, orig_rect: float32 BGR in template space. returns emitted-looking screen."""
    th,tw=ui.shape[:2]
    b=np.float32(black)
    out=b+ui*(white)  # map UI range -> screen range
    # ambient / reflection of room: very blurred original screen luminance-coloured glow (no detail)
    amb=cv2.GaussianBlur(orig_rect,(0,0),tw/12)
    out=out*(1-ambient)+ (out*0.0+amb*0.35)*ambient + amb*0.04
    # glossy sheen: diagonal soft gradient
    yy,xx=np.mgrid[0:th,0:tw].astype(np.float32)
    g=np.clip(1.0-((xx/tw)*0.7+(yy/th)*0.9),0,1)**2
    out=out+g[...,None]*refl*np.float32([22,26,34])
    # bloom of bright UI parts
    br=np.clip(ui-150,0,None)
    out=out+cv2.GaussianBlur(br,(0,0),tw/180)*0.18
    return out
def warp_screen(frame,scr,H,tw,th,expand=0.004,blur_px=None):
    """warp template-space screen into frame with soft 1px edge, expanded slightly to cover original."""
    h,w=frame.shape[:2]
    # pad template by expand so the original edge pixels are covered (filled with bezel black)
    px=int(round(expand*tw)); py=int(round(expand*th))
    pad=cv2.copyMakeBorder(scr,py,py,px,px,cv2.BORDER_CONSTANT,value=(8,8,9))
    Sh=np.array([[1,0,-px],[0,1,-py],[0,0,1.0]])
    Hp=H@Sh
    # anti-alias: pre-blur according to scale (template px per frame px)
    sc=np.sqrt(abs(np.linalg.det(H[:2,:2]/H[2,2])))
    sig=max(0.0,0.5/max(sc,1e-3)-0.0) if blur_px is None else blur_px
    src=cv2.GaussianBlur(pad,(0,0),sig) if sig>0.3 else pad
    img=cv2.warpPerspective(src,Hp,(w,h),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
    m=np.ones(pad.shape[:2],np.float32)
    msk=cv2.warpPerspective(m,Hp,(w,h),flags=cv2.INTER_LINEAR)
    msk=cv2.GaussianBlur(msk,(0,0),0.6)[...,None]
    return frame*(1-msk)+img*msk, msk
def rect_from(frame,H,tw,th):
    return cv2.warpPerspective(frame,np.linalg.inv(H),(tw,th),flags=cv2.INTER_LINEAR)
def poly_mask(shape,polys,val=1.0):
    m=np.zeros(shape[:2],np.float32)
    for p in polys: cv2.fillPoly(m,[np.int32(np.round(p))],val)
    return m
def masked_blur(frame,mask,sigma,dark=0.85,feather=2.0):
    m=mask[...,None]
    num=cv2.GaussianBlur(frame*m,(0,0),sigma); den=cv2.GaussianBlur(m,(0,0),sigma)[...,None] if False else cv2.GaussianBlur(mask,(0,0),sigma)[...,None]
    B=num/np.maximum(den,1e-3)*dark
    mf=cv2.GaussianBlur(mask,(0,0),feather)[...,None]*m  # stay inside
    mf=np.maximum(mf,0)
    return frame*(1-mf)+B*mf
def map_poly(H,pts):
    return cv2.perspectiveTransform(np.float32(pts).reshape(-1,1,2),H).reshape(-1,2)
def grain(img,mask,sigma=2.2,seed=0):
    rng=np.random.default_rng(seed)
    n=rng.normal(0,sigma,img.shape[:2]).astype(np.float32)[...,None]
    return img+n*mask
