import { normalizeBuildPreference, type BuildPreference } from '../../lib/build-contract';
export const buildPreferenceStorageKey = 'aiya-build-preference-v1';
export const buildPreferenceEvent = 'aiya-build-preference-changed';
export function readBuildPreference(): BuildPreference {
  try { return normalizeBuildPreference(window.localStorage.getItem(buildPreferenceStorageKey)); } catch { return 'auto'; }
}
