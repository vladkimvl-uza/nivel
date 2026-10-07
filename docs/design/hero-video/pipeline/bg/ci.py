# i — «Идеи», 05 · монтаж места по чертежу: общий план стола ночью (14203522 очищенный, кадры 96–188; на первом экране —
# тот же отрезок во весь кадр, здесь — свой кадр: стол, клавиатура, колонки). Экраны обоих мониторов (там конфигуратор
# Nivel первого экрана) по трекингу размыты σ 14 и притемнены — не читаются, кадр не выглядит как «наш сданный заказ».
from common import *
def build(test=None):
    F=read(SP+'/hv/w2/clean142-new.mp4',96,188)
    mon=[(453,327),(1180,327),(1180,760),(453,760)]; monL=[(-500,280),(273,309),(287,887),(-500,915)]
    H=track(F,0,mon); HL=track(F,0,[(10,300),(270,312),(282,880),(10,890)])
    pool=ell(1080,1920,0.40,0.62,0.62,0.80,1.1,0.18)
    idx=[int(round(i)) for i in np.linspace(0,len(F)-1,48)] if test is None else test
    D,M=[],[]
    for i in idx:
        f=F[i]; m=np.maximum(polymask(f.shape,[mon],H[i],dil=24),polymask(f.shape,[monL],HL[i],dil=40))
        f=blur_in(f,m,16,dark=0.32)   # экраны — тёмные, без текста
        g=night_tone(brand(f),bp=10,gamma=1.35,pool=pool,comp=0.35)
        D.append(crop(g,0,150,1650,928,DW,DH)); M.append(crop(g,560,0,608,1080,MW,MH))
    return D,M
if __name__=='__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='t':
        D,M=build([0,46,92]);sheet('i-t',D,M,3);[print(stats(d)) for d in D];cv2.imwrite('int/i-t-d.jpg',D[1]);cv2.imwrite('int/i-t-m.jpg',M[1])
    else:
        D,M=build();write('i',D,M)
