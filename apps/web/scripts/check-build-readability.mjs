import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('next/package.json'))('postcss');
let total = 0;
for (const basename of ['build-preference', 'build-execution', 'task-trace']) {
  const css = readFileSync(new URL(`../src/app/_shared/${basename}.module.css`, import.meta.url), 'utf8');
  const root = postcss.parse(css); const vars = new Map();
  root.walkDecls(/^--build-font-/, declaration => vars.set(declaration.prop, declaration.value));
  const px = value => { const resolved = value.replace(/var\((--[\w-]+)\)/g, (_, key) => { assert(vars.has(key), `Unknown variable: ${key}`); return vars.get(key); }); const match = resolved.match(/^([\d.]+)(rem|px)$/); assert(match, `Audit font: ${value}`); return Number(match[1]) * (match[2] === 'rem' ? 16 : 1); };
  assert(px(vars.get('--build-font-body')) >= 18); assert(px(vars.get('--build-font-control')) >= 16); assert(px(vars.get('--build-font-meta')) >= 14);
  root.walkDecls(declaration => {
    if (declaration.prop === 'font-size' || declaration.prop.startsWith('--build-font-')) { assert(px(declaration.value) >= 14); total++; }
    if (declaration.prop === 'font') assert.equal(declaration.value, 'inherit', 'Audit font shorthand');
    if (declaration.prop === 'zoom' || declaration.prop === 'transform' && /scale/.test(declaration.value)) assert.fail('No scale workaround');
  });
  assert(css.includes('min-height: 44px'));
}
for (const name of ['BuildPreferenceSelector', 'BuildExecutionPanel', 'TaskTracePanel']) {
  const jsx = readFileSync(new URL(`../src/app/_shared/${name}.tsx`, import.meta.url), 'utf8');
  assert(!/text-(xs|sm)|text-\[|fontSize\s*:|style=/.test(jsx), 'Audit utility and inline overrides');
}
console.log(`PASS ${total} font declarations, variables, media queries, shorthand and inline/utility checks. Browser QA required separately.`);
