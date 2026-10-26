import { chromium } from 'playwright';

const input=JSON.parse(await new Promise(resolve=>{let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>resolve(text));}));
const started=Date.now();
const checks=[];
const text=value=>String(value??'').slice(0,240);
const normalized=value=>String(value??'').normalize('NFKC').replace(/\s+/g,'').replace(/−/g,'-');
const profile=/计算器|calculator/i.test(input.idea)||/calculator|计算器/i.test(input.previousHtml||'')?'calculator':/任务看板|待办|任务.{0,20}统计/.test(input.idea)||/taskList|task-board/i.test(input.previousHtml||'')?'task-board':'smoke';
const affirmative=pattern=>input.idea.split(/[。！；;\n]/).some(part=>pattern.test(part)&&!/(?:不要|不需要|无需|不使用|取消).{0,10}/.test(part));
const wanted={percent:affirmative(/百分|百分号/)||/百分|data-action=['"]percent/.test(input.previousHtml||''),historyClear:affirmative(/清空历史/)||/清空历史/.test(input.previousHtml||''),undo:affirmative(/撤销删除/)||/撤销删除/.test(input.previousHtml||'')};
let browser;
try{
  if(process.platform!=='win32'&&process.getuid?.()===0)throw Error('Sandbox requires a non-root service account');
  browser=await chromium.launch({headless:true,chromiumSandbox:true,args:['--js-flags=--max-old-space-size=64'],env:{...process.env}});
  async function validate(html){
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block',acceptDownloads:false,permissions:[]});
    const localChecks=[],errors=[],blocked=[],cspFailures=[];let served=false,taskCounts;
    const url='http://validation.invalid/';
    await context.routeWebSocket('**/*',socket=>{blocked.push('websocket');socket.close();});
    await context.route('**/*',route=>{
      if(!served&&route.request().url()===url&&route.request().isNavigationRequest()){served=true;return route.fulfill({status:200,contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; media-src blob: data:; form-action 'none'; base-uri 'none'"},body:html});}
      blocked.push('blocked-resource');return route.abort();
    });
    const page=await context.newPage();page.setDefaultTimeout(650);page.on('dialog',dialog=>dialog.dismiss());page.on('popup',popup=>popup.close());page.on('pageerror',error=>{if(errors.length<6)errors.push(text(error.message));});
    page.on('console',message=>{if(message.type()==='error'&&/violates (?:the following )?Content Security Policy|Refused to (?:connect|load|frame|create).*Content Security Policy/i.test(message.text())&&cspFailures.length<6)cspFailures.push('CSP blocked an unexpected capability/resource');});
    const check=async(name,fn,severity='error')=>{try{const detail=await fn();localChecks.push({name,status:'passed',severity,detail:text(detail)});}catch(error){const uncertain=String(error).includes('UNLOCATED');localChecks.push({name,status:uncertain?'inconclusive':'failed',severity,detail:text(error.message||error)});}};
    const button=async(names,scope=page)=>{
      const handles=await scope.locator('button,input[type="button"],input[type="submit"],[role="button"]').elementHandles();
      for(const handle of handles){const data=await handle.evaluate(n=>({labels:[n.getAttribute('aria-label')||'',n.textContent||'',n.value||''],visible:!!(n.getBoundingClientRect().width&&n.getBoundingClientRect().height)}));if(data.visible&&names.some(n=>data.labels.some(label=>normalized(label)===normalized(n)))){await handle.click();return;}}
      throw Error('UNLOCATED 无法可靠定位按钮：'+names.join('/'));
    };
    const press=key=>button(key==='C'?['清空','AC','C']:key==='B'?['退格','⌫','删除','DEL']:key==='.'?['.','小数点']:key==='+'?['+','加法']:key==='-'?['-','减法']:key==='*'?['×','*','乘法']:key==='/'?['÷','/','除法']:key==='='?['=','等于']:[key]);
    const result=async()=>{
      const values=await page.locator('[data-aiya="display"],output,input[readonly],#display,#result,.display,.result').evaluateAll(nodes=>{
        const visible=n=>!!(n.getBoundingClientRect().width&&n.getBoundingClientRect().height);
        const pure=value=>/^(?:-?\d+(?:\.\d*)?(?:e[+-]?\d+)?|错误|错误.*|不能.*|无法.*|除数.*|Error|Infinity|NaN)$/i.test(value);
        const read=n=>String(n.value??n.textContent??'').trim();
        const found=nodes.filter(visible).flatMap(n=>{
          const own=read(n);if(pure(own))return [{value:own,explicit:n.matches('[data-aiya="display"]')}];
          // Never extract an arbitrary numeric suffix from an expression. Only an
          // unambiguous independent visible leaf in the display can be a result.
          const leaves=[...n.querySelectorAll('*')].filter(c=>visible(c)&&!c.children.length&&pure(read(c)));
          return leaves.length===1?[{value:read(leaves[0]),explicit:false}]:[];
        });
        const explicit=found.filter(x=>x.explicit);return [...new Set((explicit.length?explicit:found).map(x=>x.value))];
      });
      if(values.length!==1)throw Error('UNLOCATED 未找到唯一的纯结果节点；data-aiya="display" 应放在数字结果而非算式容器上');return values;
    };
    const completeTask=async(row)=>{
      const checkbox=row.locator('input[type="checkbox"],[role="checkbox"]');
      const visible=[];for(const control of await checkbox.elementHandles())if(await control.isVisible())visible.push(control);
      if(visible.length===1){const selected=await visible[0].evaluate(n=>n.checked===true||n.getAttribute('aria-checked')==='true');if(!selected)await visible[0].click();return;}
      await button(['完成','标记完成'],row);
    };
    const calc=async(keys,expected)=>{await press('C');for(const key of keys)await press(key);let values=await result();for(let i=0;i<8&&!values.includes(expected);i++){await page.waitForTimeout(50);values=await result();}if(!values.includes(expected))throw Error('期望 '+expected+'，实际结果 '+values.join('|'));return keys.join('')+' → '+expected;};
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:2500});await page.waitForTimeout(120);
      await check('visible-content',async()=>{if(!(await page.locator('body').innerText()).trim())throw Error('页面没有可见内容');return '存在可见内容';});
      if(profile==='calculator'){
        await check('calc:add',()=>calc(['2','+','3','='],'5'));
        await check('calc:carry',()=>calc(['1','7','+','2','8','='],'45'));
        await check('calc:subtract',()=>calc(['7','-','2','='],'5'));
        await check('calc:multiply',()=>calc(['6','*','7','='],'42'));
        await check('calc:divide',()=>calc(['8','/','2','='],'4'));
        await check('calc:decimal',()=>calc(['0','.','1','+','0','.','2','='],'0.3'));
        await check('calc:backspace',()=>calc(['1','2','3','B','+','1','='],'13'));
        if(input.preference!=='speed')await check('calc:zero-recovery',async()=>{await press('C');for(const key of ['8','/','0','='])await press(key);const values=await result();const body=await page.locator('body').innerText();if(!/不能|错误|除数|无法|除以/.test(body)||values.some(v=>/Infinity|NaN/.test(v)))throw Error('除零未显示可恢复的友好错误');await calc(['2','+','2','='],'4');return '除零错误提示及清空恢复通过';});
        if(wanted.percent)await check('calc:percent',async()=>{await press('C');await press('5');await press('0');await button(['%','百分号']);if(!(await result()).includes('0.5'))throw Error('50% 不是 0.5');return '50%=0.5';});
        if(wanted.historyClear)await check('calc:history-clear',async()=>{await calc(['2','+','3','='],'5');try{await button(['历史']);}catch{}const history=page.locator('[data-aiya="history-list"],#historyList,#history,.history-list').first();if(!await history.count())throw Error('UNLOCATED 缺少独立历史列表，请使用 data-aiya="history-list"');if(!normalized(await history.innerText()).includes('2+3=5'))throw Error('计算未形成可验证历史记录');await button(['清空历史','清空历史记录']);if(!(await result()).includes('5'))throw Error('清空历史改变当前计算结果');if(/\d[^=\n]*=\s*-?\d/.test(await history.innerText()))throw Error('历史条目没有清空');return '真实历史条目被清空，当前结果保留';});
      }else if(profile==='task-board'){
        await check('tasks:crud-statistics',async()=>{
          await button(['统计']);const total=page.locator('[data-aiya="stat-total"],#statTotal').first(),done=page.locator('[data-aiya="stat-done"],#statDone').first();if(!await total.count()||!await done.count())throw Error('UNLOCATED 缺少统计字段');const beforeTotal=Number(await total.innerText()),beforeDone=Number(await done.innerText());if(!Number.isFinite(beforeTotal)||!Number.isFinite(beforeDone))throw Error('UNLOCATED 统计字段需独立数字');taskCounts={total:beforeTotal,done:beforeDone};await button(['任务']);
          const field=page.locator('[data-aiya="task-input"],#taskInput,input[type="text"]').first();await field.fill('验证任务甲');await button(['添加','添加任务']);
          const list=page.locator('[data-aiya="task-list"],#taskList').first();if(!await list.count())throw Error('UNLOCATED 缺少 data-aiya="task-list"');if(!(await list.innerText()).includes('验证任务甲'))throw Error('添加后任务没有出现');const row=list.locator(':scope > *').filter({hasText:'验证任务甲'}).first();await completeTask(row);await button(['统计']);
          if(Number(await total.innerText())!==beforeTotal+1||Number(await done.innerText())!==beforeDone+1)throw Error('完成后统计错误');await button(['任务']);return '新建、完成、跨页统计正确';
        });
        await check('tasks:delete',async()=>{if(!taskCounts)throw Error('UNLOCATED 缺少统计基线');const list=page.locator('[data-aiya="task-list"],#taskList').first();const row=list.locator(':scope > *').filter({hasText:'验证任务甲'}).first();await button(['删除'],row);if((await list.innerText()).includes('验证任务甲'))throw Error('任务没有被删除');await button(['统计']);const total=page.locator('[data-aiya="stat-total"],#statTotal').first(),done=page.locator('[data-aiya="stat-done"],#statDone').first();if(Number(await total.innerText())!==taskCounts.total||Number(await done.innerText())!==taskCounts.done)throw Error('删除后统计没有同步');await button(['任务']);return '任务删除及统计同步正确';});
        if(wanted.undo)await check('tasks:undo',async()=>{if(!taskCounts)throw Error('UNLOCATED 缺少统计基线');const list=page.locator('[data-aiya="task-list"],#taskList').first(),undo=page.getByRole('button',{name:/撤销删除/}).first();await undo.click();await button(['已完成']);if(!(await list.innerText()).includes('验证任务甲'))throw Error('撤销没有恢复已完成状态');await button(['统计']);const total=page.locator('[data-aiya="stat-total"],#statTotal').first(),done=page.locator('[data-aiya="stat-done"],#statDone').first();if(Number(await total.innerText())!==taskCounts.total+1||Number(await done.innerText())!==taskCounts.done+1)throw Error('撤销后统计没有同步');await button(['任务']);return '撤销保留完成状态，且统计同步正确';});
      }
      await check('markup-leak',async()=>{if(/^\s*nav\.tabs\s*$/m.test(await page.locator('body').innerText()))throw Error('界面显示了 nav.tabs 源码片段');return '未发现已知源码片段泄漏';});
      for(const width of input.preference==='quality'?[390,1280]:[390]){await page.setViewportSize({width,height:844});await check(`viewport:${width}`,async()=>{const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));if(sizes.scroll>sizes.width+2)throw Error('页面横向溢出');return '没有文档横向溢出';});}
      await check('readability',async()=>{const bad=await page.locator('button,input,p,label,footer').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width&&n.getBoundingClientRect().height).map(n=>({text:(n.textContent||n.placeholder||'').slice(0,20),size:parseFloat(getComputedStyle(n).fontSize),height:n.getBoundingClientRect().height,tag:n.tagName})).filter(n=>n.size<(n.tag==='P'?18:n.tag==='FOOTER'?14:16)||n.tag==='BUTTON'&&n.height<44));if(bad.length)throw Error('字号或点击目标不足：'+JSON.stringify(bad.slice(0,4)));return '抽查正文、控件、辅助文字达标';},'warning');
      localChecks.push({name:'javascript-errors',status:errors.length?'failed':'passed',severity:'error',detail:errors.join('; ')||'初始化及已执行交互无未捕获异常'});
      localChecks.push({name:'network-isolation',status:'passed',severity:'error',detail:`独立上下文，外网/WS/Worker/下载/权限阻断；拦截资源 ${blocked.length} 次`});
      localChecks.push({name:'unexpected-resources',status:blocked.length||cspFailures.length?'failed':'passed',severity:'error',detail:blocked.length||cspFailures.length?'作品尝试加载被隔离策略拦截的资源或能力，不能交付':'已执行流程未发现被隔离策略拦截的资源'});
    }finally{await context.close();}
    return localChecks;
  }
  // A broken baseline does not make repairs impossible: preserve only demonstrably
  // passing checks from the original, while requiring the candidate's own core checks.
  let baselineChecks=[];
  if(input.previousHtml&&profile!=='smoke')baselineChecks=await validate(input.previousHtml);
  checks.push(...await validate(input.html));
  for(const before of baselineChecks.filter(c=>c.status==='passed'&&c.severity==='error'&&/^(calc:|tasks:)/.test(c.name))){
    const after=checks.find(c=>c.name===before.name);checks.push({name:'regression:'+before.name,status:after?.status||'inconclusive',severity:'error',detail:after?.status==='passed'?'保留上一版已验证功能':'上一版通过的检查在新版本未通过'});
  }
  if(profile==='smoke')checks.push({name:'functional-coverage',status:'not-run',severity:'warning',detail:'此类型仅做初始化/页面/异常冒烟检查，游戏规则、语音、设备感知及全部新增要求尚需人工实测。'});
  const required=checks.filter(c=>c.severity==='error');const status=required.some(c=>c.status==='failed')?'failed':required.some(c=>c.status==='inconclusive')?'inconclusive':'passed';
  process.stdout.write(JSON.stringify({schemaVersion:1,status,coverage:profile==='smoke'?'smoke-only':profile+'-core',durationMs:Date.now()-started,checks}));
}catch{process.stdout.write(JSON.stringify({schemaVersion:1,status:'inconclusive',coverage:'worker-error',durationMs:Date.now()-started,checks,error:'独立浏览器验证未完成；检查浏览器安装、沙箱账户或页面阻塞。'}));}
finally{await browser?.close();}
