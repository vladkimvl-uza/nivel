import cv2,numpy as np
def refine_quad(img,q,search=10,n=60,margin=0.08):
    """q: 4x2 TL,TR,BR,BL. inside assumed brighter than bezel. returns refined quad + per-side info"""
    g=cv2.GaussianBlur(cv2.cvtColor(img,cv2.COLOR_BGR2GRAY).astype(np.float32),(3,3),0)
    q=np.float32(q); cen=q.mean(0); lines=[]
    for i in range(4):
        a,b=q[i],q[(i+1)%4]; d=(b-a)/np.linalg.norm(b-a); nrm=np.array([-d[1],d[0]])
        if np.dot(cen-(a+b)/2,nrm)<0: nrm=-nrm   # nrm points inward
        pts=[]
        for t in np.linspace(margin,1-margin,n):
            p=a+(b-a)*t
            ss=np.arange(-search,search+0.01,0.5)
            xs=p[0]+nrm[0]*ss; ys=p[1]+nrm[1]*ss
            v=cv2.remap(g,xs.reshape(1,-1).astype(np.float32),ys.reshape(1,-1).astype(np.float32),cv2.INTER_LINEAR)[0]
            dv=np.gradient(v)   # inward increase
            k=np.argmax(dv)
            if dv[k]>2.0: pts.append(p+nrm*ss[k])
        pts=np.float32(pts)
        L=cv2.fitLine(pts,cv2.DIST_HUBER,0,0.01,0.01).ravel()
        lines.append((L,len(pts)))
    def inter(L1,L2):
        (vx1,vy1,x1,y1),(vx2,vy2,x2,y2)=L1,L2
        A=np.array([[vx1,-vx2],[vy1,-vy2]]); bb=np.array([x2-x1,y2-y1]); t=np.linalg.solve(A,bb)
        return np.array([x1+vx1*t[0],y1+vy1*t[0]])
    # side i = q[i]->q[i+1]; corner i = intersection side(i-1) & side(i)
    out=np.float32([inter(lines[(i-1)%4][0],lines[i][0]) for i in range(4)])
    return out,[l[1] for l in lines]
def draw_quad(img,q,col=(0,255,0),th=1):
    cv2.polylines(img,[np.int32(np.round(q*4))],True,col,th,cv2.LINE_AA,shift=2)
