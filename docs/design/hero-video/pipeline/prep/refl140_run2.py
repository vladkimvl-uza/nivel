import cv2,numpy as np,json,sys
import nccalign as N
from nccalign import *
main=json.load(open('trk_140_main.json'))['frames']
cap=cv2.VideoCapture('src-14098235.mp4')
a,b=int(sys.argv[1]),int(sys.argv[2]); out=sys.argv[3]
q0=np.float32([[1505.5,206.5],[1105.5,247.0],[1116.0,613.0],[1492.5,564.0]]); ref=200
res={}
step=1 if b>a else -1
q=q0.copy(); prev=None
for i in range(ref,b+step,step) if True else []:
    cap.set(1,i); ok,f=cap.read()
    if not ok: break
    H=np.array(main[str(i)]['H']); rect=cv2.warpPerspective(f,np.linalg.inv(H),(tw,th))
    tm=prep_tmpl(rect); img=prep_frame(f); wm=(cv2.GaussianBlur(tm,(0,0),6)>25).astype(np.float32)
    qp=q if prev is None else q+(q-prev)
    x0,y0=(qp.min(0)*SC-60).astype(int); x1,y1=(qp.max(0)*SC+60).astype(int)
    x0,y0=max(0,x0),max(0,y0); x1,y1=min(img.shape[1],x1),min(img.shape[0],y1)
    N.CROP[0],N.CROP[1]=x0,y0
    q2,s=refine(qp,tm,img[y0:y1,x0:x1],wm,steps=(4,2,1,0.5),iters=3)
    prev=q; q=q2; res[i]=(q.tolist(),s)
    if i%10==0: print(i,round(s,3),flush=True)
json.dump({str(k):{'q':v[0],'s':v[1]} for k,v in sorted(res.items())},open(out,'w'))
