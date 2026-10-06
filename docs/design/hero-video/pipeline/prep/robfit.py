import json,numpy as np,sys
def robust_fit(fn,deg=4,minn=12,a0=None,a1=None):
    d=json.load(open(fn))['frames']; ks=sorted(int(k) for k in d)
    t=[];Q=[];W=[]
    for k in ks:
        v=d[str(k)]
        if v['q'] is not None and v['n']>=minn: t.append(k);Q.append(np.float32(v['q']).ravel());W.append(v['n'])
    t=np.array(t,float);Q=np.array(Q);W=np.array(W,float)
    keep=np.ones(len(t),bool)
    tn=(t-t.mean())/(t.std()+1e-9)
    for it in range(6):
        P=[np.polyfit(tn[keep],Q[keep,j],deg,w=np.sqrt(W[keep])) for j in range(8)]
        pred=np.stack([np.polyval(p,tn) for p in P],1)
        err=np.abs(pred-Q).max(1); med=np.median(err[keep]); 
        keep=err<max(3*med,4)
    allt=np.arange(int(ks[0]) if a0 is None else a0,(int(ks[-1]) if a1 is None else a1)+1)
    tn2=(allt-t.mean())/(t.std()+1e-9)
    out=np.stack([np.polyval(p,tn2) for p in P],1).reshape(-1,4,2)
    return allt,out,keep.sum(),len(t),np.median(err[keep]),np.percentile(err[keep],90)
if __name__=='__main__':
    for deg in (3,4,5):
        allt,out,nk,nt,med,p90=robust_fit(sys.argv[1],deg)
        print(deg,'kept',nk,'/',nt,'median err %.1f p90 %.1f'%(med,p90))
