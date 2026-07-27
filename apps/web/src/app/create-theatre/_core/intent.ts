import type { StudentMemory, StudentProfile } from './types';

export const normalizeProfileName = (value?: string) => {
  const text = value?.trim().replace(/[\uFF0C\u3002,.\uFF01!\uFF1F?\u3001]/g, '') || '';
  if (!text || text.length > 12) return '';
  if ([
    '\u7537\u751F',
    '\u5973\u751F',
    '\u7537\u5B69',
    '\u5973\u5B69',
    '\u5C0F\u5B69',
    '\u5C0F\u670B\u53CB',
    '\u5927\u4EBA',
    '\u6210\u5E74\u4EBA',
    '\u6210\u4EBA',
  ].includes(text)) return '';
  return text;
};

export const studentMemoryKey = (nickname?: string) => normalizeProfileName(nickname).toLocaleLowerCase();

export const profileOnlyStudentPatterns = [
  /^(?:\u53EB\u6211|\u6211\u53EB|\u6211\u7684\u540D\u5B57\u53EB|\u6211\u7684\u540D\u5B57\u662F|\u6635\u79F0\u662F|\u6635\u79F0\u53EB)\s*[^\s\uFF0C\u3002,.\uFF01!\uFF1F?\u3001]{1,12}$/,
  /^\u6211\u662F\s*[^\s\uFF0C\u3002,.\uFF01!\uFF1F?\u3001]{1,12}$/,
  /^[A-Za-z][A-Za-z0-9_-]{1,15}$/,
  /^(?:\u6211\u662F)?(?:\u5C0F\u670B\u53CB|\u5C0F\u5B69|\u5927\u4EBA|\u6210\u5E74\u4EBA|\u7537\u751F|\u5973\u751F)$/,
];

export const isProfileOnlyStudentMessage = (text: string) => {
  const normalized = text.trim().replace(/[\uFF0C\u3002,.\uFF01!\uFF1F?\u3001]/g, '');
  return profileOnlyStudentPatterns.some((pattern) => pattern.test(normalized));
};

export const hasMeaningfulStudentHistory = (memory?: StudentMemory | null) => Boolean(
  memory?.currentApp?.html
  || (memory?.chatMessages || []).some((message) => (
    message.role === 'student' && !isProfileOnlyStudentMessage(message.text)
  )),
);

export const inferStudentProfile = (profile: StudentProfile, text: string): StudentProfile => {
  const next: StudentProfile = { ...profile };
  const nicknameMatch = text.match(/(?:\u53EB\u6211|\u6211\u53EB|\u6211\u7684\u540D\u5B57\u53EB|\u6211\u7684\u540D\u5B57\u662F|\u6635\u79F0\u662F|\u6635\u79F0\u53EB)\s*([^\s\uFF0C\u3002,.\uFF01!\uFF1F?\u3001]{1,12})/);
  const selfMatch = text.match(/\u6211\u662F\s*([^\s\uFF0C\u3002,.\uFF01!\uFF1F?\u3001]{1,12})/);
  const nickname = normalizeProfileName(nicknameMatch?.[1] || selfMatch?.[1]);
  if (nickname) next.nickname = nickname;
  const plainHandle = normalizeProfileName(text.replace(/\s+/g, ''));
  if (!next.nickname && !profile.nickname && /^[A-Za-z][A-Za-z0-9_-]{1,15}$/.test(plainHandle)) {
    next.nickname = plainHandle;
  }
  if (/\u5C0F\u670B\u53CB|\u5C0F\u5B69|\u513F\u7AE5|\u5C0F\u5B66\u751F|\u521D\u4E2D\u751F|\u5B69\u5B50/.test(text)) next.ageGroup = 'child';
  if (/\u5927\u4EBA|\u6210\u5E74\u4EBA|\u6210\u4EBA|\u4E0A\u73ED\u65CF|\u5927\u5B66\u751F/.test(text)) next.ageGroup = 'adult';
  if (/\u7537\u751F|\u7537\u5B69|\u7537\u7684/.test(text)) next.pronoun = '\u7537\u751F';
  if (/\u5973\u751F|\u5973\u5B69|\u5973\u7684/.test(text)) next.pronoun = '\u5973\u751F';
  if (/\u4FDD\u5BC6|\u4E0D\u60F3\u8BF4|\u4E0D\u7528\u77E5\u9053/.test(text)) next.pronoun = '\u4E0D\u900F\u9732';
  if (next.nickname !== profile.nickname || next.ageGroup !== profile.ageGroup || next.pronoun !== profile.pronoun) {
    next.updatedAt = new Date().toISOString();
  }
  return next;
};

export const profileSummary = (profile: StudentProfile) => {
  const parts = [
    profile.nickname ? `\u79F0\u547C\uFF1A${profile.nickname}` : '',
    profile.ageGroup === 'child' ? '\u5C0F\u670B\u53CB' : profile.ageGroup === 'adult' ? '\u5927\u4EBA' : '',
    profile.pronoun ? `\u504F\u597D\uFF1A${profile.pronoun}` : '',
    profile.voiceprintEnrolled ? '\u58F0\u7EB9\u5DF2\u5F55\u5165' : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' \u00B7 ') : '\u8FD8\u6CA1\u5EFA\u7ACB\u5B66\u751F\u6863\u6848';
};

export const nicknameQuestionText = '\u7B49\u5F85\u7684\u65F6\u5019\uFF0C\u6211\u4E5F\u60F3\u8BA4\u8BC6\u4E00\u4E0B\u4F60\uFF1A\u6211\u53EF\u4EE5\u600E\u4E48\u79F0\u547C\u4F60\uFF1F';

const nicknameQuestionLinePattern = /(\u600E\u4E48\u79F0\u547C|\u79F0\u547C\u4F60|\u53EB\u4EC0\u4E48|\u540D\u5B57\u662F\u4EC0\u4E48|\u544A\u8BC9\u6211.*(?:\u540D\u5B57|\u6635\u79F0)|\u6635\u79F0\u662F\u4EC0\u4E48|\u5982\u4F55\u79F0\u547C|\u6211\u53EF\u4EE5.*\u79F0\u547C)/;

export const stripNicknameQuestions = (text: string) => text
  .split('\n')
  .filter((line) => !nicknameQuestionLinePattern.test(line))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export const removeNicknameQuestions = (text: string, profile: StudentProfile) => {
  if (!profile.nickname) return text;
  return stripNicknameQuestions(text) || text;
};

export const appendNicknameQuestion = (text: string, profile: StudentProfile) => {
  const cleaned = removeNicknameQuestions(text, profile);
  return profile.nickname || cleaned.includes(nicknameQuestionText) ? cleaned : `${cleaned}\n${nicknameQuestionText}`;
};

export const isAppBuildRequest = (text: string) => (
  /(\u505A|\u5F00\u53D1|\u751F\u6210|\u5236\u4F5C|\u521B\u5EFA|\u5199|\u5F04)(\s*)(\u4E00\u4E2A|\u4E00\u6B3E|\u4E2A|\u6B3E|\u5C0F\u6E38\u620F|\u5C0F\u5E94\u7528|\u7F51\u9875|demo)?/.test(text)
  && /(\u8BA1\u7B97\u5668|\u6253\u5730\u9F20|\u753B\u677F|\u753B\u7B14|\u8D2A\u98DF\u86C7|\u98DE\u884C|\u5C04\u51FB|\u6E38\u620F|\u5C0F\u6E38\u620F|\u5E94\u7528|\u7F51\u9875|\u756A\u8304\u949F|\u62BD\u5956|\u8F6C\u76D8|\u8BB0\u8D26|\u6E05\u5355)/.test(text)
);

export const isAppRevisionRequest = (text: string) => (
  /(\u5E0C\u671B|\u60F3\u8981|\u6211\u8981|\u5E2E\u6211|\u7ED9|\u628A|\u8BA9|\u52A0|\u589E\u52A0|\u52A0\u5165|\u6DFB\u52A0|\u652F\u6301|\u6539\u6210|\u6539\u4E3A|\u4F18\u5316|\u5B8C\u5584|\u4FEE\u6539|\u8C03\u6574|\u6362\u6210|\u5220\u9664|\u53BB\u6389|\u4FDD\u7559)/.test(text)
  && /(\u529F\u80FD|\u53D1\u58F0|\u6717\u8BFB|\u8BED\u97F3|\u58F0\u97F3|\u97F3\u6548|\u52A8\u753B|\u989C\u8272|\u80CC\u666F|\u6309\u94AE|\u5386\u53F2|\u8BB0\u5F55|\u4FDD\u5B58|\u6392\u884C\u699C|\u96BE\u5EA6|\u91CD\u65B0\u5F00\u59CB|\u624B\u673A|\u89E6\u63A7|\u754C\u9762|\u6837\u5F0F|\u5E03\u5C40|\u8BA1\u7B97\u5668|\u6E38\u620F|\u753B\u677F|\u753B\u7B14)/.test(text)
);
