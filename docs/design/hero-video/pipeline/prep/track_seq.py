# Sequential KLT planar tracker (for surfaces where template matching is weak). Outputs quads per frame.
import cv2,numpy as np,json,sys
vid,ref,quad,out=sys.argv[1],int(sys.argv[2]),np.float32(json.loads(sys.argv[3])),sys.argv[4]
shrink=float(sys.argv[5]) if len(sys.argv)>5 else 0.08
cap=cv2.VideoCapture(vid); N=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
frames=[]
while True:
    ok,f=cap.read()
    if not ok: break
    frames.append(cv2.cvtColor(cv2.resize(f,(960,540),interpolation=cv2.INTER_AREA),cv2.COLOR_BGR2GRAY))
N=len(frames); s=0.5
res={ref:quad.tolist()}
def mask_for(q):
    c=q.mean(0); qs=c+(q-c)*(1-shrink)
    m=np.zeros((540,960),np.uint8); cv2.fillPoly(m,[np.int32(qs*s)],255); return m
for step in (1,-1):
    q=quad.copy(); i=ref
    while 0<=i+step<N:
        j=i+step; a,b=frames[i],frames[j]
        p=cv2.goodFeaturesToTrack(a,800,0.005,5,mask=mask_for(q))
        if p is None or len(p)<10: break
        p2,st,_=cv2.calcOpticalFlowPyrLK(a,b,p,None,winSize=(21,21),maxLevel=3)
        p3,st2,_=cv2.calcOpticalFlowPyrLK(b,a,p2,None,winSize=(21,21),maxLevel=3)
        okm=(st.ravel()==1)&(st2.ravel()==1)&(np.linalg.norm((p3-p).reshape(-1,2),axis=1)<0.5)
        if okm.sum()<10: break
        H,inl=cv2.findHomography(p[okm]/s,p2[okm]/s,cv2.RANSAC,1.5)
        q=cv2.perspectiveTransform(q.reshape(-1,1,2),H).reshape(4,2)
        res[j]=q.tolist(); i=j
json.dump({'frames':{str(k):{'q':v} for k,v in sorted(res.items())}},open(out,'w'))
print('tracked',len(res),'of',N)
