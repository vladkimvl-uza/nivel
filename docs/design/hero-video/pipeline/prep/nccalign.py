import cv2,numpy as np,json,sys
tw,th=1280,720; T=np.float32([[0,0],[tw,0],[tw,th],[0,th]])
SC=0.5  # work scale
def mag(img):
    b,g,r=[c.astype(np.float32) for c in cv2.split(img)]
    return (r+b)/2-g
def prep_frame(f):
    m=mag(cv2.resize(f,None,fx=SC,fy=SC,interpolation=cv2.INTER_AREA))
    m=cv2.GaussianBlur(m,(0,0),1.0)
    return m-cv2.GaussianBlur(m,(0,0),12)
def prep_tmpl(rect,blur=1.5):
    t=mag(cv2.resize(rect,None,fx=SC,fy=SC,interpolation=cv2.INTER_AREA))
    t=cv2.GaussianBlur(t,(0,0),blur)
    return t
CROP=[0,0]
def score(q,tm,img,wmask):
    """q: 4x2 frame coords (full res). NCC of warped template vs image within warped mask; img may be a crop at offset CROP (work-scale px)"""
    R=cv2.getPerspectiveTransform(T*SC,np.float32(q)*SC-np.float32(CROP))
    h,w=img.shape
    pw=cv2.warpPerspective(tm,R,(w,h)); mw=cv2.warpPerspective(wmask,R,(w,h))>0.5
    if mw.sum()<200: return -1
    pw=pw-cv2.GaussianBlur(pw,(0,0),12)
    a=pw[mw]; b=img[mw]; a=a-a.mean(); b=b-b.mean()
    return float((a*b).sum()/np.sqrt((a*a).sum()*(b*b).sum()+1e-6))
def refine(q,tm,img,wmask,steps=(8,4,2,1,0.5),iters=3):
    q=np.float32(q).copy(); best=score(q,tm,img,wmask)
    for st in steps:
        for it in range(iters):
            improved=False
            for c in range(4):
                for j in range(2):
                    for d in (-st,st):
                        q2=q.copy(); q2[c,j]+=d; s=score(q2,tm,img,wmask)
                        if s>best: best=s;q=q2;improved=True
            # global translation moves
            for dx,dy in ((st,0),(-st,0),(0,st),(0,-st)):
                q2=q+np.float32([dx,dy]); s=score(q2,tm,img,wmask)
                if s>best: best=s;q=q2;improved=True
            if not improved: break
    return q,best
if __name__=='__main__':
    main=json.load(open('trk_140_main.json'))['frames']
    q=np.float32(json.loads(sys.argv[1])); i=int(sys.argv[2])
    cap=cv2.VideoCapture('src-14098235.mp4'); cap.set(cv2.CAP_PROP_POS_FRAMES,i); ok,f=cap.read()
    H=np.array(main[str(i)]['H']); rect=cv2.warpPerspective(f,np.linalg.inv(H),(tw,th))
    tm=prep_tmpl(rect); img=prep_frame(f)
    wm=(cv2.GaussianBlur(tm,(0,0),6)>25).astype(np.float32)  # letters/bright magenta areas
    print('init',score(q,tm,img,wm))
    q2,b=refine(q,tm,img,wm,steps=(16,8,4,2,1,0.5))
    print('final',b,q2.round(1).tolist())
    R=cv2.getPerspectiveTransform(T,q2); pred=cv2.warpPerspective(rect,R,(1920,1080))
    e=cv2.Canny(cv2.cvtColor(pred,cv2.COLOR_BGR2GRAY),60,150); v=f.copy(); v[e>0]=(0,255,0)
    cv2.imwrite('ovl.jpg',np.hstack([f[150:700,950:1650],v[150:700,950:1650]]))
