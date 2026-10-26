import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root = new URL('../app/src/main/java/cc/shenliu/aiya/v3/',import.meta.url);
const dialog = readFileSync(new URL('GenerationTraceDialog.kt',root),'utf8');
assert.match(dialog,/Text\(value, fontSize = 18\.sp, lineHeight = 32\.sp/);
assert.match(dialog,/Text\(label, fontSize = 16\.sp/);
assert.match(dialog,/heightIn\(min = 48\.dp\)/);
assert.match(dialog,/verticalScroll\(rememberScrollState\(\)\)/);
assert.doesNotMatch(dialog,/fontSize\s*=\s*(?:[0-9]|1[0-3])\.sp/);
const main = readFileSync(new URL('MainActivity.kt',root),'utf8');
for (const [name,next] of [['LoadingPlayTab','FailedPlayTab'],['FailedPlayTab','WorkPlayTab']]) {
 const part=main.slice(main.indexOf(`private fun ${name}(`),main.indexOf(`private fun ${next}(`));
 assert.ok(part.length>0);
 assert.match(part,/fontSize = 18\.sp/);
 assert.match(part,/fontSize = 16\.sp/);
 assert.match(part,/heightIn\(min = 48\.dp\)/);
}
assert.match(main,/Text\(if \(recoverable\) "恢复原任务" else "再试一次", fontSize = 16\.sp/);
assert.match(main,/Text\("换个说法", fontSize = 16\.sp/);
console.log('PASS: modified native trace/loading/failure readability. Static check only; no phone layout proof.');
