export type TeacherTaskState = {
  jobStatus?: string;
  jobStage?: string;
  currentAppTitle?: string;
};

export const isTaskStatusQuestion = (text: string) => /^(?:现在|已经|还|到底)?\s*(?:好了吗|做好了吗|完成了吗|做完了吗|生成完了吗|进度(?:怎么样|如何|呢)?|到哪(?:一步)?了|还要多久|怎么还没好|怎么还没完成|是否完成|在写吗)[？?！!。\s]*$/.test(text.trim());

export const actualTaskReply = ({ jobStatus, jobStage, currentAppTitle }: TeacherTaskState) => {
  if (jobStatus === 'queued') return '任务正在等待处理，还没有完成。你可以在“任务轨迹”查看实际进度。';
  if (jobStatus === 'running') {
    const checking = /validat|check|verify|test/.test(jobStage || '');
    return checking ? '当前任务正在检查生成结果，还没有完成。检查结果会显示在“任务轨迹”中。' : '当前生成任务仍在进行中，还没有完成。你可以在“任务轨迹”查看实际进度。';
  }
  if (jobStatus === 'failed') return '最近一次生成失败了，没有在后台继续编写。请查看错误或“任务轨迹”，再决定是否重试。';
  if (jobStatus === 'cancelled') return '生成已撤销，当前没有正在运行的生成任务。';
  if (currentAppTitle) return `当前没有正在运行的生成任务。已有作品“${currentAppTitle}”可以试玩；其他需求如果没有任务轨迹，就还没有启动生成。`;
  return '当前没有正在运行的生成任务，也没有已完成的作品。请告诉我你想做什么。';
};

export const resolveGenerationDecision = (input: {
  isActive: boolean;
  hasCurrentApp: boolean;
  wantsNewApp: boolean;
  wantsRevision: boolean;
  wantsFirstBuild: boolean;
  nextAction?: string;
  userText: string;
  profileOnly?: boolean;
}) => {
  // Existing artwork must not suppress a model's explicit NEW-project command.
  // Identity/progress messages cannot turn old conversational promises into jobs.
  const blocked = input.isActive || input.profileOnly || isTaskStatusQuestion(input.userText);
  const newProject = input.wantsNewApp || input.nextAction === 'start_generation';
  const revise = input.wantsRevision || input.nextAction === 'revise';
  const shouldStart = !blocked && (newProject || revise || (!input.hasCurrentApp && input.wantsFirstBuild));
  return { shouldStart: Boolean(shouldStart), shouldReplaceCurrentApp: Boolean(shouldStart && input.hasCurrentApp && newProject) };
};

export const truthfulTeacherReply = (reply: string, state: TeacherTaskState, shouldSubmit = false) => {
  if (shouldSubmit) return '收到，准备提交这个需求。是否已开始、完成或失败，以实际任务进度为准。';
  if (/准备提交.*需求/.test(reply)) return actualTaskReply(state);
  if (state.jobStatus !== 'running' && state.jobStatus !== 'queued'
    && /(?:我|老师).{0,25}(?:正在|还在|接着|开始|继续).{0,15}(?:写|编写|开发|生成|修改)|(?:做好|完成).{0,8}(?:马上|就).{0,8}(?:喊|叫|通知)|稍等.{0,8}试玩/.test(reply)) {
    return actualTaskReply(state);
  }
  return reply;
};
