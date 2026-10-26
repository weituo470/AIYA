import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const createTheatreModelModes = ['default', 'fast', 'quality', 'fusion'] as const;
export type CreateTheatreModelMode = (typeof createTheatreModelModes)[number];

export type HermesModelProfile = {
  baseUrl: string;
  model: string;
  apiKey: string;
  updatedAt?: string;
};

export type CreateTheatreAdminSettings = {
  teacher: {
    name: string;
    avatar: string;
  };
  modelMode: CreateTheatreModelMode;
  hermesProfiles: Record<CreateTheatreModelMode, HermesModelProfile>;
  updatedAt?: string;
};

export type PublicHermesModelProfile = Omit<HermesModelProfile, 'apiKey'> & {
  hasApiKey: boolean;
  apiKeyMasked: string;
};

export type PublicCreateTheatreAdminSettings = Omit<CreateTheatreAdminSettings, 'hermesProfiles'> & {
  hermesProfiles: Record<CreateTheatreModelMode, PublicHermesModelProfile>;
};

export type CreateTheatreRuntimeModelConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  modelMode: CreateTheatreModelMode;
  apiType: string;
  provider: string;
  cliCommand: string;
  cliProvider: string;
  timeoutMs: number;
  maxTurns: number;
  maxTokens: number;
  jsonMode: boolean;
  thinkingMode: string;
  stream?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max';
  source: 'admin-profile' | 'environment';
};

export type PublicCreateTheatreRuntimeModelConfig = Omit<CreateTheatreRuntimeModelConfig, 'apiKey'> & {
  hasApiKey: boolean;
  apiKeyMasked: string;
};

type StoredHermesModelProfile = Omit<HermesModelProfile, 'apiKey'> & {
  apiKeyEncrypted?: string;
};

type StoredCreateTheatreAdminSettings = Omit<CreateTheatreAdminSettings, 'hermesProfiles'> & {
  hermesProfiles?: Partial<Record<CreateTheatreModelMode, StoredHermesModelProfile>>;
};

type HermesProfileUpdate = Partial<HermesModelProfile> & {
  clearApiKey?: boolean;
};

type SettingsUpdate = {
  teacher?: Partial<CreateTheatreAdminSettings['teacher']>;
  modelMode?: unknown;
  hermesProfiles?: Partial<Record<CreateTheatreModelMode, HermesProfileUpdate>>;
};

const emptyProfile = (): HermesModelProfile => ({
  baseUrl: '',
  model: '',
  apiKey: '',
});

export const defaultCreateTheatreAdminSettings: CreateTheatreAdminSettings = {
  teacher: {
    name: 'AIYA老师',
    avatar: '师',
  },
  modelMode: 'default',
  hermesProfiles: {
    default: emptyProfile(),
    fast: emptyProfile(),
    quality: emptyProfile(),
    fusion: emptyProfile(),
  },
};

const settingsFilePath = () =>
  process.env.CREATE_THEATRE_SETTINGS_FILE ||
  join(/* turbopackIgnore: true */ process.cwd(), '.state', 'create-theatre', 'admin-settings.json');

const encryptionSecret = () =>
  process.env.CREATE_THEATRE_SETTINGS_ENCRYPTION_KEY ||
  process.env.CREATE_THEATRE_ADMIN_TOKEN ||
  process.env.AIYA_ADMIN_TOKEN ||
  (process.env.NODE_ENV === 'production' ? '' : 'aiya-create-theatre-local-development-key');

const encryptionKey = () => {
  const secret = encryptionSecret();
  if (!secret) {
    throw new Error('CREATE_THEATRE_SETTINGS_ENCRYPTION_KEY is required before saving a Hermes API key');
  }
  return createHash('sha256').update(secret).digest();
};

const encryptApiKey = (value: string) => {
  const plain = value.trim();
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
};

const decryptApiKey = (value?: string) => {
  const encrypted = String(value || '').trim();
  if (!encrypted) return '';
  if (!encrypted.startsWith('v1:')) return encrypted;
  try {
    const [, ivText, tagText, payloadText] = encrypted.split(':');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(payloadText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
};

const normalizeBaseUrl = (value: unknown) => String(value || '').trim().replace(/\/+$/, '').slice(0, 500);
const normalizeModelName = (value: unknown) => String(value || '').trim().slice(0, 200);

export const normalizeCreateTheatreModelMode = (value: unknown): CreateTheatreModelMode => {
  const mode = String(value || '').trim().toLowerCase();
  return createTheatreModelModes.includes(mode as CreateTheatreModelMode)
    ? mode as CreateTheatreModelMode
    : 'default';
};

const env = (name: string) => String(process.env[name] || '').trim();

export const resolveCreateTheatreRuntimeModelConfig = (
  modelMode?: unknown,
  hermesProfile?: HermesModelProfile,
): CreateTheatreRuntimeModelConfig => {
  const selectedModelMode = normalizeCreateTheatreModelMode(modelMode);
  const hasAdminHermes = Boolean(hermesProfile?.baseUrl && hermesProfile?.model);
  // Fusion has its own enterprise credential. Never inherit another provider's key
  // or silently make an unconfigured Fusion option look available.
  if (selectedModelMode === 'fusion') {
    const outputLimit = Number(env('AIYA_FUSION_MAX_TOKENS') || '32768');
    const effort = env('AIYA_FUSION_REASONING_EFFORT');
    return {
      baseUrl: (hermesProfile?.baseUrl || env('AIYA_FUSION_BASE_URL') || 'https://api.fumolab.ai/v1').replace(/\/+$/, ''),
      apiKey: hermesProfile?.apiKey || env('AIYA_FUSION_API_KEY'),
      model: hermesProfile?.model || 'fusion-max-2.0',
      modelMode: 'fusion', apiType: 'openai', provider: 'http',
      cliCommand: '', cliProvider: '',
      timeoutMs: Number.parseInt(env('AIYA_TEACHER_CODER_TIMEOUT_MS') || '240000', 10),
      maxTurns: Number.parseInt(env('AIYA_TEACHER_CODER_MAX_TURNS') || '12', 10),
      maxTokens: Number.isFinite(outputLimit) ? Math.floor(Math.max(8192, Math.min(65536, outputLimit))) : 32768,
      jsonMode: env('AIYA_TEACHER_CODER_JSON_MODE') !== '0',
      thinkingMode: '',
      stream: env('AIYA_FUSION_STREAM') !== '0',
      reasoningEffort: ['low', 'medium', 'high', 'max'].includes(effort) ? effort as 'low' | 'medium' | 'high' | 'max' : 'low',
      source: hasAdminHermes ? 'admin-profile' : 'environment',
    };
  }
  const baseUrl = (
    (hasAdminHermes ? hermesProfile?.baseUrl : '') ||
    env('AIYA_TEACHER_CODER_BASE_URL') ||
    env('HERMES_BASE_URL') ||
    env('AIYA_TEACHER_AGENT_BASE_URL') ||
    env('AIYA_CREATE_FAST_DIRECT_HTML_BASE_URL') ||
    env('AIYA_CREATE_FAST_MODEL_BASE_URL') ||
    env('AIYA_CREATE_MODEL_BASE_URL') ||
    'http://127.0.0.1:1234'
  ).replace(/\/+$/, '');
  const apiKey =
    (hasAdminHermes ? hermesProfile?.apiKey || 'lm-studio' : '') ||
    env('AIYA_TEACHER_CODER_API_KEY') ||
    env('HERMES_API_KEY') ||
    env('AIYA_TEACHER_AGENT_API_KEY') ||
    env('AIYA_CREATE_FAST_DIRECT_HTML_API_KEY') ||
    env('AIYA_CREATE_FAST_MODEL_API_KEY') ||
    env('AIYA_CREATE_MODEL_API_KEY') ||
    'lm-studio';
  const defaultModel =
    (hasAdminHermes ? hermesProfile?.model : '') ||
    env('AIYA_TEACHER_CODER_MODEL') ||
    env('HERMES_MODEL') ||
    env('AIYA_TEACHER_AGENT_MODEL') ||
    env('AIYA_CREATE_FAST_DIRECT_HTML_MODEL') ||
    env('AIYA_CREATE_FAST_MODEL') ||
    env('AIYA_CREATE_MODEL') ||
    '';
  const fastModel =
    env('AIYA_TEACHER_CODER_FAST_MODEL') ||
    env('AIYA_CREATE_FAST_MODEL') ||
    env('AIYA_CREATE_FAST_DIRECT_HTML_MODEL') ||
    defaultModel;
  const qualityModel =
    env('AIYA_TEACHER_CODER_QUALITY_MODEL') ||
    env('AIYA_CREATE_QUALITY_MODEL') ||
    env('AIYA_CREATE_MODEL') ||
    defaultModel;
  const model = hasAdminHermes
    ? defaultModel
    : selectedModelMode === 'fast'
      ? fastModel
      : selectedModelMode === 'quality'
        ? qualityModel
        : defaultModel;
  const apiType =
    (hasAdminHermes ? 'openai' : '') ||
    env('AIYA_TEACHER_CODER_API_TYPE') ||
    env('HERMES_API_TYPE') ||
    env('AIYA_TEACHER_AGENT_API_TYPE') ||
    (baseUrl.includes('anthropic') ? 'anthropic' : 'openai');
  const provider =
    (hasAdminHermes ? 'http' : '') ||
    env('AIYA_TEACHER_CODER_PROVIDER') ||
    env('HERMES_TEACHER_CODER_PROVIDER') ||
    (apiType === 'hermes-cli' ? 'hermes-cli' : 'http');
  const isDeepSeekOfficial = /^https:\/\/api\.deepseek\.com/i.test(baseUrl);

  return {
    baseUrl,
    apiKey,
    model,
    modelMode: selectedModelMode,
    apiType,
    provider,
    cliCommand: env('AIYA_TEACHER_CODER_CLI_COMMAND') || env('HERMES_CLI_COMMAND') || 'hermes',
    cliProvider: env('AIYA_TEACHER_CODER_CLI_PROVIDER') || env('HERMES_CLI_PROVIDER') || 'openai-codex',
    timeoutMs: Number.parseInt(env('AIYA_TEACHER_CODER_TIMEOUT_MS') || env('HERMES_TIMEOUT_MS') || '240000', 10),
    maxTurns: Number.parseInt(env('AIYA_TEACHER_CODER_MAX_TURNS') || '12', 10),
    maxTokens: Number.parseInt(env('AIYA_TEACHER_CODER_MAX_TOKENS') || '16000', 10),
    jsonMode: env('AIYA_TEACHER_CODER_JSON_MODE') !== '0',
    thinkingMode: env('AIYA_TEACHER_CODER_THINKING') || (isDeepSeekOfficial ? 'disabled' : ''),
    source: hasAdminHermes ? 'admin-profile' : 'environment',
  };
};

const normalizeProfile = (value?: Partial<HermesModelProfile>): HermesModelProfile => ({
  baseUrl: normalizeBaseUrl(value?.baseUrl),
  model: normalizeModelName(value?.model),
  apiKey: String(value?.apiKey || '').trim().slice(0, 1000),
  updatedAt: value?.updatedAt,
});

export const normalizeCreateTheatreAdminSettings = (
  value: Partial<CreateTheatreAdminSettings> = {},
): CreateTheatreAdminSettings => {
  const teacher = (value.teacher || {}) as Partial<CreateTheatreAdminSettings['teacher']>;
  const profiles = value.hermesProfiles || defaultCreateTheatreAdminSettings.hermesProfiles;
  const name = String(teacher.name || defaultCreateTheatreAdminSettings.teacher.name)
    .trim()
    .slice(0, 24) || defaultCreateTheatreAdminSettings.teacher.name;
  const avatar = String(teacher.avatar || defaultCreateTheatreAdminSettings.teacher.avatar)
    .trim()
    .slice(0, 8) || defaultCreateTheatreAdminSettings.teacher.avatar;

  return {
    teacher: { name, avatar },
    modelMode: normalizeCreateTheatreModelMode(value.modelMode),
    hermesProfiles: {
      default: normalizeProfile(profiles.default),
      fast: normalizeProfile(profiles.fast),
      quality: normalizeProfile(profiles.quality),
      fusion: normalizeProfile(profiles.fusion),
    },
    updatedAt: value.updatedAt,
  };
};

const fromStoredSettings = (value: StoredCreateTheatreAdminSettings): CreateTheatreAdminSettings => {
  const profiles = value.hermesProfiles || {};
  return normalizeCreateTheatreAdminSettings({
    teacher: value.teacher,
    modelMode: value.modelMode,
    updatedAt: value.updatedAt,
    hermesProfiles: {
      default: {
        ...profiles.default,
        apiKey: decryptApiKey(profiles.default?.apiKeyEncrypted),
      },
      fast: {
        ...profiles.fast,
        apiKey: decryptApiKey(profiles.fast?.apiKeyEncrypted),
      },
      quality: {
        ...profiles.quality,
        apiKey: decryptApiKey(profiles.quality?.apiKeyEncrypted),
      },
      fusion: {
        ...profiles.fusion,
        apiKey: decryptApiKey(profiles.fusion?.apiKeyEncrypted),
      },
    },
  });
};

const toStoredSettings = (value: CreateTheatreAdminSettings): StoredCreateTheatreAdminSettings => ({
  teacher: value.teacher,
  modelMode: value.modelMode,
  updatedAt: value.updatedAt,
  hermesProfiles: {
    default: {
      baseUrl: value.hermesProfiles.default.baseUrl,
      model: value.hermesProfiles.default.model,
      apiKeyEncrypted: encryptApiKey(value.hermesProfiles.default.apiKey),
      updatedAt: value.hermesProfiles.default.updatedAt,
    },
    fast: {
      baseUrl: value.hermesProfiles.fast.baseUrl,
      model: value.hermesProfiles.fast.model,
      apiKeyEncrypted: encryptApiKey(value.hermesProfiles.fast.apiKey),
      updatedAt: value.hermesProfiles.fast.updatedAt,
    },
    quality: {
      baseUrl: value.hermesProfiles.quality.baseUrl,
      model: value.hermesProfiles.quality.model,
      apiKeyEncrypted: encryptApiKey(value.hermesProfiles.quality.apiKey),
      updatedAt: value.hermesProfiles.quality.updatedAt,
    },
    fusion: {
      baseUrl: value.hermesProfiles.fusion.baseUrl,
      model: value.hermesProfiles.fusion.model,
      apiKeyEncrypted: encryptApiKey(value.hermesProfiles.fusion.apiKey),
      updatedAt: value.hermesProfiles.fusion.updatedAt,
    },
  },
});

const maskApiKey = (value: string) => {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
};

export const toPublicCreateTheatreRuntimeModelConfig = (
  config: CreateTheatreRuntimeModelConfig,
): PublicCreateTheatreRuntimeModelConfig => {
  const { apiKey, ...publicConfig } = config;
  return {
    ...publicConfig,
    hasApiKey: Boolean(apiKey),
    apiKeyMasked: maskApiKey(apiKey),
  };
};

export const toPublicCreateTheatreAdminSettings = (
  settings: CreateTheatreAdminSettings,
): PublicCreateTheatreAdminSettings => {
  const publicProfile = (profile: HermesModelProfile): PublicHermesModelProfile => ({
    baseUrl: profile.baseUrl,
    model: profile.model,
    updatedAt: profile.updatedAt,
    hasApiKey: Boolean(profile.apiKey),
    apiKeyMasked: maskApiKey(profile.apiKey),
  });

  return {
    teacher: settings.teacher,
    modelMode: settings.modelMode,
    updatedAt: settings.updatedAt,
    hermesProfiles: {
      default: publicProfile(settings.hermesProfiles.default),
      fast: publicProfile(settings.hermesProfiles.fast),
      quality: publicProfile(settings.hermesProfiles.quality),
      fusion: publicProfile(settings.hermesProfiles.fusion),
    },
  };
};

export const readCreateTheatreAdminSettings = async (): Promise<CreateTheatreAdminSettings> => {
  try {
    // This is private runtime state, possibly symlinked outside the release.
    const runtimeSettingsPath = settingsFilePath();
    const raw = await readFile(/* turbopackIgnore: true */ runtimeSettingsPath, 'utf8');
    return fromStoredSettings(JSON.parse(raw) as StoredCreateTheatreAdminSettings);
  } catch {
    return normalizeCreateTheatreAdminSettings(defaultCreateTheatreAdminSettings);
  }
};

export const writeCreateTheatreAdminSettings = async (
  next: SettingsUpdate,
): Promise<CreateTheatreAdminSettings> => {
  const current = await readCreateTheatreAdminSettings();
  const now = new Date().toISOString();

  const mergeProfile = (mode: CreateTheatreModelMode): HermesModelProfile => {
    const existing = current.hermesProfiles[mode];
    const update = next.hermesProfiles?.[mode];
    if (!update) return existing;
    const suppliedApiKey = String(update.apiKey || '').trim();
    return normalizeProfile({
      baseUrl: update.baseUrl === undefined ? existing.baseUrl : update.baseUrl,
      model: update.model === undefined ? existing.model : update.model,
      apiKey: update.clearApiKey ? '' : suppliedApiKey || existing.apiKey,
      updatedAt: now,
    });
  };

  const settings = normalizeCreateTheatreAdminSettings({
    teacher: {
      name: next.teacher?.name === undefined ? current.teacher.name : next.teacher.name,
      avatar: next.teacher?.avatar === undefined ? current.teacher.avatar : next.teacher.avatar,
    },
    modelMode: next.modelMode === undefined
      ? current.modelMode
      : normalizeCreateTheatreModelMode(next.modelMode),
    hermesProfiles: {
      default: mergeProfile('default'),
      fast: mergeProfile('fast'),
      quality: mergeProfile('quality'),
      fusion: mergeProfile('fusion'),
    },
    updatedAt: now,
  });

  const file = settingsFilePath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(toStoredSettings(settings), null, 2)}\n`, 'utf8');
  return settings;
};
