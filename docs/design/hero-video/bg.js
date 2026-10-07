/* Nivel — фон ниже первого экрана: «Один заказ под лампой» (06.10.2026, раунд 9: реальные ролики вместо 3D-сцены;
   07.10.2026, раунд 10: цвет как у первого экрана, 1280/540 px, своя полоса «04 Тест», кадр сборки идёт по списку деталей).
   Грузится лениво: после 60 % трека первого экрана, прокрутки к разделам, перехода по якорю или через 5 с после load.
   Прокрутка = время заказа NV-0001: вниз время идёт вперёд, вверх — назад. Состояние считается из доли раздела.
   Без прокрутки процесс идёт сам, пока раздел на экране: чеки приходят, детали встают в корпус, часы теста идут,
   чертёж дочерчивается, на линейке мигает курсор. Стоп: скрытая вкладка, «Без анимации», prefers-reduced-motion.
   За документами — реальные ролики по этапам (стоковые Pexels и ролики владельца, ночь, цвет «фирменный»):
   03 Закупка — процессор в руке под лампой, 04 Сборка — кадр по пункту списка (гнездо, процессор, винт M.2, чистая плата),
   04 Тест — своя полоса: корпус под нагрузкой (петля) и часы теста поверх, паспорт — на свете лампы,
   05 Монтаж («Идеи», на линейке «05 Монтаж», не «Сдача») — общий план стола, экраны погашены.
   Пока на фоне чужая съёмка, видна подпись «Иллюстрация. Не работа студии» — как на первом экране, внизу справа.
   Сдача, акт, гарантия и финал — без узнаваемой съёмки: тёмный стол с тёплым пятном лампы (сток в сильном расфокусе) и знак.
   Ролики качаются лениво: ролик этапа — когда открыт соседний этап. Прокрутка перематывает ролик; без прокрутки
   он доигрывает до конца сам. Reduced motion и режим без видео — постеры этапов, ни одного видео. */
(function(){
  var NV=window.NV;if(!NV||NV.bg)return;
  var T=NV.T,$=function(i){return document.getElementById(i)};
  var ob=$('ob'),sc=$('obSc'),fst=$('finSt'),ord=$('ord'),ordT=$('ordT'),ordS=$('ordS'),ordSt=$('ordSt'),ordId=$('ordId'),lv=$('ordLv');
  var imgs=[].slice.call(sc.querySelectorAll('img')),RED=NV.mode==='reduced',DIR='media/bg/',il=$('obIl');
  var SM=NV.small(),L=SM?'m':'d',bar=$('cfgBar'),rcs=$('rcs'),rsum=$('rcsSum'),bXl=$('bXl'),bYl=$('bYl'),asm=$('asm');
  var tlog=document.querySelector('.tlog'),tlogC=$('tlogC'),bp=$('bp'),rst=document.querySelector('.rstamp'),tclk=$('tclk'),tclkH=$('tclkH'),bTl=$('bTl'),tclkL=$('tclkL'),tclkO=$('tclkO');
  /* ворота те же, что у первого экрана; на телефоне видео — только при памяти ≥ 4 ГБ; ?bg=frames — для проверки */
  var VID=!RED&&NV.gateInfo.ok&&NV.qs.get('bg')!=='frames'&&!(SM&&(navigator.deviceMemory||4)<4);
  var ST=[['Заявка','Buyurtma'],['Смета','Smeta'],['Оплата','Toʻlov'],['Закупка','Xarid'],['Сборка и тест','Yigʻish va sinov'],['Сдача','Topshirish'],['Гарантия','Kafolat']];
  var Z=[['kak','kak-rabotaem','l','#kak-rabotaem'],['cfg','konfigurator','u','#konfigurator'],['xarid','xarid','b',0,1],['yig','yigish','b',0,1],['sin','sinov','b',0,1],['pas','pasport','l'],['idei','idei','l','#idei'],['ceny','ceny','c','#ceny'],['fin','yakun','f',0,1]]
    .map(function(a){return {id:a[0],el:$(a[1]),sh:a[2],nav:a[3],band:!!a[4]}});
  var FIN=8;
  /* черта знака в кадре финала на 0,52 с (render-logo.cjs → NV_LOGO.box), в координатах кадра после encode-logo.py */
  var BX={d:{w:1280,l:[474,354.3,783.2,419.6]},m:{w:540,l:[200,252,331.6,278]}};
  /* кадр фона по разделам: k — свет лампы (боке), x/y/t/i — ролики этапов, c — тёмный стол с пятном лампы */
  var KEY=['k','k','x','y','t','k','i','c','c'],VK={x:1,y:1,t:1,i:1};
  /* сборка: доля ролика y, с которой начинается пункт списка 0..7 (pipeline/bg/cy.py chapters()): плата — пустое гнездо,
     процессор — рука ставит процессор, кулер и память — процессор в гнезде, M.2 — винт отвёрткой, 6–8 — чистая плата */
  var YC=[0,0.0962,0.3846,0.4423,0.5769,0.7692,0.8462,0.9231,1];
  function ymap(u){u=cl(u)*8;var k=Math.min(7,Math.floor(u));return YC[k]+(YC[k+1]-YC[k])*(u-k)}
  /* сборка: детали в порядке установки — те же позиции, что в смете NV-0001 */
  var AS=['mb','cpu','cool','ram','ssd','gpu','psu'];
  var G={},lit=null,zi=-1,raf=0,frozen=false,rel=false,navs=[].slice.call(document.querySelectorAll('.nav a'));
  var life={x:0,y:0,h:0,d:0,t:0},lifeT=0,need=false,lastWin=-1,wtk='',shW=ob.querySelector('.ob-sh.w');
  function cl(v){return v<0?0:v>1?1:v}
  function sm(v){v=cl(v);return v*v*(3-2*v)}
  function money(n){return Math.round(n).toLocaleString('ru-RU').replace(/\s/g,' ')}

  /* ---------- геометрия: только по resize / смене размеров, не на каждый кадр ---------- */
  function measure(){
    var y=scrollY,vh=innerHeight;G.vh=vh;
    function top(el){return el.getBoundingClientRect().top+y}
    var tr=$('heroTrack');G.heroEnd=top(tr)+tr.offsetHeight;
    Z.forEach(function(z){var t=top(z.el),h=z.el.offsetHeight;z.t=t;z.h=h;z.a=z.band?t-.35*vh:t;z.b=z.band?t+h+.35*vh:t+h});
    for(var i=1;i<Z.length;i++){if(Z[i].band)Z[i-1].b=Z[i].a;else Z[i].a=Z[i-1].b}
    G.max=document.documentElement.scrollHeight-vh;Z[FIN].b=G.max+vh;
    G.kak=Z[0].t;G.docs=top(document.querySelector('#kak-rabotaem .docs'));G.gdoc=top(document.querySelector('.gdoc'));
    var r=document.querySelector('.route');G.rt=top(r);G.rh=r.offsetHeight;
    var fr=fst.getBoundingClientRect();G.fsT=fr.top+y;G.fsH=fr.height;G.fsW=fr.width;G.fsL=fr.left;
    G.finS=Z[FIN].t-.6*vh;G.lvTop=parseFloat(getComputedStyle(lv).top)||0;
    G.win=[].slice.call(document.querySelectorAll('.win')).filter(function(w){return w.offsetHeight>0}).map(function(w){return [top(w),w.offsetHeight]});
  }
  /* доля закреплённой сцены полосы: от входа стола в кадр до конца закрепления */
  function pin(z,y){return cl((y-(z.t-.3*G.vh))/(z.h-.7*G.vh))}

  /* ---------- фон: два слоя-картинки на смену (свет лампы, постеры) и ролики этапов поверх ---------- */
  var slot=0,shown='',want='',seen={},fv=null,lp=null,fp=[];
  function src(k){return DIR+k+'-'+L+'.webp'}
  function pre(k){if(!k||seen[k])return;seen[k]=1;var i=new Image();i.decoding='async';i.src=src(k)}
  function scene(k){
    want=k;if(!k||k===shown)return;
    var im=imgs[slot^1],u=src(k);
    function go(){if(want!==k)return;imgs.forEach(function(e){e.classList.toggle('is-on',e===im)});slot^=1;shown=k}
    if(im.getAttribute('src')===u){go();return}
    im.src=u;seen[k]=1;(im.decode?im.decode():Promise.resolve()).then(go,go);
  }
  /* перемотка ролика по прокрутке: следующая перемотка — после отрисовки прошлой, очередь не копится */
  function Scr(v,fps){var o={v:v,fps:fps,t:0,last:-1,busy:false,ok:false};
    v.addEventListener('loadeddata',function(){o.ok=true;o.last=-1;sk(o)});
    v.addEventListener('seeked',function(){o.busy=false;sk(o)});
    v.addEventListener('emptied',function(){o.ok=false;o.busy=false;o.last=-1});return o}
  function sk(o){if(!o.ok||o.busy||o.play)return;var d=o.v.duration||0,t=d?Math.min(o.t,d-.02):o.t,n=Math.round(t*o.fps);if(n===o.last)return;o.last=n;o.busy=true;try{o.v.currentTime=n/o.fps+.004}catch(e){o.busy=false}}
  function vid(cls){var v=document.createElement('video');v.muted=true;v.playsInline=true;v.setAttribute('playsinline','');v.setAttribute('disablepictureinpicture','');v.setAttribute('disableremoteplayback','');v.tabIndex=-1;v.preload='auto';if(cls)v.className=cls;return v}

  /* ролики этапов: x, y, i — перемотка прокруткой (H.264 без B-кадров, ключ каждые 6 кадров), t — петля */
  var clips={},vcur='',idleT=0,ilk=null;
  function clip(k){
    var c=clips[k];if(c)return c;
    var v=vid();c=clips[k]=Scr(v,25);c.k=k;c.loop=k==='t';c.ex=0;c.ps=-1;c.play=false;
    if(c.loop)v.loop=true;
    v.addEventListener('loadeddata',function(){show();idleSoon()});
    v.addEventListener('ended',function(){if(c.play){c.play=false;c.ex=Math.max(0,(v.duration||0)-c.ps)}});
    /* стоп в конце главы (сборка: кадр идёт вместе со списком деталей) — по кадру видео, где есть requestVideoFrameCallback */
    function atStop(){if(c.play&&c.stop&&v.currentTime>=c.stop-.03){c.play=false;v.pause();c.ex=Math.max(0,v.currentTime-c.ps);c.t=v.currentTime}}
    v.addEventListener('timeupdate',atStop);
    if(v.requestVideoFrameCallback){var vf=function(){atStop();if(clips[k]===c)v.requestVideoFrameCallback(vf)};v.requestVideoFrameCallback(vf)}
    v.src=DIR+k+'-'+L+'.mp4';sc.appendChild(v);return c;
  }
  function dropClip(k){var c=clips[k];if(!c)return;c.v.pause();c.v.removeAttribute('src');c.v.load();c.v.remove();delete clips[k];if(vcur===k)vcur=''}
  function dropAll(){for(var k in clips)dropClip(k);vcur=''}
  function pauseC(c){if(c&&c.play){c.play=false;c.v.pause()}}
  function show(){for(var k in clips){var c=clips[k];c.v.classList.toggle('is-on',k===vcur&&c.ok)}}
  function playC(c){if(c.play||!c.ok||document.hidden||RED)return;c.play=true;c.busy=false;var pr=c.v.play();if(pr&&pr.catch)pr.catch(function(){c.play=false})}
  /* p — доля этапа по прокрутке; ex — сколько ролик доиграл сам без прокрутки (прокрутка вверх съедает его быстрее) */
  function setClip(k,p){
    vcur=k;var c=clip(k);for(var o in clips)if(o!==k)pauseC(clips[o]);
    if(c.loop){show();idleSoon();return}
    var d=c.v.duration||2.4,ts=p*d;if(c.ps<0)c.ps=ts;var dp=ts-c.ps;c.ps=ts;
    if(dp){if(c.play){c.ex=Math.max(0,c.v.currentTime-ts);pauseC(c)}if(dp<0)c.ex=Math.max(0,c.ex+2*dp)}
    c.t=Math.min(d,ts+c.ex);sk(c);show();
  }
  function idle(){idleT=0;var c=clips[vcur];if(!c||!c.ok)return;if(c.loop||(c.t<(c.v.duration||0)-.08&&!(c.stop&&c.t>=c.stop-.06)))playC(c)}
  function idleSoon(){if(!idleT)idleT=setTimeout(idle,450)}
  function stage(k,p){
    if(VID&&VK[k]){if(!shown)scene('k');setClip(k,p||0)}
    else{if(vcur){pauseC(clips[vcur]);vcur='';show()}scene(k)}
    var on=!!VK[k]&&!!lit;if(il&&on!==ilk){ilk=on;il.classList.toggle('is-in',on)}
  }
  function ensureFin(){
    if(fst.firstChild)return;
    if(VID){fv=Scr(vid('is-on'),25);fv.v.src=DIR+'fin-intro-'+L+'.mp4';lp=vid();lp.loop=true;lp.preload='none';fst.appendChild(fv.v);fst.appendChild(lp)}
    else{fp=(RED?['fin']:['fin0','fin']).map(function(k,i){var im=new Image();im.alt='';im.decoding='async';im.src=src(k);if(!i)im.className='is-on';fst.appendChild(im);return im})}
  }
  function dropFin(){if(fv){fv.v.removeAttribute('src');fv.v.load();lp.removeAttribute('src');lp.load()}fst.innerHTML='';fv=lp=null;fp=[];looping=false}
  var looping=false;
  function loop(on){
    if(!lp||on===looping)return;looping=on;
    if(on){if(!lp.getAttribute('src'))lp.src=DIR+'fin-loop-'+L+'.mp4';try{lp.currentTime=0}catch(e){}
      var pr=lp.play();(pr&&pr.then?pr:Promise.resolve()).then(function(){if(looping){lp.classList.add('is-on');fv.v.classList.remove('is-on')}},function(){looping=false})}
    else{lp.pause();fv.v.classList.add('is-on');lp.classList.remove('is-on')}
  }

  /* ---------- жизнь без прокрутки: шаг 200 мс, только пока нужный раздел на экране ---------- */
  function lifeTick(){
    lifeT=0;if(RED||document.hidden||!need)return;
    var now=performance.now(),dt=Math.min(.6,(now-life.t)/1000);life.t=now;
    if(zi===2)life.x+=dt/2.6;else if(zi===3)life.y+=dt/2.2;else if(zi===4)life.h+=dt/4;else if(zi===6)life.d+=dt/7;
    kick();lifeT=setTimeout(lifeTick,200);
  }
  function lifeGo(){if(need&&!lifeT&&!RED&&!document.hidden){life.t=performance.now();lifeT=setTimeout(lifeTick,200)}}
  document.addEventListener('visibilitychange',function(){if(document.hidden){loop(false);clearTimeout(lifeT);lifeT=0;for(var k in clips)pauseC(clips[k])}else{kick();idleSoon()}});

  /* ---------- линейка «Ход заказа» ---------- */
  var lis=[],rk='',stk='';
  /* шаг 05 в «Идеях» подписан «Монтаж», не «Сдача»: чужой стол не выдаётся за наш сданный заказ (LICENSES.md §7.4.6) */
  var MON=['Монтаж','Montaj'],mon=false;
  function stN(i){var a=i===5&&mon?MON:ST[i];return T(a[0],a[1])}
  function ticks(){ordT.innerHTML=ST.map(function(s,i){return '<li><b>0'+i+'</b><span>'+NV.esc(stN(i))+'</span></li>'}).join('');lis=[].slice.call(ordT.children);rk='';stk='';
    ordId.innerHTML='<span class="l">'+T('Визуализация · ','Vizualizatsiya · ')+'</span><span class="sh">'+T('Визуал. · ','Vizual. · ')+'</span>'+T('NV-0001, образец','NV-0001 namuna')+'<span class="l">'+T(' · даты условные',' · sanalar shartli')+'</span><span class="sh">'+T(' · условно',' · shartli')+'</span>'}
  function ruler(cur,pv,s,ss,st,pf){
    var key=cur+'|'+pv+'|'+s+'|'+ss;
    if(key!==rk){rk=key;lis.forEach(function(li,i){li.className=i===cur?'is-cur':(i<cur?'is-done':(pv>0&&i>0&&i<=pv?'is-pv':''))});
      ordS.textContent=SM?(pf&&cur>=0?stN(cur)+' · '+ss:ss):s}
    if(st!==stk){stk=st;ordSt.textContent=st||'';ordSt.classList.toggle('is-in',!!st);ordSt.classList.remove('is-seat');if(st&&!RED){void ordSt.offsetWidth;ordSt.classList.add('is-seat')}}
  }
  function monSet(on){if(on===mon)return;mon=on;if(lis[5])lis[5].lastChild.textContent=stN(5);rk=''}
  function nav(h){navs.forEach(function(a){a.classList.toggle('is-cur',!!h&&a.getAttribute('href')===h)})}
  var lvk='';function lvSet(tf,op){var k=tf+op;if(k!==lvk){lvk=k;lv.style.transform=tf;lv.style.opacity=op}}
  var cwk=null;function caret(on){if(on!==cwk){cwk=on;ord.classList.toggle('is-cw',on)}}

  /* ---------- документы фона: чеки-образцы, список сборки, журнал теста ---------- */
  function drawRc(){var O=NV.ORDER;if(!O||!rcs)return;var sh='AABBACBCC';
    rcs.innerHTML=O.B.map(function(r,i){return '<div class="rc" style="--x:'+((i%3)*7-7)+'px;--y:'+(i*4)+'px;--r:'+((((i*37)%9)-4)*.55).toFixed(2)+'deg"><div class="h"><span>'+T('Магазин ','Doʻkon ')+sh[i]+'</span><span>'+(i<5?'06':'07')+'.10.2026</span></div><div class="i"><span>'+NV.esc(O.L2(r[1]))+'</span><span>'+money(r[4])+'</span></div><div class="i"><span>'+T('кол-во','soni')+'</span><span>1</span></div><div class="t"><span>'+T('Итого','Jami')+'</span><span>'+money(r[4])+'</span></div><span class="nm">'+T('ОБРАЗЕЦ','NAMUNA')+'</span></div>'}).join('');
    rsum.lastChild.textContent=T('Возврат вам: ','Sizga qaytariladi: ')+money(O.S-O.R)+T(' сум',' soʻm');rcN=-1}
  var rcN=-1;function rcSet(n){if(n===rcN||!rcs)return;var O=NV.ORDER,a=0,el=rcs.children,up=n>rcN&&rcN>=0;rcN=n;
    for(var i=0;i<9;i++){el[i].classList.toggle('is-in',i<n);el[i].classList.toggle('is-new',up&&!RED&&i===n-1);if(i<n)a+=O.B[i][4]}
    rsum.firstChild.textContent=T('Чеки ','Cheklar ')+n+'/9 · '+money(a)+T(' сум',' soʻm');rsum.classList.toggle('is-all',n===9);
    bXl.textContent=T('03 Закупка · 06–07.10 · чеки ','03 Xarid · 06–07.10 · cheklar ')+n+'/9'+T(' · образцы',' · namuna')}
  function asmItems(){return AS.map(function(k){return NV.PARTS[k].n}).concat([['Кабели, BIOS 3.20, профиль памяти','Kabellar, BIOS 3.20, xotira profili']])}
  function drawAsm(){if(!asm)return;asm.innerHTML=asmItems().map(function(n){return '<li>'+NV.esc(T(n[0],n[1]))+'</li>'}).join('');asK=-2}
  var asK=-2;function asmSet(k){if(k===asK||!asm)return;asK=k;var el=asm.children;for(var i=0;i<el.length;i++)el[i].className=i<k?'is-done':(i===k?'is-cur':'');
    bYl.textContent=T('04 Сборка · 08.10 · ','04 Yigʻish · 08.10 · ')+Math.max(0,k+1)+'/8'+T(' · образец',' · namuna')}
  (function(){var p=$('tlogP');if(!p||!NV.TEMPS)return;var d=NV.TEMPS[0][1];p.setAttribute('d',d.map(function(v,i){return (i?'L':'M')+(i/48*300).toFixed(1)+' '+(78-(v-30)/60*76).toFixed(1)}).join(''))})();
  var tsk=-1;function testSet(H){var hm=hhmm(H),k=Math.floor(H*6);if(k===tsk)return;tsk=k;
    if(tclkH)tclkH.textContent=hm;if(tclk)tclk.classList.toggle('is-done',H>=8);css(tlog,'--d',(1-H/8).toFixed(3));if(tlogC&&tlogC.textContent!==hm)tlogC.textContent=hm;if(rst)rst.classList.toggle('is-in',H>=8)}
  function testText(){if(bTl)bTl.textContent=T('04 Тест · 09–10.10 · образец','04 Sinov · 09–10.10 · namuna');if(tclkL)tclkL.textContent=T('тест под нагрузкой · CPU, GPU, БП','yuklama sinovi · CPU, GPU, quvvat bloki');if(tclkO)tclkO.textContent=T('0 ошибок · 0 перезагрузок','0 xato · 0 qayta yuklanish');tsk=-1}
  function hhmm(h){var m=Math.floor(h*6)*10;return ('0'+Math.floor(m/60)).slice(-2)+':'+('0'+m%60).slice(-2)}
  var dk={};function css(el,k,v){if(!el)return;var id=k+(el.id||el.className);if(dk[id]!==v){dk[id]=v;el.style.setProperty(k,v)}}
  var trk='';function scT(v){if(v!==trk){trk=v;sc.style.transform=v}}
  /* ролик или постер соседнего этапа — заранее; на телефоне дальние ролики освобождаются */
  function near(i){var nk=KEY[Math.min(KEY.length-1,i+1)];if(VID&&VK[nk])clip(nk);else if(nk!==KEY[i])pre(nk);
    if(SM)for(var k in clips){var far=true;for(var j=Math.max(0,i-1);j<=Math.min(KEY.length-1,i+1);j++)if(KEY[j]===k)far=false;if(far)dropClip(k)}}
  function addDays(d){var t=new Date(2026,9,12+d);return ('0'+t.getDate()).slice(-2)+'.'+('0'+(t.getMonth()+1)).slice(-2)+'.'+t.getFullYear()}

  /* ---------- кадр состояния ---------- */
  function kick(){if(!raf)raf=requestAnimationFrame(upd)}
  function upd(){
    raf=0;var y=scrollY,vh=G.vh,c=y+vh*.5;
    /* телефон: ролик первого экрана освобождается через экран после стыка и берётся из кэша при возврате */
    if(SM&&NV.mode==='video'&&NV.video){if(!rel&&y>G.heroEnd+vh){rel=true;var V=NV.video;V.el.removeAttribute('src');V.el.load();V.ready=false;V.el.classList.remove('is-ready');for(var u in V.blob){URL.revokeObjectURL(V.blob[u]);delete V.blob[u]}}
      else if(rel&&y<G.heroEnd){rel=false;NV.loadVideo(NV.vcolor)}}
    var on=y+vh>G.heroEnd-2;ob.classList.toggle('is-on',on);
    /* зерно плёнки — только когда фон впервые на экране */
    if(on&&!G.go){G.go=1;ob.classList.add('is-go');pre('k');pre('c')}
    /* щелчок лампы — раньше, пока «Как работаем» ещё в нижних 40 % экрана */
    var L2=G.kak-y<.6*vh;
    if(L2!==lit){var first=lit===false;lit=L2;ob.classList.toggle('is-lit',lit);
      if(lit&&first&&!RED&&c<Z[1].a){ob.classList.add('is-flick');setTimeout(function(){ob.classList.remove('is-flick')},800)}}
    var showR=on&&lit&&!(SM&&bar.classList.contains('is-on'));ord.classList.toggle('is-on',showR);
    if(!on){nav(0);need=false;caret(false);if(vcur){pauseC(clips[vcur]);vcur='';show()}if(il&&ilk){ilk=false;il.classList.remove('is-in')}return}
    var i=0;for(var k=1;k<Z.length;k++)if(c>=Z[k].a)i=k;
    var z=Z[i],f=cl((c-z.a)/(z.b-z.a));
    if(i!==zi){zi=i;if(ob.dataset.sh!==z.sh)ob.dataset.sh=z.sh;nav(z.nav);life.x=life.y=life.h=life.d=0;
      if(i>=7)ensureFin();else if(i<=5&&fst.firstChild)dropFin();monSet(i===6);
      for(var q in clips){clips[q].ex=0;clips[q].ps=-1}near(i)}
    caret(i<=1&&!RED);
    /* окна-паузы на телефоне: сцена открывается, когда окно в середине экрана */
    var wv=0,wd=0;if(i<=1&&G.win.length)G.win.forEach(function(w){var d=w[0]+w[1]/2-c,v=1-sm((Math.abs(d)-.3*vh)/(.3*vh));if(v>wv){wv=v;wd=d}});
    wv=Math.round(wv*20)/20;if(wv!==lastWin){lastWin=wv;ob.style.setProperty('--win',wv)}
    if(wv>0){var wt='translateY('+Math.round(wd)+'px)';if(wt!==wtk){wtk=wt;shW.style.transform=wt}}
    need=false;
    if(frozen&&i===1)return;
    var cur=3,pv=0,s='',ss='',st='',lvT='scaleX(0)',lvO=lit?.8:0,P=0,pf=true;
    if(i===0){/* маршрут: предпросмотр шести шагов; курсор мигает на текущем */
      cur=-1;var g=cl((c-G.docs)/(z.b-G.docs));scT('scale('+(1+.04*cl((c-G.kak)/(G.docs-G.kak))+.2*g).toFixed(4)+')');stage('k');
      pv=c<G.rt?0:Math.min(6,1+Math.floor((c-G.rt)/G.rh*6));if(c>G.rt+G.rh)pv=6;
      if(pv){st=SM?'':String(NV.t('ss'+pv));s='0'+pv+' · '+NV.t('st'+pv+'h')+' · '+T('документ: ','hujjat: ')+NV.t('st'+pv+'d');ss='0'+pv+' · '+NV.t('st'+pv+'h')}
      else{s=T('маршрут заказа · 6 шагов, на каждом — документ','buyurtma yoʻli · 6 qadam, har birida — hujjat');ss=T('маршрут, 6 шагов','yoʻl, 6 qadam')}
      pf=false;P=0}
    else if(i===1){/* заявка рождается в конфигураторе: 00 → 01 смета → 02 оплата */
      scT('scale('+(1.24-.2*cl(f/.5)).toFixed(4)+')');stage('k');
      cur=f<.85?0:f<.93?1:2;
      s=cur===0?T('05.10 · заявка из конфигуратора','05.10 · konfiguratordan soʻrov'):cur===1?T('05.10 · смета утверждена','05.10 · smeta tasdiqlandi'):T('05.10 · 30 % платы + лимит закупки','05.10 · 30 % ish haqi + xarid limiti');
      ss=cur===0?'05.10':cur===1?T('05.10 · утверждена','05.10 · tasdiqlandi'):T('05.10 · 30 % + лимит','05.10 · 30 % + limit');st=cur?String(NV.t('ss'+cur)):'';P=(cur+f)/7}
    else if(i===2){/* закупка: девять чеков-образцов ложатся на стол; без прокрутки приходят сами, раз в 2,6 с */
      scT('none');var pp=pin(z,y);stage('x',cl(pp/.9));
      var n=RED?9:Math.min(9,(pp<=.01?0:Math.floor(pp/.88*9)+1)+Math.floor(life.x));rcSet(n);need=n<9;
      /* процессор поворачивается к лампе вместе с чеками: сам доигрывает только до доли n/9 */
      if(clips.x){var cx=clips.x;cx.stop=RED?0:Math.max(.08,n/9)*(cx.v.duration||1.84);if(cx.play&&cx.v.currentTime>=cx.stop-.03)pauseC(cx);idleSoon()}
      var dt=n<6?'06.10':'07.10';s=dt+' · '+T('чеки ','cheklar ')+n+'/9';ss=dt+' · '+n+'/9';st=n===9?String(NV.t('ss3')):'';P=(3+n/9)/7}
    else if(i===3){/* сборка: детали из сметы входят в корпус; без прокрутки — одна деталь за 2,2 с */
      scT('none');var pa=pin(z,y),ka=RED?7:Math.min(7,Math.floor(cl(pa/.92)*7.99)+Math.floor(life.y));asmSet(ka);need=ka<7;
      /* кадр — по пункту списка: прокрутка ведёт внутри главы; пункт, добавленный сам (без прокрутки), — с начала своей главы */
      var uy=cl(pa/.92)*8,ky=Math.min(7,Math.floor(uy));if(clips.y&&clips.y.ka!==ka){clips.y.ka=ka;if(ka>ky)clips.y.ex=0}stage('y',ka>ky?YC[ka]:ymap(pa/.92));
      if(clips.y){var cy=clips.y,dy=cy.v.duration||4.16;cy.stop=RED?0:YC[ka+1]*dy;if(cy.play&&cy.v.currentTime>=cy.stop-.03)pauseC(cy);idleSoon()}
      var nm=asmItems()[ka];
      s=T('08.10 · сборка ','08.10 · yigʻish ')+(ka+1)+'/8 · '+T(nm[0],nm[1]);ss=(ka+1)+'/8';cur=4;P=(4+ka/8*.4)/7}
    else if(i===4){/* 04 тест: корпус под нагрузкой, часы идут поверх — по прокрутке и сами, 1 час за 4 с */
      scT('none');stage('t');var pt=pin(z,y),H=RED?8:Math.min(8,cl(pt/.9)*8+life.h);need=H<8;testSet(H);
      if(H<8){s=T('09.10 22:00 · тест под нагрузкой ','09.10 22:00 · yuklama sinovi ')+hhmm(H)+' / 08:00';ss=hhmm(H)+' / 08:00'}
      else{s=T('10.10 · тест 08:00 · 0 ошибок','10.10 · sinov 08:00 · 0 xato');ss=T('0 ошибок','0 xato');st=String(NV.t('ss4'))}
      cur=4;P=(4.4+H/8*.6)/7}
    else if(i===5){/* паспорт: тест пройден, журнал заполнен — документ этапа 04 */
      scT('none');stage('k');testSet(8);s=T('10.10 · паспорт: тест 08:00 · 0 ошибок','10.10 · pasport: sinov 08:00 · 0 xato');ss=T('паспорт · 0 ошибок','pasport · 0 xato');st=String(NV.t('ss4'));cur=4;P=5/7}
    else if(i===6){/* 05 монтаж места по чертежу («Идеи»; на линейке «Монтаж», не «Сдача»): чертёж дочерчивается сам за 7 с */
      scT('none');cur=5;var d=RED?1:Math.min(1,cl(f/.6)+life.d);need=d<1;stage('i',f);
      css(bp,'--d',(1-d).toFixed(3));css(bp,'--tx',cl((d-.7)/.3).toFixed(2));css(bp,'--ax',(1-.75*cl((f-.85)/.15)).toFixed(2));
      var MT=[['стол','stol'],['кронштейн монитора','monitor kronshteyni'],['свет','yoritish'],['кабель-канал','kabel-kanal'],['акустика','akustika']],mk=Math.min(4,Math.floor(d*4.99)),mt=T(MT[mk][0],MT[mk][1]);
      s=T('12.10 · монтаж по чертежу · ','12.10 · chizma boʻyicha montaj · ')+mt;ss=T('монтаж · ','montaj · ')+mt;P=(5+d*.3)/7}
    else if(i===7){/* акт и расчёт → гарантия */
      scT('none');stage('c');var done=G.gdoc-y<vh*.67;cur=done?6:5;
      s=done?T('12.10.2026 · сдано · гарантия 0 / 365 дн.','12.10.2026 · topshirildi · kafolat 0 / 365 kun'):T('12.10 · акт сдачи, расчёт 70 %','12.10 · dalolatnoma, 70 % hisob');
      ss=done?T('0 / 365 дн.','0 / 365 kun'):T('12.10 · акт','12.10 · dalolatnoma');st=done?String(NV.t('ss5')):'';P=(done?6:5.6)/7}
    if(i>5)testSet(8);else if(i<4&&!RED)testSet(0);
    if(i>2)rcSet(9);else if(i<2)rcSet(0);
    if(i>3)asmSet(7);else if(i<3)asmSet(-1);
    if(i===FIN){/* финал: фраза и кнопки, затем посадка знака на чистом поле; год гарантии; у самого низа — повтор */
      cur=6;stage('c');var q=cl((y-G.finS)/(G.max-G.finS)),dd=Math.round(cl(q/.9)*365),ft=G.fsT-y;
      var t=RED?3.3:(y>=G.max-2?3.3:3.3*cl((vh-(ft+G.fsH*.5))/(.42*vh)));
      ensureFin();
      if(fv){if(!looping){fv.t=t;sk(fv)}
        if(lp&&t>2.6&&!lp.getAttribute('src')){lp.src=DIR+'fin-loop-'+L+'.mp4';lp.preload='auto'}
        loop(t>=3.3&&q>=.97&&!document.hidden&&!RED)}
      else if(fp.length>1){fp[0].classList.toggle('is-on',t<1.6);fp[1].classList.toggle('is-on',t>=1.6)}
      pf=false;
      if(q>=.96){s=T('NV-0001 закрыт · гарантия до 12.10.2027','NV-0001 yopildi · kafolat 12.10.2027 gacha');ss=T('закрыт · гарантия до 12.10.27','yopildi · kafolat 12.10.27 gacha');st=T('Закрыт','Yopildi')}
      else if(dd>=365){s=T('12.10.2027 · гарантийный год 365 / 365 дн. · профилактика сделана','12.10.2027 · kafolat yili 365 / 365 kun · profilaktika qilindi');ss=T('Гарантия · 365 / 365, год пройден','Kafolat · 365 / 365, yil oʻtdi')}
      else{var pk=dd>=170&&dd<=215;s=addDays(dd)+' · '+T('гарантия идёт · ','kafolat davom etadi · ')+dd+' / 365'+T(' дн.',' kun')+(pk?T(' · профилактика',' · profilaktika'):'');
        ss=T('Гарантия · ','Kafolat · ')+dd+' / 365'+(pk?T(' · профилактика',' · profilaktika'):T(' · идёт',' · davom etadi'));st=pk?T('Профилактика','Profilaktika'):''}
      /* черта «Хода заказа» опускается и становится нижней чертой знака, гаснет при посадке */
      var B=BX[L],S=G.fsW/B.w,e=sm(t/.45),x1=G.fsL+B.l[0]*S,yl=ft+(B.l[1]+B.l[3])/2*S-G.lvTop,wl=(B.l[2]-B.l[0])*S/innerWidth;
      lvT='translate('+(x1*e).toFixed(1)+'px,'+(yl*e).toFixed(1)+'px) scaleX('+(1+(wl-1)*e).toFixed(4)+')';lvO=RED?0:(.8*(1-cl((t-.45)/.1)));P=1}
    else lvT='scaleX('+cl(P).toFixed(4)+')';
    if(i<FIN&&looping)loop(false);
    ruler(cur,pv,s,ss,st,pf);lvSet(lvT,showR?lvO:0);
    lifeGo();
  }

  /* ---------- запуск ---------- */
  ticks();drawRc();drawAsm();testText();
  if(RED){if(rst)rst.classList.add('is-in')}
  function relayout(){var s2=NV.small();if(s2!==SM){SM=s2;L=SM?'m':'d';shown='';seen={};dropFin();dropAll();zi=-1;ticks()}measure();rk='';kick()}
  measure();
  addEventListener('scroll',function(){kick();clearTimeout(idleT);idleT=0;idleSoon()},{passive:true});addEventListener('resize',relayout);
  addEventListener('load',function(){measure();kick()});
  if('ResizeObserver' in window){var rq=0;new ResizeObserver(function(){cancelAnimationFrame(rq);rq=requestAnimationFrame(function(){measure();kick()})}).observe(document.body)}
  function ilText(){if(il)il.textContent=T('Иллюстрация. Не работа студии','Illyustratsiya. Studiya ishi emas')}
  ilText();document.addEventListener('nv-lang',function(){ticks();drawRc();drawAsm();testText();ilText();kick()});
  /* конфигуратор: во время ввода фон не обновляется (INP) */
  var cf=$('cfgForm');function unf(){if(frozen){frozen=false;kick()}}
  cf.addEventListener('pointerdown',function(){frozen=true},{passive:true});addEventListener('pointerup',unf,{passive:true});addEventListener('pointercancel',unf,{passive:true});
  NV.bg={measure:measure,G:G,Z:Z,state:function(){var cs={};for(var k in clips){var c=clips[k];cs[k]={ok:c.ok,on:c.v.classList.contains('is-on'),play:c.play,t:+c.v.currentTime.toFixed(2),d:+(c.v.duration||0).toFixed(2)}}
    return {zone:Z[zi]&&Z[zi].id,shown:shown,vcur:vcur,clips:cs,il:!!(il&&il.classList.contains('is-in')),vid:VID,looping:looping,need:need,life:life}}};
  kick();
})();
