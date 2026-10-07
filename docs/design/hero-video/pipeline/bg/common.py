# Запуск: python cx.py; python cy.py; python ct.py; python ci.py (-> int/), затем bash encode-clips.sh out, затем python stills.py out.
# Nivel, фон ниже первого экрана, раунд 10: общие функции (трекинг, маски, цвет как у первого экрана).
import sys,subprocess,glob,cv2,numpy as np
SP=r'C:/Users/v.kim/AppData/Local/Temp/claude/C--Users-v-kim/29922206-569a-4b39-90a7-6ac35168e528/scratchpad'
sys.path.insert(0,SP+'/hero-media/owner/work'); sys.path.insert(0,SP+'/hv/work'); sys.path.insert(0,SP+'/hv/w2')
from grade import brand                      # «фирменный» первого экрана
from nightmatch import night as hero_night   # перевод дня в ночь первого экрана (11537353, kind 'cpu')
V=SP+'/hero-media/video/'
DW,DH,MW,MH=1280,720,540,960

def read(p,a,b):
    c=cv2.VideoCapture(p);c.set(1,a);out=[]
    for i in range(a,b+1):
        ok,f=c.read()
        if not ok:break
        out.append(f)
    return out

def track(frames,ref,roi):
    g=[cv2.cvtColor(f,cv2.COLOR_BGR2GRAY) for f in frames]; n=len(g); H=[None]*n; H[ref]=np.eye(3)
    def run(rng):
        prev=ref
        for i in rng:
            m=np.zeros_like(g[prev]); cv2.fillPoly(m,[np.int32(cv2.perspectiveTransform(np.float32(roi)[None],H[prev])[0])],255)
            p0=cv2.goodFeaturesToTrack(g[prev],600,0.005,7,mask=m)
            if p0 is None or len(p0)<8: H[i]=H[prev]; prev=i; continue
            p1,st,_=cv2.calcOpticalFlowPyrLK(g[prev],g[i],p0,None,winSize=(31,31),maxLevel=4)
            ok=st[:,0]==1
            M=cv2.findHomography(p0[ok],p1[ok],cv2.RANSAC,3.0)[0] if ok.sum()>=8 else None
            H[i]=(M@H[prev]) if M is not None else H[prev]; prev=i
    run(range(ref+1,n)); run(range(ref-1,-1,-1)); return H

def polymask(shape,polys,H=None,dil=0):
    m=np.zeros(shape[:2],np.uint8)
    for p in polys:
        q=np.float32(p)[None]; q=cv2.perspectiveTransform(q,H)[0] if H is not None else q[0]
        cv2.fillPoly(m,[np.int32(q)],255)
    if dil: m=cv2.dilate(m,np.ones((dil,dil),np.uint8))
    return m.astype(np.float32)/255

def blur_in(f,m,sigma,dark=0.92):
    ys,xs=np.nonzero(m>0)
    if len(ys)==0: return f
    p=int(sigma*3)+4; h,w=m.shape
    y0,y1,x0,x1=max(0,ys.min()-p),min(h,ys.max()+p+1),max(0,xs.min()-p),min(w,xs.max()+p+1)
    F=f[y0:y1,x0:x1].astype(np.float32); mm0=m[y0:y1,x0:x1]
    mm=cv2.GaussianBlur(mm0,(0,0),max(2,sigma/3))[...,None]
    num=cv2.GaussianBlur(F*mm0[...,None],(0,0),sigma); den=cv2.GaussianBlur(mm0,(0,0),sigma)[...,None]
    B=num/np.maximum(den,1e-3)*dark
    out=f.copy(); out[y0:y1,x0:x1]=np.clip(F*(1-mm)+B*mm,0,255).astype(np.uint8); return out

_E={}
def ell(h,w,cx,cy,rx,ry,pw=1.3,floor=0.0):
    k=(h,w,cx,cy,rx,ry,pw,floor)
    if k not in _E:
        yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
        d=np.sqrt(((xx-cx*w)/(rx*w))**2+((yy-cy*h)/(ry*h))**2)
        _E[k]=(floor+(1-floor)*np.clip(1-d,0,1)**pw).astype(np.float32)
    return _E[k]

def night2(img,pool,exp=0.5,glare=None):
    """Тот же перевод в ночь, что nightmatch.night (первый экран): экспозиция, тёплый баланс лампы, мягкие света,
    пятно лампы pool (маска 0..1) вместо зашитых масок, плюс подавление бликов glare (0..1)."""
    x=img.astype(np.float32)/255.0; lin=x**2.2*exp
    lin=lin*np.float32([0.55,0.90,1.22]); lin=lin/(1.0+lin*1.4)*1.4
    m=pool if glare is None else pool*glare
    lin=lin*m[...,None]
    out=np.clip(lin,0,1)**(1/2.2); out=out*out*(3-2*out)*0.55+out*0.45
    floor=np.float32([27,29,31])/255.0*0.22; out=floor+out*(1-floor)
    return np.clip(out*255,0,255).astype(np.uint8)

def neutral_glare(img,thr=0.55,smax=0.22,k=0.7,blur=9):
    """серебристые блики (антистатический пакет, металл, окно): светлое и бесцветное -> вниз"""
    hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV).astype(np.float32)
    v=hsv[...,2]/255; s=hsv[...,1]/255
    m=np.clip((v-thr)/(1-thr),0,1)*np.clip((smax-s)/smax,0,1)
    m=cv2.GaussianBlur(m,(0,0),blur)
    return 1-k*m

def contrast(img,black=16,gain=1.09):
    """как у корпуса первого экрана: чёрная точка вниз"""
    return np.clip((img.astype(np.float32)-black)*gain,0,255).astype(np.uint8)

def floor_to(img,bgr=(11,12,14)):
    """чёрный не ниже фона страницы --stage #0E0C0B: без провалов в чистый 0 и без приподнятого «молока»"""
    f=np.float32(bgr); x=img.astype(np.float32)
    return np.clip(f+x*(1-f/255),0,255).astype(np.uint8)

def amber_only(img,keep_c=28,keep_w=16,rest=0.25):
    """один тёплый оранжевый: всё, что не янтарь, — к графиту (но не в ноль: графит чуть холоднее, как у первого экрана)"""
    x=img.astype(np.float32)/255; hsv=cv2.cvtColor(x,cv2.COLOR_BGR2HSV); H,S,Vv=cv2.split(hsv)
    d=np.abs(((H-keep_c+180)%360)-180); keep=np.clip(1-(d-keep_w)/24,0,1)
    S=S*(rest+(1-rest)*keep)
    return (np.clip(cv2.cvtColor(cv2.merge([H,S,Vv]),cv2.COLOR_HSV2BGR),0,1)*255).astype(np.uint8)

def crop(f,x0,y0,w,h,ow,oh,flip=False):
    if flip: f=cv2.flip(f,1)
    x0=int(round(min(max(0,x0),f.shape[1]-w))); y0=int(round(min(max(0,y0),f.shape[0]-h)))
    return cv2.resize(f[y0:y0+int(h),x0:x0+int(w)],(ow,oh),interpolation=cv2.INTER_AREA)

def hmix(H,t,w):
    """смешение тона по кругу (кратчайшей дугой): линейное смешение 300° и 26° проходит через зелёный — радуга"""
    d=((t-H+180.0)%360.0)-180.0
    return (H+d*w)%360.0

def place(f,s,cx,cy,ow,oh,ox,oy,flip=False,border=cv2.BORDER_REFLECT):
    """масштаб s, точка (cx,cy) исходника -> (ox,oy) кадра; вне исходника — чёрное"""
    if flip: f=cv2.flip(f,1); cx=f.shape[1]-1-cx
    M=np.float32([[s,0,ox-s*cx],[0,s,oy-s*cy]])
    out=cv2.warpAffine(f,M,(ow,oh),flags=cv2.INTER_AREA if s<1 else cv2.INTER_CUBIC,borderMode=border)
    inside=cv2.warpAffine(np.ones(f.shape[:2],np.float32),M,(ow,oh),flags=cv2.INTER_LINEAR,borderValue=0)
    return out,inside

def enc(p,w,h,fps=25):
    return subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r',str(fps),'-i','-',
        '-c:v','libx264','-crf','6','-preset','medium','-pix_fmt','yuv420p',p],stdin=subprocess.PIPE)

def write(k,D,M):
    pd,pm=enc(f'int/{k}-d.mp4',DW,DH),enc(f'int/{k}-m.mp4',MW,MH)
    for a,b in zip(D,M): pd.stdin.write(a.tobytes()); pm.stdin.write(b.tobytes())
    for p in (pd,pm): p.stdin.close(); p.wait()
    sheet(k,D,M); print(k,len(D),'frames')

def sheet(k,D,M,n=6):
    idx=np.linspace(0,len(D)-1,n).round().astype(int)
    top=np.hstack([cv2.resize(D[i],(480,270),interpolation=cv2.INTER_AREA) for i in idx])
    bot=np.hstack([cv2.resize(M[i],(270,480),interpolation=cv2.INTER_AREA) for i in idx])
    W=max(top.shape[1],bot.shape[1])
    pad=lambda a:np.hstack([a,np.zeros((a.shape[0],W-a.shape[1],3),np.uint8)]) if a.shape[1]<W else a
    cv2.imwrite(f'int/{k}-chk.jpg',np.vstack([pad(top),pad(bot)]),[cv2.IMWRITE_JPEG_QUALITY,90])

def stats(img):
    l=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY); return np.percentile(l,[1,50,95,99.5]).round().tolist()

def night_tone(img,bp=16,gamma=1.3,white=230,knee=0.30,comp=0.35,sat=0.55,metal_s=0.6,glint=0.10,glint_s=0.72,pool=None,warm_hi=0.0,warm_s=0.5):
    """кривая «как у первого экрана»: чёрная точка вниз, графитовые тени (насыщенность x sat), светлые места с
    невысокой насыщенностью (крышка, металл, пакет, бежевое) сжаты к графиту; на рёбрах металла — тёплый блик лампы
    (янтарь 26°, высокочастотная часть яркости) — единственный оранжевый, без бежевых полутонов"""
    x=np.clip((img.astype(np.float32)-bp)/(white-bp),0,1)**gamma
    if pool is not None: x=x*pool[...,None]
    hsv=cv2.cvtColor(x,cv2.COLOR_BGR2HSV); H,S,Vv=cv2.split(hsv)
    met=np.clip((metal_s-S)/0.2,0,1)*np.clip((Vv-0.2)/0.15,0,1)       # светлое и не насыщенное — металл/крышка
    Vc=np.where(Vv>knee,knee+(Vv-knee)*comp,Vv); V2=Vv*(1-met)+Vc*met
    S=S*(0.55*sat+0.65*sat*np.clip((S-0.3)/0.3,0,1))*(1-0.75*met)   # низкая насыщенность -> графит, кожа остаётся тёплой
    hp=np.clip((Vv-cv2.GaussianBlur(Vv,(0,0),6))/glint,0,1)*met*np.clip((Vv-0.45)/0.25,0,1)   # рёбра светлого металла
    hp=cv2.GaussianBlur(hp,(0,0),1.2)
    H=hmix(H,26,hp); S=S*(1-hp)+glint_s*hp; V2=np.clip(V2+hp*(Vv-V2)*0.9,0,1)
    if warm_hi:   # светлый металл под лампой — тёплый (медь), тени — графит
        w=np.clip((V2-0.26)/0.22,0,1)*met*warm_hi; H=hmix(H,26,w); S=S*(1-w)+warm_s*w
    out=cv2.cvtColor(cv2.merge([H,S,V2]),cv2.COLOR_HSV2BGR)
    return floor_to((np.clip(out,0,1)*255).astype(np.uint8),(10,11,13))

def warm_spot(img,mask,s=0.72,v_thr=0.12,dark=0.0,lift=1.0,add=0.0,vt=0.82):
    """пятно лампы на детали: в маске светлое уходит в янтарь 26° (единственный оранжевый кадра);
    dark — сначала притемнить поле детали (крышка -> графит)"""
    x=img.astype(np.float32)/255; hsv=cv2.cvtColor(x,cv2.COLOR_BGR2HSV); H,S,Vv=cv2.split(hsv)
    m=np.clip(mask,0,1)
    Vv=Vv*(1-dark*m)
    w=m*np.clip((Vv-v_thr)/0.25,0,1)
    H=hmix(H,26,w); S=S*(1-w)+s*w; Vv=np.clip(Vv*(1+(lift-1)*w),0,1)
    if add: a=m*add; H=hmix(H,26,a); S=S*(1-a)+s*a; Vv=Vv*(1-a)+vt*a   # свет лампы добавляется, а не только окрашивает
    return (np.clip(cv2.cvtColor(cv2.merge([H,S,Vv]),cv2.COLOR_HSV2BGR),0,1)*255).astype(np.uint8)

def place_fade(f,s,cx,cy,ow,oh,ox,oy,feather=70,flip=False):
    """place() с чёрным полем вне исходника и мягким спадом к краю исходника — край не читается"""
    o,ins=place(f,s,cx,cy,ow,oh,ox,oy,flip=flip,border=cv2.BORDER_CONSTANT)
    d=cv2.distanceTransform((ins>0.5).astype(np.uint8),cv2.DIST_L2,5)
    a=np.clip(d/feather,0,1); a=a*a*(3-2*a)
    return np.clip(o.astype(np.float32)*a[...,None],0,255).astype(np.uint8)

def graphite(img,mask,dark=0.5,desat=0.75):
    """поле детали -> графит: темнее и почти без цвета"""
    x=img.astype(np.float32)/255; hsv=cv2.cvtColor(x,cv2.COLOR_BGR2HSV); H,S,Vv=cv2.split(hsv)
    m=np.clip(mask,0,1); Vv=Vv*(1-dark*m); S=S*(1-desat*m)
    return (np.clip(cv2.cvtColor(cv2.merge([H,S,Vv]),cv2.COLOR_HSV2BGR),0,1)*255).astype(np.uint8)
