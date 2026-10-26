import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const token = process.env.AIYA_BUILD_VALIDATOR_TOKEN || '';
if (token.length < 24) throw Error('AIYA_BUILD_VALIDATOR_TOKEN must contain at least 24 characters');
if (process.platform !== 'win32' && process.getuid?.() === 0) throw Error('Run validator as a dedicated non-root service account');
const port = Number(process.env.AIYA_BUILD_VALIDATOR_PORT || '3346');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid validator port');
const worker = fileURLToPath(new URL('./validation-worker.js', import.meta.url));
const children = new Set();
const safeEnv = Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA','PLAYWRIGHT_BROWSERS_PATH'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
function terminate(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, ()=>{});
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
}
function execute(input) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--max-old-space-size=128',worker], { env:safeEnv, windowsHide:true, detached:process.platform !== 'win32', stdio:['pipe','pipe','pipe'] });
    children.add(child); let output='', settled=false;
    const finish = value => {if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>{terminate(child);finish({schemaVersion:1,status:'inconclusive',coverage:'worker-timeout',durationMs:15000,checks:[],error:'独立浏览器验证超时，不能认定功能通过。'});},15000);
    child.stdout.on('data',data=>{output+=data;if(output.length>128000){terminate(child);finish({schemaVersion:1,status:'inconclusive',coverage:'worker-error',durationMs:0,checks:[],error:'验证结果超过上限。'});}});
    child.stderr.on('data',()=>{}); // No source, environment or browser internals in service logs.
    child.on('error',()=>{children.delete(child);finish({schemaVersion:1,status:'inconclusive',coverage:'worker-error',durationMs:0,checks:[],error:'无法启动独立验证进程。'});});
    child.on('close',()=>{children.delete(child);try{finish(JSON.parse(output));}catch{finish({schemaVersion:1,status:'inconclusive',coverage:'worker-error',durationMs:0,checks:[],error:'浏览器未能完成验证（请检查安装及非 root 沙箱运行条件）。'});}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  });
}
function respond(res,status,body){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
const server=http.createServer(async(req,res)=>{
  const header=Buffer.from(req.headers.authorization||''), expected=Buffer.from(`Bearer ${token}`);
  if(header.length!==expected.length||!timingSafeEqual(header,expected)){respond(res,401,{error:'Unauthorized'});return;}
  if(req.method==='GET'&&req.url==='/health'){respond(res,children.size>=2?503:200,{service:'aiya-build-validator',schemaVersion:1,ready:true,isolation:'fresh-process-and-sandboxed-chromium',active:children.size});return;}
  if(req.method!=='POST'||req.url!=='/validate'){respond(res,404,{error:'Not found'});return;}
  if(children.size>=2){respond(res,503,{error:'Validator busy; no generation retry required'});return;}
  if(!String(req.headers['content-type']||'').startsWith('application/json')){respond(res,415,{error:'JSON required'});return;}
  let size=0, chunks=[];
  try{
    for await(const chunk of req){size+=chunk.length;if(size>1100000){respond(res,413,{error:'Input too large'});req.destroy();return;}chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(typeof body.html!=='string'||body.html.length<30||body.html.length>256000||typeof body.idea!=='string'||body.idea.length>1200||!['auto','speed','quality'].includes(body.preference)||body.previousHtml&&typeof body.previousHtml!=='string'||String(body.previousHtml||'').length>256000){respond(res,400,{error:'Invalid validation input'});return;}
    // Recheck after body ingestion: two slow clients cannot evade concurrency limit.
    if(children.size>=2){respond(res,503,{error:'Validator busy'});return;}
    const result=await execute({html:body.html,previousHtml:body.previousHtml||'',idea:body.idea,preference:body.preference});
    respond(res,200,result);
  }catch{if(!res.headersSent)respond(res,400,{error:'Invalid JSON or disconnected request'});}
});
server.requestTimeout=10000;server.headersTimeout=10000;
const probe = await execute({html:'<!doctype html><html><body><p>Validator ready</p></body></html>',idea:'health',preference:'speed'});
if (probe.status !== 'passed') throw Error('Sandboxed Chromium self-test failed; install Chromium and check service account');
server.listen(port,'127.0.0.1',()=>console.log(`AIYA build validator listening on 127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const child of children)terminate(child);server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref();});
