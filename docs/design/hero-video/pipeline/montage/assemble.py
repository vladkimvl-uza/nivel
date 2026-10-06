# Story montage v2 (25 fps): S1 14203522 (0-95) -> S2 CPU -> S3 case 13075121 -> S4 14203522 (95-188); dissolves 8 frames (0.32 s).
# Writes per colour: master-<c>.mp4 (1920x1080, CRF 12) and phone-<c>.mp4 (720x1280 vertical, per-step pan), both intermediates.
import sys,subprocess,json,cv2,numpy as np
sys.path.insert(0,r'C:/Users/v.kim/AppData/Local/Temp/claude/C--Users-v-kim/29922206-569a-4b39-90a7-6ac35168e528/scratchpad/hero-media/owner/work')
from grade import brand
D=8
class R:
    def __init__(s,p,a=0): s.c=cv2.VideoCapture(p); s.i=-1; s.f=None; s.a=a
    def get(s,k):
        k+=s.a
        while s.i<k:
            ok,f=s.c.read()
            if not ok: break
            s.f=f; s.i+=1
        return s.f
def segs(c):
    s142=lambda a: R('clean142-new.mp4',a)
    return [dict(r=s142(0),n=96,kind='142',px=(840,900)),
            dict(r=R(f'seg-cpu-{c}.mp4'),n=110,kind='x',px=(885,900)),
            dict(r=R(f'seg-case-{c}.mp4'),n=75,kind='x',px=(1240,1240)),
            dict(r=s142(95),n=94,kind='142',px=(1000,1660),hold=.3)]   # phone: first hold on the screen with the estimate, then pan to speaker + case
def plan():
    st=0; out=[]
    L=[96,110,75,94]
    for k,n in enumerate(L):
        out.append((st,st+n)); st+=n-D
    return out,st+D
SPAN,TOTAL=plan()
def ease(x): return x*x*(3-2*x)
def phone_crop(img,cx):
    w=608; x0=int(round(min(1920-w,max(0,cx-w/2))))
    return cv2.resize(img[:,x0:x0+w],(720,1280),interpolation=cv2.INTER_CUBIC)
def enc(p,w,h): return subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r','25','-i','-','-c:v','libx264','-crf','12','-preset','medium','-pix_fmt','yuv420p',p],stdin=subprocess.PIPE)
c=sys.argv[1]
S=segs(c)
pm,pp=enc(f'master-{c}.mp4',1920,1080),enc(f'phone-{c}.mp4',720,1280)
for t in range(TOTAL):
    layers=[]
    for k,(a,b) in enumerate(SPAN):
        if a<=t<b:
            sg=S[k]; li=t-a; f=sg['r'].get(li).astype(np.float32)
            if sg['kind']=='142' and c=='brand': f=brand(f.astype(np.uint8)).astype(np.float32)
            u=li/max(1,sg['n']-1); h=sg.get('hold',0); u=max(0,(u-h)/(1-h)); cx=sg['px'][0]+(sg['px'][1]-sg['px'][0])*ease(u)
            w=1.0
            if k>0 and li<D: w=(li+0.5)/D
            layers.append((f,cx,w))
    if len(layers)==1: f,cx,_=layers[0]; M=f; P=phone_crop(f,cx)
    else:
        (f0,c0,_),(f1,c1,w)=layers; w=ease(w)
        M=f0*(1-w)+f1*w; P=phone_crop(f0,c0)*(1-w)+phone_crop(f1,c1)*w
    pm.stdin.write(np.clip(M,0,255).astype(np.uint8).tobytes()); pp.stdin.write(np.clip(P,0,255).astype(np.uint8).tobytes())
for p in (pm,pp): p.stdin.close(); p.wait()
cuts=[(SPAN[k][0]+D/2)/25 for k in range(1,4)]
json.dump(dict(frames=TOTAL,dur=TOTAL/25,spans=SPAN,cuts_mid_s=cuts,dissolves=[[SPAN[k][0]/25,(SPAN[k][0]+D)/25] for k in range(1,4)]),open(f'timeline-{c}.json','w'))
print(c,TOTAL,TOTAL/25,cuts)
