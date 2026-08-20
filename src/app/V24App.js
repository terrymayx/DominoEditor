import { DominoMatterAdapter } from '../domino/DominoMatterAdapter.js';
import { MechanismPhysicsAdapter } from '../mechanism/MechanismPhysicsAdapter.js';
import { AdvancedDominoPathTool } from '../editor/AdvancedDominoPathTool.js';
import { BlueprintRuntime } from '../blueprint/BlueprintRuntime.js';

const M = window.Matter;
if (!M) throw new Error('Matter.js 未加载');

const { Engine, Bodies, Body, Composite, Events } = M;
const $ = id => document.getElementById(id);
const canvas = $('c');
const ctx = canvas.getContext('2d');
const WORLD_GROUND_Y = 650;
const mechanismTypes = new Set(['spring','piston','gear','magnet','wind','water','ice']);
const labels = {
  ball:'球', domino:'多米诺', box:'木箱', ramp:'斜坡', spring:'弹簧', piston:'活塞',
  gear:'齿轮', magnet:'磁铁', wind:'风场', water:'水流', ice:'冰面'
};
const colors = {
  ball:'#55b6ff', domino:'#f1f3f5', box:'#c68a4b', ramp:'#8a96a8', spring:'#d68cff',
  piston:'#61d4cf', gear:'#f0bb55', magnet:'#f1688d', wind:'#62dfe9', water:'#4f8cff', ice:'#9ce7ff'
};
const materialColors = { wood:'#f3ead8', stone:'#b8bec7', metal:'#cfd7df', ice:'#b9f1ff' };

let dpr = 1;
let nextId = 1;
let entities = [];
let selected = new Set();
let camera = { x:0, y:0, zoom:1 };
let mode = 'edit';
let engine = null;
let bodyMap = new Map();
let dominoAdapter = null;
let mechanismAdapter = null;
let blueprint = null;
let fallenSeen = new Set();
let lastFrame = performance.now();
let currentMaterial = 'wood';
let pathKind = 'none';
let pathAnchor = null;
let freePath = [];
let pointerDown = false;
let dragOffsets = new Map();
let draggingSelection = false;
let panning = false;
let panStart = null;
let spaceDown = false;
let history = [];
let historyIndex = -1;
let gestureDirty = false;

const pathTool = new AdvancedDominoPathTool({ spacing:Number($('pathSpacing')?.value || 34) });

function uid(){ return 'e' + nextId++; }
function rad(deg){ return deg * Math.PI / 180; }
function deg(r){ return r * 180 / Math.PI; }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function setMessage(t){ if ($('message')) $('message').textContent=t; }

function resize(){
  dpr = Math.max(1, Math.min(2, devicePixelRatio || 1));
  canvas.width = Math.round(innerWidth*dpr);
  canvas.height = Math.round(innerHeight*dpr);
  canvas.style.width = innerWidth+'px';
  canvas.style.height = innerHeight+'px';
}
addEventListener('resize', resize); resize();

function screenToWorld(sx,sy){ return {x:sx/camera.zoom+camera.x,y:sy/camera.zoom+camera.y}; }
function worldToScreen(x,y){ return {x:(x-camera.x)*camera.zoom,y:(y-camera.y)*camera.zoom}; }

function makeEntity(type,x=420,y=300){
  const e={id:uid(),type,x,y,r:0};
  if(type==='ball') Object.assign(e,{radius:24});
  if(type==='domino') Object.assign(e,{w:20,h:96,material:currentMaterial,sensitivity:1.15,impactMultiplier:1.1});
  if(type==='box') Object.assign(e,{w:64,h:64});
  if(type==='ramp') Object.assign(e,{w:220,h:18,r:18});
  if(type==='spring') Object.assign(e,{w:72,h:18,physics:{power:.06}});
  if(type==='piston') Object.assign(e,{w:84,h:26,physics:{stroke:90,speed:.08}});
  if(type==='gear') Object.assign(e,{radius:34,physics:{radius:34,angularSpeed:.04}});
  if(type==='magnet') Object.assign(e,{radius:42,physics:{radius:170,force:.0009}});
  if(type==='wind') Object.assign(e,{w:220,h:120,physics:{width:220,height:120,force:.0008}});
  if(type==='water') Object.assign(e,{w:240,h:110,physics:{width:240,height:110,force:.00055,drag:.025}});
  if(type==='ice') Object.assign(e,{w:220,h:20,physics:{width:220,height:20,friction:.005}});
  return e;
}

function snapshot(){ return JSON.stringify({version:24,nextId,entities}); }
function commitHistory(){
  if(mode!=='edit') return;
  const s=snapshot();
  if(history[historyIndex]===s) return;
  history=history.slice(0,historyIndex+1);
  history.push(s);
  if(history.length>100) history.shift();
  historyIndex=history.length-1;
  updateHistoryButtons();
}
function restoreHistory(i){
  if(i<0||i>=history.length||mode!=='edit') return;
  const d=JSON.parse(history[i]);
  entities=d.entities||[]; nextId=d.nextId||1; historyIndex=i; selected.clear();
  updateProps(); updateHistoryButtons();
}
function updateHistoryButtons(){
  if($('undoBtn')) $('undoBtn').disabled=historyIndex<=0;
  if($('redoBtn')) $('redoBtn').disabled=historyIndex<0||historyIndex>=history.length-1;
}

function addEntity(type){
  if(mode!=='edit') return;
  const center=screenToWorld(Math.min(innerWidth-330,560),Math.min(innerHeight-100,360));
  const e=makeEntity(type,Math.round(center.x/5)*5,Math.round(center.y/5)*5);
  if(type==='domino' && Math.abs(e.y-WORLD_GROUND_Y)<90) e.y=WORLD_GROUND_Y-e.h/2;
  entities.push(e); selected=new Set([e.id]); commitHistory(); updateProps();
  setMessage('已添加：'+labels[type]);
}

function entityById(id){ return entities.find(e=>e.id===id); }
function bodyFor(e){
  if(mode!=='run') return null;
  if(mechanismTypes.has(e.type)){
    const inst=mechanismAdapter?.instances.get(e.id);
    return inst?.body || inst?.sensor || null;
  }
  return bodyMap.get(e.id)||null;
}

function localPoint(e,p){
  const a=-rad(e.r||0),dx=p.x-e.x,dy=p.y-e.y;
  return {x:dx*Math.cos(a)-dy*Math.sin(a),y:dx*Math.sin(a)+dy*Math.cos(a)};
}
function hitEntity(p){
  for(let i=entities.length-1;i>=0;i--){
    const e=entities[i],q=localPoint(e,p);
    if(e.type==='ball'||e.type==='gear'||e.type==='magnet'){
      const rr=(e.radius||30)+7; if(q.x*q.x+q.y*q.y<=rr*rr) return e;
    }else{
      const w=(e.w||80),h=(e.h||50);
      if(Math.abs(q.x)<=w/2+7&&Math.abs(q.y)<=h/2+7) return e;
    }
  }
  return null;
}

function drawGrid(){
  const left=camera.x,top=camera.y,right=left+innerWidth/camera.zoom,bottom=top+innerHeight/camera.zoom;
  const step=40,major=200;
  ctx.lineWidth=1/camera.zoom;
  for(let x=Math.floor(left/step)*step;x<=right;x+=step){
    ctx.strokeStyle=(Math.round(x)%major===0)?'#27313f':'#1b222c';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
  }
  for(let y=Math.floor(top/step)*step;y<=bottom;y+=step){
    ctx.strokeStyle=(Math.round(y)%major===0)?'#27313f':'#1b222c';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
  }
  ctx.strokeStyle='#596575';ctx.lineWidth=2/camera.zoom;ctx.beginPath();ctx.moveTo(left,WORLD_GROUND_Y);ctx.lineTo(right,WORLD_GROUND_Y);ctx.stroke();
}

function drawDomino(e,x,y,a,sel){
  ctx.save();ctx.translate(x,y);ctx.rotate(a);
  ctx.fillStyle=materialColors[e.material||'wood']||materialColors.wood;
  ctx.strokeStyle=sel?'#ffe86c':'#171b20';ctx.lineWidth=(sel?4:2)/camera.zoom;
  ctx.fillRect(-e.w/2,-e.h/2,e.w,e.h);ctx.strokeRect(-e.w/2,-e.h/2,e.w,e.h);
  ctx.fillStyle='rgba(0,0,0,.24)';ctx.fillRect(-e.w/2+3,-e.h/2+6,e.w-6,3);
  ctx.restore();
}

function drawEntity(e){
  const b=bodyFor(e); const x=b?.position?.x??e.x,y=b?.position?.y??e.y,a=b?.angle??rad(e.r||0);
  const sel=selected.has(e.id);
  if(e.type==='domino'){ drawDomino(e,x,y,a,sel); return; }
  ctx.save();ctx.translate(x,y);ctx.rotate(a);
  ctx.strokeStyle=sel?'#ffe86c':'#11161d';ctx.lineWidth=(sel?4:2)/camera.zoom;ctx.fillStyle=colors[e.type]||'#ccc';
  if(e.type==='ball'){ctx.beginPath();ctx.arc(0,0,e.radius,0,Math.PI*2);ctx.fill();ctx.stroke();}
  else if(e.type==='gear'){
    ctx.beginPath();ctx.arc(0,0,e.radius,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle='#252a31';ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#252a31';for(let i=0;i<8;i++){const aa=i*Math.PI/4;ctx.beginPath();ctx.moveTo(Math.cos(aa)*15,Math.sin(aa)*15);ctx.lineTo(Math.cos(aa)*(e.radius-4),Math.sin(aa)*(e.radius-4));ctx.stroke();}
  }
  else if(e.type==='magnet'){
    const rr=e.physics?.radius||170;ctx.globalAlpha=.13;ctx.beginPath();ctx.arc(0,0,rr,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    ctx.beginPath();ctx.arc(0,0,e.radius,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 18px sans-serif';ctx.fillText('N',-7,6);
  }
  else if(e.type==='wind'||e.type==='water'){
    ctx.globalAlpha=.16;ctx.fillRect(-e.w/2,-e.h/2,e.w,e.h);ctx.globalAlpha=1;ctx.strokeRect(-e.w/2,-e.h/2,e.w,e.h);
    ctx.fillStyle='#eef';ctx.font='bold 18px sans-serif';ctx.fillText(e.type==='wind'?'➜➜':'≈≈≈',-25,6);
  }
  else if(e.type==='spring'){
    ctx.strokeRect(-e.w/2,-e.h/2,e.w,e.h);ctx.beginPath();ctx.moveTo(-e.w/2+6,0);for(let i=0;i<6;i++)ctx.lineTo(-e.w/2+12+i*10,(i%2?1:-1)*8);ctx.lineTo(e.w/2-6,0);ctx.stroke();
  }
  else if(e.type==='ice'){ctx.globalAlpha=.72;ctx.fillRect(-e.w/2,-e.h/2,e.w,e.h);ctx.globalAlpha=1;ctx.strokeRect(-e.w/2,-e.h/2,e.w,e.h);}
  else {const w=e.w||80,h=e.h||40;ctx.fillRect(-w/2,-h/2,w,h);ctx.strokeRect(-w/2,-h/2,w,h);}
  ctx.restore();
}

function drawPathPreview(){
  if(pathKind==='none')return;
  if(freePath.length>1){ctx.strokeStyle='#ffe26a';ctx.lineWidth=3/camera.zoom;ctx.beginPath();ctx.moveTo(freePath[0].x,freePath[0].y);for(const p of freePath.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke();}
  if(pathAnchor){ctx.fillStyle='#ffe26a';ctx.beginPath();ctx.arc(pathAnchor.x,pathAnchor.y,6/camera.zoom,0,Math.PI*2);ctx.fill();}
}

function render(){
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#10141a';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(dpr*camera.zoom,0,0,dpr*camera.zoom,-camera.x*dpr*camera.zoom,-camera.y*dpr*camera.zoom);
  drawGrid();
  for(const e of entities) drawEntity(e);
  drawPathPreview();
  ctx.setTransform(1,0,0,1,0,0);
  if($('cameraStatus')) $('cameraStatus').textContent=`镜头 ${Math.round(camera.zoom*100)}%`;
}

function toMechanismEntity(e){
  return {
    id:e.id,type:e.type,enabled:true,
    position:{x:e.x,y:e.y},rotation:rad(e.r||0),
    physics:{...(e.physics||{})}
  };
}

function createBasicBody(e){
  const a=rad(e.r||0); let b=null;
  if(e.type==='ball') b=Bodies.circle(e.x,e.y,e.radius,{density:.0045,friction:.03,restitution:.06,frictionAir:.0008});
  if(e.type==='box') b=Bodies.rectangle(e.x,e.y,e.w,e.h,{angle:a,density:.0038,friction:.52,restitution:.025});
  if(e.type==='ramp') b=Bodies.rectangle(e.x,e.y,e.w,e.h,{angle:a,isStatic:true,friction:.88});
  if(b){b.plugin=b.plugin||{};b.plugin.entityId=e.id;}
  return b;
}

function configureBlueprint(){
  const target=Math.max(1,Number($('goalCount')?.value||10));
  blueprint=new BlueprintRuntime({
    onAction: action=>{
      if(!mechanismAdapter||!action.target)return;
      if(action.type==='activate') mechanismAdapter.setActive(action.target,true);
      if(action.type==='deactivate') mechanismAdapter.setActive(action.target,false);
      if(action.type==='toggle') mechanismAdapter.setActive(action.target,!!action.value);
    },
    onVictory:()=>{setMessage(`🏆 目标完成：倒下 ${target} 块多米诺`);$('modeBadge').textContent='胜利';}
  });
  blueprint.load({
    nodes:[
      {id:'fallEvent',type:'event',params:{event:'domino.fallen'}},
      {id:'fallCounter',type:'counter',params:{target,reset:false}},
      {id:'victory',type:'victory'}
    ],
    links:[{from:'fallEvent',to:'fallCounter'},{from:'fallCounter',to:'victory'}]
  });
}

function startRun(){
  if(mode==='run')return;
  mode='run'; selected.clear(); updateProps();
  engine=Engine.create({enableSleeping:false});
  engine.positionIterations=10;engine.velocityIterations=8;engine.constraintIterations=4;engine.gravity.y=1.05;
  bodyMap=new Map();fallenSeen=new Set();
  const ground=Bodies.rectangle(0,WORLD_GROUND_Y+18,50000,36,{isStatic:true,friction:.9,frictionStatic:1});
  Composite.add(engine.world,ground);
  dominoAdapter=new DominoMatterAdapter(M,engine,{minRelativeSpeed:.12,assistScale:.00135,maxAssist:.014}).attach();
  mechanismAdapter=new MechanismPhysicsAdapter(M,engine);
  for(const e of entities){
    if(e.type==='domino'){
      const b=dominoAdapter.createBody(e);bodyMap.set(e.id,b);Composite.add(engine.world,b);
    }else if(mechanismTypes.has(e.type)){
      mechanismAdapter.add(toMechanismEntity(e));
    }else{
      const b=createBasicBody(e);if(b){bodyMap.set(e.id,b);Composite.add(engine.world,b);}
    }
  }
  Events.on(engine,'collisionStart',ev=>mechanismAdapter?.onCollisionPairs(ev.pairs));
  configureBlueprint();
  $('modeBadge').textContent='运行模式';setMessage('V24 运行中：真实倒伏、机关力场、Blueprint 目标已接入');
}

function stopRun(){
  if(mode!=='run')return;
  dominoAdapter?.detach();
  if(engine) Composite.clear(engine.world,false,true);
  engine=null;dominoAdapter=null;mechanismAdapter=null;blueprint=null;bodyMap.clear();fallenSeen.clear();
  mode='edit';$('modeBadge').textContent='编辑模式';setMessage('已停止，返回编辑模式');
}

function updateRun(dt){
  if(mode!=='run'||!engine)return;
  Engine.update(engine,Math.min(33,dt*1000));
  dominoAdapter?.update();mechanismAdapter?.update(dt);blueprint?.update();
  for(const e of entities){
    if(e.type!=='domino'||fallenSeen.has(e.id))continue;
    const b=bodyMap.get(e.id),meta=b?.plugin?.domino;
    if(meta?.fallen){fallenSeen.add(e.id);blueprint?.emit('domino.fallen',{id:e.id,count:fallenSeen.size,material:e.material});setMessage(`多米诺倒伏：${fallenSeen.size} 块`);}
  }
}

function pushFirstDomino(){
  if(mode!=='run')startRun();
  const doms=entities.filter(e=>e.type==='domino').sort((a,b)=>a.x-b.x);
  const e=doms[0],b=e&&bodyMap.get(e.id);if(!b){setMessage('没有可推动的多米诺');return;}
  Body.applyForce(b,{x:b.position.x,y:b.position.y-e.h*.38},{x:.011*b.mass,y:0});
  Body.setAngularVelocity(b,Math.max(.11,b.angularVelocity));setMessage('已推动第一块多米诺');
}

function setPath(kind){
  if(mode!=='edit')return;
  pathKind=kind;pathAnchor=null;freePath=[];
  document.querySelectorAll('[data-path]').forEach(b=>b.classList.toggle('active',b.dataset.path===kind));
  setMessage(kind==='none'?'路径工具已关闭':`路径工具：${kind==='free'?'自由绘制':kind==='line'?'直线':kind==='circle'?'圆形':'螺旋'}`);
}

function addPathDominoes(points){
  if(points.length<2)return;
  const created=[];
  for(let i=0;i<points.length;i++){
    const p=points[i],prev=points[Math.max(0,i-1)],next=points[Math.min(points.length-1,i+1)];
    const tangent=Math.atan2(next.y-prev.y,next.x-prev.x);
    const e=makeEntity('domino',p.x,p.y);e.r=deg(tangent);created.push(e);entities.push(e);
  }
  selected=new Set(created.map(e=>e.id));commitHistory();updateProps();setMessage(`已生成 ${created.length} 块多米诺`);
}

function finishTwoPointPath(p){
  pathTool.spacing=clamp(Number($('pathSpacing').value)||34,12,120);
  if(!pathAnchor){pathAnchor=p;setMessage('已设置起点，再点击一次确定终点/半径');return;}
  let pts=[];
  if(pathKind==='line') pts=pathTool.generateLine(pathAnchor,p);
  if(pathKind==='circle') pts=pathTool.generateCircle(pathAnchor.x,pathAnchor.y,Math.hypot(p.x-pathAnchor.x,p.y-pathAnchor.y));
  if(pathKind==='spiral') pts=pathTool.generateSpiral(pathAnchor.x,pathAnchor.y,Math.hypot(p.x-pathAnchor.x,p.y-pathAnchor.y));
  addPathDominoes(pts);pathAnchor=null;
}

function updateProps(){
  const ids=[...selected],one=ids.length===1?entityById(ids[0]):null;
  $('selectionInfo').textContent=ids.length?`已选择 ${ids.length} 个对象`:'未选择';
  $('props').classList.toggle('hidden',!one);$('emptyProps').classList.toggle('hidden',!!one);
  if(!one)return;
  $('pType').textContent=labels[one.type]||one.type;$('pX').value=Math.round(one.x);$('pY').value=Math.round(one.y);$('pR').value=Math.round(one.r||0);
  $('dominoProps').classList.toggle('hidden',one.type!=='domino');
  if(one.type==='domino'){$('pMaterial').value=one.material||'wood';$('pSensitivity').value=one.sensitivity||1.15;}
}

function applyProps(){
  if(mode!=='edit')return;
  const ids=[...selected]; if(!ids.length)return;
  for(const id of ids){const e=entityById(id);if(!e)continue;e.x=Number($('pX').value)||e.x;e.y=Number($('pY').value)||e.y;e.r=Number($('pR').value)||0;if(e.type==='domino'){e.material=$('pMaterial').value;e.sensitivity=Number($('pSensitivity').value)||1;}}
  commitHistory();updateProps();
}
function deleteSelected(){if(mode!=='edit'||!selected.size)return;entities=entities.filter(e=>!selected.has(e.id));selected.clear();commitHistory();updateProps();}
function duplicateSelected(){
  if(mode!=='edit'||!selected.size)return;const copies=[];for(const id of selected){const e=entityById(id);if(!e)continue;const n=structuredClone(e);n.id=uid();n.x+=24;n.y+=24;entities.push(n);copies.push(n.id);}selected=new Set(copies);commitHistory();updateProps();
}

function loadDemo(){
  if(mode==='run')stopRun();entities=[];selected.clear();nextId=1;
  const ramp=makeEntity('ramp',160,500);ramp.r=17;entities.push(ramp);
  const ball=makeEntity('ball',75,430);entities.push(ball);
  for(let i=0;i<22;i++){const d=makeEntity('domino',270+i*32,WORLD_GROUND_Y-48);d.material=i%7===6?'metal':'wood';entities.push(d);}
  const spring=makeEntity('spring',1020,WORLD_GROUND_Y-10);entities.push(spring);
  const gear=makeEntity('gear',1140,WORLD_GROUND_Y-62);entities.push(gear);
  const ice=makeEntity('ice',1320,WORLD_GROUND_Y-10);entities.push(ice);
  const wind=makeEntity('wind',1540,WORLD_GROUND_Y-90);entities.push(wind);
  camera={x:0,y:120,zoom:.85};commitHistory();setMessage('已载入 V24 综合测试场景：运行后可点“推第一块”测试连锁');
}

function save(){localStorage.setItem('DominoEditorV24',snapshot());setMessage('已保存到浏览器');}
function load(){
  const s=localStorage.getItem('DominoEditorV24');if(!s){setMessage('没有找到 V24 保存数据');return;}
  if(mode==='run')stopRun();const d=JSON.parse(s);entities=d.entities||[];nextId=d.nextId||1;selected.clear();history=[];historyIndex=-1;commitHistory();updateProps();setMessage('读取完成');
}
function exportJson(){
  const blob=new Blob([snapshot()],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='DominoEditor_V24.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}

canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  const p=screenToWorld(e.clientX,e.clientY);pointerDown=true;gestureDirty=false;
  if(e.button===1||e.button===2||spaceDown){panning=true;panStart={sx:e.clientX,sy:e.clientY,x:camera.x,y:camera.y};return;}
  if(mode!=='edit'||e.button!==0)return;
  if(pathKind==='free'){freePath=[p];return;}
  if(pathKind!=='none'){finishTwoPointPath(p);return;}
  const hit=hitEntity(p);
  if(hit){
    if(e.shiftKey){selected.has(hit.id)?selected.delete(hit.id):selected.add(hit.id);}else if(!selected.has(hit.id)){selected=new Set([hit.id]);}
    dragOffsets.clear();for(const id of selected){const en=entityById(id);if(en)dragOffsets.set(id,{x:en.x-p.x,y:en.y-p.y});}
    draggingSelection=true;updateProps();
  }else{if(!e.shiftKey)selected.clear();updateProps();}
});
canvas.addEventListener('pointermove',e=>{
  const p=screenToWorld(e.clientX,e.clientY);
  if(panning&&panStart){camera.x=panStart.x-(e.clientX-panStart.sx)/camera.zoom;camera.y=panStart.y-(e.clientY-panStart.sy)/camera.zoom;return;}
  if(!pointerDown||mode!=='edit')return;
  if(pathKind==='free'){const last=freePath[freePath.length-1];if(!last||Math.hypot(p.x-last.x,p.y-last.y)>5)freePath.push(p);return;}
  if(draggingSelection){for(const [id,o] of dragOffsets){const en=entityById(id);if(en){en.x=p.x+o.x;en.y=p.y+o.y;}}gestureDirty=true;updateProps();}
});
canvas.addEventListener('pointerup',()=>{
  if(pathKind==='free'&&freePath.length>1){pathTool.spacing=clamp(Number($('pathSpacing').value)||34,12,120);addPathDominoes(pathTool.sample(freePath));freePath=[];}
  if(gestureDirty)commitHistory();pointerDown=false;draggingSelection=false;panning=false;panStart=null;
});
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  if(e.altKey&&mode==='edit'&&selected.size){for(const id of selected){const en=entityById(id);if(en)en.r=(en.r||0)+(e.deltaY>0?5:-5);}commitHistory();updateProps();return;}
  const before=screenToWorld(e.clientX,e.clientY);const factor=Math.exp(-e.deltaY*.0012);camera.zoom=clamp(camera.zoom*factor,.18,3.5);const after=screenToWorld(e.clientX,e.clientY);camera.x+=before.x-after.x;camera.y+=before.y-after.y;
},{passive:false});

addEventListener('keydown',e=>{
  if(e.code==='Space')spaceDown=true;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?restoreHistory(historyIndex+1):restoreHistory(historyIndex-1);}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();restoreHistory(historyIndex+1);}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicateSelected();}
  if(e.key==='Delete'||e.key==='Backspace')deleteSelected();
  if(e.key==='Escape')setPath('none');
});
addEventListener('keyup',e=>{if(e.code==='Space')spaceDown=false;});

for(const b of document.querySelectorAll('[data-add]')) b.addEventListener('click',()=>addEntity(b.dataset.add));
for(const b of document.querySelectorAll('[data-path]')) b.addEventListener('click',()=>setPath(b.dataset.path));
$('runBtn').onclick=startRun;$('stopBtn').onclick=stopRun;$('pushBtn').onclick=pushFirstDomino;$('demoBtn').onclick=loadDemo;
$('undoBtn').onclick=()=>restoreHistory(historyIndex-1);$('redoBtn').onclick=()=>restoreHistory(historyIndex+1);
$('applyBtn').onclick=applyProps;$('deleteBtn').onclick=deleteSelected;$('dupBtn').onclick=duplicateSelected;
$('saveBtn').onclick=save;$('loadBtn').onclick=load;$('exportBtn').onclick=exportJson;
$('cameraBtn').onclick=()=>{camera={x:0,y:120,zoom:1};};
$('materialDefault').onchange=e=>{currentMaterial=e.target.value;};
$('pathSpacing').onchange=e=>{pathTool.spacing=clamp(Number(e.target.value)||34,12,120);};

commitHistory();updateProps();updateHistoryButtons();
setMessage('V24 集成完成：V20 多米诺物理 + V21 路径工具 + V22 机关库 + V23 Blueprint Runtime');

function frame(now){const dt=clamp((now-lastFrame)/1000,1/240,1/15);lastFrame=now;updateRun(dt);render();requestAnimationFrame(frame);}requestAnimationFrame(frame);

window.DominoEditorV24={get entities(){return entities;},startRun,stopRun,pushFirstDomino,loadDemo};
