import cv2,numpy as np,json,sys
main=json.load(open('trk_142_main.json'))['frames']; raw=json.load(open('trk_142_refl_pairs.json'))['frames']
tw,th=1280,720; T=np.float32([[0,0],[tw,0],[tw,th],[0,th]]); s=0.5
cap=cv2.VideoCapture('src-14203522.mp4')
def hp(g,sig=8): g=g.astype(np.float32); return g-cv2.GaussianBlur(g,(0,0),sig)
for i in [int(x) for x in sys.argv[1].split(',')]:
    cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read()
    H=np.array(main[str(i)]['H']); rect=cv2.warpPerspective(f,np.linalg.inv(H),(tw,th))
    g=cv2.cvtColor(rect,cv2.COLOR_BGR2GRAY)
    tm=cv2.resize(g,None,fx=s,fy=s,interpolation=cv2.INTER_AREA)
    tm=hp(cv2.GaussianBlur(tm.astype(np.float32),(0,0),1.0))
    ox,oy=int(0.30*tw*s),int(0.03*th*s); tm=tm[oy:int(0.97*th*s),ox:int(0.72*tw*s)].copy()
    Off=np.array([[1,0,ox],[0,1,oy],[0,0,1.0]])
    img=hp(cv2.cvtColor(f,cv2.COLOR_BGR2GRAY))
    q=np.float32(raw[str(i)]['q']); Rinit=cv2.getPerspectiveTransform(T*s,q)@Off
    S=np.diag([s,s,1.0])
    try:
        cc,W=cv2.findTransformECC(tm,img,Rinit.astype(np.float32),cv2.MOTION_HOMOGRAPHY,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,200,1e-6),None,5)
    except cv2.error as e: print(i,'fail',e); continue
    Rt=W.astype(np.float64)@np.linalg.inv(Off)@S  # template full-res -> frame
    c=cv2.perspectiveTransform(T.reshape(-1,1,2),Rt).reshape(4,2)
    print(i,'cc',round(cc,3),'init',q.round(0).tolist()[:2],'ecc',c.round(0).tolist()[:2])
    # visualize: overlay predicted reflection (flipped template warped) edges
    pred=cv2.warpPerspective(rect,Rt,(1920,1080))
    v=np.hstack([f[250:800,1100:1750], cv2.addWeighted(f,0.6,pred,0.6,0)[250:800,1100:1750]])
    cv2.imwrite(f'ecc_{i}.jpg',v)
