type ManagerCommandState = { status?: string; providerImpact?: string; kind?: string };

export function activeManagerCommandEntry<T extends { commands?: ManagerCommandState[] }>(entries: T[]): T | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.commands?.length) return entry;
  }
  return undefined;
}

export function managerMessageExecutionIntent(message: string): "change" | "confirm" | null {
  const normalized = message.normalize("NFKC").trim().replace(/[。！!，,、\s]+/gu, "");
  if (/^(确认|确认修改|确认执行|同意修改|同意执行|开始修改|开始执行|执行修改|按这个改|就这样改|可以修改|可以执行|现在修改|现在执行)$/u.test(normalized)) return "confirm";
  if (/(?:帮我|请|直接|立即|现在)(?:把|将)?[^？?]{0,80}(?:修改|修复|调整|更新|改成|改为)|^(?:把|将)[^？?]{1,100}(?:修改|修复|调整|更新|改好)(?:了|一下)?$|^(?:那)?你?(?:直接)?(?:写入|修复|修改)(?:啊|吧|一下)?$|(?:改成|改为)[^？?]{1,80}$/u.test(normalized)
    && !/(?:怎么|如何|是否|能不能|可以不可以|改好了吗|修改了吗|修复了吗)/u.test(normalized)) return "change";
  return null;
}

export function managerLocalWorkflowIntent(message: string): "workflow-back" | null {
  const normalized = message.normalize("NFKC").trim().replace(/[。！!，,、\s]+/gu, "");
  const storyboardTarget = /(?:分镜图|故事板图|宫格图)/u.test(normalized);
  const returnAction = /(?:返回|回到|回退|退回|先补|补上|补齐|继续生成|重新生成|重做|去生成|先生成)/u.test(normalized);
  if (storyboardTarget && returnAction && !/(?:为什么|怎么回事|什么问题|失败原因|是否需要|要不要)/u.test(normalized)) return "workflow-back";
  if (/^(?:返回|回到|回退|退回)(?:上一步|上一页|前一步)?$/u.test(normalized)) return "workflow-back";
  if (/^(?:返回|回到|回退|退回)(?:分镜|故事板)(?:制作|阶段|环节)?$/u.test(normalized)) return "workflow-back";
  return null;
}
