const api=window.KidsAPI,canvas=document.querySelector('#worldCanvas'),ctx=canvas.getContext('2d');
const scenes=[
 {name:'Oceano Encantado',icon:'🌊',key:'lumi',mascotName:'Lumi',prompt:'O oceano está vazio! Desenhe livremente para criar magia.',colors:['#06162e','#073b57','#087b8b'],decor:['🐠','🫧','🐚'],forms:{}},
 {name:'Viagem Espacial',icon:'🚀',key:'nova',mascotName:'Nova',prompt:'Chegamos ao espaço! Desenhe sua própria aventura.',colors:['#050318','#19104d','#3a1768'],decor:['🪐','🚀','🌟'],forms:{}},
 {name:'Floresta dos Sonhos',icon:'🌳',key:'flora',mascotName:'Flora',prompt:'A floresta quer conhecer seus desenhos!',colors:['#06190f','#0b4b2a','#197044'],decor:['🌸','🦋','🍄'],forms:{}},
 {name:'Castelo das Estrelas',icon:'🏰',key:'milo',mascotName:'Milo',prompt:'Desenhe o que imaginar para o castelo!',colors:['#160b31','#42235e','#a04d78'],decor:['💎','👑','🐉'],forms:{}}
];
let scene=0,created=0,cursor=null,entities=[],started=false,dirty=true,sceneChanging=false,transitionQueued=false,drawEnergy=0,lastMilestone=0,drag=null,lastPinchPoint=null,music=null,reactionTimer=null,currentReaction='';
const random=(a,b)=>a+Math.random()*(b-a);

function resize(){const r=document.querySelector('#stage').getBoundingClientRect(),d=1;canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);canvas.style.width=`${r.width}px`;canvas.style.height=`${r.height}px`;ctx.setTransform(d,0,0,d,0,0);canvas.logicalWidth=r.width;canvas.logicalHeight=r.height;dirty=true}
window.addEventListener('resize',resize);resize();
function say(text){document.querySelector('#companionSpeech').textContent=text;if(music?.gain)music.gain.gain.setTargetAtTime(.006,music.ctx.currentTime,.08);if('speechSynthesis'in window){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='pt-BR';u.rate=.94;u.pitch=1.2;u.volume=.75;u.onend=()=>music?.gain&&music.gain.gain.setTargetAtTime(.018,music.ctx.currentTime,.3);speechSynthesis.speak(u)}}
function startMusic(index){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;if(!music){const ctx=new AC(),gain=ctx.createGain();gain.gain.value=.018;gain.connect(ctx.destination);music={ctx,gain,step:0,timer:null}}music.ctx.resume().catch(()=>{});clearInterval(music.timer);const scales=[[196,246,294,392],[174,220,261,349],[196,233,294,330],[220,277,330,440]][index];music.step=0;music.timer=setInterval(()=>{if(music.ctx.state!=='running')return;const o=music.ctx.createOscillator(),g=music.ctx.createGain();o.type='sine';o.frequency.value=scales[music.step++%scales.length];o.connect(g);g.connect(music.gain);g.gain.setValueAtTime(.16,music.ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,music.ctx.currentTime+1.2);o.start();o.stop(music.ctx.currentTime+1.25)},1150)}
function expression(name){
 const s=scenes[scene],mascot=document.querySelector('#mascot'),image=document.querySelector('#mascotImage');
 if(currentReaction===name)return;
 currentReaction=name;
 mascot.dataset.character=s.key;
 mascot.dataset.reaction=name;
 image.src='assets/mascots/mascot-reactions-v7.png';
 mascot.classList.remove('is-waiting','is-drawing','is-celebrating');
 void mascot.offsetWidth;
 mascot.classList.add(name==='celebrate'?'is-celebrating':name==='drawing'?'is-drawing':'is-waiting');
}
function settleReaction(delay=2400){clearTimeout(reactionTimer);reactionTimer=setTimeout(()=>{if(!transitionQueued)expression('waiting')},delay)}
function setScene(index,announce=false){scene=index%scenes.length;sceneChanging=false;transitionQueued=false;drawEnergy=0;lastMilestone=0;drag=null;clearTimeout(reactionTimer);currentReaction='';const s=scenes[scene],w=canvas.logicalWidth||1000,h=canvas.logicalHeight||700;entities=s.decor.map((emoji,i)=>({emoji,x:w*(.62+i*.13),y:h*(.28+(i%2)*.19),size:48}));document.querySelector('#worldName').textContent=s.name;expression('waiting');document.querySelector('#mascotImage').alt=s.mascotName;document.querySelector('#mascotName').textContent=s.mascotName;document.querySelector('#magicFill').style.width='0%';dirty=true;startMusic(scene);if(announce){const t=document.createElement('div');t.className='world-transition';t.textContent=`${s.icon} ${s.name}`;document.querySelector('#stage').append(t);setTimeout(()=>t.remove(),2300);setTimeout(()=>say(s.prompt),900)}else say(s.prompt)}
function saveWorld(){const gallery=JSON.parse(localStorage.getItem('sysKidsGallery')||'[]');gallery.unshift({name:`Aventura — ${scenes[scene].name}`,image:api.paintCanvas.toDataURL('image/png')});localStorage.setItem('sysKidsGallery',JSON.stringify(gallery.slice(0,24)))}
function advanceWorld(){if(sceneChanging)return;sceneChanging=true;saveWorld();scene=(scene+1)%scenes.length;created=0;entities=[];api.state.strokes.length=0;api.state.redo.length=0;api.renderStrokes();setScene(scene,true)}

window.addEventListener('kids:started',()=>{started=true;requestAnimationFrame(()=>{resize();setScene(0)});setTimeout(()=>say('Oi! Eu sou Lumi. Sua mão tem poderes mágicos. '+scenes[0].prompt),500)});
window.addEventListener('kids:cursor',e=>{cursor=e.detail;const marker=document.querySelector('#magicCursor');marker.style.left=`${cursor.x}px`;marker.style.top=`${cursor.y}px`;marker.className=`magic-cursor ${cursor.gesture}`;handlePinch(cursor)});
function handlePinch(p){
 if(p.gesture!=='move'){drag=null;lastPinchPoint=null;return}
 if(!lastPinchPoint){lastPinchPoint={x:p.x,y:p.y};const stage=document.querySelector('#stage').getBoundingClientRect(),m=document.querySelector('#mascot').getBoundingClientRect();if(p.x>=m.left-stage.left&&p.x<=m.right-stage.left&&p.y>=m.top-stage.top&&p.y<=m.bottom-stage.top)drag={type:'mascot'};else{for(let i=entities.length-1;i>=0;i--)if(Math.hypot(p.x-entities[i].x,p.y-entities[i].y)<55){drag={type:'entity',item:entities[i]};break}}return}
 const dx=p.x-lastPinchPoint.x,dy=p.y-lastPinchPoint.y;lastPinchPoint={x:p.x,y:p.y};
 if(drag?.type==='mascot'){const c=document.querySelector('#companion'),left=parseFloat(c.dataset.x||24)+dx,bottom=parseFloat(c.dataset.y||16)-dy;c.dataset.x=left;c.dataset.y=bottom;c.style.left=`${left}px`;c.style.bottom=`${bottom}px`}
 if(drag?.type==='entity'){drag.item.x+=dx;drag.item.y+=dy;dirty=true}
}
window.addEventListener('kids:stroke-finished',e=>{
 if(!started)return;const stroke=e.detail,shape=stroke.shape;
 let length=0;for(let i=1;i<stroke.points.length;i++)length+=Math.hypot(stroke.points[i].x-stroke.points[i-1].x,stroke.points[i].y-stroke.points[i-1].y);
 drawEnergy+=length;const target=Math.max(6600,(api.state.width||1000)*6.45),progress=Math.min(100,drawEnergy/target*100);
 document.querySelector('#magicFill').style.width=`${progress}%`;
 expression(progress>=100?'celebrate':'drawing');if(progress<100)settleReaction();
 const milestone=Math.floor(progress/25)*25;if(milestone>lastMilestone&&milestone<=100){lastMilestone=milestone;window.dispatchEvent(new CustomEvent('kids:sound',{detail:milestone===100?'success':'magic'}));if(milestone<100)say(`A magia chegou a ${milestone} por cento!`)}
 if(progress>=100){if(!transitionQueued){transitionQueued=true;expression('celebrate');setTimeout(advanceWorld,2600)}return}
 if(!shape||!scenes[scene].forms[shape]){created++;return}
 const p=stroke.points,x=p.reduce((n,v)=>n+v.x,0)/p.length,y=p.reduce((n,v)=>n+v.y,0)/p.length,emoji=scenes[scene].forms[shape];
 entities.push({x,y,emoji,size:random(32,45)});created++;dirty=true;
 document.querySelector('#magicFill').style.width=`${Math.min(100,created/4*100)}%`;
 const names={circle:'forma redonda',square:'forma quadrada',triangle:'forma triangular'};
});

function gradient(colors,w,h){const g=ctx.createLinearGradient(0,0,0,h);colors.forEach((c,i)=>g.addColorStop(i/(colors.length-1),c));ctx.fillStyle=g;ctx.fillRect(0,0,w,h)}
function drawOcean(w,h,t){for(let i=0;i<22;i++){const x=(i*97+t*(5+i%3))%(w+80)-40,y=(i*61)%h,r=3+i%8;ctx.globalAlpha=.12;ctx.strokeStyle='#9ff6ff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.stroke()}ctx.globalAlpha=1;ctx.fillStyle='#063b38';ctx.beginPath();ctx.moveTo(0,h);for(let x=0;x<=w;x+=35)ctx.lineTo(x,h-35-Math.sin(x*.025+t*.0008)*12);ctx.lineTo(w,h);ctx.fill()}
function drawSpace(w,h,t){for(let i=0;i<40;i++){const x=(i*83)%w,y=(i*47)%h,r=i%4===0?2:1;ctx.fillStyle=i%7?'#fff':'#ffd45c';ctx.globalAlpha=.35+(i%5)*.12;ctx.fillRect(x,y,r,r)}ctx.globalAlpha=1;ctx.fillStyle='#c481ff33';ctx.beginPath();ctx.arc(w*.82,h*.24,70,0,7);ctx.fill();ctx.strokeStyle='#f7c7ff55';ctx.lineWidth=9;ctx.beginPath();ctx.ellipse(w*.82,h*.24,105,25,-.3,0,7);ctx.stroke()}
function drawForest(w,h,t){ctx.fillStyle='#082d20';ctx.beginPath();ctx.moveTo(0,h);for(let x=0;x<=w;x+=25)ctx.lineTo(x,h*.72+Math.sin(x*.018)*22);ctx.lineTo(w,h);ctx.fill();for(let i=0;i<35;i++){ctx.fillStyle=i%2?'#8bff6a':'#ffd45c';ctx.globalAlpha=.35+.3*Math.sin(t*.003+i);ctx.beginPath();ctx.arc((i*71)%w,(i*91)%(h*.7),2+i%2,0,7);ctx.fill()}ctx.globalAlpha=1}
function drawCastle(w,h,t){ctx.fillStyle='#170d2e';ctx.fillRect(0,h*.72,w,h*.28);ctx.fillStyle='#ffffff16';for(let i=0;i<4;i++){const x=w*.12+i*w*.24,hh=100+(i%2)*55;ctx.fillRect(x,h*.72-hh,90,hh);ctx.beginPath();ctx.moveTo(x-8,h*.72-hh);ctx.lineTo(x+45,h*.72-hh-55);ctx.lineTo(x+98,h*.72-hh);ctx.fill()}for(let i=0;i<20;i++){ctx.fillStyle='#ffd45c';ctx.globalAlpha=.3+.5*Math.sin(t*.004+i);ctx.fillRect((i*137)%w,(i*73)%(h*.65),2,2)}ctx.globalAlpha=1}
function renderWorld(){if(!dirty)return;dirty=false;const t=0,w=canvas.logicalWidth||1,h=canvas.logicalHeight||1,s=scenes[scene];ctx.clearRect(0,0,w,h);gradient(s.colors,w,h);if(scene===0)drawOcean(w,h,t);if(scene===1)drawSpace(w,h,t);if(scene===2)drawForest(w,h,t);if(scene===3)drawCastle(w,h,t);entities.forEach(e=>{ctx.font=`${e.size}px sans-serif`;ctx.fillText(e.emoji,e.x,e.y)})}
// Atualiza no próximo quadro da tela. Assim os objetos acompanham a pinça
// suavemente, mas o cenário continua sem gastar processamento quando está parado.
function worldFrame(){renderWorld();requestAnimationFrame(worldFrame)}
requestAnimationFrame(worldFrame);

