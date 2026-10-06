import json,numpy as np,sys
def load(fn):
    d=json.load(open(fn)); fr=d['frames']; N=max(int(k) for k in fr)+1
    Q=np.full((N,4,2),np.nan)
    for k,v in fr.items():
        if v['q'] is not None: Q[int(k)]=v['q']
    return d,Q
def smooth(Q,win=9,deg=2):
    N=len(Q); out=np.full_like(Q,np.nan); idx=np.arange(N); ok=~np.isnan(Q[:,0,0])
    for i in range(N):
        sel=ok&(np.abs(idx-i)<=win)
        if sel.sum()<deg+3: continue
        t=idx[sel]-i; w=np.exp(-0.5*(t/(win/2))**2)
        for c in range(4):
            for j in range(2):
                p=np.polyfit(t,Q[sel,c,j],deg,w=w); out[i,c,j]=p[-1]
    return out
if __name__=='__main__':
    d,Q=load(sys.argv[1]); S=smooth(Q,int(sys.argv[2]) if len(sys.argv)>2 else 9)
    ok=~np.isnan(Q[:,0,0]); print('frames',len(Q),'tracked',ok.sum(),'missing',np.where(~ok)[0].tolist()[:40])
    dev=np.abs(Q-S)[ok]; print('raw-smooth dev px: mean %.2f p95 %.2f max %.2f'%(dev.mean(),np.percentile(dev,95),dev.max()))
    acc=np.abs(np.diff(Q[ok],2,axis=0)); print('raw accel mean %.2f max %.2f'%(acc.mean(),acc.max()))
    acc=np.abs(np.diff(S[ok],2,axis=0)); print('smooth accel mean %.3f max %.3f'%(acc.mean(),acc.max()))
    bad=np.where(np.abs(Q-S).max(axis=(1,2))>2.5)[0]; print('frames dev>2.5px',bad.tolist()[:50])
