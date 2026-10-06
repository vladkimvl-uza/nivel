# step 02: CPU close-up only (bits-in-box cut), longer: 0.7-7.9 s of source -> 4.4 s
import sys,subprocess,cv2,numpy as np,pathlib
sys.path.insert(0,r'C:/Users/v.kim/AppData/Local/Temp/claude/C--Users-v-kim/29922206-569a-4b39-90a7-6ac35168e528/scratchpad/hv/work')
from nightmatch import both
V=pathlib.Path(r'C:/Users/v.kim/AppData/Local/Temp/claude/C--Users-v-kim/29922206-569a-4b39-90a7-6ac35168e528/scratchpad/hero-media/video')
f=next(V.glob('pexels-11537353-*.mp4'))
cap=cv2.VideoCapture(str(f)); sfps=cap.get(cv2.CAP_PROP_FPS); fr=[];ok=True
while ok:
    ok,x=cap.read()
    if ok: fr.append(x)
def enc(p): return subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','25','-i','-','-c:v','libx264','-crf','10','-preset','medium','-pix_fmt','yuv420p',p],stdin=subprocess.PIPE)
po,pb=enc('seg-cpu-orig.mp4'),enc('seg-cpu-brand.mp4')
a,b,n=0.7,7.9,110
for k in range(n):
    t=a+(b-a)*k/(n-1); x=fr[min(len(fr)-1,int(round(t*sfps)))]
    if x.shape[1]!=1920: x=cv2.resize(x,(1920,1080),interpolation=cv2.INTER_AREA)
    o,br=both(x,'cpu'); po.stdin.write(o.tobytes()); pb.stdin.write(br.tobytes())
for p in (po,pb): p.stdin.close(); p.wait()
print('cpu',n,sfps)
