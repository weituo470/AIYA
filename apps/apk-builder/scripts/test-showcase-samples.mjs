import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const validateSingleFileApp = (name, requirements, forbidden = []) => {
  const html = readFileSync(join(here, '..', 'samples', name), 'utf8');
  assert.match(html, /<!doctype html>/i, `${name} must be a complete HTML document`);
  assert.match(html, /<meta[^>]+name=["']viewport["']/i, `${name} must define a viewport`);
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, `${name} must contain an inline script`);
  scripts.forEach((match, index) => {
    assert.doesNotThrow(() => new Function(match[1]), `${name} script ${index + 1} must parse`);
  });
  requirements.forEach((token) => assert.ok(html.includes(token), `${name} must include ${token}`));
  forbidden.forEach((token) => assert.equal(html.includes(token), false, `${name} must not use ${token}`));
  return { name, bytes: Buffer.byteLength(html), scripts: scripts.length };
};

const flight = validateSingleFileApp('cloud-flight.html', [
  '<canvas',
  'AiyaBodyMotion.start',
  'AiyaBodyMotion.calibrate',
  "addEventListener('pointermove'",
  'navigator.vibrate',
  'AudioContext',
  '60 - elapsed',
  "type === 'storm'",
  '每 15 秒提速',
], ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB']);

const gaze = validateSingleFileApp('gaze-star-hunt.html', [
  "facingMode: 'user'",
  'AiyaBodyVisionRuntime.start',
  'gazeX',
  'headPose',
  'track.stop()',
], ['fetch(', 'localStorage', 'sessionStorage', 'indexedDB']);

const voiceGarden = validateSingleFileApp('voice-garden.html', [
  'navigator.mediaDevices.getUserMedia',
  'createAnalyser',
  'pointerDown',
  'navigator.vibrate',
  'track.stop()',
  '40-(t-startAt)',
], ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB']);

const ecosystem = validateSingleFileApp('ecosystem-bottle.html', [
  '生态平衡',
  'type="range"',
  'triggerEvent',
  'oxygen',
  'waterUses',
  'day>=45',
], ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'getUserMedia']);

const moonLetter = validateSingleFileApp('moon-letter.html', [
  'RECEIVER FREQUENCY',
  'createOscillator',
  '信号已锁定',
  'chapters.length',
  'trust',
  'navigator.vibrate',
], ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'getUserMedia']);

console.log(JSON.stringify({
  ok: true,
  samples: [flight, gaze, voiceGarden, ecosystem, moonLetter],
}, null, 2));
