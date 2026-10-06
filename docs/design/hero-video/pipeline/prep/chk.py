import cv2,numpy as np,json,sys
from quadlib import draw_quad
vid=sys.argv[1]; trks=sys.argv[2].split(','); idx=[int(x) for x in sys.argv[3].split(',')]; out=sys.argv[4]
T=[json.load(open(t))['frames'] for t in trks]
cap=cv2.VideoCapture(vid); tiles=[]
cols=[(0,255,0),(0,0,255),(255,0,255),(255,255,0)]
for i in idx:
    cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read()
    f=cv2.convertScaleAbs(f,alpha=1.4,beta=8)
    for k,t in enumerate(T):
        v=t.get(str(i))
        if v and v['q']: draw_quad(f,np.float32(v['q']),cols[k],2)
    s=cv2.resize(f,(960,540),interpolation=cv2.INTER_AREA); cv2.putText(s,str(i),(10,30),0,1,(0,255,255),2); tiles.append(s)
while len(tiles)%2: tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(out,np.vstack([np.hstack(tiles[r:r+2]) for r in range(0,len(tiles),2)]))
