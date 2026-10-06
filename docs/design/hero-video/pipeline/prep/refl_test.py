import cv2,numpy as np,json,sys
vid=sys.argv[1]; trk=json.load(open(sys.argv[2])); frames=[int(x) for x in sys.argv[3].split(',')]
roi=json.loads(sys.argv[4]) # x0,y0,x1,y1 search region (static approx) or 'auto'
tw,th=trk['tw'],trk['th']; T=np.float32([[0,0],[tw,0],[tw,th],[0,th]])
cap=cv2.VideoCapture(vid); sift=cv2.SIFT_create(nfeatures=4000,contrastThreshold=0.01)
bf=cv2.BFMatcher()
for i in frames:
    cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read()
    H=np.array(trk['frames'][str(i)]['H'])
    rect=cv2.warpPerspective(f,np.linalg.inv(H),(tw,th))
    fl=cv2.flip(rect,1)
    g1=cv2.cvtColor(fl,cv2.COLOR_BGR2GRAY)
    # equalize to boost faint
    x0,y0,x1,y1=roi; R=f[y0:y1,x0:x1]
    g2=cv2.cvtColor(R,cv2.COLOR_BGR2GRAY); cl=cv2.createCLAHE(3.0,(8,8)); g2=cl.apply(g2); g1c=cl.apply(g1)
    k1,d1=sift.detectAndCompute(cv2.resize(g1c,None,fx=0.5,fy=0.5),None)
    k2,d2=sift.detectAndCompute(g2,None)
    mm=bf.knnMatch(d1,d2,k=2); good=[p[0] for p in mm if len(p)==2 and p[0].distance<0.8*p[1].distance]
    if len(good)<8: print(i,'few',len(good)); continue
    src=np.float32([k1[g.queryIdx].pt for g in good])*2; dst=np.float32([k2[g.trainIdx].pt for g in good])+[x0,y0]
    Hr,inl=cv2.findHomography(src,dst,cv2.USAC_MAGSAC,4.0,maxIters=10000)
    n=int(inl.sum()) if inl is not None else 0
    print(i,'good',len(good),'inl',n)
    if Hr is not None:
        # flip matrix: template x -> tw-x
        Fm=np.array([[-1,0,tw],[0,1,0],[0,0,1]],float)
        Rt=Hr@Fm   # template -> frame reflection
        c=cv2.perspectiveTransform(T.reshape(-1,1,2),Rt).reshape(4,2); print('  refl quad',c.round(0).tolist())
        v=f.copy(); cv2.polylines(v,[np.int32(c)],True,(0,255,0),2)
        cv2.imwrite(f'refl_{i}.jpg',cv2.resize(v,(960,540)))
