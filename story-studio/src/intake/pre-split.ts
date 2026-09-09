import { createHash } from 'node:crypto';

import type { NovelDocument, NovelSegment } from '../domain/contracts.js';
import { normalizeNovelText } from './normalize.ts';

export interface PreSplitOptions {
  targetCharacters?: number;
  maximumCharacters?: number;
  minimumCharacters?: number;
}

interface NormalizedPreSplitOptions {
  targetCharacters: number;
  maximumCharacters: number;
  minimumCharacters: number;
}

const DEFAULT_OPTIONS: NormalizedPreSplitOptions = {
  targetCharacters: 6_000,
  maximumCharacters: 9_000,
  minimumCharacters: 2_000
};

const CHAPTER_HEADING =
  /^(?:第[〇零一二两三四五六七八九十百千万\d]{1,12}[章回节卷部集][^\n]*|chapter\s+\d+[^\n]*)$/gimu;

export function createNovelDocument(input: {
  id: string;
  title: string;
  sourceName: string;
  language?: string;
  text: string;
  now?: string;
}): NovelDocument {
  const text = normalizeNovelText(input.text);
  const now = input.now ?? new Date().toISOString();

  if (!text) {
    throw new Error('Novel text must not be empty.');
  }

  return {
    id: input.id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    approval: 'draft',
    title: input.title,
    sourceName: input.sourceName,
    language: input.language ?? 'zh-CN',
    text,
    contentHash: sha256(text),
    characterCount: text.length
  };
}

export function preSplitNovel(
  document: Pick<NovelDocument, 'id' | 'version' | 'text'>,
  options: PreSplitOptions = {}
): NovelSegment[] {
  const normalizedText = normalizeNovelText(document.text);
  const resolvedOptions = resolveOptions(options);

  if (!normalizedText) {
    return [];
  }

  const chapterStarts = findChapterStarts(normalizedText);
  const structuralStarts = chapterStarts[0] === 0 ? chapterStarts : [0, ...chapterStarts];
  const segments: NovelSegment[] = [];

  for (let index = 0; index < structuralStarts.length; index += 1) {
    const rangeStart = structuralStarts[index];
    if (rangeStart === undefined) continue;

    const rangeEnd = structuralStarts[index + 1] ?? normalizedText.length;
    const heading = headingAt(normalizedText, rangeStart, chapterStarts);
    const chunkRanges = splitRange(normalizedText, rangeStart, rangeEnd, resolvedOptions);

    for (const [sourceStart, sourceEnd] of chunkRanges) {
      const text = normalizedText.slice(sourceStart, sourceEnd);
      const order = segments.length + 1;
      const segment: NovelSegment = {
        id: stableSegmentId(document.id, document.version, sourceStart, sourceEnd, text),
        documentId: document.id,
        documentVersion: document.version,
        order,
        sourceStart,
        sourceEnd,
        text,
        characterCount: text.length
      };

      if (heading) {
        segment.heading = heading;
      }

      segments.push(segment);
    }
  }

  return segments;
}

function resolveOptions(options: PreSplitOptions): NormalizedPreSplitOptions {
  const resolved = { ...DEFAULT_OPTIONS, ...options };

  if (
    resolved.minimumCharacters <= 0 ||
    resolved.targetCharacters < resolved.minimumCharacters ||
    resolved.maximumCharacters < resolved.targetCharacters
  ) {
    throw new Error(
      'Pre-split character limits must satisfy 0 < minimum <= target <= maximum.'
    );
  }

  return resolved;
}

function findChapterStarts(text: string): number[] {
  return [...text.matchAll(CHAPTER_HEADING)].map((match) => match.index);
}

function headingAt(text: string, rangeStart: number, chapterStarts: readonly number[]): string | undefined {
  if (!chapterStarts.includes(rangeStart)) {
    return undefined;
  }

  const lineEnd = text.indexOf('\n', rangeStart);
  return text.slice(rangeStart, lineEnd === -1 ? text.length : lineEnd).trim();
}

function splitRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  options: NormalizedPreSplitOptions
): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  let cursor = rangeStart;

  while (cursor < rangeEnd) {
    const remaining = rangeEnd - cursor;
    const end =
      remaining <= options.maximumCharacters
        ? rangeEnd
        : chooseBreak(text, cursor, rangeEnd, options);

    ranges.push([cursor, end]);
    cursor = end;
  }

  return ranges;
}

function chooseBreak(
  text: string,
  start: number,
  rangeEnd: number,
  options: NormalizedPreSplitOptions
): number {
  const lowerBound = Math.min(start + options.minimumCharacters, rangeEnd);
  const target = Math.min(start + options.targetCharacters, rangeEnd);
  const upperBound = Math.min(start + options.maximumCharacters, rangeEnd);

  for (const pattern of [/\n\n/g, /\n/g, /[。！？!?；;]/g]) {
    const candidates = findBreakCandidates(text, pattern, lowerBound, upperBound);
    if (candidates.length > 0) {
      return nearestTo(candidates, target);
    }
  }

  return upperBound;
}

function findBreakCandidates(
  text: string,
  pattern: RegExp,
  lowerBound: number,
  upperBound: number
): number[] {
  const window = text.slice(lowerBound, upperBound);
  return [...window.matchAll(pattern)].map((match) => lowerBound + match.index + match[0].length);
}

function nearestTo(candidates: readonly number[], target: number): number {
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best
  );
}

function stableSegmentId(
  documentId: string,
  documentVersion: number,
  sourceStart: number,
  sourceEnd: number,
  text: string
): string {
  const digest = sha256(`${documentId}:${documentVersion}:${sourceStart}:${sourceEnd}:${text}`).slice(0, 12);
  return `novel-segment-${documentVersion}-${sourceStart}-${sourceEnd}-${digest}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
