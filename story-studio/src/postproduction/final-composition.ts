export type FinalSubtitleCue = {
  startSec: number;
  endSec: number;
  text: string;
  source: string;
};

function approvedSubtitleTexts(ideaScript: any): Set<string> {
  const texts = new Set<string>();
  for (const scene of Array.isArray(ideaScript?.scenes) ? ideaScript.scenes : []) {
    for (const block of Array.isArray(scene?.blocks) ? scene.blocks : []) {
      if ((block?.type === 'dialogue' || block?.type === 'os') && typeof block?.text === 'string' && block.text.trim()) texts.add(block.text.trim());
    }
  }
  return texts;
}

function timedExecutionParts(prompt: any): Array<{ startSec: number; endSec: number; text: string }> {
  const beats = prompt?.plan?.videoPromptSections?.timelineBeats;
  if (Array.isArray(beats)) {
    return beats.flatMap((beat: any) => Number.isFinite(Number(beat?.startSec)) && Number.isFinite(Number(beat?.endSec)) && typeof beat?.execution === 'string'
      ? [{ startSec: Number(beat.startSec), endSec: Number(beat.endSec), text: beat.execution }]
      : []);
  }
  const execution = String(prompt?.plan?.videoPromptSections?.shotExecution || '');
  const matches = [...execution.matchAll(/(?:^|[\n。])\s*(\d+(?:\.\d+)?)\s*[-–—~至]\s*(\d+(?:\.\d+)?)\s*秒[^：:]*[：:]/gu)];
  return matches.map((match, index) => ({
    startSec: Number(match[1]),
    endSec: Number(match[2]),
    text: execution.slice((match.index || 0) + match[0].length, matches[index + 1]?.index ?? execution.length),
  }));
}

export function buildFinalSubtitleCues(input: {
  ideaScript: any;
  videoPrompts: any[];
  segmentDurations: Array<{ segmentKey: string; durationSec: number }>;
  totalDurationSec: number;
}): FinalSubtitleCue[] {
  const approved = approvedSubtitleTexts(input.ideaScript);
  const offsets = new Map<string, number>();
  let offset = 0;
  for (const segment of input.segmentDurations) {
    offsets.set(String(segment.segmentKey), offset);
    offset += Number(segment.durationSec) || 0;
  }
  const cues: FinalSubtitleCue[] = [];
  for (const prompt of Array.isArray(input.videoPrompts) ? input.videoPrompts : []) {
    const segmentKey = String(prompt?.segmentKey || '');
    const segmentOffset = offsets.get(segmentKey);
    if (segmentOffset === undefined) continue;
    for (const part of timedExecutionParts(prompt)) {
      for (const text of approved) {
        if (!part.text.includes(text)) continue;
        cues.push({ startSec: segmentOffset + part.startSec, endSec: segmentOffset + part.endSec, text, source: segmentKey });
      }
    }
  }
  for (const scene of Array.isArray(input.ideaScript?.scenes) ? input.ideaScript.scenes : []) {
    for (const block of Array.isArray(scene?.blocks) ? scene.blocks : []) {
      if (block?.type !== 'transition') continue;
      const title = /字幕浮现[：:]?[“"]([^”"]+)[”"]/u.exec(String(block.text || ''))?.[1]?.trim();
      if (title) cues.push({ startSec: Math.max(0, input.totalDurationSec - 1.5), endSec: Math.max(0, input.totalDurationSec - 0.08), text: title, source: 'ending-title' });
    }
  }
  return cues
    .filter((cue, index, all) => cue.endSec > cue.startSec && all.findIndex((item) => item.startSec === cue.startSec && item.endSec === cue.endSec && item.text === cue.text) === index)
    .sort((a, b) => a.startSec - b.startSec);
}

function srtTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
  const secs = Math.floor(milliseconds % 60_000 / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function renderFinalSrt(cues: FinalSubtitleCue[]): string {
  return `${cues.map((cue, index) => `${index + 1}\n${srtTime(cue.startSec)} --> ${srtTime(cue.endSec)}\n${cue.text}`).join('\n\n')}\n`;
}

export function ffmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').replace(/:/gu, '\\:').replace(/'/gu, "\\'");
}
