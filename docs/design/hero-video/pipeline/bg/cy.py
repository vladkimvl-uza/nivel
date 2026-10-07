# y — 04 Сборка: кадр меняется вместе со списком деталей (8 пунктов, AS в bg.js):
#   1 плата — пустое гнездо (11537353, 0–35); 2 процессор — рука ставит процессор (11537353, 40–215);
#   3 кулер, 4 память — процессор в гнезде, рук нет (11537353, 215–262), растворение в 11537350;
#   5 накопитель M.2 — винт M.2 отвёрткой (11537350, 0–60); 6–8 видеокарта, блок питания, кабели — растворение
#   в чистую плату без руки (11537353, 262–300, медленный наезд) — это и конечный кадр, и постер.
# Цвет — как у первого экрана: nightmatch.night(…,'cpu') + brand() для 11537353 (тот же кадр, что в шаге 02),
# для 11537350 — та же кривая (night2) со своим пятном лампы и подавлением серебристого пакета.
from common import *
CH=[('a',0,35,10),('a',40,215,30),('a',215,262,12),('x',0,0,8),('b',0,60,20),('y',0,0,8),('c',262,300,16)]
def chapters():
    """доли ролика, с которых начинается пункт списка 0..7 (для bg.js)"""
    n=[c[3] for c in CH]; T=sum(n); s=np.cumsum([0]+n)/T
    # пункты: 0 плата=ch0, 1 процессор=ch1, 2 кулер=ch2 1-я половина, 3 память=ch2 2-я половина + растворение, 4 M.2=ch4, 5..7 = ch5+ch6 на три
    p=[s[0],s[1],s[2],s[2]+(s[3]-s[2])/2,s[4],s[5],s[5]+(1-s[5])/3,s[5]+2*(1-s[5])/3,1.0]
    return [round(float(x),4) for x in p],T
def lidmask(f):
    hsv=cv2.cvtColor(f,cv2.COLOR_BGR2HSV); m=((hsv[...,2]>150)&(hsv[...,1]<60)).astype(np.uint8)
    m[:, :400]=0; m[:, 1350:]=0; m[:430]=0; m[920:]=0
    m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((25,25),np.uint8)); nl,lb,st,_=cv2.connectedComponentsWithStats(m)
    mk=np.zeros(m.shape,np.float32)
    if nl>1:
        j=1+np.argmax(st[1:,4])
        if st[j,4]>15000: mk=cv2.erode((lb==j).astype(np.uint8),np.ones((15,15),np.uint8)).astype(np.float32)
    return mk
def build(test=False):
    A=read(glob.glob(V+'pexels-11537353-*.mp4')[0],0,300)
    bc=[(1180,840),(1360,860),(1300,1075),(1230,1075)]
    Hb=track(A,210,[(1000,700),(1500,700),(1500,1079),(1000,1079)])
    B=read(glob.glob(V+'pexels-11537350-*.mp4')[0],0,60)
    logos=[[(1300,600),(1450,595),(1455,650),(1300,655)],[(1320,685),(1480,680),(1485,735),(1320,740)],
           [(1240,720),(1560,715),(1565,775),(1240,780)],[(690,800),(950,790),(960,980),(690,990)],
           [(580,1005),(760,1005),(760,1075),(580,1075)],[(1330,905),(1580,900),(1580,990),(1330,995)],
           [(90,900),(170,900),(170,1079),(90,1079)],[(480,0),(760,0),(760,70),(480,70)],[(1180,470),(1360,470),(1360,580),(1180,580)]]
    Hg=track(B,0,[(950,300),(1700,300),(1700,1000),(950,1000)])
    PA=ell(1080,1920,0.47,0.52,0.62,0.95,1.2,0.22); PB=ell(1080,1920,0.47,0.40,0.62,0.95,1.2,0.22)
    def ga(i):
        f=A[i]; lm=lidmask(f); mk=np.maximum(lm,polymask(f.shape,[bc],Hb[i],dil=30)); f=blur_in(f,mk,10,dark=0.95)
        g=night_tone(brand(hero_night(f,'cpu')),pool=PA,comp=0.20,warm_hi=1.0,warm_s=0.60)
        # поле крышки — к графиту (не «бежевый брусок»), тёплым остаётся ребро крышки и золото контактов
        if lm.sum()>0: g=graphite(g,cv2.GaussianBlur(cv2.erode(lm,np.ones((21,21),np.uint8)),(0,0),9),dark=0.42,desat=0.55)
        return g
    def gb(i):
        f=blur_in(B[i],polymask(B[i].shape,logos,Hg[i],dil=24),12,dark=0.9)
        pool=ell(1080,1920,0.50,0.42,0.55,0.85,1.3,0.04)
        return night_tone(brand(night2(f,pool,exp=0.55,glare=neutral_glare(f,0.5,0.25,0.8,15))),pool=PB,comp=0.22,warm_hi=1.0,warm_s=0.60)
    # окна кадра: (x0,y0,w) компьютер 16:9, телефон 9:16 по высоте 1080
    WA=(0,145,1440); WB=(60,150,1440); MA=576; MB=596
    WC0=(0,145,1440); WC1=(200,250,1120)   # наезд на гнездо к концу
    def outA(g,w=WA,mx=MA,z=1.0):
        x0,y0,ww=w; return crop(g,x0,y0,ww,ww*9/16,DW,DH), crop(g,mx+(1-z)*304,(1-z)*540,608*z,1080*z,MW,MH)
    def outB(g): return crop(g,*WB[:2],WB[2],WB[2]*9/16,DW,DH), crop(g,MB,0,608,1080,MW,MH)
    D,M=[],[]
    def put(dm): D.append(dm[0]); M.append(dm[1])
    seq=[]
    for kind,a,b,n in CH:
        if kind in 'abc':
            for t in np.linspace(a,b,n): seq.append((kind,int(round(t))))
        else: seq.append((kind,n))
    if test: seq=[('a',0),('a',120),('a',240),('b',30),('c',300)]
    i=0
    while i<len(seq):
        k,v=seq[i]
        if k=='a': put(outA(ga(v)))
        elif k=='b': put(outB(gb(v)))
        elif k=='c':
            z=1-0.12*(v-262)/38; x0=WC0[0]+(WC1[0]-WC0[0])*(1-z)/0.12*0.5; y0=WC0[1]+(WC1[1]-WC0[1])*(1-z)/0.12*0.5; ww=1440*z
            put(outA(ga(v),(x0,y0,ww),MA,0.94+0.06*z))
        elif k in 'xy':
            # растворение: x — из гнезда (A 262) в винт M.2 (B 0); y — из B 60 в чистую плату (A 262)
            if k=='x': fa,fb=outA(ga(262)),outB(gb(0))
            else: fa,fb=outB(gb(60)),outA(ga(262),(WC0[0],WC0[1],WC0[2]),MA,1.0)
            for j in range(v):
                w=(j+0.5)/v; w=w*w*(3-2*w)
                put((cv2.addWeighted(fa[0],1-w,fb[0],w,0),cv2.addWeighted(fa[1],1-w,fb[1],w,0)))
        i+=1
    return D,M
if __name__=='__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='t':
        D,M=build(True);sheet('y-t',D,M,5);[print(stats(d)) for d in D];print(chapters())
        for j,d in enumerate(D): cv2.imwrite(f'int/y-t-{j}.jpg',d)
    else:
        D,M=build();write('y',D,M);print(chapters())
