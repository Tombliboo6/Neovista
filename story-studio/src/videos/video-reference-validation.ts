export interface PromptReferenceBinding {
  pictureTag: string;
  subjectTag?: string;
  assetKind: string;
  panelCount?: number;
}

const timeRange = '(\\d+(?:\\.\\d+)?)\\s*[-—–至]\\s*(\\d+(?:\\.\\d+)?)\\s*秒';
const panelList = '第([一二三四五六七八九十\\d、，,至—–-]+)格';

function panelNumbers(value: string): number[] {
  const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const number = (part: string) => digits[part] ?? Number(part);
  return value.split(/[、，,]/u).flatMap(part => {
    const range = part.split(/[至—–-]/u).map(number);
    if (range.length === 1) return range;
    if (range.length !== 2 || range[1] < range[0] || range[1] - range[0] > 9) return [NaN];
    return Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i);
  });
}

function storyboardMappingIssues(positive: string, execution: string, binding: PromptReferenceBinding): string[] {
  const tag = binding.pictureTag;
  const guide = positive.split(/\r?\n/u).find(line => line.startsWith('故事板参考：') && line.includes(tag)) ?? '';
  const beats = [...execution.matchAll(new RegExp(`^\\s*${timeRange}[\\s\\S]*?(?=^\\s*${timeRange}|(?![\\s\\S]))`, 'gmu'))];
  const mappings = [...guide.matchAll(new RegExp(`${timeRange}对应${panelList}`, 'gu'))];
  const inline = beats.map(beat => ({ start: Number(beat[1]), end: Number(beat[2]),
    panels: beat[0].includes(tag) ? panelNumbers(beat[0].match(new RegExp(panelList, 'u'))?.[1] ?? '') : [] }));
  const rows = mappings.length ? mappings.map(m => ({ start: Number(m[1]), end: Number(m[2]), panels: panelNumbers(m[3]) })) : inline;
  // A legacy continuous shot may describe the full ordered board without timed beats.
  // Preserve that authored form when its complete panel sequence is explicit.
  if (!rows.length) {
    const legacy = execution.match(new RegExp(`${tag}\\s*${panelList}`, 'u'));
    const panels = legacy ? panelNumbers(legacy[1]) : [];
    if (panels.length && panels.length === (binding.panelCount ?? panels.length) && panels.every((n, i) => n === i + 1)) return [];
  }
  if (!rows.length || rows.some(row => !row.panels.length || row.panels.some(n => !Number.isInteger(n) || n < 1))) {
    return [`${tag}缺少可核对的画格与时间对应；可在故事板参考说明中集中列出。`];
  }
  const issues: string[] = [];
  if (rows.some((row, i) => row.end <= row.start || Math.abs(row.start - (i ? rows[i - 1].end : 0)) > 0.02)
    || (beats.length && (Math.abs(rows[0].start - Number(beats[0][1])) > 0.02 || Math.abs(rows.at(-1)!.end - Number(beats.at(-1)![2])) > 0.02))) {
    issues.push(`${tag}的画格时间对应不连续或与正文时间范围不一致。`);
  }
  const panels = rows.flatMap(row => row.panels);
  const count = binding.panelCount ?? panels.length;
  if (panels.length !== count || panels.some((n, i) => n !== i + 1)) issues.push(`${tag}的画格对应须按顺序完整覆盖第1至${count}格。`);
  // If both forms were authored, neither is allowed to contradict the other.
  if (mappings.length) for (const row of inline.filter(item => item.panels.length)) {
    const mapped = rows.filter(item => item.start < row.end && item.end > row.start).flatMap(item => item.panels);
    if (row.panels.some(n => !mapped.includes(n))) issues.push(`${tag}在${row.start}—${row.end}秒的正文画格与参考说明不一致。`);
  }
  return issues;
}

/** Validate the actual production text, including manually edited drafts. */
export function videoReferenceIssues(text: string, bindings: PromptReferenceBinding[]): string[] {
  const issues: string[] = [];
  const execution = text.split('画面内容与镜头执行')[1]?.split('负面词')[0] ?? '';
  const positive = text.split('负面词')[0];
  const definitions = positive.split(/声音总则|氛围、?画质|画面内容与镜头执行/u)[0];
  const allowed = new Set(bindings.flatMap(b => [b.pictureTag, ...(b.subjectTag ? [b.subjectTag] : [])]));
  for (const match of positive.matchAll(/<\s*(?:Picture|Subject)\s*\d+\s*>/giu)) {
    if (!allowed.has(match[0])) issues.push(`引用标签不匹配：${match[0]}，请使用当前上传清单中的原样标签。`);
  }
  if (/<\s*>|<\s*(?:P|SH|AU)\s*\d+\s*>|<\s*(?:Picture|Subject)\s*(?:n|N|\?)?\s*>/u.test(positive)) {
    issues.push('存在空引用或内部编号占位符；图片使用完整的<Picture 数字>，人物使用<Subject 数字>。');
  }
  for (const binding of bindings) {
    if (binding.assetKind !== 'storyboard' && !definitions.includes(binding.pictureTag)) {
      issues.push(`参考说明或基础设定缺少${binding.pictureTag}的参考职责。`);
    }
    const tag = binding.subjectTag ?? binding.pictureTag;
    if (binding.subjectTag) {
      const clauses = definitions.split(/[。；;\n]/u);
      if (!clauses.some(clause => clause.includes(tag) && clause.includes(binding.pictureTag))) issues.push(`参考说明或基础设定缺少${tag}与${binding.pictureTag}的身份绑定。`);
      if (!execution.includes(tag)) issues.push(`镜头执行缺少${tag}的实际引用，请在主体出场或动作归属处使用。`);
    }
    if (binding.assetKind === 'storyboard') {
      issues.push(...storyboardMappingIssues(positive, execution, binding));
    }
  }
  return [...new Set(issues)];
}
