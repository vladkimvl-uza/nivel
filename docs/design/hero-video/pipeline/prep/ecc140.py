import cv2,numpy as np,json,sys
main=json.load(open('trk_140_main.json'))['frames']
tw,th=1280,720; T=np.float32([[0,0],[tw,0],[tw,th],[0,th]]); s=0.5
cap=cv2.VideoCapture('src-14098235.mp4')
def mag(img):
    b,g,r=[c.astype(np.float32) for c in cv2.split(img)]
    m=(r+b)/2-g; return m
def hp(m,sig=10): return m-cv2.GaussianBlur(m,(0,0),sig)
def ecc(i,init,blur=2.0,save=False):
    cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read()
    H=np.array(main[str(i)]['H']); rect=cv2.warpPerspective(f,np.linalg.inv(H),(tw,th))
    tm=cv2.resize(mag(rect),None,fx=s,fy=s,interpolation=cv2.INTER_AREA)
    tm=hp(cv2.GaussianBlur(tm,(0,0),blur*s+0.5),10*s)
    img=hp(cv2.GaussianBlur(mag(f),(0,0),1.0),10)
    S=np.diag([s,s,1.0])
    W0=(init@np.linalg.inv(S)).astype(np.float32)
    try:
        cc,W=cv2.findTransformECC(tm.astype(np.float32),img.astype(np.float32),W0,cv2.MOTION_HOMOGRAPHY,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,300,1e-7),None,3)
    except cv2.error as e:
        return None,0,f,rect
    R=W.astype(np.float64)@S
    return R,cc,f,rect
if __name__=='__main__':
    q=np.float32(json.loads(sys.argv[1])); i=int(sys.argv[2])
    R0=cv2.getPerspectiveTransform(T,q).astype(np.float64)
    R,cc,f,rect=ecc(i,R0)
    print("cc",cc)
    if R is None: sys.exit()
    c=cv2.perspectiveTransform(T.reshape(-1,1,2),R).reshape(4,2); print(c.round(1).tolist())
    pred=cv2.warpPerspective(rect,R,(1920,1080))
    v=np.hstack([f[150:700,950:1650],cv2.addWeighted(f,0.5,pred,0.8,0)[150:700,950:1650]])
    cv2.imwrite('ecc140.jpg',v)
