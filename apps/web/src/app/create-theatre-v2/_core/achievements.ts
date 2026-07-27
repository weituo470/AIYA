export type AchievementId =
  | 'first_code'
  | 'ai_partner'
  | 'who_am_i'
  | 'announcer'
  | 'success_run'
  | 'no_fear_debug'
  | 'little_inventor'
  | 'optimizer'
  | 'voiceprint_profile'
  | 'ai_quiz_master'
  | 'source_explorer'
  | 'take_home_work';

export type AchievementDefinition = {
  id: AchievementId;
  title: string;
  description: string;
  condition: string;
  icon: string;
  color: string;
  available: boolean;
};

export type AchievementStats = {
  promptCount: number;
  completedApps: number;
  revisionCount: number;
  teacherMessages: number;
  failedThenRetried: boolean;
  previewConfirmedVersions: number[];
  validationReviewed: boolean;
  quizCorrect: number;
  sourceOpened: boolean;
  downloadedHtml: boolean;
  voiceprintEnrolled: boolean;
  profileCompleted: boolean;
  voiceInputUsed: boolean;
};

export type AchievementState = {
  unlocked: Partial<Record<AchievementId, string>>;
  stats: AchievementStats;
};

export const defaultAchievementStats: AchievementStats = {
  promptCount: 0,
  completedApps: 0,
  revisionCount: 0,
  teacherMessages: 0,
  failedThenRetried: false,
  previewConfirmedVersions: [],
  validationReviewed: false,
  quizCorrect: 0,
  sourceOpened: false,
  downloadedHtml: false,
  voiceprintEnrolled: false,
  profileCompleted: false,
  voiceInputUsed: false,
};

export const achievementDefinitions: AchievementDefinition[] = [
  {
    id: 'first_code',
    title: '第一次写代码',
    description: '你把想法交给老师写成代码，并亲自试玩确认了效果。',
    condition: '第一版生成后，点击「我已试玩，效果可用」',
    icon: '/achievements/badge_01_first_code.webp',
    color: '#74d83f',
    available: true,
  },
  {
    id: 'ai_partner',
    title: 'AI 好搭档',
    description: '你已经学会和 AI 老师来回沟通。',
    condition: '和老师完成 3 轮有效对话',
    icon: '/achievements/badge_02_ai_partner.webp',
    color: '#8b5cf6',
    available: true,
  },
  {
    id: 'who_am_i',
    title: '我是谁',
    description: '你告诉老师自己是谁，AIYA 开始记住你的学习档案。',
    condition: '告诉老师你的称呼，完成学生建档',
    icon: '/achievements/badge_11_who_am_i.webp',
    color: '#facc15',
    available: true,
  },
  {
    id: 'announcer',
    title: '播音员',
    description: '你用声音和老师对话，体验了更自然的创作方式。',
    condition: '第一次使用语音输入发送消息',
    icon: '/achievements/badge_12_announcer.webp',
    color: '#38bdf8',
    available: true,
  },
  {
    id: 'success_run',
    title: '成功运行',
    description: '你试玩后查看了验证依据，确认作品不是只停留在代码里。',
    condition: '试玩确认后，打开「验证」查看通过记录',
    icon: '/achievements/badge_03_success_run.webp',
    color: '#2f9cff',
    available: true,
  },
  {
    id: 'no_fear_debug',
    title: '不怕报错',
    description: '遇到失败后，你完成了一次重试。',
    condition: '生成失败后重试成功',
    icon: '/achievements/badge_04_no_fear_debug.webp',
    color: '#f59e0b',
    available: true,
  },
  {
    id: 'little_inventor',
    title: '小小发明家',
    description: '你不只做出第一版，还把试玩后的想法变成了一次改进。',
    condition: '完成一次修改，并试玩确认新版效果',
    icon: '/achievements/badge_05_little_inventor.webp',
    color: '#10b981',
    available: true,
  },
  {
    id: 'optimizer',
    title: '优化大师',
    description: '你开始像真正产品经理一样打磨细节。',
    condition: '完成 2 次修改，并看过源码或验证依据',
    icon: '/achievements/badge_06_optimizer.webp',
    color: '#6366f1',
    available: true,
  },
  {
    id: 'voiceprint_profile',
    title: '声纹建档',
    description: '老师可以通过声音更自然地认识你。',
    condition: '完成声纹建档',
    icon: '/achievements/badge_07_voiceprint_profile.webp',
    color: '#14b8a6',
    available: true,
  },
  {
    id: 'ai_quiz_master',
    title: 'AI 小博士',
    description: '你已经掌握了几条 AI 编程基础常识。',
    condition: 'AI 问答答对 5 题',
    icon: '/achievements/badge_08_ai_quiz_master.webp',
    color: '#f97316',
    available: true,
  },
  {
    id: 'source_explorer',
    title: '源码探索者',
    description: '你试玩确认后打开源码，开始理解作品是怎么组成的。',
    condition: '试玩确认后第一次打开源码',
    icon: '/achievements/badge_09_source_explorer.webp',
    color: '#06b6d4',
    available: true,
  },
  {
    id: 'take_home_work',
    title: '带走作品',
    description: '你把自己的作品下载到电脑里。',
    condition: '第一次下载 HTML 文件',
    icon: '/achievements/badge_10_take_home_work.webp',
    color: '#ec4899',
    available: true,
  },
];

export const createEmptyAchievementState = (): AchievementState => ({
  unlocked: {},
  stats: { ...defaultAchievementStats },
});

export const mergeAchievementState = (value: unknown): AchievementState => {
  const candidate = value as Partial<AchievementState> | null;
  const candidateStats: Partial<AchievementStats> = candidate?.stats && typeof candidate.stats === 'object' ? candidate.stats : {};
  const previewConfirmedVersions = Array.isArray(candidateStats.previewConfirmedVersions)
    ? candidateStats.previewConfirmedVersions
        .map((version) => Number(version))
        .filter((version) => Number.isFinite(version) && version > 0)
    : [];
  return {
    unlocked: candidate?.unlocked && typeof candidate.unlocked === 'object' ? candidate.unlocked : {},
    stats: {
      ...defaultAchievementStats,
      ...candidateStats,
      previewConfirmedVersions,
      validationReviewed: Boolean(candidateStats.validationReviewed),
      voiceprintEnrolled: Boolean(candidateStats.voiceprintEnrolled),
      profileCompleted: Boolean(candidateStats.profileCompleted),
      voiceInputUsed: Boolean(candidateStats.voiceInputUsed),
    },
  };
};

export const getAchievementStorageKey = (nickname?: string) =>
  `aiya:create-theatre-v2:achievements:${nickname?.trim().toLocaleLowerCase() || 'guest'}`;
