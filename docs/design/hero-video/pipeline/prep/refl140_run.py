import cv2,numpy as np,json,sys
from nccalign import *
main=json.load(open('trk_140_main.json'))['frames']
cap=cv2.VideoCapture('src-14098235.mp4'); N=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
q0=np.float32([[1505.5,206.5],[1105.5,247.0],[1116.0,613.0],[1492.5,564.0]]); ref=200
res={ref:(q0.tolist(),0.487)}
for rng in (range(ref+1,N),range(ref-1,-1,-1)):
    q=q0.copy(); prev=None
    for i in rng:
        cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read()
        if not ok: break
        H=np.array(main[str(i)]['H']); rect=cv2.warpPerspective(f,np.linalg.inv(H),(tw,th))
        tm=prep_tmpl(rect); img=prep_frame(f); wm=(cv2.GaussianBlur(tm,(0,0),6)>25).astype(np.float32)
        # predict using velocity
        qp=q if prev is None else q+(q-prev)
        q2,b=refine(qp,tm,img,wm,steps=(4,2,1,0.5),iters=3)
        prev=q; q=q2; res[i]=(q.tolist(),b)
        if i%20==0: print(i,round(b,3),flush=True)
json.dump({str(k):{'q':v[0],'s':v[1]} for k,v in sorted(res.items())},open('trk_140_refl.json','w'))
