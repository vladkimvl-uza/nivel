import cv2,sys
f=cv2.imread(sys.argv[1]); x0,y0,x1,y1=map(int,sys.argv[2].split(',')); step=int(sys.argv[4]) if len(sys.argv)>4 else 50
c=f[y0:y1,x0:x1].copy()
sc=float(sys.argv[5]) if len(sys.argv)>5 else 1.0
c=cv2.resize(c,None,fx=sc,fy=sc,interpolation=cv2.INTER_CUBIC)
for x in range((x0//step+1)*step,x1,step):
    X=int((x-x0)*sc); cv2.line(c,(X,0),(X,c.shape[0]),(0,255,0),1); cv2.putText(c,str(x),(X+2,14),0,0.45,(0,255,0),1)
for y in range((y0//step+1)*step,y1,step):
    Y=int((y-y0)*sc); cv2.line(c,(0,Y),(c.shape[1],Y),(0,255,255),1); cv2.putText(c,str(y),(2,Y-2),0,0.45,(0,255,255),1)
cv2.imwrite(sys.argv[3],c)
