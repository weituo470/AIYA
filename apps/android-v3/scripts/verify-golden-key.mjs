import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const dialog=readFileSync(new URL('../app/src/main/java/cc/shenliu/aiya/v3/GoldenKeyDialog.kt',import.meta.url),'utf8');
assert.match(dialog,/Text\(example.prompt, fontSize = 18\.sp, lineHeight = 32\.sp/);
assert.match(dialog,/heightIn\(min = 48\.dp\)/);
assert.match(dialog,/Text\("选用提示词", fontSize = 16\.sp/);
assert.match(dialog,/Text\("复制", fontSize = 16\.sp/);
assert.match(dialog,/verticalScroll\(rememberScrollState\(\)\)/);
assert.doesNotMatch(dialog,/fontSize\s*=\s*(?:[0-9]|1[0-3])\.sp/);
assert.doesNotMatch(dialog,/submitGeneration|requestGeneration|exchangeGenerationHttp/,'Selection must not submit a generation');
const gradle=readFileSync(new URL('../app/build.gradle',import.meta.url),'utf8');
assert.match(gradle,/inputs\.file\('src\/main\/assets\/golden-key\.json'\)/,'Catalog changes must invalidate tests');
assert.match(gradle,/outputs\.upToDateWhen \{ false \}/,'Paid live checks must execute, not reuse cached success');
const catalog=JSON.parse(readFileSync(new URL('../app/src/main/assets/golden-key.json',import.meta.url),'utf8'));
assert.equal(catalog.examples.length,6);
for(const e of catalog.examples){assert.ok(e.title.length<=5);assert.ok(e.checks.length>=3);assert.ok(e.prompt.includes('不使用 localStorage'));assert.ok(e.prompt.includes('正文至少18px'));if(e.id!=='light-drawing')assert.ok(!/画板|画笔|绘画|canvas/i.test(e.prompt),'Cross-type drawing intent: '+e.id);}
console.log('PASS Golden Key catalog and modified native readability; not phone UI proof.');
