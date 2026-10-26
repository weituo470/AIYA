const clauseBoundaries = [
  /[\n\r。！？!?；;，,]/g,
  /而是|但是|但(?:要|需|应|请|用|显示|提供|加入|添加|实现|保留)|不过|改为|换成|替换为|只保留|仍需|仍要|还要|也要|并(?:需要|使用|显示|提供|加入|添加|实现|保留)|同时(?:需要|使用|显示|提供|加入|添加|实现|保留)/g,
  /\b(?:but|instead|however)\b/gi,
];

const chineseDoubleNegation = /(?:不能没有|不可没有|不能不|不可不|不得不|不要不|并非不|不是不)\s*$/;
const englishDoubleNegation = /(?:not\s+only|cannot\s+do\s+without|can't\s+do\s+without|not\s+without)\s*$/i;
const chineseNonNegatingQualifier = /(?:不要只有|不能只有|不只是|不止是?|不仅(?:仅)?|并非只有|不是只有)\s*$/;

const chinesePreNegation = /(?:不要|不需要|无需|不必|不用|不使用|不提供|不显示|不出现|不加入|不添加|不实现|不做|不引入|不接入|不加载|不依赖|不启用|不请求|不申请|禁止|避免|别|不能出现|不可出现|不允许|取消|移除|删除|去掉|排除|舍弃|禁用|没有|无|不是|并非)(?:\s|["'“”‘’()（）]|任何|额外|默认|自动|相关|这些|上述|所有|一个|该|此|这种|对应|在|页面|界面|中|里|上|的|再|出现|显示|提供|加入|添加|设置|使用|实现|包含|保留|展示|生成|创建|放置|写入|接入|加载|依赖|支持|启用|请求|申请|采用){0,16}$/;
const chineseNegationScope = /(?:不要|不需要|无需|不必|不用|不使用|不提供|不显示|不出现|不加入|不添加|不实现|不做|不引入|不接入|不加载|不依赖|不启用|不请求|不申请|禁止|避免|别|不能出现|不可出现|不允许|取消|移除|删除|去掉|排除|舍弃|禁用|没有|无|不是|并非)[\s\S]{0,48}$/;
const englishPreNegation = /(?:\b(?:no|without|never|exclude|avoid|remove|disable)\b|\b(?:do\s+not|don't|must\s+not|should\s+not|not)\b(?:\s+[a-z-]+){0,6})\s*$/i;

const chinesePostNegation = /^(?:\s|["'“”‘’()（）]|按钮|功能|选项|模式|入口|文案|标签|控制|支持|权限){0,12}(?:也请|请|也|都|一并)?(?:不要|不需要|无需|不必|不用|禁止|取消|移除|删除|去掉|不显示|不出现|不能出现|不可出现|不允许)/;
const englishPostNegation = /^\s*(?:button|feature|option|mode|label|control)?\s*(?:is\s+not\s+needed|isn't\s+needed|must\s+not|should\s+not|remove|disable)/i;

const afterLastBoundary = (value: string) => {
  let boundaryEnd = 0;
  for (const pattern of clauseBoundaries) {
    pattern.lastIndex = 0;
    let match = pattern.exec(value);
    while (match) {
      boundaryEnd = Math.max(boundaryEnd, match.index + match[0].length);
      match = pattern.exec(value);
    }
  }
  return value.slice(boundaryEnd);
};

const beforeNextBoundary = (value: string) => {
  let boundaryStart = value.length;
  for (const pattern of clauseBoundaries) {
    pattern.lastIndex = 0;
    const match = pattern.exec(value);
    if (match) boundaryStart = Math.min(boundaryStart, match.index);
  }
  return value.slice(0, boundaryStart);
};

export const isNegatedIntentOccurrence = (
  text: string,
  start: number,
  length: number,
) => {
  const localPrefix = afterLastBoundary(text.slice(0, start)).slice(-64);
  const localSuffix = beforeNextBoundary(text.slice(start + length)).slice(0, 32);

  if (chineseDoubleNegation.test(localPrefix) || englishDoubleNegation.test(localPrefix)) {
    return false;
  }
  if (chineseNonNegatingQualifier.test(localPrefix)) return false;
  return chinesePreNegation.test(localPrefix)
    || chineseNegationScope.test(localPrefix)
    || englishPreNegation.test(localPrefix)
    || chinesePostNegation.test(localSuffix)
    || englishPostNegation.test(localSuffix);
};

export const hasAffirmedIntent = (text: string, pattern: RegExp) => {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  let match = matcher.exec(text);
  while (match) {
    if (!isNegatedIntentOccurrence(text, match.index, match[0].length)) return true;
    if (!match[0]) matcher.lastIndex += 1;
    match = matcher.exec(text);
  }
  return false;
};

export const collectAffirmedTerms = (text: string, terms: readonly string[]) => terms.filter((term) => {
  let offset = 0;
  let index = text.indexOf(term, offset);
  while (index >= 0) {
    if (!isNegatedIntentOccurrence(text, index, term.length)) return true;
    offset = index + term.length;
    index = text.indexOf(term, offset);
  }
  return false;
});

export const teacherCoderVisibleTerms = [
  '开始', '暂停', '继续', '重置', '清空', '退格', '历史', '重新开始', '分数', '倒计时',
  '食物', '橡皮', '画笔', '撤销', '下载', '图片', '新手', '学习次数', '鼓励', '简单',
  '普通', '困难', '慢速', '快速', '最高分', '发声', '声音',
] as const;

export const collectRequestedVisibleTerms = (idea: string) => (
  collectAffirmedTerms(idea, teacherCoderVisibleTerms)
);

export const isSnakeRequest = (idea: string) => (
  hasAffirmedIntent(idea, /贪[食吃]蛇|snake/i)
);

export const isSnakeWallWrapRequested = (idea: string) => (
  isSnakeRequest(idea)
  && hasAffirmedIntent(idea, /撞墙.*(另一边|对面|出来)|从另一边出来|穿墙|wrap|opposite/i)
);

export const isDirectionalAppRequest = (idea: string) => (
  isSnakeRequest(idea)
  || hasAffirmedIntent(idea, /方向键|方向控制|上下左右|移动(?:控制|操控)|控制(?:角色|人物|小球|赛车|飞船|蛇)|操控(?:角色|人物|小球|赛车|飞船|蛇)|键盘操作|软键盘|d-?pad|keyboard|arrow|wasd|directional\s+control/i)
);

export const isFaceBodyVisionRequest = (idea: string) => (
  hasAffirmedIntent(idea, /人脸|鬼脸|脸部|眼睛|左右眼|眨眼|目光|视线|注视|眼球|嘴巴|张嘴|表情|face|eye|gaze|eye\s*track|look\s*direction|blink|mouth|grimace|facial\s*expression/i)
);

export const isGestureBodyVisionRequest = (idea: string) => (
  hasAffirmedIntent(idea, /视觉手势|手势识别|石头剪子布|拳头|剪刀|手掌|visual\s*gesture|hand\s*gesture|rock\s*paper\s*scissors/i)
);

export const isWhistlePitchRequest = (idea: string) => (
  // A synthesized note's pitch is output, not evidence of live audio capture.
  // Require a whistle or a measurement/recognition operation, not "音高" alone.
  hasAffirmedIntent(idea, /口哨|哨声|吹哨|(?:检测|识别|测量|追踪).{0,8}(?:音高|音调|(?:声音|音频)(?:的)?(?:特定)?频率)|(?:音高|音调|(?:声音|音频)(?:的)?(?:特定)?频率).{0,8}(?:检测|识别|测量|追踪)|\bwhistle\b|\bpitch\s*(?:detect|track|frequency)|\b(?:detect|track|measure)\w*\s+(?:audio\s+)?frequency/i)
);

export const isMicrophoneInputRequest = (idea: string) => (
  isWhistlePitchRequest(idea)
  || hasAffirmedIntent(idea, /麦克风|录音|录下.*声|语音输入|声音输入|声控|吹气|嘴炮|音量检测|声音检测|跟读|microphone|getusermedia|audio\s*input|voice\s*input|record(?:ing)?\s*(?:audio|voice|sound)/i)
);

export const isCameraInputRequest = (idea: string) => (
  isFaceBodyVisionRequest(idea)
  || isGestureBodyVisionRequest(idea)
  || hasAffirmedIntent(idea, /摄像头|前置相机|前摄|相机|自拍|camera|webcam|front[- ]?camera/i)
);

export const isMotionSensorRequest = (idea: string) => (
  // Physics acceleration and simulated tilt need no device sensor. Match an
  // actual sensor/source or a device gesture; keep genuine mobile intents.
  hasAffirmedIntent(idea, /体感|陀螺仪|加速度(?:计|传感器)|(?:手机|设备)(?:的)?加速度|(?:读取|采集|监听|获取).{0,8}加速度|重力感应|(?:倾斜|摇晃|甩动|旋转)(?:手机|设备)|(?:手机|设备)(?:倾斜|摇晃|甩动|旋转)|摇一摇|手机钓鱼|平滑球|平衡球|牛仔对决|姿态感应|AiyaBodyMotion|\bdeviceorientation\b|\bdevicemotion\b|\bgyroscope\b|\baccelerometer\b|\b(?:tilt|shake)(?:\s+(?:the|your))?\s+(?:phone|device)\b/i)
);

export const isWhackRequest = (idea: string) => (
  hasAffirmedIntent(idea, /打地鼠|地鼠|whack[- ]?a[- ]?mole|mole/i)
);

export const isDrawingBoardRequest = (idea: string) => (
  hasAffirmedIntent(idea, /画板|画笔|绘画|canvas/i)
);

export const isCalculatorRequest = (idea: string) => (
  hasAffirmedIntent(idea, /计算器|加减乘除|calculator/i)
);
