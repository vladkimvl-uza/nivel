import cv2,numpy as np,sys,subprocess
sys.path.insert(0,'.')
from casefx import geom,night,tame
sys.path.insert(0,r'C:/Users/v.kim/AppData/Local/Temp/claude/C--Users-v-kim/29922206-569a-4b39-90a7-6ac35168e528/scratchpad/hero-media/owner/work')
from grade import brand
from comp import masked_blur
cap=cv2.VideoCapture(r'C:/Users/v.kim/AppData/Local/Temp/claude/C--Users-v-kim/29922206-569a-4b39-90a7-6ac35168e528/scratchpad/hero-media/owner/work/clean-13075121.mp4')
fr=[];ok=True
while ok:
  ok,f=cap.read()
  if ok: fr.append(f)
A,B,N=100,220,75
G={i:geom(fr[i]) for i in range(A,B+1)}
# track the pump display (mirrored digits) from frame 135 both ways
gray=lambda im:cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)
pos={135:(1320,465)}
T=gray(G[135])[465-30:465+30,1320-36:1320+36]
def step(i,prev):
    x,y=prev; r=70; g=gray(G[i])
    x0,y0=max(0,x-36-r),max(0,y-30-r)
    S=g[y0:y+30+r,x0:x+36+r]
    res=cv2.matchTemplate(S,T,cv2.TM_CCOEFF_NORMED); _,mv,_,ml=cv2.minMaxLoc(res)
    return (x0+ml[0]+36,y0+ml[1]+30),mv
for i in range(136,B+1): pos[i],_=step(i,pos[i-1])
for i in range(134,A-1,-1): pos[i],_=step(i,pos[i+1])
def enc(p): return subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','25','-i','-','-c:v','libx264','-crf','10','-preset','medium','-pix_fmt','yuv420p',p],stdin=subprocess.PIPE)
po,pb=enc('seg-case-orig.mp4'),enc('seg-case-brand.mp4')
log=[]
for k in range(N):
    t=A+(B-A)*k/(N-1); i=int(round(t)); g=G[i].astype(np.float32)
    x,y=pos[i]; m=np.zeros(g.shape[:2],np.float32); cv2.ellipse(m,(int(x),int(y)),(30,26),0,0,360,1,-1)
    g=masked_blur(g,m,9,dark=0.7,feather=3)
    o=night(np.clip(g,0,255).astype(np.uint8)); b=np.clip((brand(tame(o)).astype(np.float32)-16)*1.09,0,255).astype(np.uint8)
    po.stdin.write(o.tobytes()); pb.stdin.write(b.tobytes()); log.append((i,x,y))
    if k in (0,37,74): cv2.imwrite(f'case_k{k}.jpg',np.hstack([cv2.resize(o,(960,540)),cv2.resize(b,(960,540))]))
for p in (po,pb): p.stdin.close(); p.wait()
print(log[::10])
