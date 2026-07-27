import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeHtml = readFileSync(join(here, '..', 'src', 'runtime', 'aiya-body-runtime.html'), 'utf8');
const match = runtimeHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
assert.ok(match, 'body runtime script must exist');
const mainActivity = readFileSync(
  join(here, '..', '..', 'android-v3', 'app', 'src', 'main', 'java', 'cc', 'shenliu', 'aiya', 'v3', 'MainActivity.kt'),
  'utf8',
);
const embeddedMatch = mainActivity.match(/private fun aiyaBodyRuntimeScript\(\): String = """\r?\n([\s\S]*?<script id="aiya-v3-body-runtime">[\s\S]*?<\/script>)\r?\n"""\.trimIndent\(\)/);
assert.ok(embeddedMatch, 'Android preview body runtime must exist');
assert.equal(embeddedMatch[1].trim(), runtimeHtml.trim(), 'preview and exported APK body runtimes must stay identical');

const canvasContext = { drawImage() {} };
const canvas = {
  width: 0,
  height: 0,
  getContext: () => canvasContext,
  toDataURL: () => 'data:image/jpeg;base64,ZmFrZQ==',
};
const listeners = new Map();
const window = {
  document: { createElement: (name) => name === 'canvas' ? canvas : {} },
  addEventListener: (name, listener) => listeners.set(name, listener),
  removeEventListener: (name) => listeners.delete(name),
  requestAnimationFrame: (callback) => { callback(0); return 1; },
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  Float32Array,
  JSON,
  Math,
  Object,
  Promise,
};
window.window = window;

vm.runInNewContext(match[1], window, { filename: 'aiya-body-runtime.js' });

assert.equal(window.AiyaBodyVisionRuntime.version, 2);
assert.equal(window.AiyaBodyVisionRuntime.capabilities().ok, false);
assert.equal(window.AiyaBodyAudio.version, 1);
assert.equal(window.AiyaBodyMotion.version, 1);

const androidVisionEngine = readFileSync(
  join(here, '..', '..', 'android-v3', 'app', 'src', 'main', 'java', 'cc', 'shenliu', 'aiya', 'v3', 'AiyaBodyVisionEngine.kt'),
  'utf8',
);
const exportedVisionBridge = readFileSync(join(here, '..', 'src', 'templates', 'AiyaBodyVisionBridge.java.tpl'), 'utf8');
for (const token of ['gazeX', 'gazeY', 'gazeDirection', 'eyeLookInLeft', 'eyeLookOutRight']) {
  assert.ok(androidVisionEngine.includes(token), `Android preview bridge must expose ${token}`);
  assert.ok(exportedVisionBridge.includes(token), `exported APK bridge must expose ${token}`);
}

const gazeSample = readFileSync(join(here, '..', 'samples', 'gaze-star-hunt.html'), 'utf8');
const gazeScript = gazeSample.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
assert.ok(gazeScript, 'gaze showcase script must exist');
assert.doesNotThrow(() => new Function(gazeScript[1]), 'gaze showcase script must parse');
for (const token of [
  "facingMode: 'user'",
  'playsinline',
  'AiyaBodyVisionRuntime.start',
  'gazeX',
  'gazeY',
  'headPose',
  'getVideoTracks()',
  'track.stop()',
  '校准',
  '不上传',
]) {
  assert.ok(gazeSample.includes(token), `gaze showcase must include ${token}`);
}
for (const forbidden of ['fetch(', 'localStorage', 'sessionStorage', 'indexedDB']) {
  assert.equal(gazeSample.includes(forbidden), false, `gaze showcase must not use ${forbidden}`);
}

const sampleRate = 48_000;
const length = 4096;
const sine = (frequency, amplitude = 0.3) => {
  const values = new Float32Array(length);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate);
  }
  return values;
};

const whistle = window.AiyaBodyAudio.estimatePitch(sine(1200), sampleRate, {
  whistleMinHz: 700,
  whistleMaxHz: 4000,
});
assert.ok(Math.abs(whistle.frequency - 1200) < 18, `expected ~1200Hz, got ${whistle.frequency}`);
assert.ok(whistle.clarity > 0.9, `expected high clarity, got ${whistle.clarity}`);
assert.equal(whistle.isWhistle, true);

const voiceLike = window.AiyaBodyAudio.estimatePitch(sine(220), sampleRate);
assert.ok(Math.abs(voiceLike.frequency - 220) < 8, `expected ~220Hz, got ${voiceLike.frequency}`);
assert.equal(voiceLike.isWhistle, false);

const silence = window.AiyaBodyAudio.estimatePitch(new Float32Array(length), sampleRate);
assert.equal(silence.frequency, 0);
assert.equal(silence.isWhistle, false);

console.log(JSON.stringify({
  ok: true,
  runtimeVersion: window.AiyaBodyAudio.version,
  whistle,
  voiceLike,
  silence,
}, null, 2));
