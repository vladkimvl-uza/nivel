# t — 04 Тест (своя полоса «04 Sinov»): корпус под нагрузкой (13075121 очищенный, Zebronics размыт; кадры 10–112,
# на первом экране — 100–220), отражён, горизонт выровнен; бесшовная петля 72 кадра. Кольца вентиляторов — тёплый
# оранжевый (как на первом экране), остальное графит; дисплей помпы размыт по трекингу; стена и растение — в темноту.
from common import *
from casefx import tame
def od(g): return floor_to((place_fade(g,0.60,1000,500,DW,DH,0.66*DW,0.57*DH,90)*ell(DH,DW,0.66,0.56,0.36,0.70,0.9,0.0)[...,None]).astype(np.uint8),(10,11,13))
def om(g): return floor_to((place_fade(g,0.54,1000,500,MW,MH,0.50*MW,0.47*MH,90)*ell(MH,MW,0.5,0.45,0.85,0.40,0.9,0.0)[...,None]).astype(np.uint8),(10,11,13))
def build(test=None):
    F=read(SP+'/hero-media/owner/work/clean-13075121.mp4',10,112)
    gray=lambda im:cv2.cvtColor(im,cv2.COLOR_BGR2GRAY); r0=10
    pos={r0:(830,360)}; T=gray(F[r0])[360-34:360+34,830-40:830+40]
    def step(i,j,prev):
        # шаблон — из соседнего кадра (обновляется), чтобы не уплывал на длинном отрезке
        x,y=prev; Tj=gray(F[j])[y-34:y+34,x-40:x+40]; r=40; g=gray(F[i]); x0,y0=max(0,x-40-r),max(0,y-34-r); S=g[y0:y+34+r,x0:x+40+r]
        res=cv2.matchTemplate(S,Tj,cv2.TM_CCOEFF_NORMED); _,mv,_,ml=cv2.minMaxLoc(res); return (x0+ml[0]+40,y0+ml[1]+34)
    for i in range(r0+1,len(F)): pos[i]=step(i,i-1,pos[i-1])
    for i in range(r0-1,-1,-1): pos[i]=step(i,i+1,pos[i+1])
    print('pump',pos[0],pos[50],pos[100])
    R=cv2.getRotationMatrix2D((960,540),-10.0,1.0)
    yy,xx=np.mgrid[0:1080,0:1920].astype(np.float32)
    pool=ell(1080,1920,0.55,0.47,0.46,0.70,1.1,0.03)*(1-0.75*np.clip((0.40-xx/1920)/0.2,0,1))
    G=[]
    rng=range(len(F)) if test is None else test
    for i in rng:
        f=F[i]
        m=np.zeros(f.shape[:2],np.float32); cv2.ellipse(m,pos[i],(54,48),0,0,360,1,-1); f=blur_in(f,m,10,dark=0.75)
        hsv=cv2.cvtColor(f,cv2.COLOR_BGR2HSV)
        ring=np.clip((hsv[...,2].astype(np.float32)-95)/80,0,1)                # всё светлое внутри корпуса — кольца, подсветка
        f=cv2.warpAffine(cv2.flip(f,1),R,(1920,1080),flags=cv2.INTER_CUBIC)
        ring=cv2.warpAffine(cv2.flip(ring,1),R,(1920,1080))
        x=(f.astype(np.float32)/255)**2.2*0.70
        x=(np.clip(x,0,1)**(1/2.2)*255).astype(np.uint8)
        g=night_tone(contrast(brand(tame(x)),16,1.09),bp=4,gamma=1.1,pool=pool)
        rm=cv2.GaussianBlur(ring,(0,0),3)*np.clip(pool*1.8,0,1)
        g=warm_spot(g,rm,s=0.80,v_thr=0.10,lift=1.55)
        G.append(g)
    if test is not None: return [od(g) for g in G],[om(g) for g in G]
    N=len(G); C=16; L=N-C; out=[]
    for k in range(L):
        if k<C: w=k/C; w=w*w*(3-2*w); out.append(cv2.addWeighted(G[k],w,G[L+k],1-w,0))
        else: out.append(G[k])
    out=[out[min(len(out)-1,int(round(k*(len(out)-1)/71)))] for k in range(72)]
    return [od(g) for g in out],[om(g) for g in out]
if __name__=='__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='t':
        D,M=build([0,50,100]);sheet('t-t',D,M,3);[print(stats(d)) for d in D];cv2.imwrite('int/t-t-d.jpg',D[1]);cv2.imwrite('int/t-t-m.jpg',M[1])
    else:
        D,M=build();write('t',D,M)
