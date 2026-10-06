import cv2,numpy as np,json,sys
vid=sys.argv[1]; trk=json.load(open(sys.argv[2])); a0,a1=int(sys.argv[3]),int(sys.argv[4]); roi=json.loads(sys.argv[5]); out=sys.argv[6]
tw,th=trk['tw'],trk['th']; T=np.float32([[0,0],[tw,0],[tw,th],[0,th]])
Fm=np.array([[-1,0,tw],[0,1,0],[0,0,1]],float)
cap=cv2.VideoCapture(vid); sift=cv2.SIFT_create(nfeatures=5000,contrastThreshold=0.008)
bf=cv2.BFMatcher(); cl=cv2.createCLAHE(3.0,(8,8)); res={}
cap.set(cv2.CAP_PROP_POS_FRAMES,a0)
for i in range(a0,a1+1):
    ok,f=cap.read()
    if not ok: break
    H=np.array(trk['frames'][str(i)]['H'])
    rect=cv2.warpPerspective(f,np.linalg.inv(H),(tw,th))
    g1=cl.apply(cv2.cvtColor(cv2.flip(rect,1),cv2.COLOR_BGR2GRAY))
    g1=cv2.resize(g1,None,fx=0.5,fy=0.5,interpolation=cv2.INTER_AREA)
    x0,y0,x1,y1=roi
    g2=cl.apply(cv2.cvtColor(f[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY))
    k1,d1=sift.detectAndCompute(g1,None); k2,d2=sift.detectAndCompute(g2,None)
    r={'n':0,'q':None}
    if d1 is not None and d2 is not None and len(k2)>10:
        mm=bf.knnMatch(d1,d2,k=2); good=[p[0] for p in mm if len(p)==2 and p[0].distance<0.82*p[1].distance]
        if len(good)>=8:
            src=np.float32([k1[g.queryIdx].pt for g in good])*2; dst=np.float32([k2[g.trainIdx].pt for g in good])+[x0,y0]
            Hr,inl=cv2.findHomography(src,dst,cv2.USAC_MAGSAC,4.0,maxIters=10000)
            if Hr is not None:
                Rt=Hr@Fm; c=cv2.perspectiveTransform(T.reshape(-1,1,2),Rt).reshape(4,2)
                r={'n':int(inl.sum()),'q':c.tolist()}
    res[i]=r
    if i%20==0: print(i,r['n'],file=sys.stderr)
json.dump({'frames':{str(k):v for k,v in res.items()}},open(out,'w'))
