import type { StudentMemory } from './types';
import { studentMemoryKey } from './intent';

export const legacyStudentProfileStorageKey = 'aiya:create-theatre:student-profile';
export const studentMemoryStorageKey = 'aiya:create-theatre:student-memories';
export const readStudentMemories = (): Record<string, StudentMemory> => {
  try {
    const raw = window.localStorage.getItem(studentMemoryStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StudentMemory>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const writeStudentMemory = (memory: StudentMemory) => {
  const key = studentMemoryKey(memory.profile.nickname);
  if (!key) return;
  const memories = readStudentMemories();
  memories[key] = memory;
  window.localStorage.setItem(studentMemoryStorageKey, JSON.stringify(memories));
};

export const findStudentMemory = (nickname?: string) => {
  const key = studentMemoryKey(nickname);
  if (!key) return null;
  return readStudentMemories()[key] || null;
};
