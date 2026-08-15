const api=window.KidsAPI;
const $=s=>document.querySelector(s);
const prefs=Object.assign({name:'Artista',difficulty:'easy',minutes:30,sound:true},JSON.parse(localStorage.getItem('sysKidsPrefs')||'{}'));
let shapeMode=false,voice=null,score=+(localStorage.getItem('sysKidsScore')||0),challengeIndex=-1,sessionTimer;
let creationCount=0;
const autoColors=['#8bff6a','#58d9ff','#ff6b8a','#ffd45c','#b98cff','#ff914d'];
const autoBrushes=['neon','rainbow','stars','bubbles','fire','classic'];
const challenges=[
 {icon:'⭕',text:'Desenhe um círculo',type:'circle',story:'Uma bolha mágica precisa ficar redondinha!'},
 {icon:'🟩',text:'Desenhe um quadrado',type:'square',story:'Construa a casinha do robô.'},
 {icon:'🔺',text:'Desenhe um triângulo',type:'triangle',story:'Faça uma montanha para o explorador.'},
 {icon:'🐟',text:'Desenhe um peixe e dê vida a ele',type:'creature',story:'Crie um amigo para nadar pela tela.'}
];

function sound(kind='pop'){
 if(!prefs.sound)return;const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
 const c=sound.ctx||(sound.ctx=new Audio()),o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);
 const notes={draw:440,pop:620,success:880,fill:330,magic:740};o.frequency.setValueAtTime(notes[kind]||520,c.currentTime);o.frequency.exponentialRampToValueAtTime((notes[kind]||520)*1.35,c.currentTime+.12);g.gain.setValueAtTime(.055,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.16);o.start();o.stop(c.currentTime+.17);
}
window.addEventListener('kids:sound',e=>sound(e.detail));

function bounds(stroke,robust=false){let xs=stroke.points.map(p=>p.x).sort((a,b)=>a-b),ys=stroke.points.map(p=>p.y).sort((a,b)=>a-b);const trim=robust?Math.floor(xs.length*.04):0;xs=xs.slice(trim,xs.length-trim||undefined);ys=ys.slice(trim,ys.length-trim||undefined);return{x:xs[0],y:ys[0],w:xs.at(-1)-xs[0],h:ys.at(-1)-ys[0]}}
function trimShapeTail(stroke){const pts=stroke.points;if(pts.length<18)return;const start=pts[0],b=bounds(stroke),near=Math.max(16,Math.hypot(b.w,b.h)*.09);for(let i=Math.floor(pts.length*.58);i<pts.length;i++){if(Math.hypot(pts[i].x-start.x,pts[i].y-start.y)<near){stroke.points=pts.slice(0,i+1);stroke.points.at(-1).x=start.x;stroke.points.at(-1).y=start.y;return}}}
function perfectShape(stroke,type){
 const b=bounds(stroke,true),cx=b.x+b.w/2,cy=b.y+b.h/2,n=72,points=[];
 if(type==='circle'){const radius=(b.w+b.h)/4;for(let i=0;i<=n;i++){const a=i/n*Math.PI*2;points.push({x:cx+Math.cos(a)*radius,y:cy+Math.sin(a)*radius})}}
 if(type==='square'){const side=(b.w+b.h)/2,x=cx-side/2,y=cy-side/2;points.push({x,y},{x:x+side,y},{x:x+side,y:y+side},{x,y:y+side},{x,y})}
 if(type==='triangle'){points.push({x:cx,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h},{x:cx,y:b.y})}
 if(points.length){stroke.points=points;stroke.shape=type;}
}
function lineDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)}
function simplify(points,tolerance){if(points.length<3)return points;let max=0,index=0;for(let i=1;i<points.length-1;i++){const value=lineDistance(points[i],points[0],points.at(-1));if(value>max){max=value;index=i}}if(max>tolerance){const a=simplify(points.slice(0,index+1),tolerance),b=simplify(points.slice(index),tolerance);return a.slice(0,-1).concat(b)}return[points[0],points.at(-1)]}
function guessShape(stroke){const b=bounds(stroke,true),diagonal=Math.hypot(b.w,b.h),closed=Math.hypot(stroke.points[0].x-stroke.points.at(-1).x,stroke.points[0].y-stroke.points.at(-1).y)<diagonal*.16;if(!closed)return'line';const corners=simplify(stroke.points,diagonal*.055).length-1;if(corners===3)return'triangle';if(corners===4)return'square';const cx=b.x+b.w/2,cy=b.y+b.h/2,rx=Math.max(1,b.w/2),ry=Math.max(1,b.h/2);let ellipseError=0,boxError=0;for(const p of stroke.points){const nx=Math.abs((p.x-cx)/rx),ny=Math.abs((p.y-cy)/ry);ellipseError+=Math.abs(Math.hypot(nx,ny)-1);boxError+=Math.abs(Math.max(nx,ny)-1)}ellipseError/=stroke.points.length;boxError/=stroke.points.length;if(ellipseError<.2&&ellipseError<boxError*.92)return'circle';if(boxError<.18)return'square';return'free'}
function snapStroke(stroke){const start=stroke.points[0],end=stroke.points.at(-1);for(const other of api.state.strokes){if(other===stroke)continue;for(const p of [other.points[0],other.points.at(-1)]){if(Math.hypot(start.x-p.x,start.y-p.y)<15){start.x=p.x;start.y=p.y}if(Math.hypot(end.x-p.x,end.y-p.y)<15){end.x=p.x;end.y=p.y}}}}
function onStroke(stroke){
 stroke.brush=$('#brushType').value;
 if(shapeMode){const detected=guessShape(stroke);const challenged=challengeIndex>=0&&['circle','square','triangle'].includes(challenges[challengeIndex].type)?challenges[challengeIndex].type:null;const wanted=challenged||detected;if(['circle','square','triangle'].includes(wanted)){perfectShape(stroke,wanted);api.showToast(`${wanted==='circle'?'Círculo':wanted==='triangle'?'Triângulo':'Quadrado'} corrigido perfeitamente ✨`);sound('magic')}}
 api.renderStrokes();sound('draw');checkChallenge(stroke);
 creationCount++;api.state.brushColor=autoColors[creationCount%autoColors.length];api.state.brushType=autoBrushes[Math.floor(creationCount/2)%autoBrushes.length];
}
window.addEventListener('kids:stroke-finished',e=>onStroke(e.detail));window.addEventListener('kids:filled',()=>sound('fill'));

function nextChallenge(){challengeIndex=(challengeIndex+1)%challenges.length;const c=challenges[challengeIndex];$('#challengeIcon').textContent=c.icon;$('#challengeText').textContent=`${c.text} — ${c.story}`;$('#challengeBar').classList.add('visible');api.showToast(`Novo desafio: ${c.text}`)}
function checkChallenge(stroke){if(challengeIndex<0)return;const c=challenges[challengeIndex],b=bounds(stroke);let ok=false;if(c.type==='circle')ok=guessShape(stroke)==='circle';else if(c.type==='square'||c.type==='triangle')ok=Math.hypot(stroke.points[0].x-stroke.points.at(-1).x,stroke.points[0].y-stroke.points.at(-1).y)<Math.max(b.w,b.h)*.25;else if(c.type==='letter')ok=stroke.points.length>20&&b.h>b.w*.7;else if(c.type==='number')ok=stroke.points.length>35;else if(c.type==='creature')ok=stroke.points.length>25;if(ok){if(c.type==='creature')api.connectedGroup(stroke).forEach((s,i)=>s.animation={vx:1.1+i*.08,vy:.45});score+=prefs.difficulty==='hard'?30:prefs.difficulty==='normal'?20:10;localStorage.setItem('sysKidsScore',score);$('#score').textContent=`${score} pts`;celebrate();autoSave(c.text);setTimeout(nextChallenge,32000)}}
function celebrate(){sound('success');api.showToast(`Muito bem, ${prefs.name}! + pontos ⭐`);const box=$('#celebration'),items=['⭐','✨','🎉','🌈','💚'];for(let i=0;i<28;i++){const e=document.createElement('span');e.className='confetti';e.textContent=items[i%items.length];e.style.left=`${Math.random()*100}%`;e.style.animationDelay=`${Math.random()*.45}s`;box.append(e);setTimeout(()=>e.remove(),2500)}}

$('#brushType').addEventListener('change',e=>{api.state.brushType=e.target.value;api.showToast(`Pincel ${e.target.selectedOptions[0].textContent} ativado`)});
$('#duplicateButton').onclick=()=>{const last=api.state.strokes.at(-1);if(!last)return api.showToast('Desenhe algo primeiro');const group=api.connectedGroup(last),copies=group.map(s=>({...s,points:s.points.map(p=>({x:p.x+35,y:p.y+35}))}));api.state.strokes.push(...copies);api.renderStrokes();sound('magic');api.showToast('Desenho duplicado')};
$('#animateButton').onclick=()=>{const last=api.state.strokes.at(-1);if(!last)return api.showToast('Desenhe algo primeiro');api.connectedGroup(last).forEach((s,i)=>s.animation={vx:1.1+i*.08,vy:.45});api.showToast('Seu desenho ganhou vida! 🐟');sound('magic')};
function animate(){let active=false;for(const s of api.state.strokes){if(!s.animation)continue;active=true;const b=bounds(s);if(b.x<3||b.x+b.w>api.state.width-3)s.animation.vx*=-1;if(b.y<3||b.y+b.h>api.state.height-3)s.animation.vy*=-1;s.points.forEach(p=>{p.x+=s.animation.vx;p.y+=s.animation.vy})}if(active)api.renderStrokes();requestAnimationFrame(animate)}animate();
$('#challengeButton').onclick=nextChallenge;$('#score').textContent=`${score} pts`;

function executeVoice(text){text=text.toLowerCase();const colors={verde:'#8bff6a',rosa:'#ff6b8a',azul:'#58d9ff',amarelo:'#ffd45c',branco:'#ffffff'};for(const [name,color] of Object.entries(colors))if(text.includes(name)){api.state.brushColor=color;api.showToast(`Cor ${name}`)}if(text.includes('limpar'))api.clearAll();if(text.includes('desfazer'))$('#undoButton').click();if(text.includes('salvar'))$('#downloadButton').click();if(text.includes('desafio'))nextChallenge();if(text.includes('arco-íris')){$('#brushType').value='rainbow';$('#brushType').dispatchEvent(new Event('change'))}if(text.includes('animar')||text.includes('vida'))$('#animateButton').click()}
$('#voiceButton').onclick=()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return api.showToast('Comando de voz não disponível neste navegador');voice=new SR();voice.lang='pt-BR';voice.onstart=()=>{$('#voiceButton').classList.add('active');api.showToast('Estou ouvindo…')};voice.onresult=e=>executeVoice(e.results[0][0].transcript);voice.onend=()=>$('#voiceButton').classList.remove('active');voice.start()};

function gallery(){return JSON.parse(localStorage.getItem('sysKidsGallery')||'[]')}
function autoSave(label='Criação livre'){const items=gallery(),image=api.paintCanvas.toDataURL('image/png');items.unshift({name:`${prefs.name} — ${label} — ${new Date().toLocaleDateString('pt-BR')}`,image});localStorage.setItem('sysKidsGallery',JSON.stringify(items.slice(0,24)))}
function renderGallery(){const grid=$('#galleryGrid'),items=gallery();grid.innerHTML=items.length?'':'<p>A galeria ainda está vazia.</p>';items.forEach((item,i)=>{const wrap=document.createElement('div'),img=document.createElement('img'),del=document.createElement('button');img.src=item.image;img.title=item.name;del.textContent='Excluir';del.onclick=()=>{items.splice(i,1);localStorage.setItem('sysKidsGallery',JSON.stringify(items));renderGallery()};wrap.append(img,del);grid.append(wrap)})}
$('#galleryButton').onclick=()=>{renderGallery();$('#galleryDialog').showModal()};$('#saveGalleryButton').onclick=()=>{const items=gallery();items.unshift({name:`${prefs.name} — ${new Date().toLocaleDateString('pt-BR')}`,image:api.paintCanvas.toDataURL('image/png')});localStorage.setItem('sysKidsGallery',JSON.stringify(items.slice(0,24)));renderGallery();sound('success')};
document.querySelectorAll('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('#parentsButton').onclick=()=>{$('#childName').value=prefs.name;$('#difficulty').value=prefs.difficulty;$('#sessionMinutes').value=prefs.minutes;$('#soundToggle').checked=prefs.sound;$('#parentsDialog').showModal()};
$('#saveParents').onclick=()=>{prefs.name=$('#childName').value||'Artista';prefs.difficulty=$('#difficulty').value;prefs.minutes=Math.max(5,+$('#sessionMinutes').value||30);prefs.sound=$('#soundToggle').checked;localStorage.setItem('sysKidsPrefs',JSON.stringify(prefs));$('#parentsDialog').close();startSessionTimer();api.showToast('Configurações salvas')};
function startSessionTimer(){clearTimeout(sessionTimer);sessionTimer=setTimeout(()=>api.showToast(`Hora de descansar um pouco, ${prefs.name}! 🌿`),prefs.minutes*60000)}startSessionTimer();
window.addEventListener('kids:started',()=>{if(challengeIndex<0)nextChallenge();api.state.brushColor=autoColors[0];api.state.brushType=autoBrushes[0];startSessionTimer()});
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.altKey&&e.key.toLowerCase()==='p'){e.preventDefault();$('#parentsButton').click()}});
