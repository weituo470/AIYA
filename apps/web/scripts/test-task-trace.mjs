import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild');
const web = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(web, '../../outputs/task-trace');
await mkdir(out, { recursive: true });
const entry = `
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync,writeFileSync} from 'node:fs';
import {TaskTracePanel} from './src/app/_shared/TaskTracePanel';
import {selectTaskBuild,TeacherCoderError,buildValidationSummary} from './src/app/_shared/task-trace';
import {runTeacherCoder as desktop} from './src/app/create-theatre/_core/teacher-coder-client';
import {runTeacherCoder as alternate} from './src/app/create-theatre-v2/_core/teacher-coder-client';
const recorded=JSON.parse(readFileSync(${JSON.stringify(join(web, 'scripts/fixtures/task-trace.json'))},'utf8'));
const results=[];
async function test(name,fn){await fn();results.push({name,passed:true});console.log('PASS',name);}
const text=(props)=>renderToStaticMarkup(<TaskTracePanel {...props}/>);
await test('trace fixture renders route, returned model and validation coverage',()=>{let s=text({build:recorded});assert(s.includes(recorded.taskId));assert(s.includes('模型 API 直接生成'));assert(s.includes(recorded.model.requested));assert(s.includes('核心功能'));assert(s.includes('生成完成 ≠ 完整测试通过'));});
await test('smoke-only is not represented as core or full testing',()=>{const s=text({build:{...recorded,validations:[{status:'passed',coverage:'smoke-only',durationMs:1,checks:[]}]}});assert(s.includes('仅页面冒烟，未验证业务逻辑'));});
await test('unknown returned model remains unknown',()=>{assert(text({build:{...recorded,model:{...recorded.model,returned:null}}}).includes('供应方未提供，或尚未成功返回'));});
await test('failed and running revisions never show previous trace',()=>{assert.equal(selectTaskBuild({status:'failed'}, {build:recorded}),undefined);assert.equal(selectTaskBuild({status:'running'}, {build:recorded}),undefined);assert.equal(selectTaskBuild(null,{build:recorded}),recorded);assert(text({failed:true}).includes('本次任务失败'));assert(text({pending:true}).includes('正在等待服务器'));assert(text({}).includes('暂无任务轨迹'));});
await test('template fallback is distinguishable from model output',()=>{assert(text({build:{...recorded,route:'template-fallback'}}).includes('非本次模型生成'));});
await test('public trace omits arbitrary raw provider secrets and repair evidence',()=>{const s=text({build:{...recorded,apiKey:'test-only-secret-canary',repair:{status:'failed',attempted:true,maxAttempts:1,evidence:{token:'test-only-secret-canary'}}}});assert(!s.includes('test-only-secret-canary'));});
await test('validation summary never assumes generated means validated',()=>{assert.notEqual(buildValidationSummary().ok,true);assert.notEqual(buildValidationSummary(recorded).ok,true);assert.equal(buildValidationSummary({...recorded,checks:[{name:'browser-runtime',status:'failed',detail:'broken'}]}).ok,false);});
const original=globalThis.fetch;
try{for(const [name,client] of [['desktop',desktop],['alternate',alternate]]){
await test(name+' success attaches exact server trace',async()=>{globalThis.fetch=async()=>Response.json({ok:true,result:{html:'<html></html>'},build:recorded});let p=await client({idea:'test'});assert.deepEqual(p.result.build,recorded);});
await test(name+' failed API preserves failed server trace',async()=>{const b={...recorded,status:'failed',error:'gateway timeout'};globalThis.fetch=async()=>Response.json({ok:false,error:b.error,build:b,diagnosticId:b.taskId},{status:502});await assert.rejects(client({idea:'test'}),e=>e instanceof TeacherCoderError&&e.build.status==='failed'&&e.message.includes(b.taskId));});
await test(name+' legacy response and invalid JSON have no invented trace',async()=>{globalThis.fetch=async()=>Response.json({ok:true,result:{html:'<html></html>'}});assert.equal((await client({idea:'test'})).build,undefined);const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;try{globalThis.fetch=async()=>{clock+=540001;return new Response('not json',{status:500});};await assert.rejects(client({idea:'test'}),e=>e instanceof TeacherCoderError&&!e.build&&e.message.includes('等待上限'));}finally{Date.now=originalNow;}});
await test(name+' exhausted network recovery is typed and has no invented trace',async()=>{const originalNow=Date.now;let clock=originalNow();let posts=0;Date.now=()=>clock;try{globalThis.fetch=async(_url,init)=>{if(init?.method==='POST')posts++;clock+=540001;throw new TypeError('Failed to fetch');};await assert.rejects(client({idea:'test'}),e=>e instanceof TeacherCoderError&&!e.build&&e.message.includes('等待上限'));assert.equal(posts,1);}finally{Date.now=originalNow;}});
const source=readFileSync(${JSON.stringify(web)}+'/src/app/'+(name==='desktop'?'create-theatre':'create-theatre-v2')+'/_hooks/useCreateTheatreJob.ts','utf8');assert(source.includes('build: coded.build'));assert(source.includes('reason instanceof TeacherCoderError ? reason.build : undefined'));assert(!source.includes('本轮只做静态安全拦截'));}}
finally{globalThis.fetch=original;}
writeFileSync(${JSON.stringify(join(out, 'test-results.json'))},JSON.stringify({scope:'deterministic rendering / mocked API client; not model stability test',results},null,2));
console.log('SUMMARY',results.length+'/'+results.length);
`;
await esbuild.build({stdin:{contents:entry,resolveDir:web,loader:'tsx'},bundle:true,platform:'node',format:'esm',outfile:join(out,'test-bundle.mjs'),jsx:'automatic',loader:{'.css':'empty'},external:['react','react-dom/server'],banner:{js:`import {createRequire as cr} from 'node:module';const require=cr(${JSON.stringify(join(web, 'package.json'))});`}});
// Resolve React from the Web dependency tree without installing any new packages.
const bundle = join(out, 'test-bundle.mjs');
// esbuild external ESM imports otherwise resolve from outputs rather than the Web tree.
let source = (await import('node:fs/promises')).readFile;
let js = await source(bundle,'utf8');
js=js.replace(/from "react"/g,`from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`).replace(/from "react-dom\/server"/g,`from ${JSON.stringify(pathToFileURL(require.resolve('react-dom/server')).href)}`).replace(/from "react\/jsx-runtime"/g,`from ${JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)}`);
await writeFile(bundle,js);
execFileSync(process.execPath,[bundle],{stdio:'inherit'});
