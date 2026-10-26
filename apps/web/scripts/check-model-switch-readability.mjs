import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const postcss=createRequire(require.resolve('next/package.json'))('postcss');
const css=readFileSync(new URL('../src/app/_shared/model-switcher.module.css',import.meta.url),'utf8');
const jsx=readFileSync(new URL('../src/app/_shared/ModelSwitcher.tsx',import.meta.url),'utf8');
const root=postcss.parse(css);const vars=new Map();
root.walkDecls(/^--model-font-/,d=>vars.set(d.prop,d.value));
const px=value=>{const v=value.replace(/var\((--[\w-]+)\)/g,(_,key)=>{assert(vars.has(key),'Unknown font variable '+key);return vars.get(key);});const m=v.match(/^([\d.]+)(rem|px)$/);assert(m,'Font value needs explicit audit: '+v);return Number(m[1])*(m[2]==='rem'?16:1);};
let checked=0;
root.walkDecls(d=>{
 if(d.prop==='font-size'||d.prop.startsWith('--model-font-')){assert(px(d.value)>=14,`Too small: ${d.toString()}`);checked++;}
 if(d.prop==='font'){assert(d.value==='inherit','Audit font shorthand: '+d.toString());}
 if(d.prop==='zoom'||(d.prop==='transform'&&d.value.includes('scale')))assert.fail('Do not scale text');
});
assert(px(vars.get('--model-font-body'))>=18);assert(px(vars.get('--model-font-control'))>=16);assert(px(vars.get('--model-font-meta'))>=14);
assert(!/text-(xs|sm)|text-\[|fontSize\s*:/.test(jsx),'Local utility or inline font requires audit');
assert(css.includes('min-height: 44px')&&css.includes('min-height: 48px'));
console.log(`PASS ${checked} font declarations/variables, shorthand checks, media queries, inline/utility overrides, 18/16/14 tiers. Runtime browser verification still required.`);
