import cv2,numpy as np,sys
vid,idxs=sys.argv[1],[int(x) for x in sys.argv[2].split(',')]
cap=cv2.VideoCapture(vid)
for i in idxs:
    cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read()
    g=cv2.cvtColor(f,cv2.COLOR_BGR2GRAY)
    cv2.imwrite(f'kf_{vid[4:12]}_{i}.png',f)
    for th in (40,60,80):
        m=(g>th).astype(np.uint8)*255
        m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((15,15),np.uint8))
        cs,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        cs=sorted(cs,key=cv2.contourArea,reverse=True)[:3]
        for c in cs:
            ap=cv2.approxPolyDP(c,0.02*cv2.arcLength(c,True),True)
            print(i,th,int(cv2.contourArea(c)),len(ap),ap.reshape(-1,2).tolist() if len(ap)<=6 else '')
