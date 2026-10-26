import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const postcss=createRequire(require.resolve('next/package.json'))('postcss');
for(const name of ['create-theatre','create-theatre-v2']){
 const root=postcss.parse(readFileSync(new URL(`../src/app/${name}/create-theatre.module.css`,import.meta.url),'utf8'));
 const rules=[];root.walkRules(r=>{if(/\.chatBubble\s+(?:p|span)\b/.test(r.selector))rules.push(r);});
 for(const rule of rules){const props=new Map(rule.nodes.filter(x=>x.type==='decl').map(x=>[x.prop,x.value]));if(props.has('font-size')){const body=/\.chatBubble\s+p\b/.test(rule.selector);const variable=body?'--dialogue-font-body':'--dialogue-font-meta';assert.equal(props.get('font-size'),`var(${variable})`);const value=props.get(variable);assert(value?.endsWith('rem'));assert(parseFloat(value)*16 >= (body?18:14));}assert(!props.has('font'),'Audit font shorthand');assert(!props.has('zoom'),'No zoom workaround');assert(!/scale/.test(props.get('transform')||''));}
 assert(rules.length>=2);console.log('PASS',name,'conversation font variables and all local/media overrides');
}
