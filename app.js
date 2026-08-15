const $ = (selector) => document.querySelector(selector);
const video = $('#camera');
const paintCanvas = $('#paintCanvas');
const trackingCanvas = $('#trackingCanvas');
const pctx = paintCanvas.getContext('2d');
const tctx = trackingCanvas.getContext('2d');

const state = {
  running: false, starting:false, paused: false, detector: null, lastVideoTime: -1,
  gesture: 'none', candidate: 'none', candidateFrames: 0,
  brushColor: '#8bff6a', brushSize: 8, brushType:'neon', toolMode:'draw', strokes: [], redo: [], current: null,
  selected: null, lastPinch: null, smoothPoint: null, showSkeleton: true,
  visualLandmarks: null, pinchReleaseFrames: 0, fillLatch:false, twoTransform:null, drawMissFrames:0,
  smoothing:.48, drawGraceFrames:10, calibration:{samples:[],movement:[],previous:null,done:false}, lastDrawTime:0, handMissFrames:0
};

const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

function resizeCanvases() {
  const rect = $('#stage').getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 1.25);
  for (const canvas of [paintCanvas, trackingCanvas]) {
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    canvas.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
  }
  state.width = rect.width; state.height = rect.height;
  renderStrokes();
}

function point(lm) { return { x: (1 - lm.x) * state.width, y: lm.y * state.height }; }
function dist(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
function fingerExtended(lm,tip,pip,mcp){
  const wrist=point(lm[0]),t=point(lm[tip]),p=point(lm[pip]),m=point(lm[mcp]);
  const a={x:p.x-m.x,y:p.y-m.y},b={x:t.x-p.x,y:t.y-p.y};
  const alignment=(a.x*b.x+a.y*b.y)/((Math.hypot(a.x,a.y)*Math.hypot(b.x,b.y))||1);
  // Funciona apontando para cima, para baixo ou para os lados: a ponta precisa
  // estar mais longe do pulso e as duas partes do dedo quase alinhadas.
  return dist(wrist,t)>dist(wrist,p)*1.12&&alignment>.42;
}

function palmFacesScreen(lm, handedness) {
  // A ordem dos nós da palma muda de sentido quando vemos as costas da mão.
  // O MediaPipe classifica selfies como espelhadas; por isso "Left" corresponde
  // ao sinal positivo no quadro bruto da câmera e "Right" ao negativo.
  const wrist = lm[0], indexBase = lm[5], pinkyBase = lm[17];
  const turn = (indexBase.x - wrist.x) * (pinkyBase.y - wrist.y)
    - (indexBase.y - wrist.y) * (pinkyBase.x - wrist.x);
  const expectedSign = handedness === 'Left' ? 1 : -1;
  return turn * expectedSign > 0.002;
}

function classify(lm, handedness) {
  const palm = dist(point(lm[5]), point(lm[17]));
  const pinchDistance = dist(point(lm[4]), point(lm[8]));
  const pinch = pinchDistance < palm * .40;
  const preparingPinch = pinchDistance < palm * .72;
  const fingers = [fingerExtended(lm,8,6,5),fingerExtended(lm,12,10,9),fingerExtended(lm,16,14,13),fingerExtended(lm,20,18,17)];
  const thumbOpen = dist(point(lm[4]), point(lm[5])) > palm * .52;
  if (pinch) return 'move';
  // Zona neutra: interrompe o pincel enquanto o polegar se aproxima do indicador.
  if (preparingPinch) return 'prePinch';
  if (fingers.every(Boolean) && thumbOpen) return palmFacesScreen(lm, handedness) ? 'erase' : 'turnPalm';
  if (fingers[0] && !fingers[1] && !fingers[2] && !fingers[3]) {
    return palmFacesScreen(lm, handedness) ? 'draw' : 'turnPalm';
  }
  return 'hover';
}

function stabilize(next) {
  // Ao soltar uma pinça, entra numa trava curta. A pose intermediária se parece
  // com um indicador levantado, mas não deve produzir nenhum risco.
  if (state.gesture === 'move' && next !== 'move') {
    state.gesture='releasePinch';state.pinchReleaseFrames=16;
    state.candidate=next;state.candidateFrames=0;state.selected=null;state.lastPinch=null;
    state.smoothPoint=null;updateGestureUI('releasePinch');return;
  }
  if (state.gesture === 'releasePinch') {
    if(next==='move'){
      state.candidateFrames++;
      if(state.candidateFrames>=2){state.gesture='move';state.pinchReleaseFrames=0;updateGestureUI('move');}
      return;
    }
    state.candidateFrames=0;
    if(state.pinchReleaseFrames>0){state.pinchReleaseFrames--;return;}
    // Só sai da trava quando a mão já não está mais na zona de formação da pinça.
    if(next==='prePinch')return;
    state.gesture='hover';state.candidate=next;state.candidateFrames=1;
    state.smoothPoint=null;updateGestureUI('hover');return;
  }
  // Não esperamos os 3 quadros de estabilização para parar um desenho quando
  // uma pinça começa. Isso evita o pequeno risco feito antes de entrar em mover.
  if (state.gesture === 'draw' && (next === 'prePinch' || next === 'move')) {
    finishStroke(); state.gesture = 'prePinch'; state.candidate = next;
    state.candidateFrames = next === 'move' ? 1 : 0; state.smoothPoint = null;
    updateGestureUI('prePinch'); return;
  }
  if (next === state.candidate) state.candidateFrames++; else { state.candidate = next; state.candidateFrames = 1; }
  // Movimentos rápidos podem esconder momentaneamente um dedo. Mantemos o
  // pincel por alguns quadros, exceto quando uma pinça/borracha começa.
  const leavingDraw=state.gesture==='draw'&&!['draw','move','prePinch','erase'].includes(next);
  const framesNeeded=leavingDraw?state.drawGraceFrames:3;
  if (state.candidateFrames >= framesNeeded && state.gesture !== next) {
    if (state.current) finishStroke();
    state.gesture = next; state.smoothPoint = null; state.lastPinch = null;
    updateGestureUI(next);
  }
}

function smooth(p, factor=state.smoothing) {
  if (!state.smoothPoint) state.smoothPoint = p;
  else state.smoothPoint = { x:state.smoothPoint.x+(p.x-state.smoothPoint.x)*factor, y:state.smoothPoint.y+(p.y-state.smoothPoint.y)*factor };
  return {...state.smoothPoint};
}

function smoothHand(lm) {
  if(!state.visualLandmarks)state.visualLandmarks=lm.map(p=>({...p}));
  else state.visualLandmarks=lm.map((p,i)=>({
    x:state.visualLandmarks[i].x+(p.x-state.visualLandmarks[i].x)*.30,
    y:state.visualLandmarks[i].y+(p.y-state.visualLandmarks[i].y)*.30,
    z:state.visualLandmarks[i].z+(p.z-state.visualLandmarks[i].z)*.30
  }));
  return state.visualLandmarks;
}

function beginOrDraw(p) {
  if (state.paused) return;
  if (!state.current) {
    state.current = { color:state.brushColor, size:state.brushSize, brush:state.brushType, points:[p] };
    state.strokes.push(state.current); state.redo = [];
  } else {
    const last=state.current.points.at(-1),gap=dist(last,p);
    const maxSafeGap=Math.max(180,(state.width||1000)*.24);
    if(gap>maxSafeGap){finishStroke();state.current={color:state.brushColor,size:state.brushSize,brush:state.brushType,points:[p]};state.strokes.push(state.current)}
    else if(gap>1.4){const steps=Math.min(32,Math.max(1,Math.ceil(gap/6)));for(let i=1;i<=steps;i++)state.current.points.push({x:last.x+(p.x-last.x)*i/steps,y:last.y+(p.y-last.y)*i/steps});}
  }
  state.lastDrawTime=performance.now();
  renderStrokes(); updateHistoryButtons();
}
function finishStroke() { const finished=state.current;if (finished?.points.length < 2) state.strokes.pop();state.current=null;if(finished?.points.length>=2)window.dispatchEvent(new CustomEvent('kids:stroke-finished',{detail:finished})); }

function convexHull(points) {
  const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower=[];for(const p of sorted){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  const upper=[];for(const p of sorted.reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}

function insidePolygon(p, polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if(((a.y>p.y)!==(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x))inside=!inside;
  }
  return inside;
}

function distanceToSegment(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return dist(p,{x:a.x+t*dx,y:a.y+t*dy});
}

function eraseAt(lm) {
  if (state.paused) return;
  const handPoints=lm.map(point), hull=convexHull(handPoints);
  const margin=Math.max(10,dist(point(lm[5]),point(lm[17]))*.13);
  const touched=pt=>insidePolygon(pt,hull)||hull.some((a,i)=>distanceToSegment(pt,a,hull[(i+1)%hull.length])<margin);
  let changed=false;
  state.strokes = state.strokes.map(s => {
    const chunks=[]; let chunk=[];
    for (const pt of s.points) {
      if (touched(pt)) { if(chunk.length>1) chunks.push({...s,points:chunk}); chunk=[]; changed=true; }
      else chunk.push(pt);
    }
    if(chunk.length>1) chunks.push({...s,points:chunk});
    return chunks;
  }).flat();
  if(changed){ state.redo=[]; renderStrokes(); updateHistoryButtons(); }
}

function segmentsCross(a,b,c,d) {
  if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.max(c.x,d.x)<Math.min(a.x,b.x)||
     Math.max(a.y,b.y)<Math.min(c.y,d.y)||Math.max(c.y,d.y)<Math.min(a.y,b.y))return false;
  const turn=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const ab1=turn(a,b,c),ab2=turn(a,b,d),cd1=turn(c,d,a),cd2=turn(c,d,b);
  return ((ab1<=0&&ab2>=0)||(ab1>=0&&ab2<=0))&&((cd1<=0&&cd2>=0)||(cd1>=0&&cd2<=0));
}

function segmentDistance(a,b,c,d) {
  if(segmentsCross(a,b,c,d))return 0;
  return Math.min(distanceToSegment(a,c,d),distanceToSegment(b,c,d),distanceToSegment(c,a,b),distanceToSegment(d,a,b));
}

function strokesTouch(a,b) {
  // Só agrupa quando a tinta visível de um traço toca a do outro.
  const inkRadius=(a.size+b.size)/2;
  for(let i=1;i<a.points.length;i++)for(let j=1;j<b.points.length;j++){
    if(segmentDistance(a.points[i-1],a.points[i],b.points[j-1],b.points[j])<=inkRadius)return true;
  }
  return false;
}

function connectedGroup(seed) {
  const group=[seed], pending=[seed], remaining=state.strokes.filter(s=>s!==seed);
  while(pending.length){
    const current=pending.pop();
    for(let i=remaining.length-1;i>=0;i--){
      const other=remaining[i];
      if(strokesTouch(current,other)){group.push(other);pending.push(other);remaining.splice(i,1);}
    }
  }
  return group;
}

function nearestStroke(p) {
  let best=null,bestD=48;
  state.strokes.forEach(s => s.points.forEach(pt => { const d=dist(pt,p); if(d<bestD){best=s;bestD=d;} }));
  return best ? connectedGroup(best) : null;
}
function moveAt(p) {
  if (state.paused) return;
  // Pinça no interior vazio de uma forma fechada preenche; perto da tinta move.
  const closeStroke=nearestStroke(p);
  const enclosed=state.strokes.slice().reverse().find(s=>s.points.length>2&&dist(s.points[0],s.points.at(-1))<Math.max(30,s.size*4)&&insidePolygon(p,s.points));
  if(!closeStroke&&enclosed){if(!state.fillLatch){connectedGroup(enclosed).forEach(s=>s.fill=state.brushColor);state.fillLatch=true;renderStrokes();window.dispatchEvent(new Event('kids:filled'));}return;}
  if (!state.selected) state.selected=closeStroke;
  if (state.selected && state.lastPinch) {
    const dx=p.x-state.lastPinch.x,dy=p.y-state.lastPinch.y;
    state.selected.forEach(stroke=>stroke.points.forEach(pt=>{pt.x+=dx;pt.y+=dy;})); renderStrokes();
  }
  state.lastPinch=p;
}

function renderStrokes() {
  if(!state.width)return;
  pctx.clearRect(0,0,state.width,state.height);
  pctx.lineCap='round'; pctx.lineJoin='round';
  for(const s of state.strokes){
    if(s.points.length<2)continue;
    if(s.fill&&dist(s.points[0],s.points.at(-1))<Math.max(30,s.size*4)){pctx.beginPath();pctx.moveTo(s.points[0].x,s.points[0].y);s.points.slice(1).forEach(p=>pctx.lineTo(p.x,p.y));pctx.closePath();pctx.globalAlpha=.32;pctx.fillStyle=s.fill;pctx.fill();pctx.globalAlpha=1;}
    pctx.beginPath(); pctx.moveTo(s.points[0].x,s.points[0].y);
    for(let i=1;i<s.points.length;i++)pctx.lineTo(s.points[i].x,s.points[i].y);
    const last=s.points.at(-1);pctx.lineTo(last.x,last.y);
    const brush=s.brush||'neon';pctx.strokeStyle=brush==='rainbow'?`hsl(${(state.strokes.indexOf(s)*67+performance.now()/30)%360} 95% 65%)`:brush==='fire'?'#ff7a32':s.color;pctx.lineWidth=s.size;pctx.shadowColor=pctx.strokeStyle;pctx.shadowBlur=brush==='classic'?0:brush==='fire'?14:6;pctx.stroke();pctx.shadowBlur=0;
    if(brush==='stars'||brush==='bubbles'){const step=Math.max(6,Math.floor(s.points.length/18));for(let i=0;i<s.points.length;i+=step){const p=s.points[i];pctx.font=`${Math.max(8,s.size*1.6)}px sans-serif`;pctx.fillStyle=s.color;pctx.fillText(brush==='stars'?'✦':'○',p.x,p.y);}}
  }
}

function drawTracking(lm, cursor, gesture) {
  tctx.clearRect(0,0,state.width,state.height);
  if(state.showSkeleton){
    const pts=lm.map(point), palm=[pts[0],pts[1],pts[5],pts[9],pts[13],pts[17]];
    const glow=gesture==='erase'?'#ff6b8a':gesture==='move'?'#58d9ff':state.brushColor;
    const handWidth=dist(pts[5],pts[17]);
    const gradient=tctx.createRadialGradient(pts[9].x,pts[9].y,5,pts[9].x,pts[9].y,handWidth);
    gradient.addColorStop(0,'rgba(225,235,238,.34)');gradient.addColorStop(1,'rgba(130,155,165,.16)');
    tctx.beginPath();palm.forEach((p,i)=>i?tctx.lineTo(p.x,p.y):tctx.moveTo(p.x,p.y));tctx.closePath();
    tctx.fillStyle=gradient;tctx.fill();
    // Cada dedo é uma faixa arredondada e macia, sem articulações mecânicas.
    const fingers=[[0,1,2,3,4],[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20]];
    tctx.lineCap='round';tctx.lineJoin='round';tctx.strokeStyle='rgba(190,210,215,.29)';tctx.lineWidth=Math.max(10,handWidth*.15);
    fingers.forEach(ids=>{tctx.beginPath();ids.forEach((id,i)=>i?tctx.lineTo(pts[id].x,pts[id].y):tctx.moveTo(pts[id].x,pts[id].y));tctx.stroke();});
    // Um contorno fino comunica o modo atual sem transformar a mão em robô.
    tctx.strokeStyle=`${glow}99`;tctx.lineWidth=1.5;
    fingers.forEach(ids=>{tctx.beginPath();ids.forEach((id,i)=>i?tctx.lineTo(pts[id].x,pts[id].y):tctx.moveTo(pts[id].x,pts[id].y));tctx.stroke();});
  }
  if(gesture==='erase'){
    const hull=convexHull(lm.map(point));
    tctx.beginPath();hull.forEach((p,i)=>i?tctx.lineTo(p.x,p.y):tctx.moveTo(p.x,p.y));tctx.closePath();
    tctx.fillStyle='rgba(255,107,138,.13)';tctx.fill();tctx.strokeStyle='#ff6b8a';tctx.lineWidth=2;tctx.setLineDash([6,5]);tctx.stroke();tctx.setLineDash([]);
  }else{
    const radius=gesture==='move'?16:state.brushSize/2+8;
    tctx.beginPath();tctx.arc(cursor.x,cursor.y,radius,0,Math.PI*2);tctx.strokeStyle=gesture==='move'?'#58d9ff':state.brushColor;tctx.lineWidth=2;tctx.setLineDash([5,5]);tctx.stroke();tctx.setLineDash([]);
  }
  if(state.selected&&gesture==='move'){const selectedPoints=state.selected.flatMap(s=>s.points),xs=selectedPoints.map(p=>p.x),ys=selectedPoints.map(p=>p.y);tctx.strokeStyle='#58d9ff';tctx.lineWidth=2;tctx.strokeRect(Math.min(...xs)-10,Math.min(...ys)-10,Math.max(...xs)-Math.min(...xs)+20,Math.max(...ys)-Math.min(...ys)+20);}
}

async function startCamera() {
  if(state.running||state.starting)return;state.starting=true;
  try {
    setStatus('Carregando reconhecimento…',false);
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs');
    const fileset = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm');
    state.detector = await vision.HandLandmarker.createFromOptions(fileset,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.55,minHandPresenceConfidence:.55,minTrackingConfidence:.55});
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false});
    video.srcObject=stream;await video.play();state.running=true;state.starting=false;
    $('#cameraPlaceholder').classList.add('hidden');$('#gestureBadge').classList.add('visible');$('#hint').classList.add('visible');
    $('#cameraButton').innerHTML='<span class="camera-icon">●</span> Câmera ativa';setStatus('Rastreando em tempo real',true);document.body.classList.add('session-active');window.dispatchEvent(new Event('kids:started'));resizeCanvases();requestAnimationFrame(loop);
  } catch(err) { state.starting=false;$('#cameraPlaceholder').classList.remove('auto-starting');console.error(err);setStatus('Não foi possível iniciar',false);showToast(location.protocol==='file:'?'Abra pelo servidor local para usar a câmera':'Permita o uso da câmera e tente novamente'); }
}

function loop() {
  if(!state.running)return;
  if(video.currentTime!==state.lastVideoTime){
    state.lastVideoTime=video.currentTime;
    const result=state.detector.detectForVideo(video,performance.now());
    if(result.landmarks?.length){
      state.handMissFrames=0;
      const lm=result.landmarks[0];
      const handedness=result.handedness?.[0]?.[0]?.categoryName || 'Right';
      const raw=classify(lm,handedness);stabilize(raw);
      calibrateHand(lm);
      const anchor=state.gesture==='move'?point(lm[8]):state.gesture==='erase'?point(lm[9]):point(lm[8]);
      const cursor=smooth(anchor);
      if(state.gesture==='draw')beginOrDraw(cursor);
      else if(state.gesture==='erase')eraseAt(lm);
      else if(state.gesture==='move')moveAt(cursor);
      else { state.selected=null;state.lastPinch=null; }
      if(state.gesture!=='move')state.fillLatch=false;
      drawTracking(smoothHand(lm),cursor,state.gesture);
      window.dispatchEvent(new CustomEvent('kids:cursor',{detail:{...cursor,gesture:state.gesture}}));
    } else {
      state.handMissFrames++;
      if(state.handMissFrames>5){stabilize('none');finishStroke();state.selected=null;state.visualLandmarks=null;tctx.clearRect(0,0,state.width,state.height)}
    }
  }
  requestAnimationFrame(loop);
}

function calibrateHand(lm){
  if(state.calibration.done)return;const palm=dist(point(lm[5]),point(lm[17])),tip=point(lm[8]);state.calibration.samples.push(palm);if(state.calibration.previous)state.calibration.movement.push(dist(tip,state.calibration.previous));state.calibration.previous=tip;
  if(state.calibration.samples.length>=45){const values=state.calibration.samples.sort((a,b)=>a-b),moves=state.calibration.movement.sort((a,b)=>a-b),median=values[Math.floor(values.length/2)],jitter=moves[Math.floor(moves.length*.35)]||0;state.smoothing=median<70?.56:median>170?.36:jitter>5?.34:.44;state.drawGraceFrames=jitter>5?10:8;state.calibration.done=true;showToast('Mão calibrada automaticamente ✨');window.dispatchEvent(new Event('kids:calibrated'));}
}

function handleTwoHandTransform(hands){
  if(hands.length<2){state.twoTransform=null;return}
  const pinchHand=lm=>dist(point(lm[4]),point(lm[8]))<dist(point(lm[5]),point(lm[17]))*.42;
  if(!hands.every(pinchHand)){state.twoTransform=null;return}
  const a=point(hands[0][8]),b=point(hands[1][8]),center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=dist(a,b),angle=Math.atan2(b.y-a.y,b.x-a.x);
  if(!state.twoTransform){const group=nearestStroke(center);if(!group)return;state.twoTransform={group,center,distance,angle,original:group.map(s=>s.points.map(p=>({...p})))};return}
  const t=state.twoTransform,scale=Math.max(.35,Math.min(3,distance/t.distance)),rotation=angle-t.angle;
  t.group.forEach((s,si)=>s.points.forEach((p,pi)=>{const o=t.original[si][pi],x=o.x-t.center.x,y=o.y-t.center.y;p.x=center.x+(x*Math.cos(rotation)-y*Math.sin(rotation))*scale;p.y=center.y+(x*Math.sin(rotation)+y*Math.cos(rotation))*scale}));renderStrokes();
}

function updateGestureUI(gesture){
  const map={draw:['☝','Desenhando'],move:['🤏','Movendo traço'],prePinch:['🤏','Preparando pinça'],releasePinch:['○','Soltando pinça'],erase:['✋','Apagando'],turnPalm:['↻','Vire a palma para a tela'],hover:['•','Mão detectada'],none:['•','Aguardando mão']};
  $('#gestureIcon').textContent=map[gesture][0];$('#gestureName').textContent=map[gesture][1];
  ['draw','move','erase'].forEach(g=>$(`#${g}Card`).classList.toggle('active',g===gesture));
  if(['draw','move','erase'].includes(gesture))window.dispatchEvent(new CustomEvent('kids:sound',{detail:gesture==='erase'?'fill':gesture==='move'?'pop':'draw'}));
}
function setStatus(text,live){$('#statusText').textContent=text;$('#statusPill').classList.toggle('live',live);}
function updateHistoryButtons(){ $('#undoButton').disabled=!state.strokes.length;$('#redoButton').disabled=!state.redo.length; }
let toastTimer;function showToast(text){const el=$('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600);}

function undo(){finishStroke();const s=state.strokes.pop();if(s)state.redo.push(s);renderStrokes();updateHistoryButtons();}
function redo(){const s=state.redo.pop();if(s)state.strokes.push(s);renderStrokes();updateHistoryButtons();}
function clearAll(){if(!state.strokes.length)return;state.redo.push(...state.strokes.splice(0));renderStrokes();updateHistoryButtons();showToast('Tela limpa — você pode desfazer');}
function download(){
  const out=document.createElement('canvas');out.width=paintCanvas.width;out.height=paintCanvas.height;const c=out.getContext('2d');c.fillStyle='#0b0d13';c.fillRect(0,0,out.width,out.height);c.drawImage(paintCanvas,0,0);
  const a=document.createElement('a');a.download=`gesture-ink-${new Date().toISOString().slice(0,10)}.png`;a.href=out.toDataURL('image/png');a.click();showToast('Desenho salvo em PNG');
}

$('#cameraButton').addEventListener('click',startCamera);$('#startButton').addEventListener('click',startCamera);
$('#undoButton').addEventListener('click',undo);$('#redoButton').addEventListener('click',redo);$('#clearButton').addEventListener('click',clearAll);$('#downloadButton').addEventListener('click',download);
$('#brushSize').addEventListener('input',e=>{state.brushSize=+e.target.value;$('#brushOutput').textContent=`${e.target.value} px`;});
$('#colors').addEventListener('click',e=>{const btn=e.target.closest('.color');if(!btn)return;state.brushColor=btn.dataset.color;document.querySelectorAll('.color').forEach(b=>b.classList.toggle('active',b===btn));});
$('#customColor').addEventListener('input',e=>{state.brushColor=e.target.value;document.querySelectorAll('.color').forEach(b=>b.classList.remove('active'));});
$('#skeletonToggle').addEventListener('change',e=>state.showSkeleton=e.target.checked);
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}if(e.code==='Space'&&!e.repeat){e.preventDefault();state.paused=!state.paused;showToast(state.paused?'Desenho pausado':'Desenho retomado');}});
window.addEventListener('resize',resizeCanvases);resizeCanvases();
window.KidsAPI={state,renderStrokes,nearestStroke,connectedGroup,finishStroke,showToast,clearAll,paintCanvas,playSound:(kind='pop')=>window.dispatchEvent(new CustomEvent('kids:sound',{detail:kind}))};
// Modo quiosque infantil: ao abrir ou atualizar, entra direto na aventura.
window.addEventListener('load',()=>setTimeout(startCamera,250));
