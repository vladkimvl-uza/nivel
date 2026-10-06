import cv2,numpy as np,json,sys
from quadlib import draw_quad
from smooth import load,smooth
trk=sys.argv[1]; vid=sys.argv[2]; P=json.loads(sys.argv[3]); idx=[int(x) for x in sys.argv[4].split(',')]; out=sys.argv[5]
d,Q=load(trk); S=smooth(Q,9)
tw,th=d['tw'],d['th']; T=np.float32([[0,0],[tw,0],[tw,th],[0,th]]); rq=np.float32(d['refquad'])
Hr=cv2.getPerspectiveTransform(rq,T)
cap=cv2.VideoCapture(vid); tiles=[]
for i in idx:
    cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read(); f=cv2.convertScaleAbs(f,alpha=1.5,beta=5)
    H=cv2.getPerspectiveTransform(T,np.float32(S[i]))@Hr
    for p in P:
        q=cv2.perspectiveTransform(np.float32(p).reshape(-1,1,2),H).reshape(4,2); draw_quad(f,q,(0,255,0),2)
    s=cv2.resize(f,(960,540)); cv2.putText(s,str(i),(10,30),0,1,(0,255,255),2); tiles.append(s)
while len(tiles)%2: tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(out,np.vstack([np.hstack(tiles[r:r+2]) for r in range(0,len(tiles),2)]))
