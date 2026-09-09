export type FeedbackGroups = { actionable: string[]; optional: string[]; diagnostic: string[] };

// Presentation only. Original validation results and submission gates remain intact.
export function groupStageFeedback(messages: string | string[] | undefined): FeedbackGroups {
  const groups: FeedbackGroups = { actionable: [], optional: [], diagnostic: [] };
  const lines = (Array.isArray(messages) ? messages : [messages || '']).flatMap(message => message.split(/\r?\n/u));
  for (const line of lines) {
    const name = line.match(/^([^：；]+)：/u)?.[1];
    for (const part of line.split('；')) {
      const text = part.trim().replace(/[。;]+$/u, '');
      if (!text) continue;
      const value = name && !text.startsWith(`${name}：`) ? `${name}：${text}` : text;
      // Real failure and story/reference risks take precedence over cosmetic matches.
      const actionable = /失败|超时|未完成|冲突|身份不一致|人物不一致|未上传|不可用|不存在|不在当前剧本|未找到此人物|(?:对白.*(?:遗漏|缺失)|(?:遗漏|错配|改动).*对白)|引用.*(?:错误|错位)|场次归属.*(?:确认|无法)|状态变化与剧本.*不一致|缺少.*(?:正文|必填)|failed|timeout|unavailable|unknown (?:scene|evidence)|identity.*mismatch|preserve dialogue|reference contract:/iu.test(text);
      const diagnostic = /人物设定已保留，可继续审核|不会因此卡住角色阶段|核心事实已保留，可继续审核|不会阻断，可在提交生图前按需精简|引用未匹配剧本原句|evidence is not verbatim|引用所标场次与人物出场场次列表不一致|sourceSceneKeys.*(?:order|match)|剧本依据索引不完整|尚未提供支持人物设定的剧本引用|有一条依据缺少设定说明或引用原文/iu.test(text);
      const target = actionable ? groups.actionable : diagnostic ? groups.diagnostic : groups.optional;
      if (!target.includes(value)) target.push(value);
    }
  }
  return groups;
}
