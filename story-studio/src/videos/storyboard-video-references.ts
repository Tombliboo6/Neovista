export interface StoryboardVideoReference {
  imageUrl: string;
  pictureTag: string;
  panelCount: number;
}

export function changedStoryboardImageKeys(previous: Array<{ segmentKey: string; imageUrl?: string; panelCount?: number }> = [], next: Array<{ segmentKey: string; status?: string; imageUrl?: string; panelCount?: number }> = []): Set<string> {
  return new Set(next.filter(board => {
    const old = previous.find(item => item.segmentKey === board.segmentKey);
    return board.status === 'complete' && board.imageUrl && (old?.imageUrl !== board.imageUrl || (old?.panelCount && board.panelCount && old.panelCount !== board.panelCount));
  }).map(board => board.segmentKey));
}

interface VideoReferences {
  referenceLabels?: string[];
  referenceImageUrls?: string[];
  referenceLayoutVersion?: number;
  storyboardReference?: StoryboardVideoReference;
}

/** Older projects stored the planning board before the numbered asset images. */
export function normalizeStoryboardVideoReferences<T extends VideoReferences>(prompt: T): T & VideoReferences {
  if (prompt.referenceLayoutVersion === 2) return prompt;
  const labels = [...(prompt.referenceLabels ?? [])];
  const urls = [...(prompt.referenceImageUrls ?? [])];
  const match = /(?:整张\s*)?([3469三四六九])\s*宫格/u.exec(labels[0] ?? '');
  if (!match || !urls.length) return prompt;
  const label = labels.shift()!;
  const imageUrl = urls.shift()!;
  labels.push(label);
  urls.push(imageUrl);
  const panelCount = Number(match[1]) || ({ 三: 3, 四: 4, 六: 6, 九: 9 } as Record<string, number>)[match[1]];
  return { ...prompt, referenceLabels: labels, referenceImageUrls: urls, referenceLayoutVersion: 2,
    storyboardReference: { imageUrl, pictureTag: `<Picture ${urls.length}>`, panelCount } };
}

export function withStoryboardVideoGuide(text: string, board?: Pick<StoryboardVideoReference, 'pictureTag' | 'panelCount'>, plan?: {
  videoPromptSections?: { timelineBeats?: Array<{ startSec?: number; endSec?: number; panelKeys?: string[] }> };
}): string {
  if (!board) return text;
  // An approved, editable guide is part of the user's prompt. Submission must
  // not replace its timing edits with an older structured draft.
  const existingGuide = text.match(/^故事板参考：([^\n]*)/mu)?.[1];
  if (existingGuide?.startsWith(`${board.pictureTag}是本段整张${board.panelCount}宫格`)) return text;
  const timeline = (plan?.videoPromptSections?.timelineBeats ?? []).map(beat => {
    const numbers = (beat.panelKeys ?? []).map(key => Number(key.replace(/^P/u, ''))).filter(n => n >= 1 && n <= board.panelCount);
    return numbers.length && Number.isFinite(beat.startSec) && Number.isFinite(beat.endSec)
      ? `${beat.startSec}—${beat.endSec}秒对应第${numbers.join('、')}格` : '';
  }).filter(Boolean).join('；');
  const guide = `故事板参考：${board.pictureTag}是本段整张${board.panelCount}宫格故事板，按从左到右、从上到下读取，控制各镜头的视角、人物位置、构图、动作状态和镜头顺序。${timeline ? `${timeline}。` : '各格按正文时间线对应动作与镜头。'}在关键画面之间自然运动，保持单幅全屏视频画面；不把拼版当作首帧，不展示宫格边框或图中文字。`;
  return `${guide}\n${text.replace(/^故事板参考：[^\n]*\n?/mu, '').trim()}`;
}
