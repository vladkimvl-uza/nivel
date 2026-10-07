# Неподвижные кадры фона, раунд 10.
#   k-{d,m}.webp — «Как работаем», конфигуратор, паспорт: свет лампы в расфокусе (14203522 очищенный, кадр 40;
#                  весь кадр в сильном расфокусе — экраны, предметы и место не читаются);
#   c-{d,m}.webp — цены, акт, гарантия, финал: тёмный стол, тёплое пятно лампы справа внизу — за правым краем
#                  документа (тот же ролик, кадр 170, расфокус сильнее; не узнать ни место, ни сетап);
#   x/y/t/i-{d,m}.webp — постеры этапов (reduced motion и режим без видео): конечное состояние этапа = последний кадр.
import sys
from common import *
OUT=sys.argv[1] if len(sys.argv)>1 else 'out'
def webp(img,p,q): cv2.imwrite(p,img,[cv2.IMWRITE_WEBP_QUALITY,q])
def bokeh(f,sigma,pool,ow,oh,x0=0,w=1920):
    x=cv2.resize(f[:, x0:x0+w],(ow,oh),interpolation=cv2.INTER_AREA)
    x=cv2.GaussianBlur(x,(0,0),sigma*ow/960)
    return night_tone(brand(x),bp=10,gamma=1.2,pool=pool,comp=0.45)
F=read(SP+'/hv/w2/clean142-new.mp4',40,170)
k=F[0]
webp(bokeh(k,17,ell(DH,DW,0.42,0.38,0.85,1.0,1.2,0.25),DW,DH),OUT+'/k-d.webp',62)
webp(bokeh(k,17,ell(MH,MW,0.5,0.38,1.2,0.75,1.2,0.25),MW,MH,656,608),OUT+'/k-m.webp',62)
c=F[130]
# пятно лампы: тёплое, справа внизу (за правым краем акта и гарантии); в остальном — почти чёрный стол
cd=bokeh(c,26,ell(DH,DW,0.86,0.70,0.42,0.75,1.5,0.06),DW,DH)
cd=warm_spot(cd,ell(DH,DW,0.90,0.74,0.34,0.62,1.5,0.0),s=0.66,v_thr=0.02,add=0.75,vt=0.62)
cm=bokeh(c,26,ell(MH,MW,0.80,0.80,0.9,0.42,1.5,0.06),MW,MH,656,608)
cm=warm_spot(cm,ell(MH,MW,0.86,0.86,0.8,0.32,1.5,0.0),s=0.66,v_thr=0.02,add=0.7,vt=0.56)
webp(cd,OUT+'/c-d.webp',62); webp(cm,OUT+'/c-m.webp',62)
for kk in 'xyti':
    for L in 'dm':
        cap=cv2.VideoCapture(f'int/{kk}-{L}.mp4'); n=int(cap.get(7))
        # постер: конечное состояние этапа; у теста (петля) — середина петли
        cap.set(1,n//2 if kk=='t' else n-1); ok,f=cap.read(); webp(f,f'{OUT}/{kk}-{L}.webp',58)
print('ok')
