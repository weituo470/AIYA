import assert from 'node:assert/strict';
import {
  appendNicknameQuestion,
  hasMeaningfulStudentHistory,
  inferStudentProfile,
  isAppBuildRequest,
  isAppRevisionRequest,
  isProfileOnlyStudentMessage,
  nicknameQuestionText,
  normalizeProfileName,
  studentMemoryKey,
} from '../src/app/create-theatre/_core/intent';
import { createJobPayload } from '../src/app/create-theatre/_core/create-job-service';
import { makeTeacherMessage, safeHtml, versionLabel, welcomeTeacherText } from '../src/app/create-theatre/_core/teacher-copy';
import {
  buildReplayScenes,
  createEmptyReplaySample,
  filterReplayMessagesForSample,
  makeReplayVersion,
  normalizeReplaySample,
  theatreReplaySchemaVersion,
} from '../src/app/create-theatre/_core/theatre-replay';
import {
  createVoiceprintEmbedding,
  extractVoiceprintNickname,
  formatVoiceprintScore,
  makeVoiceprintProfile,
  verifyVoiceprintProfile,
} from '../src/app/create-theatre/_core/voiceprint';

const xiaoMing = '\u5c0f\u660e';
const junWei = '\u541b\u7ef4';
const adult = '\u5927\u4eba';
const female = '\u5973\u751f';

assert.equal(normalizeProfileName(` ${xiaoMing}\u3002`), xiaoMing);
assert.equal(normalizeProfileName('\u7537\u751f'), '');
assert.equal(studentMemoryKey(xiaoMing), xiaoMing);

assert.equal(isProfileOnlyStudentMessage(`\u53eb\u6211${xiaoMing}`), true);
assert.equal(isProfileOnlyStudentMessage(`\u6211\u662f${adult}`), true);
assert.equal(isProfileOnlyStudentMessage('\u505a\u4e00\u4e2a\u98de\u884c\u5c04\u51fb\u6e38\u620f'), false);
assert.equal(hasMeaningfulStudentHistory({ profile: { nickname: xiaoMing }, chatMessages: [{ id: '1', role: 'student', text: `\u53eb\u6211${xiaoMing}`, at: new Date().toISOString() }], currentApp: null, updatedAt: new Date().toISOString() }), false);
assert.equal(hasMeaningfulStudentHistory({ profile: { nickname: xiaoMing }, chatMessages: [{ id: '1', role: 'student', text: '\u505a\u4e00\u4e2a\u8ba1\u7b97\u5668', at: new Date().toISOString() }], currentApp: null, updatedAt: new Date().toISOString() }), true);

let profile = inferStudentProfile({}, `\u53eb\u6211${junWei}\uff0c\u6211\u662f${adult}`);
assert.equal(profile.nickname, junWei);
assert.equal(profile.ageGroup, 'adult');
profile = inferStudentProfile(profile, `\u6211\u662f${female}`);
assert.equal(profile.pronoun, female);

assert.equal(isAppBuildRequest('\u505a\u4e00\u4e2a\u98de\u884c\u5c04\u51fb\u6e38\u620f\u3002'), true);
assert.equal(isAppBuildRequest('\u7ed9\u6211\u505a \u4e00\u4e2a\u8d2a\u98df\u86c7\u5c0f\u6e38\u620f'), true);
assert.equal(isAppBuildRequest('\u8001\u5e08\u4f60\u597d'), false);
assert.equal(isAppRevisionRequest('\u7ed9\u8ba1\u7b97\u5668\u52a0\u4e0a\u53d1\u58f0\u529f\u80fd'), true);
assert.equal(isAppRevisionRequest('\u5e0c\u671b\u6309\u94ae\u989c\u8272\u6539\u6210\u7ea2\u8272'), true);
assert.equal(isAppRevisionRequest('\u8001\u5e08\u4f60\u597d'), false);

assert.equal(appendNicknameQuestion('\u6536\u5230\uff0c\u6211\u5148\u5b89\u6392\u7f16\u7a0b Agent\u3002', {}).includes(nicknameQuestionText), true);
assert.equal(appendNicknameQuestion(`\u6536\u5230\u3002\n${nicknameQuestionText}`, {}).split(nicknameQuestionText).length, 2);
assert.equal(appendNicknameQuestion('\u6536\u5230\u3002', { nickname: junWei }), '\u6536\u5230\u3002');

assert.equal(versionLabel(2), '\u7b2c2\u7248');
assert.equal(safeHtml(undefined).includes('\u7b49\u5f85\u751f\u6210'), true);
assert.equal(makeTeacherMessage('?????????????????AI???').text, welcomeTeacherText);

const firstPayload = createJobPayload('\u505a\u4e00\u4e2a\u8ba1\u7b97\u5668', null);
assert.equal(firstPayload.prompt.startsWith('\u505a\u4e00\u4e2a\u8ba1\u7b97\u5668'), true);
assert.equal(firstPayload.prompt.includes('\u5355\u6587\u4ef6 HTML'), true);
assert.equal(firstPayload.revision, '');
assert.equal(firstPayload.mode, 'model');
assert.deepEqual(firstPayload.modelFallbacks, ['official-deepseek-deepseek-v4-flash']);
const revisionPayload = createJobPayload('\u52a0\u4e0a\u53d1\u58f0\u529f\u80fd', { html: '<html></html>', title: '\u8ba1\u7b97\u5668' });
assert.equal(revisionPayload.prompt.startsWith('\u57fa\u4e8e\u5f53\u524d\u4f5c\u54c1\u7ee7\u7eed\u4fee\u6539\u5b8c\u5584'), true);
assert.equal(revisionPayload.revision.startsWith('\u52a0\u4e0a\u53d1\u58f0\u529f\u80fd'), true);
assert.equal(revisionPayload.revision.includes('\u5355\u6587\u4ef6 HTML'), true);
assert.equal(Boolean(revisionPayload.currentApp), true);

const emptyReplay = createEmptyReplaySample();
assert.equal(emptyReplay.schemaVersion, theatreReplaySchemaVersion);
assert.equal(buildReplayScenes(emptyReplay).length, 0);

const legacyMixedReplay = normalizeReplaySample({
  id: 'legacy-replay',
  title: '旧回放',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date().toISOString(),
  messages: [makeTeacherMessage('旧项目消息')],
  versions: [{ version: 1, html: '<!doctype html><html></html>' }],
});
assert.equal(legacyMixedReplay.versions.length, 0);
assert.equal(buildReplayScenes(legacyMixedReplay).length, 0);

const projectStart = '2026-07-16T10:00:00.000Z';
const scopedReplay = createEmptyReplaySample({
  projectId: 'project-current',
  createdAt: projectStart,
});
const scopedMessages = filterReplayMessagesForSample(scopedReplay, [
  { id: 'old', role: 'student', text: '旧项目需求', at: '2026-07-16T09:59:59.000Z' },
  { id: 'new', role: 'student', text: '当前项目需求', at: projectStart },
  { id: 'reply', role: 'teacher', text: '开始当前项目', at: '2026-07-16T10:00:01.000Z' },
]);
assert.deepEqual(scopedMessages.map((message) => message.id), ['new', 'reply']);

const replayVersion = makeReplayVersion(1, {
  id: 'teacher-test',
  status: 'succeeded',
  stage: 'succeeded',
  prompt: '做一个计算器',
  events: [],
  result: {
    title: '计算器',
    brief: '可以完成加减运算。',
    html: '<!doctype html>\n<html><body><button>计算</button></body></html>',
  },
});
assert.ok(replayVersion);
const completeReplay = {
  ...scopedReplay,
  messages: scopedMessages,
  versions: [replayVersion!],
};
assert.equal(buildReplayScenes(completeReplay).length, 1 + scopedMessages.length + 1);

const makePcmChunk = (frequency: number) => {
  const sampleRate = 16000;
  const seconds = 2;
  const samples = sampleRate * seconds;
  const buffer = new ArrayBuffer(samples * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / 1000, (samples - index) / 1000);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.5 * envelope;
    view.setInt16(index * 2, Math.round(value * 32767), true);
  }
  return buffer;
};

const voiceEmbedding = createVoiceprintEmbedding([makePcmChunk(220)]);
assert.ok(voiceEmbedding);
assert.equal(voiceEmbedding!.length > 10, true);
assert.equal(extractVoiceprintNickname('\u6211\u662f\u5c0f\u660e'), xiaoMing);
assert.equal(extractVoiceprintNickname(xiaoMing), xiaoMing);
const voiceProfile = makeVoiceprintProfile(xiaoMing, voiceEmbedding!);
const voiceVerify = verifyVoiceprintProfile(voiceProfile, voiceEmbedding!);
assert.equal(voiceVerify.matched, true);
const otherVoiceEmbedding = createVoiceprintEmbedding([makePcmChunk(440)]);
assert.ok(otherVoiceEmbedding);
assert.equal(verifyVoiceprintProfile(voiceProfile, otherVoiceEmbedding!).matched, false);
assert.equal(formatVoiceprintScore(1), '100%');
assert.equal(verifyVoiceprintProfile(undefined, voiceEmbedding!).reason, 'NO_PROFILE');

console.log('create-theatre core checks passed');
