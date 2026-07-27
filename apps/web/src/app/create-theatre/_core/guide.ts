export type CreateTheatreGuideStep = {
  id: string;
  targetId: string;
  badge: string;
  title: string;
  body: string;
  coachLine: string;
};

export const createTheatreGuideStorageKey = 'aiya:create-theatre:game-guide:v1';

export const createTheatreGuideSteps: CreateTheatreGuideStep[] = [
  {
    id: 'meet-teacher',
    targetId: 'teacher-panel',
    badge: '第 1 关',
    title: '先认识你的 AI 老师',
    body: '这里会播放老师讲解，也会告诉你下一步该做什么。像游戏教程一样，我们一次只看一个动作。',
    coachLine: '先听老师说一句，再开始做第一个小应用。',
  },
  {
    id: 'voice-control',
    targetId: 'teacher-voice-controls',
    badge: '第 2 关',
    title: '打开声音，跟着老师走',
    body: '这里可以重播讲解、切换老师音色，或者在浏览器拦截时点一下开始播放。',
    coachLine: '如果没听到声音，先点这里重播。',
  },
  {
    id: 'choose-app',
    targetId: 'first-app-suggestions',
    badge: '第 3 关',
    title: '选择一个能马上做出来的小应用',
    body: '新手先选一个小目标，比如打地鼠或画笔。目标越清楚，AI 写出来的第一版越容易试玩。',
    coachLine: '点一个卡片，老师会直接开始写代码。',
  },
  {
    id: 'chat-input',
    targetId: 'teacher-chat-input',
    badge: '第 4 关',
    title: '也可以直接说出你的想法',
    body: '在这里打字或按住说话。你可以说“做一个计算器”，也可以说“给计算器加发声功能”。',
    coachLine: '像和老师聊天一样说需求，不需要会写代码。',
  },
  {
    id: 'send-request',
    targetId: 'teacher-send-button',
    badge: '第 5 关',
    title: '发送后，老师会直接写代码',
    body: '发送以后，不要干等。你可以继续问老师：现在做到哪一步了？哪里出错了？',
    coachLine: '发送就是开工按钮。',
  },
  {
    id: 'watch-progress',
    targetId: 'lesson-progress',
    badge: '第 6 关',
    title: '看见 AI 写代码的过程',
    body: '左侧会显示排队、理解需求、编写代码、验证和完成。这样你知道该等，还是该改需求。',
    coachLine: '这里是你的任务进度条。',
  },
  {
    id: 'try-demo',
    targetId: 'demo-preview-tabs',
    badge: '第 7 关',
    title: '试玩、看源码、看验证依据',
    body: '作品生成后，先试玩；想学习就看源码；想知道为什么能交付，就看验证。',
    coachLine: '完成后你就能像玩游戏一样继续升级作品。',
  },
];
