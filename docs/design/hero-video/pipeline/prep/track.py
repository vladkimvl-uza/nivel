# Planar tracker: template = rectified quad in ref frame; per-frame SIFT match -> homography template->frame.
import cv2,numpy as np,json,sys,argparse
ap=argparse.ArgumentParser()
ap.add_argument('video'); ap.add_argument('ref',type=int); ap.add_argument('quad'); ap.add_argument('out')
ap.add_argument('--tw',type=int,default=1280); ap.add_argument('--th',type=int,default=720)
ap.add_argument('--feat',default=None,help='feature polygon in template coords as fractions x0,y0,x1,y1 (rect)')
ap.add_argument('--start',type=int,default=0); ap.add_argument('--end',type=int,default=-1)
ap.add_argument('--pad',type=float,default=0.35)
a=ap.parse_args()
q=np.float32(json.loads(a.quad)).reshape(4,2)
T=np.float32([[0,0],[a.tw,0],[a.tw,a.th],[0,a.th]])
cap=cv2.VideoCapture(a.video); N=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
end=N-1 if a.end<0 else a.end
def frame(i):
    cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read(); return f
ref=frame(a.ref)
Hr=cv2.getPerspectiveTransform(q,T)
tmpl=cv2.warpPerspective(ref,Hr,(a.tw,a.th),flags=cv2.INTER_AREA if False else cv2.INTER_LINEAR)
cv2.imwrite(a.out.replace('.json','_tmpl.png'),tmpl)
sift=cv2.SIFT_create(nfeatures=6000,contrastThreshold=0.02)
m=np.zeros((a.th,a.tw),np.uint8)
fx=[0.03,0.03,0.97,0.97] if a.feat is None else [float(v) for v in a.feat.split(',')]
m[int(fx[1]*a.th):int(fx[3]*a.th),int(fx[0]*a.tw):int(fx[2]*a.tw)]=255
tg=cv2.cvtColor(tmpl,cv2.COLOR_BGR2GRAY)
kT,dT=sift.detectAndCompute(tg,m)
print('template kp',len(kT),file=sys.stderr)
bf=cv2.BFMatcher(cv2.NORM_L2)
res={}
def solve(f,pred):
    H0,W0=f.shape[:2]
    x0,y0=pred.min(0); x1,y1=pred.max(0); w,h=x1-x0,y1-y0
    X0=int(max(0,x0-w*a.pad)); Y0=int(max(0,y0-h*a.pad)); X1=int(min(W0,x1+w*a.pad)); Y1=int(min(H0,y1+h*a.pad))
    if X1-X0<40 or Y1-Y0<40: return None,0
    g=cv2.cvtColor(f[Y0:Y1,X0:X1],cv2.COLOR_BGR2GRAY)
    k,d=sift.detectAndCompute(g,None)
    if d is None or len(k)<10: return None,0
    mm=bf.knnMatch(dT,d,k=2)
    good=[p[0] for p in mm if len(p)==2 and p[0].distance<0.78*p[1].distance]
    if len(good)<12: return None,len(good)
    src=np.float32([kT[g_.queryIdx].pt for g_ in good]); dst=np.float32([k[g_.trainIdx].pt for g_ in good])+[X0,Y0]
    H,inl=cv2.findHomography(src,dst,cv2.USAC_MAGSAC,2.5,maxIters=5000,confidence=0.999)
    if H is None: return None,0
    return H,int(inl.sum())
for rng in (range(a.ref,end+1),range(a.ref-1,a.start-1,-1)):
    pred=q.copy()
    for i in rng:
        f=frame(i); H,n=solve(f,pred)
        if H is not None and n>=15:
            c=cv2.perspectiveTransform(T.reshape(-1,1,2),H).reshape(4,2)
            # sanity: area change vs pred
            ar=cv2.contourArea(c)/max(1,cv2.contourArea(pred))
            if 0.7<ar<1.4:
                res[i]={'H':H.tolist(),'q':c.tolist(),'n':n}; pred=c
            else: res[i]={'H':None,'q':None,'n':n}
        else: res[i]={'H':None,'q':None,'n':n}
        if i%25==0: print(i,n,file=sys.stderr)
json.dump({'tw':a.tw,'th':a.th,'ref':a.ref,'refquad':q.tolist(),'frames':{str(k):v for k,v in sorted(res.items())}},open(a.out,'w'))
