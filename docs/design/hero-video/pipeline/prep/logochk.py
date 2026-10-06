import cv2,numpy as np,json,sys
from quadlib import draw_quad
from smooth import load,smooth
vid=sys.argv[1]; specs=json.loads(sys.argv[2]); idx=[int(x) for x in sys.argv[3].split(',')]; out=sys.argv[4]; ref=int(sys.argv[5])
cap=cv2.VideoCapture(vid); tiles=[]
tr=[]
for fn,polys in specs:
    d,Q=load(fn); S=smooth(Q,7); tr.append((S,polys))
for i in idx:
    cap.set(1,i); ok,f=cap.read()
    for S,polys in tr:
        H=cv2.getPerspectiveTransform(np.float32(S[ref]),np.float32(S[i]))
        for p in polys:
            q=cv2.perspectiveTransform(np.float32(p).reshape(-1,1,2),H).reshape(4,2); draw_quad(f,q,(0,255,0),2)
    s=cv2.resize(f,(960,540)); cv2.putText(s,str(i),(10,30),0,1,(0,255,255),2); tiles.append(s)
while len(tiles)%2: tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(out,np.vstack([np.hstack(tiles[r:r+2]) for r in range(0,len(tiles),2)]))
