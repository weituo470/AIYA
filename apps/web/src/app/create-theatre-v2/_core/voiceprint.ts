import { normalizeProfileName } from './intent';

export type VoiceprintProfile = {
  nickname: string;
  embedding: number[];
  sampleCount: number;
  createdAt: string;
  updatedAt: string;
  model: 'aiya-browser-pcm-v1';
};

export type VoiceprintVerifyResult = {
  matched: boolean;
  score: number;
  threshold: number;
  profile?: VoiceprintProfile;
  reason?: string;
};

export const voiceprintStorageKey = 'aiya:create-theatre:voiceprints';
export const voiceprintMatchThreshold = 0.88;

export const extractVoiceprintNickname = (text: string, fallback?: string) => {
  const nicknameMatch = text.match(/(?:\u53eb\u6211|\u6211\u53eb|\u6211\u7684\u540d\u5b57\u53eb|\u6211\u7684\u540d\u5b57\u662f|\u6635\u79f0\u662f|\u6635\u79f0\u53eb|\u6211\u662f)\s*([^\s\uff0c\u3002,.\uff01!\uff1f?\u3001]{1,12})/);
  const named = normalizeProfileName(nicknameMatch?.[1]);
  if (named) return named;

  const plain = normalizeProfileName(text);
  const looksLikeOnlyName = plain.length > 0
    && plain.length <= 8
    && !/(\u505a|\u5f00\u53d1|\u751f\u6210|\u5236\u4f5c|\u521b\u5efa|\u5199|\u5f04|\u8001\u5e08|AI|Agent)/i.test(plain);
  if (looksLikeOnlyName) return plain;
  return normalizeProfileName(fallback);
};

export const createVoiceprintEmbedding = (chunks: ArrayBuffer[]) => {
  const samples = readPcm16Samples(chunks);
  if (samples.length < 1600) return null;

  const frameSize = 640;
  const sampleRate = 16000;
  const rmsValues: number[] = [];
  const zcrValues: number[] = [];
  const absValues: number[] = [];
  const peakValues: number[] = [];
  const bandValues = frequencyBands.map(() => [] as number[]);

  for (let offset = 0; offset + frameSize <= samples.length; offset += frameSize) {
    let energy = 0;
    let abs = 0;
    let peak = 0;
    let zeroCrossings = 0;
    let previous = samples[offset] || 0;

    for (let index = 0; index < frameSize; index += 1) {
      const sample = samples[offset + index] || 0;
      energy += sample * sample;
      const sampleAbs = Math.abs(sample);
      abs += sampleAbs;
      peak = Math.max(peak, sampleAbs);
      if ((sample >= 0 && previous < 0) || (sample < 0 && previous >= 0)) zeroCrossings += 1;
      previous = sample;
    }

    const rms = Math.sqrt(energy / frameSize);
    if (rms < 0.006) continue;
    rmsValues.push(rms);
    zcrValues.push(zeroCrossings / frameSize);
    absValues.push(abs / frameSize);
    peakValues.push(peak);

    const bandEnergies = frequencyBands.map((frequency) => goertzelEnergy(samples, offset, frameSize, frequency, sampleRate));
    const totalBandEnergy = bandEnergies.reduce((sum, value) => sum + value, 0) || 1;
    bandEnergies.forEach((value, index) => {
      bandValues[index].push(Math.log1p((value / totalBandEnergy) * 100));
    });
  }

  if (rmsValues.length < 3) return null;

  const embedding = [
    ...summarize(rmsValues),
    ...summarize(zcrValues),
    ...summarize(absValues),
    ...summarize(peakValues),
    ...bandValues.flatMap(summarize),
    Math.min(1, samples.length / 16000 / 8),
    Math.min(1, rmsValues.length / Math.max(1, Math.floor(samples.length / frameSize))),
  ];

  return normalizeVector(embedding);
};

export const compareVoiceprintEmbedding = (left: number[], right: number[]) => {
  const size = Math.min(left.length, right.length);
  if (!size) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    const a = left[index] || 0;
    const b = right[index] || 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

export const mergeVoiceprintEmbedding = (existing: number[], next: number[], existingSampleCount: number) => {
  const weight = Math.max(1, existingSampleCount);
  const size = Math.max(existing.length, next.length);
  const merged = Array.from({ length: size }, (_, index) => (((existing[index] || 0) * weight) + (next[index] || 0)) / (weight + 1));
  return normalizeVector(merged);
};

export const makeVoiceprintProfile = (nickname: string, embedding: number[], existing?: VoiceprintProfile): VoiceprintProfile => {
  const now = new Date().toISOString();
  const normalizedNickname = normalizeProfileName(nickname);
  return {
    nickname: normalizedNickname,
    embedding: existing ? mergeVoiceprintEmbedding(existing.embedding, embedding, existing.sampleCount) : embedding,
    sampleCount: (existing?.sampleCount || 0) + 1,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    model: 'aiya-browser-pcm-v1',
  };
};

export const verifyVoiceprintProfile = (profile: VoiceprintProfile | undefined, embedding: number[], threshold = voiceprintMatchThreshold): VoiceprintVerifyResult => {
  if (!profile) return { matched: false, score: 0, threshold, reason: 'NO_PROFILE' };
  const score = compareVoiceprintEmbedding(profile.embedding, embedding);
  return { matched: score >= threshold, score, threshold, profile, reason: score >= threshold ? undefined : 'LOW_SCORE' };
};

export const formatVoiceprintScore = (score: number) => `${Math.round(score * 100)}%`;

export const readVoiceprintProfiles = (): Record<string, VoiceprintProfile> => {
  try {
    const raw = window.localStorage.getItem(voiceprintStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, VoiceprintProfile>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const writeVoiceprintProfiles = (profiles: Record<string, VoiceprintProfile>) => {
  window.localStorage.setItem(voiceprintStorageKey, JSON.stringify(profiles));
};

export const findVoiceprintProfile = (nickname?: string) => {
  const key = normalizeProfileName(nickname).toLocaleLowerCase();
  if (!key) return undefined;
  return readVoiceprintProfiles()[key];
};

export const upsertStoredVoiceprintProfile = (nickname: string, embedding: number[]) => {
  const key = normalizeProfileName(nickname).toLocaleLowerCase();
  if (!key) return null;
  const profiles = readVoiceprintProfiles();
  const profile = makeVoiceprintProfile(nickname, embedding, profiles[key]);
  profiles[key] = profile;
  writeVoiceprintProfiles(profiles);
  return profile;
};

export const verifyStoredVoiceprint = (nickname: string, embedding: number[], threshold = voiceprintMatchThreshold) => {
  return verifyVoiceprintProfile(findVoiceprintProfile(nickname), embedding, threshold);
};

export const matchStoredVoiceprint = (embedding: number[], threshold = voiceprintMatchThreshold) => {
  const profiles = Object.values(readVoiceprintProfiles());
  if (!profiles.length) return { matched: false, score: 0, threshold, reason: 'NO_PROFILE' } satisfies VoiceprintVerifyResult;

  let bestResult: VoiceprintVerifyResult = { matched: false, score: 0, threshold, reason: 'LOW_SCORE' };
  profiles.forEach((profile) => {
    const result = verifyVoiceprintProfile(profile, embedding, threshold);
    if (result.score > bestResult.score) bestResult = result;
  });
  return bestResult;
};

const readPcm16Samples = (chunks: ArrayBuffer[]) => {
  const samples: number[] = [];
  chunks.forEach((chunk) => {
    const view = new DataView(chunk);
    for (let offset = 0; offset + 1 < view.byteLength; offset += 2) {
      samples.push(view.getInt16(offset, true) / 32768);
    }
  });
  return samples;
};

const frequencyBands = [120, 180, 260, 380, 560, 820, 1200, 1760, 2600, 3800];

const goertzelEnergy = (samples: number[], offset: number, size: number, frequency: number, sampleRate: number) => {
  const normalizedFrequency = (2 * Math.PI * frequency) / sampleRate;
  const coefficient = 2 * Math.cos(normalizedFrequency);
  let previous = 0;
  let previous2 = 0;

  for (let index = 0; index < size; index += 1) {
    const window = 0.54 - (0.46 * Math.cos((2 * Math.PI * index) / Math.max(1, size - 1)));
    const current = ((samples[offset + index] || 0) * window) + (coefficient * previous) - previous2;
    previous2 = previous;
    previous = current;
  }

  return (previous2 * previous2) + (previous * previous) - (coefficient * previous * previous2);
};

const summarize = (values: number[]) => {
  if (!values.length) return [0, 0, 0, 0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return [
    mean,
    Math.sqrt(variance),
    sorted[Math.floor(sorted.length * 0.25)] || 0,
    sorted[Math.floor(sorted.length * 0.5)] || 0,
    sorted[Math.floor(sorted.length * 0.75)] || 0,
  ];
};

const normalizeVector = (values: number[]) => {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + (value * value), 0));
  if (!norm) return values.map(() => 0);
  return values.map((value) => Number((value / norm).toFixed(6)));
};
