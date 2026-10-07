# x — 03 Закупка: процессор в руке под лампой (12611453, кадры 45 -> 0, обратный ход).
# Процессор поворачивается к лампе: графитовая крышка ловит тёплый блик, к последнему чеку крышка горит тёплым — «куплено».
# Маленький (компьютер ~0.4 от исходника, процессор ~1/3 высоты кадра, справа от чеков; телефон — над чеками).
# Надпись на крышке и номер на подложке размыты по трекингу, поверх — мелкая фактура металла.
from common import *
def build(test=None):
    p=glob.glob(V+'pexels-12611453-*.mp4')[0]; F=read(p,0,60)
    lid=[(555,420),(935,205),(1150,655),(765,860)]          # поле крышки с надписью (кадр 10)
    sub=[(640,900),(800,850),(820,975),(660,1010)]          # номер на подложке
    chip=[(500,400),(990,85),(1215,715),(690,990)]          # весь процессор (кадр 10)
    H=track(F,10,chip)
    idx=[int(round(i)) for i in np.linspace(45,0,46)] if test is None else test
    D,M=[],[]
    rng=np.random.default_rng(7); N0=rng.normal(0,1,(1080,1920)).astype(np.float32)
    N0=cv2.GaussianBlur(cv2.GaussianBlur(N0,(0,0),1.0),(0,0),sigmaX=5,sigmaY=0.7)
    for i in idx:
        f=F[i]
        ml=polymask(f.shape,[lid],H[i],dil=27); f=blur_in(f,ml,13,dark=1.0); f=blur_in(f,polymask(f.shape,[sub],H[i],dil=25),14,dark=0.9)
        f=np.clip(f.astype(np.float32)+(N0*10*ml)[...,None],0,255).astype(np.uint8)   # фактура металла — не «гладкая плитка»
        q=cv2.perspectiveTransform(np.float32(chip)[None],H[i])[0]; cx,cy=q.mean(0)
        pool=ell(1080,1920,0.44,0.47,0.62,0.95,1.1,0.03)
        mc=cv2.GaussianBlur(polymask(f.shape,[chip],H[i],dil=12),(0,0),10)
        hand=cv2.GaussianBlur(((cv2.cvtColor(f,cv2.COLOR_BGR2HSV)[...,0]<16)|(cv2.cvtColor(f,cv2.COLOR_BGR2HSV)[...,0]>170)).astype(np.float32),(0,0),25)
        bgm=0.2+0.8*np.clip(mc+0.9*hand,0,1)                    # стена за рукой — в темноту, процессор и пальцы под лампой
        g=amber_only(brand(night2(f,pool*bgm,exp=0.85)),rest=0.3)
        # тёплый блик на крышке — медь, а не «свечение»: насыщенность и яркость ограничены
        x=g.astype(np.float32)/255; hsv=cv2.cvtColor(x,cv2.COLOR_BGR2HSV); Hh,S,Vv=cv2.split(hsv)
        mcl=cv2.GaussianBlur(polymask(f.shape,[chip],H[i],dil=5),(0,0),4)
        warm=mcl*np.clip((S-0.25)/0.3,0,1)
        Hh=hmix(Hh,25,warm); S=np.minimum(S,0.70); Vv=np.minimum(Vv,0.72)
        g=(np.clip(cv2.cvtColor(cv2.merge([Hh,S,Vv]),cv2.COLOR_HSV2BGR),0,1)*255).astype(np.uint8)
        for s,ow,oh,ox,oy,L in ((0.35,DW,DH,0.72*DW,0.47*DH,D),(0.28,MW,MH,0.60*MW,0.47*MH,M)):
            # центр кадра привязан к средней точке процессора за отрезок, а не к кадру: рука движется, лампа стоит
            o,ins=place(g,s,830,520,ow,oh,ox,oy,flip=True,border=cv2.BORDER_REPLICATE)
            # за краем исходника рука продолжается в темноту: размытое продолжение края и спад яркости
            dist=cv2.distanceTransform((ins<0.5).astype(np.uint8),cv2.DIST_L2,5)
            ob=cv2.GaussianBlur(o,(0,0),14); a=np.clip(dist/40,0,1)[...,None]
            o=(o*(1-a)+ob*a); fade=np.exp(-dist/70)
            pl=ell(oh,ow,ox/ow,oy/oh,0.62*oh/ow,0.62,1.1,0.0)*0.85+0.15
            o=(o.astype(np.float32)*(fade*pl)[...,None])
            L.append(floor_to(contrast(np.clip(o,0,255).astype(np.uint8),8,1.08)))
    return D,M
if __name__=='__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='t':
        D,M=build([45,32,20,0]);sheet('x-t',D,M,4);[print(stats(d)) for d in D];cv2.imwrite('int/x-t-d.jpg',D[1]);cv2.imwrite('int/x-t-m.jpg',M[3]);cv2.imwrite('int/x-t-d0.jpg',D[3])
    else:
        D,M=build();write('x',D,M)
