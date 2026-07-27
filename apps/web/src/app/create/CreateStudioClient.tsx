'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useVoiceInput, VoiceInputButton } from '../../features/voice-input';
import styles from './create.module.css';

type RunnerMode = 'codex' | 'model' | 'auto';
type GenerationRouteId = 'direct-model' | 'codex-cli' | 'claude-code' | 'gemini-cli' | 'qwen-code' | 'aider';

type GeneratedApp = {
  title: string;
  kind: string;
  brief: string;
  html: string;
  teaching: string[];
  nextEdits: string[];
};

type CreateGenerateResponse = Partial<GeneratedApp> & {
  source?: 'model' | 'codex-runner';
  model?: string;
  repaired?: boolean;
  qualityFailures?: string[];
};

type GenerateRequest = {
  prompt: string;
  revision?: string;
  currentApp?: GeneratedApp;
  mode?: RunnerMode;
  cliProvider?: string;
  cliModel?: string;
  modelProvider?: string;
};

type CreateJobEvent = {
  at: string;
  stage: string;
  message: string;
  data?: Record<string, unknown>;
};

type CreateValidationReport = {
  ok?: boolean;
  failures?: string[];
  warnings?: string[];
  startedAt?: string;
  finishedAt?: string;
  quality?: {
    score?: number;
    threshold?: number;
    ok?: boolean;
    gateFailures?: string[];
    warnings?: string[];
    criteria?: Array<{
      id: string;
      label: string;
      passed: boolean;
      weight: number;
      evidence?: string;
      required?: boolean;
    }>;
  };
};

type CreateJob = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: string;
  attempts?: number;
  events?: CreateJobEvent[];
  result?: CreateGenerateResponse;
  validationReport?: CreateValidationReport | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
  mode?: RunnerMode;
  cliProvider?: string;
  cliModel?: string;
  modelProvider?: string;
};

type CliProvider = {
  id: string;
  title: string;
  description?: string;
  modelLabel?: string;
  configured?: boolean;
  installed?: boolean;
  available?: boolean;
};


type CliModel = {
  id: string;
  providerId: string;
  title: string;
  description?: string;
  model?: string;
  modelLabel?: string;
  configured?: boolean;
  installed?: boolean;
  available?: boolean;
  authConfigured?: boolean;
  authHint?: string;
  blockedReason?: string;
};

type ModelProvider = {
  id: string;
  title: string;
  description?: string;
  model?: string;
  baseUrl?: string;
  configured?: boolean;
  available?: boolean;
  latencyMs?: number | null;
  error?: string | null;
};

type CreateRunnerHealth = {
  ok?: boolean;
  status?: string;
  cliProviders?: CliProvider[];
  defaultCliProvider?: string;
  cliModels?: CliModel[];
  defaultCliModel?: string;
  modelProviders?: ModelProvider[];
  defaultModelProvider?: string;
  error?: string;
};

type CreateJobResponse = {
  job?: CreateJob;
  error?: string;
};

type VersionRecord = {
  id: string;
  version: number;
  label: string;
  createdAt: string;
  app: GeneratedApp;
  model?: string;
};

const examples = [
  '做一个太空躲避陨石小游戏，难度慢慢增加',
  '做一个可爱的番茄钟，适合小朋友学习',
  '做一个抽奖转盘，可以编辑奖项',
  '做一个森林风格的学习任务清单',
];

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));

const appTitle = (prompt: string, fallback: string) => {
  const clean = prompt
    .replace(/^做一个|^生成一个|^帮我做一个|^我要一个|^设计一个/, '')
    .replace(/[。.!！?？]/g, '')
    .trim();
  if (!clean) return fallback;
  return clean.length > 18 ? `${clean.slice(0, 18)}…` : clean;
};

const themeFor = (prompt: string) => {
  if (/可爱|儿童|小朋友|粉|萌/.test(prompt)) {
    return {
      bg: 'linear-gradient(135deg,#fff0f6,#e7f5ff 58%,#fff9db)',
      panel: 'rgba(255,255,255,.76)',
      text: '#273043',
      muted: '#68738a',
      accent: '#ff6b9d',
      accent2: '#4dabf7',
    };
  }
  if (/森林|自然|植物|露营|清新/.test(prompt)) {
    return {
      bg: 'radial-gradient(circle at top,#d8f5a2,transparent 35%),linear-gradient(135deg,#0b2f23,#081c15)',
      panel: 'rgba(255,255,255,.1)',
      text: '#f5fff8',
      muted: '#c6f6d5',
      accent: '#8ce99a',
      accent2: '#ffd43b',
    };
  }
  return {
    bg: 'radial-gradient(circle at 20% 10%,#233d7a 0,transparent 30%),radial-gradient(circle at 80% 20%,#11494d 0,transparent 26%),#050816',
    panel: 'rgba(255,255,255,.09)',
    text: '#f4f7ff',
    muted: '#aeb8d6',
    accent: '#63e6be',
    accent2: '#7c8cff',
  };
};

const wrapHtml = (title: string, prompt: string, body: string, script: string) => {
  const theme = themeFor(prompt);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    *{box-sizing:border-box} html,body{margin:0;min-height:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:${theme.text}}
    body{min-height:100vh;background:${theme.bg};overflow:hidden}
    button,input{font:inherit}
    .app{min-height:100vh;display:grid;grid-template-rows:auto 1fr;padding:clamp(16px,4vw,34px);position:relative}
    .app:before{content:"";position:absolute;inset:-20%;background-image:radial-gradient(circle,rgba(255,255,255,.36) 1px,transparent 1px);background-size:42px 42px;opacity:.16;transform:rotate(-8deg);pointer-events:none}
    .top{position:relative;z-index:1;display:flex;justify-content:space-between;gap:14px;align-items:center}
    .brand{display:flex;align-items:center;gap:10px;letter-spacing:.08em;text-transform:uppercase;font-size:12px;color:${theme.muted}}
    .dot{width:11px;height:11px;border-radius:999px;background:${theme.accent};box-shadow:0 0 26px ${theme.accent}}
    .badge{border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:8px 11px;background:rgba(255,255,255,.08);color:${theme.muted};font-size:12px}
    .stage{position:relative;z-index:1;display:grid;place-items:center;min-height:0;padding:24px 0}
    .panel{width:min(760px,100%);min-height:min(620px,calc(100vh - 120px));display:grid;align-content:center;gap:20px;padding:clamp(22px,5vw,52px);border:1px solid rgba(255,255,255,.16);border-radius:34px;background:${theme.panel};box-shadow:0 30px 100px rgba(0,0,0,.32);backdrop-filter:blur(18px)}
    h1{margin:0;font-size:clamp(34px,8vw,82px);line-height:.9;letter-spacing:-.07em;overflow-wrap:anywhere;word-break:break-word}
    p{margin:0;color:${theme.muted};line-height:1.7}.controls{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
    .primary,.ghost{min-height:44px;border-radius:999px;border:0;padding:0 18px;cursor:pointer}
    .primary{color:#06101d;font-weight:900;background:linear-gradient(135deg,${theme.accent},${theme.accent2})}.ghost{color:${theme.text};border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08)}
    .metric{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:6px}.metric div{border-top:1px solid rgba(255,255,255,.16);padding-top:12px}.metric strong{display:block;font-size:clamp(24px,5vw,44px)}.metric span{color:${theme.muted};font-size:12px}
    canvas{width:100%;max-width:640px;height:min(58vh,430px);border-radius:26px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.15);box-shadow:inset 0 0 40px rgba(0,0,0,.3)}
    input{width:100%;min-height:48px;border-radius:18px;border:1px solid rgba(255,255,255,.18);padding:0 14px;color:${theme.text};background:rgba(255,255,255,.08);outline:none}
    @media(max-width:620px){body{overflow:auto}.app{min-height:100svh;padding:14px}.top{align-items:flex-start}.panel{min-height:calc(100svh - 96px);border-radius:26px}.metric{grid-template-columns:1fr}}
  </style>
</head>
<body>${body}<script>${script.replace(/<\/script/gi, '<\\/script')}</script></body>
</html>`;
};

const makeGame = (prompt: string): GeneratedApp => {
  const title = appTitle(prompt, '太空躲避陨石');
  const body = `<main class="app"><header class="top"><div class="brand"><span class="dot"></span>AIYA Create</div><div class="badge">方向键 / 触摸拖动</div></header><section class="stage"><div class="panel"><h1>${escapeHtml(title)}</h1><p>躲开坠落陨石，吃到能量星。这个小游戏已经适配手机触摸和电脑键盘。</p><canvas id="game" width="760" height="480"></canvas><div class="controls"><button class="primary" id="start">开始游戏</button><button class="ghost" id="reset">重开</button></div><div class="metric"><div><strong id="score">0</strong><span>当前分数</span></div><div><strong id="best">0</strong><span>本轮最高</span></div><div><strong id="level">1</strong><span>难度等级</span></div></div></div></section></main>`;
  const hard = /困难|更难|加快|高速|疯狂/.test(prompt);
  const script = `const c=document.getElementById('game'),x=c.getContext('2d'),scoreEl=document.getElementById('score'),bestEl=document.getElementById('best'),levelEl=document.getElementById('level');let run=false,score=0,best=0,t=0,p={x:380,y:390,r:18,vx:0},rocks=[],stars=[];function reset(){run=false;score=0;t=0;p={x:380,y:390,r:18,vx:0};rocks=[];stars=[];draw()}function spawn(){rocks.push({x:Math.random()*720+20,y:-30,r:Math.random()*18+14,vy:Math.random()*2.2+${hard ? 3.2 : 2.1}+score/260})}function star(){stars.push({x:Math.random()*720+20,y:-20,r:9,vy:2.1+score/400})}function hit(a,b){return Math.hypot(a.x-b.x,a.y-b.y)<a.r+b.r}function ship(){x.save();x.translate(p.x,p.y);x.fillStyle='#63e6be';x.shadowColor='#63e6be';x.shadowBlur=18;x.beginPath();x.moveTo(0,-24);x.lineTo(20,20);x.lineTo(0,12);x.lineTo(-20,20);x.closePath();x.fill();x.restore()}function draw(){x.clearRect(0,0,760,480);x.fillStyle='rgba(255,255,255,.9)';for(let i=0;i<70;i++)x.fillRect((i*97+t*.18)%760,(i*53+t*.38)%480,1.5,1.5);rocks.forEach(r=>{x.fillStyle='#8d99ae';x.beginPath();x.arc(r.x,r.y,r.r,0,Math.PI*2);x.fill()});stars.forEach(s=>{x.fillStyle='#7c8cff';x.beginPath();x.arc(s.x,s.y,s.r,0,Math.PI*2);x.fill()});ship()}function step(){if(!run)return;t++;score++;if(t%Math.max(18,48-Math.floor(score/80))===0)spawn();if(t%95===0)star();p.x=Math.max(24,Math.min(736,p.x+p.vx));rocks.forEach(r=>r.y+=r.vy);stars.forEach(s=>s.y+=s.vy);rocks=rocks.filter(r=>r.y<520);stars=stars.filter(s=>s.y<520);for(const r of rocks){if(hit(p,r)){run=false;best=Math.max(best,score);bestEl.textContent=best;draw();return}}stars=stars.filter(s=>{if(hit(p,s)){score+=80;return false}return true});scoreEl.textContent=score;levelEl.textContent=String(1+Math.floor(score/240));draw();requestAnimationFrame(step)}document.getElementById('start').onclick=()=>{if(!run){run=true;requestAnimationFrame(step)}};document.getElementById('reset').onclick=reset;window.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')p.vx=-7;if(e.key==='ArrowRight')p.vx=7;if(e.key===' '){run=true;requestAnimationFrame(step)}});window.addEventListener('keyup',()=>p.vx=0);c.addEventListener('pointermove',e=>{const r=c.getBoundingClientRect();p.x=(e.clientX-r.left)/r.width*760});reset();`;
  return {
    title,
    kind: '小游戏 · 画布',
    brief: '一个带得分、难度递增和触摸控制的浏览器小游戏。',
    html: wrapHtml(title, prompt, body, script),
    teaching: ['Canvas 负责绘制飞船、陨石和星星。', 'requestAnimationFrame 形成游戏循环。', '碰撞检测用两个圆心距离判断，适合入门理解游戏逻辑。'],
    nextEdits: ['把飞船换成小猫', '加一个生命值系统', '换成像素街机风格'],
  };
};

const makeTimer = (prompt: string): GeneratedApp => {
  const title = appTitle(prompt, '专注番茄钟');
  const body = `<main class="app"><header class="top"><div class="brand"><span class="dot"></span>AIYA Create</div><div class="badge">专注 / 休息</div></header><section class="stage"><div class="panel"><h1>${escapeHtml(title)}</h1><p>一个适合学习和工作的轻量番茄钟。点击开始，25 分钟专注后自动进入休息提示。</p><div class="metric"><div><strong id="m">25</strong><span>分钟</span></div><div><strong id="s">00</strong><span>秒</span></div><div><strong id="r">1</strong><span>轮次</span></div></div><div class="controls"><button class="primary" id="go">开始</button><button class="ghost" id="rest">5 分钟休息</button><button class="ghost" id="reset">重置</button></div></div></section></main>`;
  const script = `let total=25*60,timer=null,round=1;const m=document.getElementById('m'),s=document.getElementById('s'),r=document.getElementById('r');function paint(){m.textContent=String(Math.floor(total/60)).padStart(2,'0');s.textContent=String(total%60).padStart(2,'0');r.textContent=round}function run(){if(timer)return;timer=setInterval(()=>{total--;if(total<=0){clearInterval(timer);timer=null;round++;total=5*60;document.body.style.filter='brightness(1.12)'}paint()},1000)}document.getElementById('go').onclick=run;document.getElementById('rest').onclick=()=>{clearInterval(timer);timer=null;total=5*60;paint()};document.getElementById('reset').onclick=()=>{clearInterval(timer);timer=null;total=25*60;round=1;document.body.style.filter='none';paint()};paint();`;
  return {
    title,
    kind: '效率工具 · 计时器',
    brief: '一个可立即使用的番茄钟，适合作为个人效率小应用的第一步。',
    html: wrapHtml(title, prompt, body, script),
    teaching: ['计时器的核心是 setInterval。', '状态变量 total 决定页面显示的分钟和秒。', '按钮事件负责开始、休息和重置。'],
    nextEdits: ['改成 50 分钟专注', '加一个完成音效', '记录今天完成了几轮'],
  };
};

const makeWheel = (prompt: string): GeneratedApp => {
  const title = appTitle(prompt, '幸运抽奖转盘');
  const body = `<main class="app"><header class="top"><div class="brand"><span class="dot"></span>AIYA Create</div><div class="badge">可编辑奖项</div></header><section class="stage"><div class="panel"><h1>${escapeHtml(title)}</h1><p>输入奖项，用逗号分隔，然后点击开始抽奖。</p><canvas id="wheel" width="620" height="420"></canvas><input id="items" value="一等奖,二等奖,三等奖,再来一次,神秘礼物,谢谢参与" /><div class="controls"><button class="primary" id="spin">开始抽奖</button></div><p id="result">准备开始。</p></div></section></main>`;
  const script = `const c=document.getElementById('wheel'),x=c.getContext('2d'),input=document.getElementById('items'),result=document.getElementById('result');let angle=0,spinning=false,colors=['#63e6be','#7c8cff','#ffd166','#ef476f','#06d6a0','#118ab2'];function list(){return input.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean).slice(0,10)}function draw(){const items=list(),cx=310,cy=210,r=165;x.clearRect(0,0,620,420);items.forEach((it,i)=>{const a1=angle+i*Math.PI*2/items.length,a2=angle+(i+1)*Math.PI*2/items.length;x.beginPath();x.moveTo(cx,cy);x.arc(cx,cy,r,a1,a2);x.fillStyle=colors[i%colors.length];x.fill();x.save();x.translate(cx,cy);x.rotate((a1+a2)/2);x.fillStyle='#08111f';x.font='bold 18px sans-serif';x.fillText(it,60,6);x.restore()});x.fillStyle='#fff';x.beginPath();x.moveTo(cx,30);x.lineTo(cx-16,70);x.lineTo(cx+16,70);x.fill()}function spin(){if(spinning)return;spinning=true;let speed=.55+Math.random()*.25;const id=setInterval(()=>{angle+=speed;speed*=.97;draw();if(speed<.012){clearInterval(id);spinning=false;const items=list();const i=Math.floor((((Math.PI*1.5-angle)%(Math.PI*2)+Math.PI*2)%(Math.PI*2))/(Math.PI*2/items.length));result.textContent='抽中：'+items[i%items.length]}},16)}document.getElementById('spin').onclick=spin;input.oninput=draw;draw();`;
  return {
    title,
    kind: '互动工具 · 抽奖组件',
    brief: '一个可编辑奖项的抽奖转盘，适合活动页和课堂互动。',
    html: wrapHtml(title, prompt, body, script),
    teaching: ['Canvas 扇形绘制可以做出转盘。', '奖项列表来自输入框，用逗号拆分。', '减速动画制造“转起来”的感觉。'],
    nextEdits: ['加中奖音效', '增加奖项权重', '发布成活动分享页'],
  };
};

const makeChecklist = (prompt: string): GeneratedApp => {
  const title = appTitle(prompt, '想法行动清单');
  const body = `<main class="app"><header class="top"><div class="brand"><span class="dot"></span>AIYA Create</div><div class="badge">应用雏形</div></header><section class="stage"><div class="panel"><h1>${escapeHtml(title)}</h1><p>根据你的想法生成第一版应用骨架：添加任务、完成任务，并查看进度。</p><input id="task" placeholder="输入一个任务" /><div class="controls"><button class="primary" id="add">添加任务</button><button class="ghost" id="seed">生成三步计划</button></div><div class="metric"><div><strong id="done">0</strong><span>已完成</span></div><div><strong id="total">0</strong><span>总任务</span></div><div><strong id="progress">0%</strong><span>进度</span></div></div><p id="list"></p></div></section></main>`;
  const script = `const task=document.getElementById('task'),list=document.getElementById('list');let rows=[];function paint(){const done=rows.filter(x=>x.done).length;document.getElementById('done').textContent=done;document.getElementById('total').textContent=rows.length;document.getElementById('progress').textContent=rows.length?Math.round(done/rows.length*100)+'%':'0%';list.innerHTML=rows.map((x,i)=>'<button class="ghost" data-i="'+i+'">'+(x.done?'✓ ':'○ ')+x.name+'</button>').join(' ')||'先添加一个任务。';list.querySelectorAll('button').forEach(btn=>btn.onclick=()=>{rows[Number(btn.dataset.i)].done=!rows[Number(btn.dataset.i)].done;paint()})}function add(name){if(!name)return;rows.push({name,done:false});task.value='';paint()}document.getElementById('add').onclick=()=>add(task.value.trim());document.getElementById('seed').onclick=()=>{rows=[{name:'确认目标用户',done:false},{name:'做出第一个可运行版本',done:false},{name:'分享给 3 个人试用',done:false}];paint()};paint();`;
  return {
    title,
    kind: '通用应用 · 任务清单',
    brief: '一个从任意想法启动的任务型应用骨架，可继续扩展为项目管理、学习计划或活动工具。',
    html: wrapHtml(title, prompt, body, script),
    teaching: ['最小应用通常需要输入、状态和渲染。', 'rows 数组保存任务状态。', '点击任务按钮可以切换完成状态。'],
    nextEdits: ['改成学习打卡工具', '增加截止日期', '生成分享海报'],
  };
};

const buildApp = (input: string): GeneratedApp => {
  const prompt = input.replace(/\s+/g, ' ').trim() || examples[0];
  if (/番茄|计时|专注|倒计时|效率/.test(prompt)) return makeTimer(prompt);
  if (/抽奖|转盘|随机|选择|摇号/.test(prompt)) return makeWheel(prompt);
  if (/游戏|躲避|陨石|飞船|飞机|打怪|闯关|跑酷/.test(prompt)) return makeGame(prompt);
  return makeChecklist(prompt);
};

const isLikelyGamePrompt = (value: string) => {
  const lowerValue = value.toLowerCase();
  return [
    '\u6e38\u620f',
    '\u5c0f\u6e38\u620f',
    '\u8d2a\u5403\u86c7',
    '\u8d2a\u98df\u86c7',
    'snake',
    '\u95ef\u5173',
    '\u5f97\u5206',
    '\u65b9\u5411\u952e',
    'wasd',
    '\u63a7\u5236',
    '\u8dd1\u9177',
    '\u5c04\u51fb',
    '\u98de\u673a',
    '\u98de\u8239',
    '\u8eb2\u907f',
    '\u6253\u602a',
  ].some((term) => lowerValue.includes(term.toLowerCase()));
};

const requireTextField = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`create-runner succeeded but result.${field} is missing; mock/fallback is disabled.`);
  }
  return value.trim();
};

const requireStringArray = (value: unknown, field: string) => {
  if (!Array.isArray(value)) {
    throw new Error(`create-runner succeeded but result.${field} is missing; mock/fallback is disabled.`);
  }
  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 5);
  if (!cleaned.length) {
    throw new Error(`create-runner succeeded but result.${field} is empty; mock/fallback is disabled.`);
  }
  return cleaned;
};


const localizeGeneratedText = (text: string) => {
  const replacements: Array<[RegExp, string]> = [
    [/Single-file Demo - DeepSeek Fast Lane/g, '\u5355\u6587\u4ef6 Demo \u00b7 DeepSeek \u5feb\u901f\u901a\u9053'],
    [/DeepSeek v4 Pro first returns a compact game\/app spec; AIYA renders deterministic HTML and only shows it after static, semantic, and Playwright validation pass\./g, '\u6a21\u578b\u5148\u7406\u89e3\u9700\u6c42\uff0cAIYA \u751f\u6210\u53ef\u8fd0\u884c\u9875\u9762\uff0c\u5e76\u5728\u9759\u6001\u3001\u8bed\u4e49\u548c\u6d4f\u89c8\u5668\u9a8c\u8bc1\u901a\u8fc7\u540e\u5c55\u793a\u3002'],
    [/Fast lane: use a small model call only for intent\/spec, then use deterministic templates for reliable playable demos\./g, '\u5feb\u901f\u901a\u9053\uff1a\u5148\u7406\u89e3\u610f\u56fe\u548c\u73a9\u6cd5\u89c4\u683c\uff0c\u518d\u751f\u6210\u53ef\u73a9 Demo\u3002'],
    [/Quality gate: block external resources\/network\/storage, run browser interaction checks, and verify keyboard scroll isolation\./g, '\u8d28\u91cf\u95e8\u7981\uff1a\u7981\u7528\u5916\u90e8\u8d44\u6e90\u3001\u7f51\u7edc\u548c\u5b58\u50a8\uff0c\u9a8c\u8bc1\u6d4f\u89c8\u5668\u4ea4\u4e92\u4e0e\u952e\u76d8\u6eda\u52a8\u9694\u79bb\u3002'],
    [/Model:/g, '\u6a21\u578b\uff1a'],
    [/Quality score:/g, '\u9a8c\u8bc1\u63d0\u793a\uff1a'],
    [/Improve visual theme/g, '\u4f18\u5316\u89c6\u89c9\u98ce\u683c'],
    [/Add levels or difficulty/g, '\u589e\u52a0\u5173\u5361\u6216\u96be\u5ea6'],
    [/Upgrade into a multi-file project/g, '\u5347\u7ea7\u4e3a\u591a\u6587\u4ef6\u9879\u76ee'],
    [/Canvas/g, '\u753b\u5e03'],
  ];
  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
};

const localizeGeneratedDemoHtml = (html: string) => {
  const replacements: Array<[RegExp, string]> = [
    [/Super Plumber Rush/g, '\u8d85\u7ea7\u6c34\u7ba1\u5de5\u51b2\u523a'],
    [/AIYA CREATE ? CANVAS BUILD MODE/g, 'AIYA CREATE ? \u753b\u5e03\u6784\u5efa\u6a21\u5f0f'],
    [/AIYA Create ? Canvas Build Mode/g, 'AIYA Create ? \u753b\u5e03\u6784\u5efa\u6a21\u5f0f'],
    [/Canvas Build Mode/g, '\u753b\u5e03\u6784\u5efa\u6a21\u5f0f'],
    [/Neon Drift/g, '\u9713\u8679\u98de\u884c'],
    [/Run, jump, collect bright coins, avoid stomping hazards, and restart instantly\./g, '\u5954\u8dd1\u3001\u8df3\u8dc3\u3001\u6536\u96c6\u91d1\u5e01\u3001\u907f\u5f00\u969c\u788d\uff0c\u968f\u65f6\u53ef\u4ee5\u91cd\u65b0\u5f00\u59cb\u3002'],
    [/Move the ship, collect cyan energy, avoid red meteors, and restart instantly\./g, '\u79fb\u52a8\u98de\u8239\uff0c\u6536\u96c6\u80fd\u91cf\uff0c\u907f\u5f00\u9668\u77f3\uff0c\u968f\u65f6\u91cd\u65b0\u5f00\u59cb\u3002'],
    [/Collect cyan cores\. Avoid red meteors\./g, '\u6536\u96c6\u9752\u8272\u80fd\u91cf\u6838\uff0c\u907f\u5f00\u7ea2\u8272\u9668\u77f3\u3002'],
    [/Impact detected\. Restart and try again\./g, '\u53d1\u751f\u78b0\u649e\u3002\u8bf7\u91cd\u65b0\u5f00\u59cb\u518d\u8bd5\u3002'],
    [/Hit the mole before time runs out\. The target jumps across a real 3 x 3 board\./g, '\u5728\u5012\u8ba1\u65f6\u7ed3\u675f\u524d\u6253\u4e2d\u5730\u9f20\uff0c\u76ee\u6807\u4f1a\u5728 3?3 \u6d1e\u53e3\u4e2d\u968f\u673a\u51fa\u73b0\u3002'],
    [/Time up\. Final score (\d+)\. \u91cd\u65b0\u5f00\u59cb to play again\./g, '\u65f6\u95f4\u5230\uff0c\u6700\u7ec8\u5f97\u5206 $1\u3002\u70b9\u51fb\u91cd\u65b0\u5f00\u59cb\u518d\u73a9\u4e00\u5c40\u3002'],
    [/Time up\. Final score/g, '\u65f6\u95f4\u5230\uff0c\u6700\u7ec8\u5f97\u5206'],
    [/to play again/g, '\u518d\u73a9\u4e00\u5c40'],
    [/click\/tap holes/g, '\u70b9\u51fb\u6d1e\u53e3'],
    [/keys 1-9/g, '\u6570\u5b57\u952e 1-9'],
    [/Space hits current mole/g, '\u7a7a\u683c\u952e\u6253\u5f53\u524d\u5730\u9f20'],
    [/Press Space, ArrowUp, or click canvas to jump\./g, '\u6309\u7a7a\u683c\u3001\u4e0a\u65b9\u5411\u952e\uff0c\u6216\u70b9\u51fb\u753b\u5e03\u8df3\u8dc3\u3002'],
    [/Press Space or move to start\./g, '\u6309\u7a7a\u683c\u6216\u79fb\u52a8\u5f00\u59cb\u3002'],
    [/ArrowLeft \/ ArrowRight \/ A \/ D \/ Space \/ pointer move\./g, '\u65b9\u5411\u952e / A / D / \u7a7a\u683c / \u6307\u9488\u79fb\u52a8\u3002'],
    [/\bTIME\b/g, '\u65f6\u95f4'],
    [/\bTime\b/g, '\u65f6\u95f4'],
    [/\bScore\b/g, '\u5206\u6570'],
    [/\bPoints\b/g, '\u5f97\u5206'],
    [/\bBest\b/g, '\u6700\u9ad8\u5206'],
    [/\bStatus\b/g, '\u72b6\u6001'],
    [/Game Over/g, '\u6e38\u620f\u7ed3\u675f'],
    [/gameover/g, '\u6e38\u620f\u7ed3\u675f'],
    [/\brunning\b/g, '\u8fdb\u884c\u4e2d'],
    [/\bReady\b/g, '\u51c6\u5907\u5c31\u7eea'],
    [/\bready\b/g, '\u51c6\u5907\u5c31\u7eea'],
    [/Start \/ Resume/g, '\u5f00\u59cb / \u7ee7\u7eed'],
    [/Restart/g, '\u91cd\u65b0\u5f00\u59cb'],
    [/Controls:/g, '\u64cd\u4f5c\uff1a'],
  ];
  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), html);
};

const normalizeGeneratedApp = (result: CreateGenerateResponse): GeneratedApp => ({
  title: localizeGeneratedText(requireTextField(result.title, 'title')).slice(0, 80),
  kind: localizeGeneratedText(requireTextField(result.kind, 'kind')).slice(0, 40),
  brief: localizeGeneratedText(requireTextField(result.brief, 'brief')).slice(0, 180),
  html: localizeGeneratedDemoHtml(requireTextField(result.html, 'html')),
  teaching: requireStringArray(result.teaching, 'teaching').map(localizeGeneratedText),
  nextEdits: requireStringArray(result.nextEdits, 'nextEdits').map(localizeGeneratedText),
});

const makeVersionRecord = (app: GeneratedApp, label: string, version = 1, model?: string): VersionRecord => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  version,
  label,
  createdAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  app,
  model,
});

const stageLabels: Record<string, string> = {
  queued: '排队中',
  preparing: '准备工作区',
  fast_generating: '理解需求',
  fast_verify: '快速验证',
  codex_generating: '编写代码',
  static_check: '静态检查',
  browser_verify: '浏览器验证',
  quality_review: '验证汇总',
  repairing: '自动修复',
  succeeded: '验证通过',
  failed: '验证失败',
};

const stageOrder = ['queued', 'preparing', 'fast_generating', 'fast_verify', 'codex_generating', 'static_check', 'browser_verify', 'quality_review', 'repairing', 'succeeded'];

const stageDescriptions: Record<string, string> = {
  queued: '任务已创建，等待生成器接手。',
  preparing: '创建临时目录，写入产品规格与模板文件。',
  fast_generating: '模型正在理解你的需求，并生成应用/游戏规格。',
  fast_verify: '正在检查生成结果是否可运行、可交互、符合需求。',
  codex_generating: '服务器 Codex 正在编写代码；复杂演示这里耗时最长。',
  static_check: '运行安装、类型检查、代码检查、测试和构建。',
  browser_verify: '启动浏览器执行真实点击、按键、截图验证。',
  quality_review: '汇总命令、浏览器、语义和工程结构，形成验证诊断。',
  repairing: '验证失败时把报告交回 Codex 自动修复。',
  succeeded: '产物通过验证，准备替换右侧预览。',
};

type JobStepState = 'done' | 'active' | 'pending' | 'skipped' | 'failed';

const stageEstimatedMs: Record<string, number> = {
  queued: 5_000,
  preparing: 8_000,
  fast_generating: 35_000,
  fast_verify: 12_000,
  codex_generating: 540_000,
  static_check: 35_000,
  browser_verify: 12_000,
  quality_review: 4_000,
  repairing: 420_000,
  succeeded: 0,
};

const programmingTips: Record<string, string[]> = {
  queued: ['可靠的生成系统会先排队并创建隔离工作区，避免多个任务互相污染文件。', '生成失败时不能覆盖旧版本；必须保留上一个可用演示。'],
  preparing: ['产品规格会把一句话需求变成可测试的工程约束。', '模板负责固定依赖、测试和画布生命周期，让模型专注业务逻辑。'],
  fast_generating: ['第一步不是直接写页面，而是先判断你要做的是游戏、工具还是互动组件。', '如果任务太复杂，系统会跳过快速通道，进入更完整的 Codex 编程流程。'],
  fast_verify: ['快速验证会检查是否有多元素互动、计分、倒计时、重开入口和真实交互变化。', '验证诊断会提示问题，但不再用质量分挡住预览。'],
  codex_generating: ['游戏质量的关键是清晰状态、输入反馈和可重开路径，不只是画面复杂。', '方向键游戏必须阻止页面滚动，否则网页滚动会和游戏控制冲突。'],
  static_check: ['类型检查负责发现导入和类型错误，测试负责验证核心逻辑。', '构建通过不代表可玩，所以还需要浏览器验证。'],
  browser_verify: ['浏览器验证会真实打开页面、按键、点击和截图，这是比静态分析更强的证据。', '画布演示可以通过输入前后的图像变化判断是否真的可交互。'],
  quality_review: ['验证诊断来自命令链、浏览器证据、语义匹配和工程结构。', '现在优先让用户先看到结果，再把问题作为诊断提示出来。'],
  repairing: ['自动修复应该只修根因，不能为了过测试删功能或降低验收标准。', '好的修复循环会把失败报告交回模型，而不是让用户重新描述问题。'],
};

const translateRunnerMessage = (value?: string) => {
  let text = String(value || '');
  if (!text) return '';
  const replacements: Array<[RegExp, string]> = [
    [/Create workspace is being prepared/gi, '正在准备工作区'],
    [/DeepSeek fast lane demo validated and preview artifact is ready/gi, '快速通道已通过验证，预览产物已就绪'],
    [/DeepSeek fast lane is using\s*/gi, '快速通道使用模型：'],
    [/DeepSeek fast lane returned candidate html/gi, '快速通道已返回候选页面'],
    [/DeepSeek fast lane is generating a demo spec with\s*/gi, '正在生成演示规格，模型：'],
    [/Fast lane model returned in\s*/gi, '快速通道模型返回，用时 '],
    [/rendering verified HTML/gi, '正在渲染已验证页面'],
    [/Running fast lane static checks/gi, '正在执行快速通道静态检查'],
    [/Running fast lane browser checks/gi, '正在执行快速通道浏览器检查'],
    [/Scoring fast lane quality gates/gi, '正在汇总快速通道验证诊断'],
    [/Fast lane validation failed/gi, '快速通道验证失败'],
    [/Fast lane failed:/gi, '快速通道失败：'],
    [/Server Codex is implementing ProductSpec inside template/gi, '服务器 Codex 正在模板内实现产品规格'],
    [/Codex generation failed:/gi, 'Codex 生成失败：'],
    [/Running project command validation/gi, '正在执行项目命令验证'],
    [/Validation failed/gi, '验证失败'],
    [/Running pnpm install/gi, '正在安装依赖'],
    [/Running pnpm typecheck/gi, '正在执行类型检查'],
    [/Running pnpm lint/gi, '正在执行代码规范检查'],
    [/Running pnpm test/gi, '正在执行测试'],
    [/Running pnpm build/gi, '正在构建项目'],
    [/Running pnpm smoke/gi, '正在执行浏览器冒烟测试'],
    [/Codex is still writing code/gi, 'Codex 仍在编写代码'],
    [/passed in/gi, '已通过，用时'],
    [/Static safety checks passed/gi, '静态安全检查通过'],
    [/Browser runtime has no errors/gi, '浏览器运行无错误'],
    [/Visible response after input/gi, '输入后有可见响应'],
    [/Arrow\/WASD\/Space do not scroll host page/gi, '方向键/WASD/空格不会滚动宿主页'],
    [/No external resources/gi, '未检测到外部资源'],
    [/Score\/status/gi, '分数/状态'],
    [/Restart/gi, '重新开始'],
    [/playable/gi, '可玩'],
    [/Quality gate failed:/gi, '验证提示：'],
    [/Browser check failed:/gi, '浏览器检查失败：'],
    [/Semantic check failed:/gi, '语义检查失败：'],
    [/Whack-a-mole/gi, '打地鼠'],
    [/Snake/gi, '贪食蛇'],
    [/Console error:/gi, '控制台错误：'],
    [/Page error:/gi, '页面错误：'],
    [/Job /gi, '任务 '],
    [/workspace/gi, '工作区'],
    [/artifact/gi, '产物'],
    [/validation/gi, '验证'],
    [/quality/gi, '质量'],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text;
};

const stageLabel = (stage?: string) => stageLabels[stage || ''] || stage || '\u51c6\u5907\u4e2d';

const stageProgress = (stage?: string, status?: string) => {
  if (status === 'succeeded') return 100;
  if (status === 'failed') return 100;
  const index = Math.max(0, stageOrder.indexOf(stage || 'queued'));
  return Math.min(96, Math.round(((index + 1) / stageOrder.length) * 100));
};

const lastJobEventMessage = (job: CreateJob | null) => translateRunnerMessage(job?.events?.[job.events.length - 1]?.message || stageLabel(job?.stage));

const stageTip = (stage: string | undefined, elapsedMs: number) => {
  const tips = programmingTips[stage || ''] || programmingTips.queued;
  return tips[Math.floor(Math.max(0, elapsedMs) / 18_000) % tips.length];
};

const estimatedRemainingMs = (stage: string | undefined, status: string | undefined, stageElapsedMsValue: number) => {
  if (status === 'succeeded' || status === 'failed') return 0;
  const safeStage = stage || 'queued';
  const currentIndex = Math.max(0, stageOrder.indexOf(safeStage));
  const currentBudget = Math.max(0, (stageEstimatedMs[safeStage] || 0) - stageElapsedMsValue);
  const nextStages = stageOrder.slice(currentIndex + 1).filter((item) => !['repairing', 'succeeded'].includes(item));
  return currentBudget + nextStages.reduce((sum, item) => sum + (stageEstimatedMs[item] || 0), 0);
};

const parseTimestamp = (value?: string) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatClockTime = (value?: string) => {
  const time = parseTimestamp(value);
  if (!time) return '--:--';
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const jobStartedAtMs = (job: CreateJob | null, fallbackNow: number) =>
  parseTimestamp(job?.createdAt) || parseTimestamp(job?.events?.[0]?.at) || fallbackNow;

const jobFinishedAtMs = (job: CreateJob | null, fallbackNow: number) => {
  if (!job || (job.status !== 'succeeded' && job.status !== 'failed')) return fallbackNow;
  return parseTimestamp(job.updatedAt) || parseTimestamp(job.events?.[job.events.length - 1]?.at) || fallbackNow;
};

const jobElapsedMs = (job: CreateJob | null, fallbackNow: number, manualStartedAt?: number | null) => {
  if (!job) return manualStartedAt ? fallbackNow - manualStartedAt : 0;
  return jobFinishedAtMs(job, fallbackNow) - jobStartedAtMs(job, fallbackNow);
};

const stageStartedAtMs = (job: CreateJob | null, fallbackNow: number) => {
  if (!job?.events?.length) return jobStartedAtMs(job, fallbackNow);
  const reversedEvents = [...job.events].reverse();
  const currentStageEvent = reversedEvents.find((event) => event.stage === job.stage);
  return parseTimestamp(currentStageEvent?.at) || jobStartedAtMs(job, fallbackNow);
};

const stageElapsedMs = (job: CreateJob | null, fallbackNow: number) => {
  if (!job) return 0;
  return jobFinishedAtMs(job, fallbackNow) - stageStartedAtMs(job, fallbackNow);
};

const jobStepState = (job: CreateJob | null, stage: string): JobStepState => {
  if (!job) return 'pending';
  const hasStageEvent = Boolean(job.events?.some((event) => event.stage === stage));
  if (job.status === 'failed' && job.stage === stage) return 'failed';
  if (job.status === 'succeeded') {
    if (stage === 'repairing' && !hasStageEvent) return 'skipped';
    return 'done';
  }
  if (job.stage === stage) return 'active';
  const currentIndex = Math.max(0, stageOrder.indexOf(job.stage || 'queued'));
  const stageIndex = stageOrder.indexOf(stage);
  if (stageIndex >= 0 && stageIndex < currentIndex) return 'done';
  return 'pending';
};

const createCodexJob = async (request: GenerateRequest): Promise<CreateJob> => {
  const response = await fetch('/api/create/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => null) as CreateJobResponse | null;
  if (!response.ok || !payload?.job) {
    throw new Error(payload?.error || `create-runner \u8fd4\u56de ${response.status}`);
  }
  return payload.job;
};

const fetchCodexJob = async (jobId: string): Promise<CreateJob> => {
  const response = await fetch(`/api/create/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => null) as CreateJobResponse | null;
  if (!response.ok || !payload?.job) {
    throw new Error(payload?.error || `create-runner \u67e5\u8be2\u8fd4\u56de ${response.status}`);
  }
  return payload.job;
};

const waitForCodexJob = async (jobId: string, onProgress: (job: CreateJob) => void): Promise<CreateJob> => {
  const started = Date.now();
  while (Date.now() - started < 900_000) {
    const job = await fetchCodexJob(jobId);
    onProgress(job);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((resolve) => window.setTimeout(resolve, 900));
  }
  throw new Error('create-runner \u4efb\u52a1\u8d85\u8fc7 15 \u5206\u949f\uff0c\u8bf7\u67e5\u770b runner \u65e5\u5fd7\u6216\u7a0d\u540e\u91cd\u8bd5\u3002');
};


const generationRouteText: Record<GenerationRouteId, { title: string; desc: string; kind: 'model' | 'cli'; providerId?: string }> = {
  'direct-model': { title: '直接模型', desc: '速度优先，直接生成', kind: 'model' },
  'codex-cli': { title: 'Codex CLI', desc: '编程、验证、修复', kind: 'cli', providerId: 'codex' },
  'claude-code': { title: 'Claude Code', desc: '命令行编程链路', kind: 'cli', providerId: 'claude-code' },
  'gemini-cli': { title: 'Gemini CLI', desc: '预留扩展', kind: 'cli', providerId: 'gemini-cli' },
  'qwen-code': { title: 'Qwen Code', desc: '预留扩展', kind: 'cli', providerId: 'qwen-code' },
  aider: { title: 'Aider', desc: '预留扩展', kind: 'cli', providerId: 'aider' },
};

const generationRouteOrder: GenerationRouteId[] = ['direct-model', 'codex-cli', 'claude-code', 'gemini-cli', 'qwen-code', 'aider'];

const defaultCliProviders: CliProvider[] = [
  { id: 'codex', title: 'Codex CLI', description: '\u5f53\u524d\u9ed8\u8ba4\u670d\u52a1\u5668\u7f16\u7a0b\u5de5\u5177', configured: true, installed: true, available: true },
  { id: 'claude-code', title: 'Claude Code', description: '\u9700\u8981\u670d\u52a1\u5668\u5b89\u88c5\u5e76\u914d\u7f6e claude \u547d\u4ee4', configured: false, installed: false, available: false },
  { id: 'gemini-cli', title: 'Gemini CLI', description: '\u9700\u8981\u670d\u52a1\u5668\u5b89\u88c5\u5e76\u914d\u7f6e gemini \u547d\u4ee4', configured: false, installed: false, available: false },
  { id: 'qwen-code', title: 'Qwen Code', description: '\u9700\u8981\u670d\u52a1\u5668\u5b89\u88c5\u5e76\u914d\u7f6e qwen \u547d\u4ee4', configured: false, installed: false, available: false },
  { id: 'aider', title: 'Aider', description: '\u9700\u8981\u670d\u52a1\u5668\u5b89\u88c5\u5e76\u914d\u7f6e aider \u547d\u4ee4', configured: false, installed: false, available: false },
];

const cliProviderTitle = (providers: CliProvider[], id?: string) =>
  providers.find((provider) => provider.id === id)?.title || id || 'Codex CLI';

const cliModelTitle = (models: CliModel[], id?: string) =>
  models.find((model) => model.id === id)?.title || id || 'Codex GPT-5.5';

const compactModelName = (title?: string, model?: string) => {
  const source = title || model || '默认模型';
  return source
    .replace(/^Codex CLI\s*-\s*DeepPraxis\s*/i, '')
    .replace(/^Claude Code\s*-\s*DeepPraxis\s*/i, '')
    .replace(/\s*-\s*Direct$/i, '')
    .replace(/Kimi K2\.7 Code/i, 'Kimi K2.7')
    .replace(/Qwen3\.7 Max/i, 'Qwen3.7')
    .replace(/Doubao Seed 2\.1 Pro/i, '豆包 2.1 Pro')
    .trim();
};

const routeStatusText = (available: boolean, configured?: boolean, installed?: boolean) => {
  if (available) return '可用';
  if (installed === false) return '未安装';
  if (configured === false) return '未配置';
  return '不可用';
};

const isUnsupportedCliModel = (model: CliModel) => model.providerId === 'codex' && model.id.startsWith('codex-gpt-');

const defaultCliModels: CliModel[] = [
  { id: 'claude-deepraxis-qwen3-7-max', providerId: 'claude-code', title: 'Claude Code - DeepPraxis Qwen3.7 Max', model: 'qwen3.7-max', configured: true, installed: true, available: true },
  { id: 'claude-deepraxis-deepseek-v4-pro', providerId: 'claude-code', title: 'Claude Code - DeepPraxis DeepSeek V4 Pro', model: 'deepseek-v4-pro', configured: true, installed: true, available: true },
  { id: 'claude-deepraxis-kimi-k2-7-code', providerId: 'claude-code', title: 'Claude Code - DeepPraxis Kimi K2.7 Code', model: 'kimi-k2.7-code', configured: true, installed: true, available: true },
  { id: 'codex-deepraxis-kimi-k2-7-code', providerId: 'codex', title: 'Codex CLI - DeepPraxis Kimi K2.7 Code', model: 'kimi-k2.7-code', configured: true, installed: true, available: true },
  { id: 'codex-deepraxis-deepseek-v4-pro', providerId: 'codex', title: 'Codex CLI - DeepPraxis DeepSeek V4 Pro', model: 'deepseek-v4-pro', configured: true, installed: true, available: true },
  { id: 'codex-deepraxis-qwen3-7-max', providerId: 'codex', title: 'Codex CLI - DeepPraxis Qwen3.7 Max', model: 'qwen3.7-max', configured: true, installed: true, available: true },
];

const defaultModelProviders: ModelProvider[] = [
  { id: 'direct-kimi-k2-7-code', title: 'Kimi K2.7 Code - Direct', model: 'kimi-k2.7-code', configured: false, available: false, latencyMs: null },
  { id: 'direct-deepseek-v4-pro', title: 'DeepSeek V4 Pro - Direct', model: 'deepseek-v4-pro', configured: false, available: false, latencyMs: null },
  { id: 'direct-glm-5-2', title: 'GLM-5.2 - Direct', model: 'glm-5.2', configured: false, available: false, latencyMs: null },
  { id: 'router-qwen3-7-max', title: 'Qwen3.7 Max - Router', model: 'qwen3.7-max', configured: false, available: false, latencyMs: null },
  { id: 'direct-minimax-m2-7', title: 'MiniMax M2.7 - Direct', model: 'minimax-m2.7', configured: false, available: false, latencyMs: null },
  { id: 'direct-doubao-seed-2-1-pro', title: 'Doubao Seed 2.1 Pro - Direct', model: 'doubao-seed-2.1-pro', configured: false, available: false, latencyMs: null },
  { id: 'direct-deepseek-v4-flash', title: 'DeepSeek V4 Flash - Direct', model: 'deepseek-v4-flash', configured: false, available: false, latencyMs: null },
];

const fetchRunnerHealth = async (): Promise<CreateRunnerHealth> => {
  const response = await fetch('/api/create/health', { cache: 'no-store' });
  const payload = await response.json().catch(() => null) as CreateRunnerHealth | null;
  if (!response.ok) throw new Error(payload?.error || `create-runner 健康检查返回 ${response.status}`);
  return payload || {};
};


const jobStatusText = (job?: CreateJob) => {
  if (!job) return '未开始';
  if (job.status === 'succeeded') return '已完成';
  if (job.status === 'failed') return '失败';
  if (job.status === 'queued') return '排队中';
  return stageLabel(job.stage);
};

const jobValidationText = (job?: CreateJob) => {
  if (!job?.validationReport) return '待验证';
  if (job.validationReport.failures?.length || job.validationReport.quality?.gateFailures?.length) return '有提示';
  return '已验证';
};

const jobAgeText = (job?: CreateJob, now = Date.now()) => {
  if (!job?.createdAt) return '--';
  return formatDuration(Math.max(0, now - new Date(job.createdAt).getTime()));
};

const latestEventDataValue = (job: CreateJob | undefined, key: string) => {
  const events = job?.events || [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = events[index]?.data?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
};

const jobStreamLines = (job?: CreateJob, limit = 6) => {
  const value = latestEventDataValue(job, 'streamLines');
  return Array.isArray(value)
    ? value.filter((line): line is string => typeof line === 'string' && Boolean(line.trim())).slice(-limit)
    : [];
};

const jobDataText = (job: CreateJob | undefined, key: string) => {
  const value = latestEventDataValue(job, key);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
};

const jobFailureText = (job?: CreateJob) => {
  if (!job) return '';
  return job.error || job.validationReport?.failures?.[0] || '';
};

const jobCompareVerdict = (job?: CreateJob) => {
  if (!job) return { label: '等待提交', tone: 'idle' as const };
  if (job.status === 'queued' || job.status === 'running') return { label: '运行中', tone: 'running' as const };
  if (job.status === 'failed') return { label: '失败', tone: 'failed' as const };
  if (job.validationReport?.ok === false || job.validationReport?.quality?.ok === false) {
    return { label: '可预览 · 有警告', tone: 'warning' as const };
  }
  return { label: '通过', tone: 'passed' as const };
};

const jobCompareStatus = (job?: CreateJob) => jobCompareVerdict(job).tone;

const jobCompareMainIssue = (job?: CreateJob) => {
  if (!job) return '启动后会显示最新运行事件。';
  const firstFailure = job.validationReport?.failures?.[0]
    || job.validationReport?.quality?.gateFailures?.[0]
    || job.error;
  if (firstFailure) return translateRunnerMessage(firstFailure);
  if (job.validationReport?.warnings?.[0]) return translateRunnerMessage(job.validationReport.warnings[0]);
  return translateRunnerMessage(lastJobEventMessage(job));
};


export default function CreateStudioClient() {
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const revisionInputRef = useRef<HTMLInputElement | null>(null);
  const activeVoiceTargetRef = useRef<'prompt' | 'revision'>('prompt');
  const textCursorRef = useRef({
    prompt: { start: 0, end: 0 },
    revision: { start: 0, end: 0 },
  });
  const [prompt, setPrompt] = useState(examples[0]);
  const [revision, setRevision] = useState('');
  const [generated, setGenerated] = useState<GeneratedApp>(() => buildApp(examples[0]));
  const [versionHistory, setVersionHistory] = useState<VersionRecord[]>(() => [
    makeVersionRecord(buildApp(examples[0]), '示例初始版本'),
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'teach' | 'source' | 'publish'>('teach');
  const [showSourceCode, setShowSourceCode] = useState(false);
  const [notice, setNotice] = useState('Codex 运行器会在服务器隔离工作区中生成、验证并修复演示。');
  const [jobProgress, setJobProgress] = useState<CreateJob | null>(null);
  const [selectedRouteIds, setSelectedRouteIds] = useState<GenerationRouteId[]>(['direct-model']);
  const [cliProviders, setCliProviders] = useState<CliProvider[]>(defaultCliProviders);
  const [selectedCliProvider, setSelectedCliProvider] = useState('claude-code');
  const [cliModels, setCliModels] = useState<CliModel[]>(defaultCliModels);
  const [selectedCliModel, setSelectedCliModel] = useState('claude-deepraxis-qwen3-7-max');
  const [selectedCliModelByProvider, setSelectedCliModelByProvider] = useState<Record<string, string>>({
    codex: 'codex-deepraxis-kimi-k2-7-code',
    'claude-code': 'claude-deepraxis-qwen3-7-max',
  });
  const [modelProviders, setModelProviders] = useState<ModelProvider[]>(defaultModelProviders);
  const [selectedModelProvider, setSelectedModelProvider] = useState('direct-kimi-k2-7-code');
  const [runnerHealthError, setRunnerHealthError] = useState<string | null>(null);
  const [compareJobs, setCompareJobs] = useState<Partial<Record<GenerationRouteId, CreateJob>>>({});
  const [compareResults, setCompareResults] = useState<Partial<Record<GenerationRouteId, GeneratedApp>>>({});
  const [selectedCompareLane, setSelectedCompareLane] = useState<GenerationRouteId | null>(null);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [progressNow, setProgressNow] = useState(() => Date.now());
  const jobIsActive = jobProgress?.status === 'queued' || jobProgress?.status === 'running';
  const rememberTextCursor = (target: 'prompt' | 'revision') => {
    const element = target === 'prompt' ? promptTextareaRef.current : revisionInputRef.current;
    const value = target === 'prompt' ? prompt : revision;
    activeVoiceTargetRef.current = target;
    if (!element) return;
    textCursorRef.current[target] = {
      start: element.selectionStart ?? value.length,
      end: element.selectionEnd ?? value.length,
    };
  };

  const insertTextAtCursor = (target: 'prompt' | 'revision', text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    const element = target === 'prompt' ? promptTextareaRef.current : revisionInputRef.current;
    const cursor = textCursorRef.current[target];
    const update = target === 'prompt' ? setPrompt : setRevision;
    update((current) => {
      const start = Math.max(0, Math.min(cursor.start, current.length));
      const end = Math.max(start, Math.min(cursor.end, current.length));
      const before = current.slice(0, start);
      const after = current.slice(end);
      const prefix = before && !/\s$/.test(before) ? ' ' : '';
      const suffix = after && !/^\s/.test(after) ? ' ' : '';
      const next = `${before}${prefix}${cleanText}${suffix}${after}`;
      const nextCursor = before.length + prefix.length + cleanText.length;
      window.requestAnimationFrame(() => {
        element?.focus();
        element?.setSelectionRange(nextCursor, nextCursor);
        activeVoiceTargetRef.current = target;
        textCursorRef.current[target] = { start: nextCursor, end: nextCursor };
      });
      return next;
    });
  };

  const voice = useVoiceInput({
    hotwords: ['AIYA', 'Codex', '贪吃蛇', '小游戏', '应用', 'Demo', '发布'],
    onCommit: (text) => {
      insertTextAtCursor(activeVoiceTargetRef.current, text);
      setNotice('\u8bed\u97f3\u5185\u5bb9\u5df2\u63d2\u5165\u5230\u5f53\u524d\u5149\u6807\u4f4d\u7f6e\u3002');
    },
    onError: (error) => {
      setNotice(`语音输入失败：${error.message}`);
    },
  });

  useEffect(() => {
    const idea = new URLSearchParams(window.location.search).get('idea');
    if (!idea) return;
    const decoded = decodeURIComponent(idea);
    const localApp = buildApp(decoded);
    setPrompt(decoded);
    setGenerated(localApp);
    setVersionHistory([makeVersionRecord(localApp, '分享入口初始版本')]);
  }, []);

  useEffect(() => {
    if (!isGenerating && !jobIsActive) return;
    setProgressNow(Date.now());
    const timer = window.setInterval(() => setProgressNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating, jobIsActive]);

  useEffect(() => {
    let cancelled = false;
    fetchRunnerHealth()
      .then((health) => {
        if (cancelled) return;
        const providers = health.cliProviders?.length ? health.cliProviders : defaultCliProviders;
        setCliProviders(providers);
        setRunnerHealthError(health.status === 'misconfigured' ? '\u9ed8\u8ba4 CLI \u5de5\u5177\u4e0d\u53ef\u7528\uff0c\u8bf7\u68c0\u67e5\u670d\u52a1\u5668\u547d\u4ee4\u6216\u5bc6\u94a5\u914d\u7f6e\u3002' : null);
        const nextProvider = health.defaultCliProvider || providers.find((provider) => provider.available)?.id || providers[0]?.id || 'claude-code';
        setSelectedCliProvider((current) => providers.some((provider) => provider.id === current) ? current : nextProvider);
        const nextCliModels = health.cliModels?.length ? health.cliModels : defaultCliModels;
        setCliModels(nextCliModels);
        const activeProvider = providers.some((provider) => provider.id === selectedCliProvider) ? selectedCliProvider : nextProvider;
        const nextCliModel = health.defaultCliModel && nextCliModels.some((model) => model.id === health.defaultCliModel && model.providerId === activeProvider)
          ? health.defaultCliModel
          : nextCliModels.find((model) => model.providerId === activeProvider && model.available)?.id || nextCliModels.find((model) => model.providerId === activeProvider)?.id || 'claude-deepraxis-qwen3-7-max';
        setSelectedCliModel((current) => nextCliModels.some((model) => model.id === current && model.providerId === activeProvider) ? current : nextCliModel);
        setSelectedCliModelByProvider((current) => {
          const next = { ...current };
          for (const provider of providers) {
            const existing = next[provider.id];
            const providerModels = nextCliModels.filter((model) => model.providerId === provider.id && !isUnsupportedCliModel(model));
            const stillValid = providerModels.some((model) => model.id === existing);
            if (!stillValid) {
              next[provider.id] = providerModels.find((model) => model.available)?.id
                || providerModels[0]?.id
                || '';
            }
          }
          return next;
        });
        const nextModelProviders = health.modelProviders?.length ? health.modelProviders : defaultModelProviders;
        setModelProviders(nextModelProviders);
        const nextModelProvider = health.defaultModelProvider || nextModelProviders.find((provider) => provider.available)?.id || nextModelProviders[0]?.id || 'direct-kimi-k2-7-code';
        setSelectedModelProvider((current) => nextModelProviders.some((provider) => provider.id === current) ? current : nextModelProvider);
      })
      .catch((error) => {
        if (cancelled) return;
        setRunnerHealthError(error instanceof Error ? error.message : '\u65e0\u6cd5\u8fde\u63a5 create-runner');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const appendVersion = (app: GeneratedApp, label: string, model?: string) => {
    setVersionHistory((current) => {
      const nextVersion = (current[0]?.version || 0) + 1;
      return [makeVersionRecord(app, label, nextVersion, model), ...current].slice(0, 8);
    });
  };

  const restoreVersion = (record: VersionRecord) => {
    setGenerated(record.app);
    setRevision('');
    setActiveTab('teach');
    setNotice(`已回退查看 V${record.version}：${record.label}。继续输入修改要求会基于这个版本生成新版本。`);
  };

  const focusPreview = () => {
    previewIframeRef.current?.focus({ preventScroll: true });
  };

  const downloadGeneratedHtml = () => {
    const safeTitle = (generated.title || 'aiya-demo')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'aiya-demo';
    const blob = new Blob([generated.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeTitle}.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice('已下载当前 demo 的 index.html。');
  };

  const copyGeneratedHtml = async () => {
    try {
      await navigator.clipboard.writeText(generated.html);
      setNotice('当前 demo 代码已复制到剪贴板。');
    } catch {
      setNotice('复制失败，请切到“查看代码”后手动复制。');
    }
  };

  useEffect(() => {
    if (isGenerating) return;
    window.requestAnimationFrame(focusPreview);
  }, [generated.html, isGenerating]);

  const toggleRoute = (routeId: GenerationRouteId) => {
    if (isGenerating) return;
    setSelectedRouteIds((current) => {
      if (current.includes(routeId)) {
        return current.length === 1 ? current : current.filter((item) => item !== routeId);
      }
      return [...current, routeId];
    });
  };

  const modelForProvider = (providerId: string) => {
    const usableModels = cliModels.filter((model) => model.providerId === providerId && !isUnsupportedCliModel(model));
    const selected = selectedCliModelByProvider[providerId];
    if (usableModels.some((model) => model.id === selected)) return selected;
    return usableModels.find((model) => model.available)?.id || usableModels[0]?.id || '';
  };

  const setModelForProvider = (providerId: string, modelId: string) => {
    setSelectedCliModelByProvider((current) => ({ ...current, [providerId]: modelId }));
    setSelectedCliProvider(providerId);
    setSelectedCliModel(modelId);
  };

  const buildRouteRequest = (routeId: GenerationRouteId, basePrompt: string, editInstruction: string, currentApp?: GeneratedApp): GenerateRequest => {
    const route = generationRouteText[routeId];
    if (route.kind === 'model') {
      return {
        prompt: basePrompt,
        revision: editInstruction || undefined,
        currentApp,
        mode: 'model',
        modelProvider: selectedModelProvider,
      };
    }
    const providerId = route.providerId || 'claude-code';
    return {
      prompt: basePrompt,
      revision: editInstruction || undefined,
      currentApp,
      mode: 'codex',
      cliProvider: providerId,
      cliModel: modelForProvider(providerId),
    };
  };

  const runGeneration = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (isGenerating) return;
    const basePrompt = prompt.trim() || examples[0];
    const editInstruction = revision.trim();
    const isEditingCurrentVersion = Boolean(editInstruction);
    const startedAt = Date.now();
    const activeRoutes = selectedRouteIds.filter((routeId) => {
      const route = generationRouteText[routeId];
      if (route.kind === 'model') return Boolean(selectedModelProvider);
      return Boolean(route.providerId && modelForProvider(route.providerId));
    });
    if (activeRoutes.length === 0) {
      setNotice('请至少选择一个可用的生成方式。');
      return;
    }
    setGenerationStartedAt(startedAt);
    setProgressNow(startedAt);
    setIsGenerating(true);
    setJobProgress(null);
    setCompareJobs({});
    setCompareResults({});
    setSelectedCompareLane(null);

    const runRoute = async (routeId: GenerationRouteId): Promise<{ routeId: GenerationRouteId; app: GeneratedApp; job: CreateJob }> => {
      const job = await createCodexJob(buildRouteRequest(routeId, basePrompt, editInstruction, isEditingCurrentVersion ? generated : undefined));
      setCompareJobs((current) => ({ ...current, [routeId]: job }));
      setJobProgress(job);
      const completedJob = await waitForCodexJob(job.id, (nextJob) => {
        setCompareJobs((current) => ({ ...current, [routeId]: nextJob }));
        setJobProgress(nextJob);
        setNotice(`${generationRouteText[routeId].title} ? ${stageLabel(nextJob.stage)} ? ${lastJobEventMessage(nextJob)}`);
      });
      setCompareJobs((current) => ({ ...current, [routeId]: completedJob }));
      if (completedJob.status !== 'succeeded' || !completedJob.result) {
        const failures = completedJob.validationReport?.failures?.join(' | ') || completedJob.error || '未知验证失败';
        throw new Error(`${generationRouteText[routeId].title} ${failures}`);
      }
      const app = normalizeGeneratedApp(completedJob.result);
      setCompareResults((current) => ({ ...current, [routeId]: app }));
      return { routeId, app, job: completedJob };
    };

    try {
      const isMultiRoute = activeRoutes.length > 1;
      setNotice(isMultiRoute
        ? `已启动 ${activeRoutes.length} 路对比：${activeRoutes.map((routeId) => generationRouteText[routeId].title).join(' / ')}。任一路先通过就会先展示。`
        : `${generationRouteText[activeRoutes[0]].title} 正在生成可运行版本……`);

      const routePromises = activeRoutes.map((routeId) => runRoute(routeId));
      if (isMultiRoute) {
        void Promise.allSettled(routePromises).then((results) => {
          const successes = results
            .filter((item): item is PromiseFulfilledResult<{ routeId: GenerationRouteId; app: GeneratedApp; job: CreateJob }> => item.status === 'fulfilled')
            .map((item) => item.value);
          if (successes.length > 0) {
            setNotice(`多路对比已收尾：${successes.map((item) => generationRouteText[item.routeId].title).join(' / ')} 通过。`);
            return;
          }
          const errors = results
            .filter((item): item is PromiseRejectedResult => item.status === 'rejected')
            .map((item) => item.reason instanceof Error ? item.reason.message : String(item.reason))
            .join(' | ');
          setNotice(`所有生成方式都未通过，已保留上一个可用版本。错误：${errors || '未知错误'}`);
        });
      }

      let preferred: { routeId: GenerationRouteId; app: GeneratedApp; job: CreateJob };
      try {
        preferred = isMultiRoute ? await Promise.any(routePromises) : await routePromises[0];
      } catch (aggregateError) {
        const errors = aggregateError instanceof AggregateError
          ? aggregateError.errors.map((item) => item instanceof Error ? item.message : String(item)).join(' | ')
          : aggregateError instanceof Error ? aggregateError.message : String(aggregateError);
        throw new Error(errors || '生成方式均未通过。');
      }

      setGenerated(preferred.app);
      setRevision('');
      setSelectedCompareLane(preferred.routeId);
      setActiveTab('teach');
      appendVersion(
        preferred.app,
        isMultiRoute
          ? `对比先通过：${generationRouteText[preferred.routeId].title}`
          : isEditingCurrentVersion
            ? `${generationRouteText[preferred.routeId].title} 修改：${editInstruction.slice(0, 28)}`
            : `${generationRouteText[preferred.routeId].title} 生成：${basePrompt.slice(0, 28)}`,
        preferred.job.result?.model || preferred.job.result?.source,
      );
      setNotice(isMultiRoute
        ? `多路对比已有一路先通过，已展示 ${generationRouteText[preferred.routeId].title}。其他路线会继续在对比面板里更新。`
        : `已通过 ${generationRouteText[preferred.routeId].title} 生成并通过验证。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(`生成失败，已保留上一个可用版本。错误：${message}`);
    } finally {
      setIsGenerating(false);
    }
  };


  const share = async () => {
    const url = new URL(window.location.href);
    url.pathname = '/create';
    url.search = '';
    url.searchParams.set('idea', encodeURIComponent(prompt.trim() || examples[0]));
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice('分享链接已复制。对方打开后会看到同一个生成入口。');
    } catch {
      setNotice(`分享链接：${url.toString()}`);
    }
  };

  const currentVersion = versionHistory.find((record) => record.app.html === generated.html)?.version || versionHistory[0]?.version || 1;
  const currentElapsed = jobElapsedMs(jobProgress, progressNow, generationStartedAt);
  const currentStageElapsed = stageElapsedMs(jobProgress, progressNow);
  const currentProgress = stageProgress(jobProgress?.stage, jobProgress?.status);
  const currentStageLabel = stageLabel(jobProgress?.stage);
  const currentStageMessage = lastJobEventMessage(jobProgress);
  const currentTip = stageTip(jobProgress?.stage, currentElapsed);
  const currentEstimatedRemaining = estimatedRemainingMs(jobProgress?.stage, jobProgress?.status, currentStageElapsed);
  const currentQuality = jobProgress?.validationReport?.quality;
  const visibleQualityCriteria = currentQuality?.criteria?.filter((item) => item.required || !item.passed).slice(0, 6) || [];
  const visibleStages = stageOrder.filter((stage) => stage !== 'succeeded');
  const recentJobEvents = jobProgress?.events?.slice(-5) || [];
  const currentCliLines = jobStreamLines(jobProgress, 24);
  const currentCliRawOutput = jobDataText(jobProgress || undefined, 'rawStreamText');
  const currentCliLogPath = jobDataText(jobProgress || undefined, 'logPath');
  const currentCliOutputBytes = jobDataText(jobProgress || undefined, 'outputBytes');
  const currentCliProviderId = jobProgress?.cliProvider || jobDataText(jobProgress || undefined, 'cliProvider') || selectedCliProvider;
  const currentCliModelId = jobProgress?.cliModel || jobDataText(jobProgress || undefined, 'cliModel') || selectedCliModel;
  const currentCliTitle = jobDataText(jobProgress || undefined, 'cliModelTitle') || jobDataText(jobProgress || undefined, 'cliTitle') || `${cliProviderTitle(cliProviders, currentCliProviderId)} · ${cliModelTitle(cliModels, currentCliModelId)}`;
  const routeHasJobOrResult = (routeId: GenerationRouteId) => Boolean(compareJobs[routeId] || compareResults[routeId]);
  const visibleCompareRoutes = generationRouteOrder.filter((routeId) => selectedRouteIds.includes(routeId) || routeHasJobOrResult(routeId));
  const hasCompareOutput = visibleCompareRoutes.some(routeHasJobOrResult);
  const hasMultiRouteSelection = selectedRouteIds.length > 1;
  const showCodexCliPanel = Boolean(jobProgress && jobProgress.mode === 'codex' && !hasMultiRouteSelection);
  const selectedLaneSucceeded = selectedCompareLane ? compareJobs[selectedCompareLane]?.status === 'succeeded' : false;
  const latestJobFailed = jobProgress?.status === 'failed' && !selectedLaneSucceeded;
  const latestJobFailures = jobProgress?.validationReport?.failures?.length
    ? jobProgress.validationReport.failures
    : jobProgress?.error
      ? [jobProgress.error]
      : [];
  const routeModelOptions = (routeId: GenerationRouteId) => {
    const route = generationRouteText[routeId];
    if (route.kind === 'model') {
      const availableProviders = modelProviders.filter((provider) => provider.available);
      return availableProviders.length ? availableProviders : modelProviders;
    }
    const providerModels = cliModels.filter((model) => model.providerId === route.providerId && !isUnsupportedCliModel(model));
    const availableModels = providerModels.filter((model) => model.available);
    return availableModels.length ? availableModels : providerModels;
  };
  const selectedRouteModelId = (routeId: GenerationRouteId) => {
    const route = generationRouteText[routeId];
    if (route.kind === 'model') return selectedModelProvider;
    return route.providerId ? modelForProvider(route.providerId) : '';
  };
  const routeAvailability = (routeId: GenerationRouteId) => {
    const route = generationRouteText[routeId];
    if (route.kind === 'model') {
      const provider = modelProviders.find((item) => item.id === selectedModelProvider) || modelProviders[0];
      return { available: Boolean(provider?.available), configured: provider?.configured, installed: true };
    }
    const provider = cliProviders.find((item) => item.id === route.providerId);
    return { available: Boolean(provider?.available), configured: provider?.configured, installed: provider?.installed };
  };
  const jobStepClassName = (state: JobStepState) => [
    styles.jobStep,
    state === 'done' ? styles.jobStepDone : '',
    state === 'active' ? styles.jobStepActive : '',
    state === 'pending' ? styles.jobStepPending : '',
    state === 'skipped' ? styles.jobStepSkipped : '',
    state === 'failed' ? styles.jobStepFailed : '',
  ].filter(Boolean).join(' ');

  const adoptCompareResult = (lane: GenerationRouteId, laneApp?: GeneratedApp, laneJob?: CreateJob) => {
    if (!laneApp) return;
    setGenerated(laneApp);
    setSelectedCompareLane(lane);
    appendVersion(laneApp, `手动选择：${generationRouteText[lane].title}`, laneJob?.result?.model || laneJob?.result?.source);
    setNotice(`已切换为 ${generationRouteText[lane].title} 的结果。`);
    window.requestAnimationFrame(focusPreview);
  };

  const selectedLaneJob = selectedCompareLane ? compareJobs[selectedCompareLane] : undefined;
  const currentRouteTitle = selectedCompareLane ? generationRouteText[selectedCompareLane].title : '\u793a\u4f8b\u521d\u59cb\u7248\u672c';
  const currentRouteDesc = selectedCompareLane ? generationRouteText[selectedCompareLane].desc : '\u672c\u5730\u793a\u4f8b\uff0c\u7528\u4e8e\u8bf4\u660e\u9884\u89c8\u533a\u57df\u3002';
  const currentVersionModel = selectedLaneJob?.result?.model || selectedLaneJob?.result?.source || 'static-example';
  const currentVersionValidation = selectedLaneJob ? jobValidationText(selectedLaneJob) : '\u672a\u9a8c\u8bc1';
  const currentVersionVerdict = selectedLaneJob ? jobCompareVerdict(selectedLaneJob).label : '\u793a\u4f8b';

  return (
    <main className={styles.createShell}>
      <div className={styles.cosmos} aria-hidden="true">
        <span className={styles.blackHole} />
        <span className={styles.orbitOne} />
        <span className={styles.orbitTwo} />
      </div>

      <header className={styles.topbar}>
        <a className={styles.brand} href="/">
          <span className={styles.brandMark}>A</span>
          <span>
            <strong>AIYA 创作</strong>
            <small>一句话生成应用</small>
          </span>
        </a>
        <nav className={styles.navActions} aria-label="AIYA Create navigation">
          <a href="/dev">Dev 终端</a>
          <a href="/">返回 AIYA</a>
          <a href="/investors/aiya-2026">投资备忘录</a>
          <button type="button" onClick={share}>分享当前想法</button>
        </nav>
      </header>

      <section className={styles.hero}>
        <p className={styles.kicker}>创作 · 学习 · 发布</p>
        <h1>一句话，把想法变成可玩的应用。</h1>
        <p className={styles.heroCopy}>
          AIYA 创作让普通用户先看到一个能运行的结果，再通过智能体对话学习、修改、发布和推广。
        </p>
      </section>

      <section className={styles.workspace} aria-label="AIYA Create workspace">
        <form className={styles.promptPanel} onSubmit={runGeneration}>
          <div className={styles.panelHeading}>
            <span>01</span>
            <div>
              <h2>描述你的第一个应用</h2>
              <p>先限制为单文件网页，保证能在手机和电脑浏览器里立即运行。</p>
            </div>
          </div>

          <div className={styles.inputBlock}>
            <div className={styles.inputLabelRow}>
              <label className={styles.inputLabel} htmlFor="createPrompt">一句话想法</label>
              <VoiceInputButton
                voice={voice}
                className={styles.voiceButton}
                activeClassName={styles.listening}
                cancelReadyClassName={styles.cancelReady}
                dotClassName={styles.voiceDot}
                disabled={isGenerating}
              />
            </div>
            <textarea
              ref={promptTextareaRef}
              id="createPrompt"
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                rememberTextCursor('prompt');
              }}
              onSelect={() => rememberTextCursor('prompt')}
              onClick={() => rememberTextCursor('prompt')}
              onKeyUp={() => rememberTextCursor('prompt')}
              onFocus={() => rememberTextCursor('prompt')}
              placeholder="例如：做一个太空躲避陨石小游戏"
              rows={5}
            />
            <p className={`${styles.voiceStatus} ${voice.isActive ? styles.voiceStatusLive : ''}`}>
              {voice.finalText || voice.partialText
                ? `识别中：${voice.finalText}${voice.partialText}`
                : voice.firstTokenLatencyMs
                  ? `${voice.statusText} 首字延迟：${voice.firstTokenLatencyMs}ms`
                  : voice.statusText}
            </p>
          </div>

          <div className={styles.examples}>
            {examples.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  const localApp = buildApp(item);
                  setPrompt(item);
                  setRevision('');
                  setGenerated(localApp);
                  setVersionHistory([makeVersionRecord(localApp, '示例初始版本')]);
                  setNotice('已载入示例。点击“生成可运行版本”可调用模型重做，或直接填写修改要求微调当前示例。');
                }}
              >
                {item}
              </button>
            ))}
          </div>

          <label className={styles.inputBlock}>
            <span>继续修改</span>
            <input
              ref={revisionInputRef}
              value={revision}
              onChange={(event) => {
                setRevision(event.target.value);
                rememberTextCursor('revision');
              }}
              onSelect={() => rememberTextCursor('revision')}
              onClick={() => rememberTextCursor('revision')}
              onKeyUp={() => rememberTextCursor('revision')}
              onFocus={() => rememberTextCursor('revision')}
              placeholder="例如：把食物改成红色苹果 / 加暂停按钮 / 优化手机按钮"
            />
          </label>

          <div className={styles.quickEdits}>
            {generated.nextEdits.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setRevision(item);
                  setNotice('修改指令已填入，点击“应用到当前版本”生成新版本。');
                }}
              >
                {item}
              </button>
            ))}
          </div>

          <div className={styles.editMode}>
            <span>当前 V{currentVersion}</span>
            <div>
              <strong>{revision.trim() ? '将基于右侧当前作品继续修改' : '未填写修改要求时会按原始想法生成新版本'}</strong>
              <small>修改会携带当前页面代码给模型，保留已有功能后增量完善。</small>
            </div>
          </div>

          <div className={styles.routeSwitch} aria-label={'生成方式'}>
            <div className={styles.routeSwitchTitle}>
              <strong>{'生成方式'}</strong>
              <span>{selectedRouteIds.length > 1 ? `已选 ${selectedRouteIds.length} 路对比` : '单路生成'}</span>
            </div>
            <div className={styles.routeCapsules}>
              {generationRouteOrder.map((routeId) => {
                const route = generationRouteText[routeId];
                const selected = selectedRouteIds.includes(routeId);
                const options = routeModelOptions(routeId);
                const availability = routeAvailability(routeId);
                const unavailable = !availability.available && routeId !== 'direct-model';
                const selectedModelId = selectedRouteModelId(routeId);
                return (
                  <button
                    key={routeId}
                    type="button"
                    className={`${styles.routeCapsule} ${selected ? styles.routeCapsuleActive : ''} ${unavailable ? styles.routeCapsuleDisabled : ''}`}
                    onClick={() => toggleRoute(routeId)}
                    disabled={isGenerating || unavailable}
                    title={unavailable ? '该生成方式暂未接通，后续可继续扩展。' : route.desc}
                  >
                    <span className={styles.routeCheck}>{selected ? '✓' : '+'}</span>
                    <span className={styles.routeCopy}>
                      <strong>{route.title}</strong>
                      <em>{route.desc}</em>
                    </span>
                    <span className={styles.routeStatus}>{routeStatusText(availability.available, availability.configured, availability.installed)}</span>
                    {options.length > 0 ? (
                      <select
                        className={styles.routeModelSelect}
                        value={selectedModelId}
                        disabled={isGenerating}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation();
                          const nextModelId = event.target.value;
                          if (route.kind === 'model') {
                            setSelectedModelProvider(nextModelId);
                            if (!selectedRouteIds.includes(routeId)) toggleRoute(routeId);
                            return;
                          }
                          if (route.providerId) {
                            setModelForProvider(route.providerId, nextModelId);
                            if (!selectedRouteIds.includes(routeId)) toggleRoute(routeId);
                          }
                        }}
                      >
                        {options.map((option) => {
                          const optionId = option.id;
                          const optionTitle = compactModelName(option.title, 'model' in option ? option.model : undefined);
                          const optionState = option.available ? '可用' : option.configured ? '不可用' : '未配置';
                          const latency = 'latencyMs' in option && typeof option.latencyMs === 'number' ? ` / ${option.latencyMs} ms` : '';
                          return (
                            <option key={optionId} value={optionId}>
                              {optionTitle} - {optionState}{latency}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <span className={styles.routeModelEmpty}>{'待接入'}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {runnerHealthError && <p className={styles.cliProviderWarning}>{runnerHealthError}</p>}
          </div>

          <button className={styles.generateButton} type="submit" disabled={isGenerating}>
            {isGenerating ? '生成中…' : revision.trim() ? '应用到当前版本' : '生成可运行版本'}
          </button>

          <p className={styles.notice}>{notice}</p>

          {jobProgress && (
            <div className={styles.jobProgress} aria-live="polite">
              <div className={styles.jobProgressHeader}>
                <div>
                  <strong>{currentStageLabel}</strong>
                  <small>Job {jobProgress.id}</small>
                </div>
                <span>{jobProgress.status === 'failed' ? '\u5931\u8d25' : `${currentProgress}%`}</span>
              </div>
              <div className={styles.jobProgressTrack}>
                <span style={{ width: `${currentProgress}%` }} />
              </div>
              <div className={styles.jobTimingGrid}>
                <div>
                  <strong>{formatDuration(currentElapsed)}</strong>
                  <span>总耗时</span>
                </div>
                <div>
                  <strong>{formatDuration(currentStageElapsed)}</strong>
                  <span>当前阶段</span>
                </div>
                <div>
                  <strong>{jobProgress.attempts || 0}</strong>
                  <span>尝试轮次</span>
                </div>
                <div>
                  <strong>{formatDuration(currentEstimatedRemaining)}</strong>
                  <span>预计剩余</span>
                </div>
              </div>
              <p>{currentStageMessage}</p>
              <div className={styles.learningTip}>
                <strong>等待时学一点</strong>
                <span>{currentTip}</span>
              </div>
              <ol className={styles.jobStepList}>
                {visibleStages.map((stage) => {
                  const state = jobStepState(jobProgress, stage);
                  return (
                    <li key={stage} className={jobStepClassName(state)}>
                      <span className={styles.jobStepDot} aria-hidden="true" />
                      <div>
                        <strong>{stageLabel(stage)}</strong>
                        <small>{state === 'skipped' ? '本轮未触发，已跳过。' : stageDescriptions[stage]}</small>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {recentJobEvents.length > 0 && (
                <div className={styles.jobEventLog}>
                  <strong>最近进度</strong>
                  {recentJobEvents.map((event, index) => (
                    <p key={`${event.at}-${event.stage}-${index}`}>
                      <span>{formatClockTime(event.at)}</span>
                      {translateRunnerMessage(event.message)}
                    </p>
                  ))}
                </div>
              )}
              {currentQuality && (
                <div className={styles.qualityPanel}>
                  <div className={styles.qualityHeader}>
                    <strong>验证诊断</strong>
                    <span className={currentQuality.ok ? styles.qualityPass : styles.qualityFail}>
                      {currentQuality.ok ? '通过' : '有提示'}
                    </span>
                  </div>
                  <div className={styles.qualityCriteria}>
                    {visibleQualityCriteria.map((item) => (
                      <p key={item.id} className={item.passed ? styles.qualityCriterionPass : styles.qualityCriterionFail}>
                        <strong>{item.passed ? '✓' : '!'}</strong>
                        <span>{translateRunnerMessage(item.label)}</span>
                        <small>{translateRunnerMessage(item.evidence)}</small>
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {Boolean(jobProgress.validationReport?.failures?.length) && (
                <ul>
                  {jobProgress.validationReport?.failures?.slice(0, 3).map((failure) => <li key={failure}>{translateRunnerMessage(failure)}</li>)}
                </ul>
              )}
            </div>
          )}
        </form>

        <section className={styles.previewPanel}>
          <div className={styles.previewHeader}>
            <div>
              <span>02 · 沙盒预览</span>
              <h2>{latestJobFailed ? '本次生成未通过' : generated.title}</h2>
              <p>{latestJobFailed ? `当前预览已暂停：${latestJobFailures[0] ? translateRunnerMessage(latestJobFailures[0]) : '生成结果没有通过验证。'}` : generated.brief}</p>
            </div>
            <div className={styles.previewMeta}>
              <strong>{generated.kind}</strong>
              <small>{showSourceCode ? '正在查看 index.html' : '隔离沙盒运行'}</small>
            </div>
          </div>

          {showCodexCliPanel && (
            <section className={styles.codexCliPanel} aria-live="polite">
              <div className={styles.codexCliHeader}>
                <div>
                  <span>{`${currentCliTitle} \u5b9e\u65f6\u8f93\u51fa`}</span>
                  <strong>{jobProgress ? `${stageLabel(jobProgress.stage)} · ${jobStatusText(jobProgress)}` : '等待启动'}</strong>
                </div>
                <small>{currentCliOutputBytes ? `${Number(currentCliOutputBytes).toLocaleString()} bytes` : '等待输出'}</small>
              </div>
              <div className={styles.codexCliMeta}>
                <span>任务 {jobProgress?.id.slice(-8)}</span>
                <span>轮次 {jobProgress?.attempts || 0}</span>
                <span>耗时 {formatDuration(currentElapsed)}</span>
              </div>
              {currentCliLogPath && <p className={styles.codexCliPath}>{currentCliLogPath}</p>}
              <pre className={styles.codexCliOutput}>
                {currentCliRawOutput
                  ? currentCliRawOutput
                  : currentCliLines.length > 0
                    ? currentCliLines.join('\n')
                    : `\u7b49\u5f85 ${currentCliTitle} \u8f93\u51fa stdout/stderr \u539f\u59cb\u6d41\u2026\u2026`}
              </pre>
            </section>
          )}

          {(hasMultiRouteSelection || hasCompareOutput) && (
            <div className={styles.compareMonitor} aria-live="polite">
              <div className={styles.compareMonitorHeader}>
                <strong>{'\u751f\u6210\u8bc4\u6d4b'}</strong>
                <span>{'\u6bd4\u8f83\u6bcf\u4e00\u8def\u7684\u72b6\u6001\u3001\u8017\u65f6\u3001\u8d28\u91cf\u5206\u548c\u5173\u952e\u5931\u8d25\u539f\u56e0\u3002'}</span>
              </div>
              <div className={styles.compareMonitorGrid}>
                {visibleCompareRoutes.map((lane) => {
                  const laneJob = compareJobs[lane];
                  const laneApp = compareResults[lane];
                  const streamLines = jobStreamLines(laneJob);
                  return (
                    <section key={lane} className={styles.compareMonitorLane} data-status={jobCompareStatus(laneJob)}>
                      <div className={styles.compareMonitorLaneTop}>
                        <div>
                          <strong>{generationRouteText[lane].title}</strong>
                          <small>{generationRouteText[lane].desc}</small>
                          <span>{laneJob?.id ? `${'\u4efb\u52a1'} ${laneJob.id.slice(-8)}` : '\u5c1a\u672a\u63d0\u4ea4'}</span>
                        </div>
                        <em>{jobCompareVerdict(laneJob).label}</em>
                      </div>
                      <div className={styles.compareMonitorFacts}>
                        <span>{'\u8017\u65f6\uff1a'}{jobAgeText(laneJob, progressNow)}</span>
                        <span>{'\u9636\u6bb5\uff1a'}{laneJob ? stageLabel(laneJob.stage) : '--'}</span>
                        <span>{'验证：'}{jobValidationText(laneJob)}</span>
                      </div>
                      <p className={styles.compareMonitorMessage}>
                        {jobCompareMainIssue(laneJob)}
                      </p>
                      <div className={styles.compareMonitorActions}>
                        <button
                          type="button"
                          disabled={!laneApp || selectedCompareLane === lane}
                          onClick={() => adoptCompareResult(lane, laneApp, laneJob)}
                        >
                          {selectedCompareLane === lane ? '当前版本' : '设为当前版本'}
                        </button>
                      </div>
                      {streamLines.length > 0 && (
                        <details className={styles.compareMonitorLog}>
                          <summary>{'\u67e5\u770b\u8fd0\u884c\u65e5\u5fd7'}</summary>
                          <pre className={styles.compareMonitorCode}>{streamLines.join('\n')}</pre>
                        </details>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          )}

          <div className={styles.currentVersionBar}>
            <div>
              <strong>{'\u5f53\u524d\u9884\u89c8'}</strong>
              <span>{currentRouteTitle} {'\u00b7'} {currentVersionVerdict} {'\u00b7'} {'\u9a8c\u8bc1'} {currentVersionValidation}</span>
              <small>{currentRouteDesc} {'\u00b7'} {currentVersionModel}</small>
            </div>
            <div className={styles.currentVersionActions}>
              <button type="button" data-active={!showSourceCode ? 'true' : 'false'} onClick={() => setShowSourceCode(false)} disabled={isGenerating}>{'\u9884\u89c8'}</button>
              <button type="button" data-active={showSourceCode ? 'true' : 'false'} onClick={() => setShowSourceCode(true)} disabled={isGenerating}>{'\u4ee3\u7801'}</button>
              <button type="button" onClick={copyGeneratedHtml} disabled={isGenerating}>{'\u590d\u5236'}</button>
              <button type="button" onClick={downloadGeneratedHtml} disabled={isGenerating}>{'\u4e0b\u8f7d'}</button>
            </div>
          </div>

          <div className={styles.deviceFrame} onPointerDown={focusPreview}>
            {isGenerating ? (
              <div className={styles.generatingState}>
                <span />
                <strong>{jobProgress ? currentStageLabel : revision.trim() ? '正在创建修改任务' : '正在创建生成任务'}</strong>
                <p>{jobProgress ? currentStageMessage : revision.trim() ? '读取当前 index.html，按你的修改要求完善细节。' : '理解需求、规划界面、写入交互逻辑、注入移动端适配。'}</p>
                <div className={styles.generatingMetrics}>
                  <div>
                    <strong>{formatDuration(currentElapsed)}</strong>
                    <span>已等待</span>
                  </div>
                  <div>
                    <strong>{jobProgress ? `${currentProgress}%` : '--'}</strong>
                    <span>进度</span>
                  </div>
                  <div>
                    <strong>{formatDuration(currentEstimatedRemaining)}</strong>
                    <span>预计剩余</span>
                  </div>
                </div>
                <p className={styles.generatingTip}>{currentTip}</p>
                <small className={styles.generatingHint}>真实 Codex 生成会经历编程、构建、浏览器验证；复杂 demo 可能需要 5–15 分钟。</small>
              </div>
            ) : latestJobFailed ? (
              <div className={styles.failedPreviewState}>
                <span className={styles.failedPreviewIcon}>!</span>
                <strong>本次没有交付新 Demo</strong>
                <p>系统检测到生成结果和你的任务描述不匹配，所以没有替换当前版本。</p>
                <div className={styles.failedPreviewList}>
                  {latestJobFailures.slice(0, 4).map((failure) => (
                    <span key={failure}>{translateRunnerMessage(failure)}</span>
                  ))}
                </div>
                <small>上一版可用作品已保留。请调整生成方式/模型后重新生成，或查看运行日志定位原因。</small>
              </div>
            ) : showSourceCode ? (
              <div className={styles.sourceViewer}>
                <div className={styles.sourceViewerHeader}>
                  <strong>index.html</strong>
                  <span>{generated.html.length.toLocaleString()} 字符 · 单文件 HTML/CSS/JS</span>
                </div>
                <pre><code>{generated.html}</code></pre>
              </div>
            ) : (
              <iframe
                ref={previewIframeRef}
                key={generated.html}
                title={`${generated.title} \u9884\u89c8`}
                sandbox="allow-scripts"
                srcDoc={localizeGeneratedDemoHtml(generated.html)}
                tabIndex={0}
                onLoad={focusPreview}
                onPointerDown={focusPreview}
              />
            )}
          </div>

        </section>

        {false && (
        <aside className={styles.inspector}>
          <div className={styles.panelHeading}>
            <span>03</span>
            <div>
              <h2>教学与发布</h2>
              <p>生成结果不是终点，而是学习、修改和传播的起点。</p>
            </div>
          </div>

          <div className={styles.versionPanel}>
            <div className={styles.versionPanelHeader}>
              <strong>版本历史</strong>
              <span>{versionHistory.length} 个版本</span>
            </div>
            <div className={styles.versionList}>
              {versionHistory.map((record) => {
                const isCurrent = record.app.html === generated.html;
                return (
                  <button
                    key={record.id}
                    type="button"
                    className={isCurrent ? styles.currentVersion : ''}
                    onClick={() => restoreVersion(record)}
                    disabled={isCurrent}
                  >
                    <strong>V{record.version}</strong>
                    <span>{record.label}</span>
                    <small>{record.model || 'static-example'} · {record.createdAt}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.tabs} role="tablist" aria-label="Result details">
            <button type="button" className={activeTab === 'teach' ? styles.active : ''} onClick={() => setActiveTab('teach')}>看懂它</button>
            <button type="button" className={activeTab === 'source' ? styles.active : ''} onClick={() => setActiveTab('source')}>文件</button>
            <button type="button" className={activeTab === 'publish' ? styles.active : ''} onClick={() => setActiveTab('publish')}>发布</button>
          </div>

          {activeTab === 'teach' && (
            <div className={styles.detailList}>
              {generated.teaching.map((item, index) => (
                <p key={item}><strong>{index + 1}</strong>{item}</p>
              ))}
            </div>
          )}

          {activeTab === 'source' && (
            <div className={styles.fileList}>
              <div>
                <strong>index.html</strong>
                <span>页面、样式和交互逻辑</span>
                <small>V0 单文件 · 后续可拆成多文件版本</small>
              </div>
            </div>
          )}

          {activeTab === 'publish' && (
            <div className={styles.publishBox}>
              <strong>下一步：AIYA Gallery</strong>
              <p>V0 先验证生成和预览闭环。V1 将加入保存、版本、缩略图、发布、Remix 和创作者主页。</p>
              <button type="button" onClick={share}>复制分享链接</button>
            </div>
          )}
        </aside>
        )}
      </section>
    </main>
  );
}
