import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const web = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, web), 'utf8');
const catalog = JSON.parse(read('src/app/_shared/golden-key.json'));
const android = JSON.parse(read('../../apps/android-v3/app/src/main/assets/golden-key.json'));
assert.equal(catalog.platform, 'desktop-web');
assert.deepEqual(catalog.examples.map(e => e.id), android.examples.map(e => e.id), 'Theme identifiers remain shared');
assert.equal(catalog.schemaVersion, 1);
assert.equal(catalog.examples.length, 6);
assert.equal(new Set(catalog.examples.map(e => e.id)).size, 6);
for (const e of catalog.examples) {
  assert(e.prompt.length > 500 && e.checks.length >= 3 && e.nextStep && e.requirements);
  assert.equal(e.upgrades.length, 3, `${e.id}: three concrete optional improvements`);
  assert.equal(new Set(e.upgrades.map(u => u.id)).size, 3);
  for (const upgrade of e.upgrades) {
    assert(upgrade.prompt.length > 300 && upgrade.prompt.length < 6000);
    assert(upgrade.prompt.includes('继续修改当前') && upgrade.prompt.includes('不是新建'));
    assert(upgrade.title && upgrade.outcome && upgrade.checks.length >= 2);
    assert(upgrade.prompt.includes('页面内确认') && upgrade.prompt.includes('390px'));
  }
  assert([...e.title].length <= 5);
  const mobile = android.examples.find(item => item.id === e.id);
  assert.equal(e.title, mobile.title);
  assert.notEqual(e.prompt, mobile.prompt, `${e.id}: desktop must not copy the mobile prompt`);
  assert(e.prompt.includes('电脑版 AIYA 网页试玩') && e.prompt.includes('电脑键盘和鼠标是主要输入'));
  assert(e.prompt.includes('不申请设备权限') && e.prompt.includes('不使用 localStorage'));
  assert(!/AiyaBodyMotion|deviceorientation|getUserMedia|安卓试玩/.test(e.prompt), `${e.id}: no native/hardware-only dependency in desktop sandbox`);
  assert(e.prompt.includes('约390px') && e.prompt.includes('不足720px'));
  assert(e.checks.some(check => /键|鼠标|回车/.test(check)), `${e.id}: desktop acceptance must exercise desktop input`);
  if (e.id !== 'light-drawing') assert(!/画板|画笔|绘画|canvas/i.test(e.prompt), 'Do not misclassify a non-drawing template as drawing');
}
const byId = Object.fromEntries(catalog.examples.map(e => [e.id, e]));
assert(byId['gravity-maze'].prompt.includes('模拟重力') && byId['gravity-maze'].prompt.includes('不是手机体感'));
assert(byId['sound-garden'].prompt.includes('16步') && byId['sound-garden'].prompt.includes('不是麦克风音量检测'));
assert(byId['purchase-helper'].prompt.includes('不照搬手机三页'));
assert(byId['focus-forest'].prompt.includes('performance.now'));
assert(byId['light-drawing'].prompt.includes('Ctrl/Cmd+Z'));
const picker = read('src/app/_shared/GoldenKeyPicker.tsx');
assert(picker.includes('电脑版专用提示词') && !picker.includes('建议在 AIYA APK'));
for (const route of ['create-theatre', 'create-theatre-v2']) {
  const source = read(`src/app/${route}/CreateTheatreClient.tsx`);
  assert(source.includes('<GoldenKeyPicker disabled={isActive || isTeacherChatting}'));
  assert(source.includes('const wantsNewApp = usingGoldenKey || (!usingGoldenUpgrade && isExplicitNewAppRequest(value))'));
  assert(source.includes('usingGoldenKey || usingGoldenUpgrade ? activeStudentProfile : inferStudentProfile'));
  assert(source.includes('goldenKeyUpgradeDraft,\n    teacherChatMessages'));
  assert(source.includes('currentApp.html !== goldenKeyUpgradeDraft?.targetHtml'));
  assert(source.includes('goldenKeyContext: options.goldenKeyContext'));
  assert(source.includes('<GoldenKeyJourney app={currentApp}'));
  assert(source.includes('firstAppSuggestions.map'));
  const choose = source.match(/<GoldenKeyPicker[\s\S]*?\}\} \/>/)[0];
  assert(!/fetch\(|sendTeacherChat\(|createJob\(|speakTeacher\(/.test(choose), 'Picker must only fill draft');
}
assert(byId['light-drawing'].prompt.includes('多层半透明') && byId['light-drawing'].prompt.includes('随机种子'));
assert(byId['light-drawing'].upgrades.find(u => u.id === 'replay').prompt.includes('同一帧更新进度条与百分比'), 'Replay must require live progress, not only a start/end update');
const journey = read('src/app/_shared/GoldenKeyJourney.tsx');
assert(journey.includes('已生成 · 请验收') && journey.includes('点击发送才开始修改'));
assert(!/fetch\(|sendTeacherChat\(|createJob\(|speakTeacher\(/.test(journey));
const css = read('src/app/_shared/golden-key.module.css');
const variables = Object.fromEntries([...css.matchAll(/(--key-[\w-]+):\s*([\d.]+)rem/g)].map(m => [m[1], Number(m[2]) * 16]));
assert(variables['--key-body'] >= 18 && variables['--key-control'] >= 16 && variables['--key-meta'] >= 14);
for (const declaration of css.matchAll(/(?:^|[;{])\s*font-size\s*:\s*([^;}]+)/g)) {
  const v = declaration[1].trim();
  assert(/^var\(--key-(body|control|meta|title)\)$/.test(v), `Unexpected font size ${v}`);
}
assert(!/(?:^|[;{])\s*font\s*:|\bzoom\s*:|transform\s*:/.test(css), 'Avoid hidden font overrides or scaling');
assert(/min-height:\s*44px/.test(css));
assert(/@media \(max-width: 640px\)/.test(css));
console.log(JSON.stringify({ passed: true, examples: catalog.examples.map(e => ({ id: e.id, promptSha256: createHash('sha256').update(e.prompt).digest('hex') })), fontTokens: variables }, null, 2));
