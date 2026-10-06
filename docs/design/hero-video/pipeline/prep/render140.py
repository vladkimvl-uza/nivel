import cv2,numpy as np,json,subprocess,sys
from comp import *
from reflhide import refl_hide
A,B=75,150
OUT=sys.argv[1]; test=[int(x) for x in sys.argv[2].split(',')] if len(sys.argv)>2 else None
Hm,(mw,mh),_=tracks_H('trk_140_main.json',9)
R=json.load(open('trk_140_refl_back.json'))
Qr=np.array([R[str(i)]['q'] for i in range(0,201)],np.float64)
# smooth reflection corners
Sr=np.copy(Qr)
for i in range(len(Qr)):
    lo,hi=max(0,i-5),min(len(Qr),i+6); w=np.exp(-0.5*((np.arange(lo,hi)-i)/3.0)**2); Sr[i]=(Qr[lo:hi]*w[:,None,None]).sum(0)/w.sum()
ui=prep_ui('../ui/scr-cfg.png',mw,mh)
T=np.float32([[0,0],[mw,0],[mw,mh],[0,mh]])
lin=lambda x:(np.clip(x,0,255)/255.0)**2.2; enc_=lambda x:255*np.clip(x,0,1)**(1/2.2)
cap=cv2.VideoCapture('src-14098235.mp4')
frames=range(A,B+1) if test is None else test
if test is None:
    enc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','25','-i','-','-c:v','libx264','-preset','medium','-crf','10','-pix_fmt','yuv420p',OUT],stdin=subprocess.PIPE)
gains=[]
for i in frames:
    cap.set(1,i); ok,f=cap.read(); I=f.astype(np.float32)
    H=Hm[i]; orig=rect_from(I,H,mw,mh); scr=screen_look(ui,orig,refl=0.10,ambient=0.08)
    # reflection: linear subtract original screen, add new screen
    Rr=cv2.getPerspectiveTransform(T,np.float32(Sr[i]))
    Po=cv2.warpPerspective(cv2.GaussianBlur(lin(orig),(0,0),2),Rr,(1920,1080)); Pn=cv2.warpPerspective(cv2.GaussianBlur(lin(scr),(0,0),2),Rr,(1920,1080))
    M=cv2.warpPerspective(np.ones((mh,mw),np.float32),Rr,(1920,1080))
    Il=lin(I); hp=lambda x:x-cv2.GaussianBlur(x,(0,0),25)
    sel=(M>0.5)&(cv2.GaussianBlur(Po.sum(2),(0,0),3)>0.08)
    g=np.float32([max(0,float((hp(Po[...,c])[sel]*hp(Il[...,c])[sel]).sum()/((hp(Po[...,c])[sel]**2).sum()+1e-6))) for c in range(3)])
    g=np.clip(g,0,0.35)*1.25; gains.append(g.tolist())
    Mf=cv2.GaussianBlur(M,(0,0),3)[...,None]
    gn=float(np.mean(g))
    J=enc_(np.clip(Il-Mf*g*Po,0,None)+Mf*gn*Pn)
    # residual hide of strong letters/figure
    J2,a=refl_hide(J,orig,Rr,mw,mh,thr=110,dil=14,sig=7,fe=5)
    J=J*(1-0.85*a[...,None])+J2*(0.9*a[...,None])
    # monitor chin logo blur
    logo=map_poly(H,[[0.40*mw,1.004*mh],[0.60*mw,1.004*mh],[0.60*mw,1.07*mh],[0.40*mw,1.07*mh]])
    J=masked_blur(J,poly_mask(J.shape,[logo]),4,dark=0.9,feather=2)
    # wall posters at top edge: blur band above monitor/case
    band=np.zeros(J.shape[:2],np.float32); band[:130]=1.0
    occ=poly_mask(J.shape,[map_poly(H,[[-0.03*mw,-0.03*mh],[1.03*mw,-0.03*mh],[1.03*mw,1.1*mh],[-0.03*mw,1.1*mh]])])
    band=np.clip(band-cv2.dilate(occ,np.ones((9,9),np.uint8)),0,1)
    J=masked_blur(J,band,10,dark=0.85,feather=3)
    J,mk=warp_screen(J,scr,H,mw,mh,expand=0.004)
    J=grain(J,mk,2.0,seed=i)
    o=np.clip(J,0,255).astype(np.uint8)
    if test is None: enc.stdin.write(o.tobytes())
    else: cv2.imwrite(f'test140_{i}.png',o)
if test is None: enc.stdin.close(); enc.wait()
print('gain mean',np.mean(gains,0))
