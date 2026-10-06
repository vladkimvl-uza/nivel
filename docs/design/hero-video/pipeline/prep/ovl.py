import cv2,numpy as np,json,sys
main=json.load(open('trk_140_main.json'))['frames']; tw,th=1280,720; T=np.float32([[0,0],[tw,0],[tw,th],[0,th]])
q=np.float32(json.loads(sys.argv[1])); i=int(sys.argv[2])
cap=cv2.VideoCapture('src-14098235.mp4'); cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read()
H=np.array(main[str(i)]['H']); rect=cv2.warpPerspective(f,np.linalg.inv(H),(tw,th))
R=cv2.getPerspectiveTransform(T,q); pred=cv2.warpPerspective(rect,R,(1920,1080))
e=cv2.Canny(cv2.cvtColor(pred,cv2.COLOR_BGR2GRAY),60,150)
v=f.copy(); v[e>0]=(0,255,0)
cv2.imwrite('ovl.jpg',np.hstack([f[150:700,950:1650],v[150:700,950:1650]]))
