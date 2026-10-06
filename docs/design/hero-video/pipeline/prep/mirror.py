import json,numpy as np,cv2,sys
from smooth import load,smooth
W,Hh=1920,1080; cx,cy=W/2,Hh/2
def calib_f(Hs):
    rows=[];rhs=[]
    for H in Hs:
        Hc=np.array([[1,0,-cx],[0,1,-cy],[0,0,1]])@H
        h1,h2=Hc[:,0],Hc[:,1]
        # w = diag(a,a,1), a=1/f^2 : h1^T w h2 = 0 ; h1^T w h1 - h2^T w h2 = 0
        rows.append(h1[0]*h2[0]+h1[1]*h2[1]); rhs.append(-h1[2]*h2[2])
        rows.append(h1[0]**2+h1[1]**2-h2[0]**2-h2[1]**2); rhs.append(-(h1[2]**2-h2[2]**2))
    A=np.array(rows)[:,None]; b=np.array(rhs)
    a=np.linalg.lstsq(A,b,rcond=None)[0][0]
    return 1/np.sqrt(a)
def K_(f): return np.array([[f,0,cx],[0,f,cy],[0,0,1.]])
def pose(H,f):
    M=np.linalg.inv(K_(f))@H
    lam=1/np.linalg.norm(M[:,0]); r1=M[:,0]*lam; r2=M[:,1]*lam; t=M[:,2]*lam
    if t[2]<0: r1,r2,t=-r1,-r2,-t
    R=np.stack([r1,r2,np.cross(r1,r2)],1); U,_,Vt=np.linalg.svd(R); R=U@Vt
    return R,t
def mirror_H(R,t,f,n,d):
    # X=(u,v,0); X'=X-2(n.X-d)n = (I-2nn^T)X + 2dn
    A=np.eye(3)-2*np.outer(n,n); b=2*d*n
    P=np.stack([R@A[:,0],R@A[:,1],R@b+t],1)
    return K_(f)@P
def nvec(p): th,ph=p; return np.array([np.sin(th)*np.cos(ph),np.sin(th)*np.sin(ph),np.cos(th)])
def residuals(p,data,f):
    n=nvec(p[:2]); d=p[2]; out=[]
    for (R,t,pairs) in data:
        Hm=mirror_H(R,t,f,n,d)
        pr=cv2.perspectiveTransform(pairs[:,None,:2].astype(np.float64),Hm).reshape(-1,2)
        out.append((pr-pairs[:,2:]).ravel())
    return np.concatenate(out)
def lm(p,data,f,it=60):
    lamb=1e-2
    r=residuals(p,data,f); c=np.sum(np.minimum(r**2,400))
    for k in range(it):
        J=np.zeros((len(r),len(p)))
        for j in range(len(p)):
            dp=np.zeros(len(p)); dp[j]=1e-5*max(1,abs(p[j]))
            J[:,j]=(residuals(p+dp,data,f)-r)/dp[j]
        w=(np.abs(r)<20).astype(float)  # robust: ignore gross
        A=J.T@(J*w[:,None]); g=J.T@(r*w)
        step=-np.linalg.solve(A+lamb*np.diag(np.diag(A)+1e-9),g)
        r2=residuals(p+step,data,f); c2=np.sum(np.minimum(r2**2,400))
        if c2<c: p=p+step; r=r2; c=c2; lamb*=0.3
        else: lamb*=10
        if lamb>1e8: break
    return p,r
if __name__=='__main__':
    mainj,pairsj=sys.argv[1],sys.argv[2]
    d,Q=load(mainj); fr=d['frames']
    Hs=[np.array(fr[str(i)]['H']) for i in range(0,len(Q),3)]
    f=calib_f(Hs); print('focal',f)
    P=json.load(open(pairsj))['frames']
    data=[]
    for k,v in P.items():
        if v.get('pairs') and v['n']>=10:
            R,t=pose(np.array(fr[k]['H']),f); data.append((R,t,np.array(v['pairs'])))
    print('frames with pairs',len(data),'pts',sum(len(x[2]) for x in data))
    best=None
    for th in np.linspace(0.1,3.0,24):
        for ph in np.linspace(-np.pi,np.pi,36,endpoint=False):
            for dd in np.linspace(-1500,3000,19):
                r=residuals(np.array([th,ph,dd]),data[::6],f); c=np.median(np.abs(r))
                if best is None or c<best[0]: best=(c,np.array([th,ph,dd]))
    print('grid best',best)
    p,r=lm(best[1],data,f)
    ar=np.abs(r).reshape(-1,2); e=np.linalg.norm(ar,axis=1)
    print('params',p.tolist(),'n',nvec(p[:2]).tolist(),'median err',np.median(e),'p75',np.percentile(e,75),'inlier<5px',np.mean(e<5))
    json.dump({'f':f,'p':p.tolist()},open(sys.argv[3],'w'))
