import { resolveCreateTheatreRuntimeModelConfig, type CreateTheatreAdminSettings } from './_admin-settings';

export const webModelModes = ['default', 'quality', 'fusion'] as const;
export type WebModelMode = typeof webModelModes[number];
export const webModelIds = { default: 'deepseek-flash', quality: 'gpt-6-astra', fusion: 'fusion-max-2.0' } as const;
export const webModelLabels = { default: 'DeepSeek V4.1 Flash', quality: 'gpt-6-astra', fusion: 'Fusion Max 2.0（实验）' } as const;
export const normalizeWebModelMode = (mode: unknown): WebModelMode => mode === 'fusion' ? 'fusion' : mode === 'quality' ? 'quality' : 'default';
export function webModelConfig(settings: CreateTheatreAdminSettings, mode: WebModelMode) {
  return { ...resolveCreateTheatreRuntimeModelConfig(mode, settings.hermesProfiles[mode]), model: webModelIds[mode] };
}
