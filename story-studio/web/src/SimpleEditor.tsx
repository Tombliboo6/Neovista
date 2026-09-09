import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import "./simple-editor.css";

export type EditorAssetKind = "video" | "audio" | "image" | "subtitle" | "final";
export type EditorAsset = {
  id: string;
  kind: EditorAssetKind;
  title: string;
  mediaUrl?: string;
  durationSec?: number;
  source: "director" | "free" | "import" | "postproduction";
  segmentKey?: string;
  familyKey?: string;
  version?: number;
  createdAt?: string;
};
export type EditorClip = {
  id: string;
  assetId: string;
  title: string;
  mediaUrl: string;
  sourceInSec: number;
  sourceOutSec: number;
  nativeVolume: number;
  transition: "cut" | "fade";
  fadeDurationSec: number;
};
export type EditorAudioClip = {
  id: string;
  assetId: string;
  title: string;
  mediaUrl: string;
  sourceInSec: number;
  sourceOutSec: number;
  timelineStartSec: number;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
};
export type EditorSubtitle = { id: string; text: string; startSec: number; endSec: number; enabled: boolean };
export type EditorRenderResult = {
  status: "running" | "complete" | "failed";
  filename?: string;
  outputPath?: string;
  mediaUrl?: string;
  manifestPath?: string;
  subtitlePath?: string;
  durationSec?: number;
  clipCount?: number;
  audioClipCount?: number;
  subtitleCount?: number;
  error?: string;
  createdAt?: string;
};
export type EditorState = {
  importedAssets: EditorAsset[];
  clips: EditorClip[];
  audioClips: EditorAudioClip[];
  nativeVolume: number;
  musicAssetId?: string;
  musicMediaUrl?: string;
  musicVolume: number;
  musicFadeInSec: number;
  musicFadeOutSec: number;
  subtitles: EditorSubtitle[];
  renders: EditorRenderResult[];
  renderStatus: "idle" | "running" | "failed";
  renderError?: string;
};

export const defaultEditorState = (): EditorState => ({
  importedAssets: [], clips: [], audioClips: [], nativeVolume: 1, musicVolume: 0.28, musicFadeInSec: 1, musicFadeOutSec: 2,
  subtitles: [], renders: [], renderStatus: "idle",
});

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

export function normalizeEditorState(value?: Partial<EditorState>): EditorState {
  const defaults = defaultEditorState();
  const importedAssets = Array.isArray(value?.importedAssets) ? value.importedAssets.filter((asset): asset is EditorAsset => Boolean(asset && typeof asset.id === "string" && typeof asset.title === "string" && ["video", "audio", "image", "subtitle", "final"].includes(asset.kind))).slice(0, 2_000) : [];
  const clips = Array.isArray(value?.clips) ? value.clips.filter((clip): clip is EditorClip => Boolean(clip && typeof clip.id === "string" && typeof clip.mediaUrl === "string")).slice(0, 500).map((clip) => {
    const sourceInSec = finite(clip.sourceInSec, 0, 0, 86_400);
    return { ...clip, title: String(clip.title || "未命名片段").slice(0, 160), sourceInSec, sourceOutSec: Math.max(sourceInSec + 0.04, finite(clip.sourceOutSec, sourceInSec + 5, sourceInSec + 0.04, 86_400)), nativeVolume: finite(clip.nativeVolume, 1, 0, 2), transition: (clip.transition === "fade" ? "fade" : "cut") as EditorClip["transition"], fadeDurationSec: finite(clip.fadeDurationSec, 0.25, 0.05, 3) };
  }) : [];
  const audioClips = Array.isArray(value?.audioClips) ? value.audioClips.filter((clip): clip is EditorAudioClip => Boolean(clip && typeof clip.id === "string" && typeof clip.mediaUrl === "string")).slice(0, 500).map((clip) => {
    const sourceInSec = finite(clip.sourceInSec, 0, 0, 86_400);
    const sourceOutSec = Math.max(sourceInSec + 0.04, finite(clip.sourceOutSec, sourceInSec + 5, sourceInSec + 0.04, 86_400));
    return { ...clip, title: String(clip.title || "未命名音频").slice(0, 160), sourceInSec, sourceOutSec, timelineStartSec: finite(clip.timelineStartSec, 0, 0, 86_400), volume: finite(clip.volume, 0.28, 0, 2), fadeInSec: finite(clip.fadeInSec, 0, 0, 30), fadeOutSec: finite(clip.fadeOutSec, 0, 0, 30) };
  }) : [];
  const subtitles = Array.isArray(value?.subtitles) ? value.subtitles.filter((cue): cue is EditorSubtitle => Boolean(cue && typeof cue.id === "string")).slice(0, 2_000).map((cue) => ({ id: cue.id.slice(0, 200), text: String(cue.text || "").slice(0, 2_000), startSec: finite(cue.startSec, 0, 0, 86_400), endSec: finite(cue.endSec, 1, 0.04, 86_400), enabled: cue.enabled !== false })) : [];
  const renders = Array.isArray(value?.renders) ? value.renders.filter((render): render is EditorRenderResult => Boolean(render && ["running", "complete", "failed"].includes(render.status))).slice(-30) : [];
  return {
    importedAssets, clips, audioClips,
    nativeVolume: finite(value?.nativeVolume, defaults.nativeVolume, 0, 2),
    musicAssetId: typeof value?.musicAssetId === "string" ? value.musicAssetId.slice(0, 300) : undefined,
    musicMediaUrl: typeof value?.musicMediaUrl === "string" ? value.musicMediaUrl.slice(0, 20_000) : undefined,
    musicVolume: finite(value?.musicVolume, defaults.musicVolume, 0, 2),
    musicFadeInSec: finite(value?.musicFadeInSec, defaults.musicFadeInSec, 0, 30),
    musicFadeOutSec: finite(value?.musicFadeOutSec, defaults.musicFadeOutSec, 0, 30),
    subtitles, renders,
    renderStatus: value?.renderStatus === "running" ? "failed" : value?.renderStatus === "failed" ? "failed" : "idle",
    renderError: value?.renderStatus === "running" ? "上次合成因页面关闭而中断；时间线和已有成片仍已保留。" : typeof value?.renderError === "string" ? value.renderError.slice(0, 4_000) : undefined,
  };
}

function newId(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function durationOf(clip: Pick<EditorClip, "sourceInSec" | "sourceOutSec">) { return Math.max(0.04, clip.sourceOutSec - clip.sourceInSec); }
function timeLabel(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(safe % 60)).padStart(2, "0")}.${Math.floor((safe % 1) * 10)}`;
}

export function SimpleEditor({ state, assets, onChange, onImportMedia, onRender, onViewImage }: {
  state: EditorState;
  assets: EditorAsset[];
  onChange: (next: EditorState) => void;
  onImportMedia: (file: File) => Promise<EditorAsset>;
  onRender: () => Promise<void>;
  onViewImage?: (src: string, title: string) => void;
}) {
  const [tab, setTab] = useState<"all" | EditorAssetKind>("all");
  const [query, setQuery] = useState("");
  const [selectedClipId, setSelectedClipId] = useState(state.clips[0]?.id || "");
  const [selectedAudioClipId, setSelectedAudioClipId] = useState(state.audioClips[0]?.id || "");
  const [inspectorKind, setInspectorKind] = useState<"video" | "audio">("video");
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingPreviewRef = useRef<{ clipId: string; sourceTime: number; autoplay: boolean } | null>(null);
  const switchingClipRef = useRef(false);
  const trimDragRef = useRef<{ pointerId: number; clipId: string; edge: "start" | "end"; startX: number; sourceInSec: number; sourceOutSec: number; secondsPerPixel: number; sourceMaxSec: number } | null>(null);
  const audioTrimDragRef = useRef<{ pointerId: number; clipId: string; edge: "start" | "end"; startX: number; sourceInSec: number; sourceOutSec: number; timelineStartSec: number; secondsPerPixel: number; sourceMaxSec: number } | null>(null);
  const suppressClipClickRef = useRef(false);
  const selectedClip = state.clips.find((clip) => clip.id === selectedClipId) || state.clips[0];
  const selectedAudioClip = state.audioClips.find((clip) => clip.id === selectedAudioClipId) || state.audioClips[0];
  const totalDuration = state.clips.reduce((sum, clip) => sum + durationOf(clip), 0);
  const filteredAssets = assets.filter((asset) => (tab === "all" || asset.kind === tab) && (!query.trim() || `${asset.title} ${asset.segmentKey || ""}`.toLowerCase().includes(query.trim().toLowerCase())));
  const latestRender = state.renders.at(-1);
  const clipRanges = useMemo(() => {
    let cursor = 0;
    return state.clips.map((clip) => { const start = cursor; cursor += durationOf(clip); return { clip, start, end: cursor }; });
  }, [state.clips]);
  const audioRanges = useMemo(() => state.audioClips.map((clip) => ({ clip, start: clip.timelineStartSec, end: clip.timelineStartSec + durationOf(clip) })), [state.audioClips]);
  const activeAudioRange = audioRanges.find((item) => playheadSec >= item.start && playheadSec < item.end);
  const selectedRange = clipRanges.find((item) => item.clip.id === selectedClip?.id);
  const splitTargetRange = clipRanges.find((item) => playheadSec > item.start + 0.04 && playheadSec < item.end - 0.04);
  const audioSplitTargetRange = audioRanges.find((item) => playheadSec > item.start + 0.04 && playheadSec < item.end - 0.04);
  const previewAudioClip = activeAudioRange?.clip;
  const previewAudioUrl = previewAudioClip?.mediaUrl || (!state.audioClips.length ? state.musicMediaUrl : undefined);
  useEffect(() => {
    if (!state.clips.length) {
      if (selectedClipId) setSelectedClipId("");
      return;
    }
    if (!state.clips.some((clip) => clip.id === selectedClipId)) setSelectedClipId(state.clips[0].id);
  }, [selectedClipId, state.clips]);
  useEffect(() => {
    if (!state.audioClips.length) {
      if (selectedAudioClipId) setSelectedAudioClipId("");
      return;
    }
    if (!state.audioClips.some((clip) => clip.id === selectedAudioClipId)) setSelectedAudioClipId(state.audioClips[0].id);
  }, [selectedAudioClipId, state.audioClips]);
  useEffect(() => setPreviewSize(null), [selectedClip?.id]);
  useEffect(() => {
    if (playheadSec > totalDuration) setPlayheadSec(totalDuration);
  }, [playheadSec, totalDuration]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedClip || video.readyState < 1 || isPlaying) return;
    if (video.currentTime >= selectedClip.sourceInSec && video.currentTime < selectedClip.sourceOutSec) return;
    const localTime = selectedRange ? Math.max(0, Math.min(durationOf(selectedClip) - 0.001, playheadSec - selectedRange.start)) : 0;
    video.currentTime = selectedClip.sourceInSec + localTime;
  }, [isPlaying, playheadSec, selectedClip?.id, selectedClip?.sourceInSec, selectedClip?.sourceOutSec, selectedRange?.start]);

  const patchState = (patch: Partial<EditorState>) => onChange({ ...state, ...patch });
  const patchClip = (id: string, patch: Partial<EditorClip>) => patchState({ clips: state.clips.map((clip) => clip.id === id ? { ...clip, ...patch } : clip) });
  const patchAudioClip = (id: string, patch: Partial<EditorAudioClip>) => patchState({ audioClips: state.audioClips.map((clip) => clip.id === id ? { ...clip, ...patch } : clip) });
  const addAsset = (asset: EditorAsset) => {
    if (!asset.mediaUrl) return;
    if (asset.kind === "audio") {
      const timelineStartSec = totalDuration > 0 ? Math.min(playheadSec, Math.max(0, totalDuration - 0.04)) : 0;
      const availableDuration = totalDuration > 0 ? Math.max(0.04, totalDuration - timelineStartSec) : Math.max(0.04, asset.durationSec || 5);
      const clip: EditorAudioClip = { id: newId("audio"), assetId: asset.id, title: asset.title, mediaUrl: asset.mediaUrl, sourceInSec: 0, sourceOutSec: Math.max(0.04, Math.min(asset.durationSec || availableDuration, availableDuration)), timelineStartSec, volume: 0.28, fadeInSec: 0, fadeOutSec: 0 };
      patchState({ audioClips: [...state.audioClips, clip], musicAssetId: undefined, musicMediaUrl: undefined });
      setSelectedAudioClipId(clip.id); setInspectorKind("audio"); return;
    }
    if (asset.kind !== "video" && asset.kind !== "final") return;
    const clip: EditorClip = { id: newId("clip"), assetId: asset.id, title: asset.title, mediaUrl: asset.mediaUrl, sourceInSec: 0, sourceOutSec: Math.max(0.5, asset.durationSec || 5), nativeVolume: 1, transition: "cut", fadeDurationSec: 0.25 };
    patchState({ clips: [...state.clips, clip] }); setSelectedClipId(clip.id);
  };
  const buildDirectorTimeline = () => {
    const directorVideos = assets.filter((asset) => asset.kind === "video" && asset.source === "director" && asset.mediaUrl);
    const clips = directorVideos.map((asset) => ({ id: newId("clip"), assetId: asset.id, title: asset.title, mediaUrl: asset.mediaUrl!, sourceInSec: 0, sourceOutSec: Math.max(0.5, asset.durationSec || 5), nativeVolume: 1, transition: "cut" as const, fadeDurationSec: 0.25 }));
    patchState({ clips }); setSelectedClipId(clips[0]?.id || ""); setPlayheadSec(0);
  };
  const moveClip = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return;
    const next = [...state.clips]; const from = next.findIndex((clip) => clip.id === fromId); const to = next.findIndex((clip) => clip.id === toId);
    if (from < 0 || to < 0) return;
    const [clip] = next.splice(from, 1); next.splice(to, 0, clip); patchState({ clips: next });
  };
  const moveAudioClip = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return;
    const ordered = [...state.audioClips].sort((a, b) => a.timelineStartSec - b.timelineStartSec);
    const from = ordered.findIndex((clip) => clip.id === fromId); const to = ordered.findIndex((clip) => clip.id === toId);
    if (from < 0 || to < 0) return;
    const [clip] = ordered.splice(from, 1); ordered.splice(to, 0, clip);
    let cursor = 0;
    patchState({ audioClips: ordered.map((item) => { const next = { ...item, timelineStartSec: cursor }; cursor += durationOf(item); return next; }) });
  };
  const audioVolumeAt = (time: number) => {
    const range = audioRanges.find((item) => time >= item.start && time < item.end);
    if (range) {
      const local = time - range.start;
      const remaining = range.end - time;
      const fadeIn = range.clip.fadeInSec > 0 ? Math.min(1, local / range.clip.fadeInSec) : 1;
      const fadeOut = range.clip.fadeOutSec > 0 ? Math.min(1, remaining / range.clip.fadeOutSec) : 1;
      return Math.max(0, Math.min(1, range.clip.volume * Math.min(fadeIn, fadeOut)));
    }
    const fadeIn = state.musicFadeInSec > 0 ? Math.min(1, time / state.musicFadeInSec) : 1;
    const remaining = Math.max(0, totalDuration - time);
    const fadeOut = state.musicFadeOutSec > 0 ? Math.min(1, remaining / state.musicFadeOutSec) : 1;
    return Math.max(0, Math.min(1, state.musicVolume * Math.min(fadeIn, fadeOut)));
  };
  const syncMusic = (time: number, playing: boolean) => {
    const audio = audioRef.current;
    if (!audio) return;
    const range = audioRanges.find((item) => time >= item.start && time < item.end);
    const sourceTime = range ? range.clip.sourceInSec + Math.max(0, time - range.start) : time;
    if (audio.readyState >= 1 && Math.abs(audio.currentTime - sourceTime) > 0.12) audio.currentTime = Math.max(0, Math.min(sourceTime, Number.isFinite(audio.duration) ? audio.duration : sourceTime));
    audio.volume = audioVolumeAt(time);
    if (playing) void audio.play().catch(() => undefined); else audio.pause();
  };
  const seekGlobal = (time: number, autoplay = false) => {
    const safe = Math.max(0, Math.min(totalDuration, time)); setPlayheadSec(safe);
    const range = clipRanges.find((item) => safe < item.end) || clipRanges.at(-1);
    if (!range) return;
    const sourceTime = Math.min(range.clip.sourceOutSec - 0.001, range.clip.sourceInSec + Math.max(0, safe - range.start));
    syncMusic(safe, autoplay);
    const video = videoRef.current;
    if (selectedClip?.id !== range.clip.id || !video) {
      switchingClipRef.current = true;
      pendingPreviewRef.current = { clipId: range.clip.id, sourceTime, autoplay };
      setSelectedClipId(range.clip.id);
      return;
    }
    if (range.clip.id !== selectedClipId) setSelectedClipId(range.clip.id);
    video.currentTime = sourceTime;
    video.volume = Math.max(0, Math.min(1, state.nativeVolume * range.clip.nativeVolume));
    if (autoplay) void video.play().catch(() => setIsPlaying(false));
  };
  const finishCurrentClip = () => {
    const range = clipRanges.find((item) => item.clip.id === selectedClipId);
    if (!range || pendingPreviewRef.current) return;
    const next = clipRanges[clipRanges.indexOf(range) + 1];
    if (next) {
      switchingClipRef.current = true;
      pendingPreviewRef.current = { clipId: next.clip.id, sourceTime: next.clip.sourceInSec, autoplay: isPlaying };
      setPlayheadSec(next.start);
      setSelectedClipId(next.clip.id);
      return;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = Math.max(range.clip.sourceInSec, range.clip.sourceOutSec - 0.001);
    }
    audioRef.current?.pause();
    setPlayheadSec(totalDuration);
    setIsPlaying(false);
  };
  const onVideoTime = () => {
    const range = clipRanges.find((item) => item.clip.id === selectedClipId); if (!range || !videoRef.current) return;
    const local = Math.max(0, videoRef.current.currentTime - range.clip.sourceInSec);
    const globalTime = Math.min(range.end, range.start + local);
    setPlayheadSec(globalTime);
    videoRef.current.volume = Math.max(0, Math.min(1, state.nativeVolume * range.clip.nativeVolume));
    if (audioRef.current) {
      const audioRange = audioRanges.find((item) => globalTime >= item.start && globalTime < item.end);
      const audioSourceTime = audioRange ? audioRange.clip.sourceInSec + Math.max(0, globalTime - audioRange.start) : globalTime;
      audioRef.current.volume = audioVolumeAt(globalTime);
      if (audioRef.current.readyState >= 1 && Math.abs(audioRef.current.currentTime - audioSourceTime) > 0.35) audioRef.current.currentTime = audioSourceTime;
    }
    if (videoRef.current.currentTime >= range.clip.sourceOutSec - 0.03) finishCurrentClip();
  };
  useEffect(() => {
    if (!isPlaying) return;
    let animationFrame = 0;
    const updatePlaybackFrame = () => {
      const video = videoRef.current;
      const range = clipRanges.find((item) => item.clip.id === selectedClipId);
      if (video && range && !pendingPreviewRef.current) {
        if (video.currentTime >= range.clip.sourceOutSec - 0.008) {
          finishCurrentClip();
          return;
        } else {
          const local = Math.max(0, video.currentTime - range.clip.sourceInSec);
          const globalTime = Math.min(range.end, range.start + local);
          setPlayheadSec(globalTime);
          video.volume = Math.max(0, Math.min(1, state.nativeVolume * range.clip.nativeVolume));
          if (audioRef.current) {
            const audioRange = audioRanges.find((item) => globalTime >= item.start && globalTime < item.end);
            const audioSourceTime = audioRange ? audioRange.clip.sourceInSec + Math.max(0, globalTime - audioRange.start) : globalTime;
            audioRef.current.volume = audioVolumeAt(globalTime);
            if (audioRef.current.readyState >= 1 && Math.abs(audioRef.current.currentTime - audioSourceTime) > 0.12) audioRef.current.currentTime = audioSourceTime;
          }
        }
      }
      animationFrame = requestAnimationFrame(updatePlaybackFrame);
    };
    animationFrame = requestAnimationFrame(updatePlaybackFrame);
    return () => cancelAnimationFrame(animationFrame);
  }, [audioRanges, clipRanges, isPlaying, selectedClipId, state.nativeVolume]);
  const onPreviewMetadata = () => {
    const video = videoRef.current;
    if (!video || !selectedClip) return;
    setPreviewSize({ width: video.videoWidth, height: video.videoHeight });
    const pending = pendingPreviewRef.current?.clipId === selectedClip.id ? pendingPreviewRef.current : null;
    const fallbackTime = selectedRange ? selectedClip.sourceInSec + Math.max(0, playheadSec - selectedRange.start) : selectedClip.sourceInSec;
    video.currentTime = Math.max(selectedClip.sourceInSec, Math.min(selectedClip.sourceOutSec - 0.001, pending?.sourceTime ?? fallbackTime));
    video.volume = Math.max(0, Math.min(1, state.nativeVolume * selectedClip.nativeVolume));
    if (Number.isFinite(video.duration) && selectedClip.sourceOutSec > video.duration) patchClip(selectedClip.id, { sourceOutSec: Math.max(selectedClip.sourceInSec + 0.04, video.duration) });
    pendingPreviewRef.current = null;
    switchingClipRef.current = false;
    if (pending?.autoplay || isPlaying) void video.play().catch(() => setIsPlaying(false));
  };
  const onAudioMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const sourceTime = activeAudioRange ? activeAudioRange.clip.sourceInSec + Math.max(0, playheadSec - activeAudioRange.start) : playheadSec;
    audio.currentTime = Math.max(0, Math.min(sourceTime, Number.isFinite(audio.duration) ? audio.duration : sourceTime));
    audio.volume = audioVolumeAt(playheadSec);
    if (activeAudioRange && Number.isFinite(audio.duration) && activeAudioRange.clip.sourceOutSec > audio.duration) patchAudioClip(activeAudioRange.clip.id, { sourceOutSec: Math.max(activeAudioRange.clip.sourceInSec + 0.04, audio.duration) });
    if (isPlaying) void audio.play().catch(() => undefined);
  };
  const toggleTimelinePlayback = () => {
    if (!state.clips.length) return;
    if (isPlaying) {
      videoRef.current?.pause(); audioRef.current?.pause(); setIsPlaying(false); return;
    }
    setIsPlaying(true);
    seekGlobal(playheadSec >= totalDuration - 0.01 ? 0 : playheadSec, true);
  };
  const seekFromRuler = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seekGlobal(totalDuration * Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))), isPlaying);
  };
  const splitClipAtPlayhead = () => {
    if (!splitTargetRange) return;
    const index = state.clips.findIndex((clip) => clip.id === splitTargetRange.clip.id);
    if (index < 0) return;
    const sourceTime = splitTargetRange.clip.sourceInSec + (playheadSec - splitTargetRange.start);
    const rightClip = { ...splitTargetRange.clip, id: newId("clip"), sourceInSec: sourceTime };
    const next = [...state.clips];
    next.splice(index, 1, { ...splitTargetRange.clip, sourceOutSec: sourceTime }, rightClip);
    pendingPreviewRef.current = { clipId: rightClip.id, sourceTime, autoplay: isPlaying };
    switchingClipRef.current = true;
    patchState({ clips: next });
    setSelectedClipId(rightClip.id); setInspectorKind("video");
  };
  const splitAudioAtPlayhead = () => {
    if (!audioSplitTargetRange) return;
    const index = state.audioClips.findIndex((clip) => clip.id === audioSplitTargetRange.clip.id);
    if (index < 0) return;
    const sourceTime = audioSplitTargetRange.clip.sourceInSec + (playheadSec - audioSplitTargetRange.start);
    const rightClip = { ...audioSplitTargetRange.clip, id: newId("audio"), sourceInSec: sourceTime, timelineStartSec: playheadSec };
    const next = [...state.audioClips];
    next.splice(index, 1, { ...audioSplitTargetRange.clip, sourceOutSec: sourceTime }, rightClip);
    patchState({ audioClips: next }); setSelectedAudioClipId(rightClip.id); setInspectorKind("audio");
  };
  const onClipPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, clip: EditorClip) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const edge = localX <= 12 ? "start" : localX >= rect.width - 12 ? "end" : null;
    if (!edge) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    suppressClipClickRef.current = false;
    const sourceAsset = assets.find((asset) => asset.id === clip.assetId);
    trimDragRef.current = { pointerId: event.pointerId, clipId: clip.id, edge, startX: event.clientX, sourceInSec: clip.sourceInSec, sourceOutSec: clip.sourceOutSec, secondsPerPixel: durationOf(clip) / Math.max(1, rect.width), sourceMaxSec: Math.max(clip.sourceOutSec, sourceAsset?.durationSec || 0) };
    setSelectedClipId(clip.id); setInspectorKind("video");
  };
  const onClipPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = trimDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const delta = (event.clientX - drag.startX) * drag.secondsPerPixel;
    if (Math.abs(event.clientX - drag.startX) > 2) suppressClipClickRef.current = true;
    if (drag.edge === "start") patchClip(drag.clipId, { sourceInSec: Math.max(0, Math.min(drag.sourceOutSec - 0.04, drag.sourceInSec + delta)) });
    else patchClip(drag.clipId, { sourceOutSec: Math.max(drag.sourceInSec + 0.04, Math.min(drag.sourceMaxSec, drag.sourceOutSec + delta)) });
  };
  const onClipPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (trimDragRef.current?.pointerId !== event.pointerId) return;
    trimDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onAudioPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, clip: EditorAudioClip) => {
    const rect = event.currentTarget.getBoundingClientRect(); const localX = event.clientX - rect.left;
    const edge = localX <= 12 ? "start" : localX >= rect.width - 12 ? "end" : null;
    if (!edge) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); suppressClipClickRef.current = false;
    const sourceAsset = assets.find((asset) => asset.id === clip.assetId);
    audioTrimDragRef.current = { pointerId: event.pointerId, clipId: clip.id, edge, startX: event.clientX, sourceInSec: clip.sourceInSec, sourceOutSec: clip.sourceOutSec, timelineStartSec: clip.timelineStartSec, secondsPerPixel: durationOf(clip) / Math.max(1, rect.width), sourceMaxSec: Math.max(clip.sourceOutSec, sourceAsset?.durationSec || 0) };
    setSelectedAudioClipId(clip.id); setInspectorKind("audio");
  };
  const onAudioPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = audioTrimDragRef.current; if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault(); const delta = (event.clientX - drag.startX) * drag.secondsPerPixel;
    if (Math.abs(event.clientX - drag.startX) > 2) suppressClipClickRef.current = true;
    if (drag.edge === "start") {
      const sourceInSec = Math.max(0, Math.min(drag.sourceOutSec - 0.04, drag.sourceInSec + delta));
      patchAudioClip(drag.clipId, { sourceInSec, timelineStartSec: Math.max(0, drag.timelineStartSec + sourceInSec - drag.sourceInSec) });
    } else patchAudioClip(drag.clipId, { sourceOutSec: Math.max(drag.sourceInSec + 0.04, Math.min(drag.sourceMaxSec, drag.sourceOutSec + delta)) });
  };
  const onAudioPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (audioTrimDragRef.current?.pointerId !== event.pointerId) return;
    audioTrimDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const moveSubtitle = (id: string, direction: -1 | 1) => {
    const next = [...state.subtitles]; const index = next.findIndex((cue) => cue.id === id); const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]]; patchState({ subtitles: next });
  };
  const splitSubtitle = (cue: EditorSubtitle) => {
    if (playheadSec <= cue.startSec + 0.04 || playheadSec >= cue.endSec - 0.04) return;
    const index = state.subtitles.findIndex((item) => item.id === cue.id); if (index < 0) return;
    const next = [...state.subtitles]; next.splice(index, 1, { ...cue, endSec: playheadSec }, { ...cue, id: newId("subtitle"), startSec: playheadSec }); patchState({ subtitles: next });
  };
  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files || [])]; if (!files.length) return;
    setImportBusy(true);
    try { for (const file of files) await onImportMedia(file); }
    finally { setImportBusy(false); event.target.value = ""; }
  };

  return <section className="simple-editor" aria-label="剪辑台">
    <aside className="editor-library">
      <div className="editor-panel-heading"><div><small>PROJECT MEDIA</small><h2>项目素材库</h2></div><button onClick={() => fileRef.current?.click()} disabled={importBusy}>{importBusy ? "导入中" : "+ 导入"}</button></div>
      <input ref={fileRef} hidden multiple type="file" accept="video/*,audio/*,image/*" onChange={(event) => void importFiles(event)} />
      <input className="editor-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索本项目素材" aria-label="搜索项目素材" />
      <div className="editor-tabs">
        {([ ["all", "全部"], ["video", "视频"], ["audio", "音频"], ["image", "图片"], ["subtitle", "字幕"], ["final", "成片"] ] as const).map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className="editor-assets">
        {filteredAssets.map((asset) => <button key={asset.id} className="editor-asset" draggable={Boolean(asset.mediaUrl) && asset.kind !== "image"} onDragStart={(event) => event.dataTransfer.setData("application/x-prism-editor-asset", asset.id)} onClick={() => { if (asset.kind === "image" && asset.mediaUrl) onViewImage?.(asset.mediaUrl, asset.title); }} onDoubleClick={() => { if (asset.kind !== "image") addAsset(asset); }}>
          <span className={`asset-thumb kind-${asset.kind}`}>
            {asset.mediaUrl && asset.kind === "image" ? <img src={asset.mediaUrl} alt="" loading="lazy" /> : asset.mediaUrl && (asset.kind === "video" || asset.kind === "final") ? <><video src={asset.mediaUrl} muted playsInline preload="metadata" onLoadedMetadata={(event) => { const video = event.currentTarget; if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.08, video.duration / 2); }} /><i aria-hidden="true">▶</i></> : asset.kind === "audio" ? "♫" : asset.kind === "subtitle" ? "字" : "▧"}
          </span>
          <span><strong>{asset.title}</strong><small>{asset.source === "director" ? "导演素材" : asset.source === "free" ? "自由画布" : asset.source === "import" ? "本地导入" : "后期结果"}{asset.version ? ` · V${asset.version}` : ""}{asset.durationSec ? ` · ${timeLabel(asset.durationSec)}` : ""}</small></span>
        </button>)}
        {!filteredAssets.length && <div className="editor-empty compact">当前分类暂无素材</div>}
      </div>
    </aside>

    <div className="editor-main">
      <div className="editor-preview-row">
        <div className="editor-preview">
          <div className="preview-stage">
            {selectedClip ? <div className="preview-media-shell" style={previewSize?.width && previewSize.height ? { aspectRatio: `${previewSize.width} / ${previewSize.height}` } : undefined}><video ref={videoRef} src={selectedClip.mediaUrl} playsInline preload="auto" onClick={toggleTimelinePlayback} onLoadedMetadata={onPreviewMetadata} onTimeUpdate={onVideoTime} onEnded={finishCurrentClip} onPlay={() => { setIsPlaying(true); syncMusic(playheadSec, true); }} onPause={() => { if (!switchingClipRef.current) { setIsPlaying(false); audioRef.current?.pause(); } }} /><span className="preview-source-size">时间线预览 · {previewSize?.width && previewSize.height ? `${previewSize.width} × ${previewSize.height}` : "读取中"}</span></div> : <div className="editor-empty"><strong>时间线为空</strong><span>双击视频素材，或从导演镜头建立时间线</span><button onClick={buildDirectorTimeline}>从导演镜头建立</button></div>}
          </div>
          {previewAudioUrl && <audio key={previewAudioClip?.id || "legacy-music"} ref={audioRef} data-audio-clip-id={previewAudioClip?.id || "legacy"} src={previewAudioUrl} preload="auto" onLoadedMetadata={onAudioMetadata} />}
          <div className="editor-transport"><button onClick={() => seekGlobal(0, isPlaying)}>⏮</button><button className="editor-play-toggle" onClick={toggleTimelinePlayback}>{isPlaying ? "Ⅱ 暂停" : "▶ 播放"}</button><span>{timeLabel(playheadSec)} / {timeLabel(totalDuration)}</span></div>
        </div>

        <aside className="editor-inspector">
          <div className="editor-panel-heading"><div><small>INSPECTOR</small><h2>{inspectorKind === "audio" ? "音频属性" : "视频属性"}</h2></div></div>
          {inspectorKind === "audio" && selectedAudioClip ? <>
            <label>音频名称<input value={selectedAudioClip.title} onChange={(event) => patchAudioClip(selectedAudioClip.id, { title: event.target.value })} /></label>
            <label>时间线位置（秒）<input type="number" min="0" max={Math.max(0, totalDuration - 0.04)} step="0.1" value={selectedAudioClip.timelineStartSec} onChange={(event) => patchAudioClip(selectedAudioClip.id, { timelineStartSec: Math.max(0, Math.min(Math.max(0, totalDuration - 0.04), Number(event.target.value))) })} /></label>
            <div className="editor-field-pair"><label>源入点（秒）<input type="number" min="0" step="0.1" value={selectedAudioClip.sourceInSec} onChange={(event) => patchAudioClip(selectedAudioClip.id, { sourceInSec: Math.min(Number(event.target.value), selectedAudioClip.sourceOutSec - 0.04) })} /></label><label>源出点（秒）<input type="number" min={selectedAudioClip.sourceInSec + 0.04} step="0.1" value={selectedAudioClip.sourceOutSec} onChange={(event) => patchAudioClip(selectedAudioClip.id, { sourceOutSec: Math.max(Number(event.target.value), selectedAudioClip.sourceInSec + 0.04) })} /></label></div>
            <label>片段音量 {Math.round(selectedAudioClip.volume * 100)}%<input type="range" min="0" max="2" step="0.01" value={selectedAudioClip.volume} onChange={(event) => patchAudioClip(selectedAudioClip.id, { volume: Number(event.target.value) })} /></label>
            <div className="editor-field-pair"><label>淡入（秒）<input type="number" min="0" max="30" step="0.1" value={selectedAudioClip.fadeInSec} onChange={(event) => patchAudioClip(selectedAudioClip.id, { fadeInSec: Math.max(0, Number(event.target.value)) })} /></label><label>淡出（秒）<input type="number" min="0" max="30" step="0.1" value={selectedAudioClip.fadeOutSec} onChange={(event) => patchAudioClip(selectedAudioClip.id, { fadeOutSec: Math.max(0, Number(event.target.value)) })} /></label></div>
            <div className="editor-trim-help">拖动音频片段主体调整顺序，拖动两侧裁剪；也可在指针处精确分割。</div>
            <button className="editor-danger" onClick={() => { patchState({ audioClips: state.audioClips.filter((clip) => clip.id !== selectedAudioClip.id) }); setSelectedAudioClipId(""); setInspectorKind("video"); }}>移出音频轨</button>
          </> : selectedClip ? <>
            <label>片段名称<input value={selectedClip.title} onChange={(event) => patchClip(selectedClip.id, { title: event.target.value })} /></label>
            <div className="editor-field-pair"><label>入点（秒）<input type="number" min="0" step="0.1" value={selectedClip.sourceInSec} onChange={(event) => patchClip(selectedClip.id, { sourceInSec: Math.min(Number(event.target.value), selectedClip.sourceOutSec - 0.04) })} /></label><label>出点（秒）<input type="number" min={selectedClip.sourceInSec + 0.04} step="0.1" value={selectedClip.sourceOutSec} onChange={(event) => patchClip(selectedClip.id, { sourceOutSec: Math.max(Number(event.target.value), selectedClip.sourceInSec + 0.04) })} /></label></div>
            <label>原声 {Math.round(selectedClip.nativeVolume * 100)}%<input type="range" min="0" max="2" step="0.01" value={selectedClip.nativeVolume} onChange={(event) => patchClip(selectedClip.id, { nativeVolume: Number(event.target.value) })} /></label>
            <label>衔接<select value={selectedClip.transition} onChange={(event) => patchClip(selectedClip.id, { transition: event.target.value === "fade" ? "fade" : "cut" })}><option value="cut">硬切</option><option value="fade">淡入淡出</option></select></label>
            {selectedClip.transition === "fade" && <label>淡化时长（秒）<input type="number" min="0.05" max="3" step="0.05" value={selectedClip.fadeDurationSec} onChange={(event) => patchClip(selectedClip.id, { fadeDurationSec: Number(event.target.value) })} /></label>}
            <div className="editor-trim-help">拖动时间线片段左右边缘裁剪；将指针放到片段中间可执行分割。</div>
            <button className="editor-danger" onClick={() => { patchState({ clips: state.clips.filter((clip) => clip.id !== selectedClip.id) }); setSelectedClipId(""); }}>移出时间线</button>
          </> : <div className="editor-empty compact">选择视频或音频片段后可调整时间、裁剪、音量与衔接</div>}
        </aside>
      </div>

      <div className="editor-timeline" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const asset = assets.find((item) => item.id === event.dataTransfer.getData("application/x-prism-editor-asset")); if (asset) addAsset(asset); }}>
        <div className="timeline-toolbar"><div><strong>时间线</strong><span>{state.clips.length} 段视频 · {state.audioClips.length} 段音频 · {timeLabel(totalDuration)}</span></div><div><button className="editor-split" disabled={!splitTargetRange} onClick={splitClipAtPlayhead}>✂ 分割视频</button><button className="editor-split" disabled={!audioSplitTargetRange} onClick={splitAudioAtPlayhead}>✂ 分割音频</button><button onClick={buildDirectorTimeline}>按导演镜头重建</button><button className="editor-primary" disabled={!state.clips.length || state.renderStatus === "running"} onClick={() => void onRender()}>{state.renderStatus === "running" ? "正在生成" : "生成新成片"}</button></div></div>
        <div className="timeline-ruler" onPointerDown={(event) => { if (!totalDuration || event.target !== event.currentTarget) return; event.currentTarget.setPointerCapture(event.pointerId); seekFromRuler(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromRuler(event); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}><i style={{ left: `${totalDuration ? playheadSec / totalDuration * 100 : 0}%` }} /><input className="timeline-scrubber" aria-label="时间指针" type="range" min="0" max={Math.max(0.01, totalDuration)} step="0.01" value={Math.min(playheadSec, Math.max(0.01, totalDuration))} onPointerDown={(event) => { if (!totalDuration) return; event.currentTarget.setPointerCapture(event.pointerId); seekFromRuler(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromRuler(event); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onChange={(event) => seekGlobal(Number(event.target.value), isPlaying)} disabled={!totalDuration} /><span>00:00</span><span>{timeLabel(totalDuration / 2)}</span><span>{timeLabel(totalDuration)}</span></div>
        <div className="timeline-track"><b>视频</b><div className="timeline-clips" style={{ gridTemplateColumns: state.clips.map((clip) => `${durationOf(clip)}fr`).join(" ") }}>
          {state.clips.map((clip) => <button key={clip.id} className={`timeline-clip ${selectedClip?.id === clip.id && inspectorKind === "video" ? "selected" : ""}`} draggable onPointerDown={(event) => onClipPointerDown(event, clip)} onPointerMove={onClipPointerMove} onPointerUp={onClipPointerUp} onPointerCancel={onClipPointerUp} onDragStart={(event) => { if (trimDragRef.current) event.preventDefault(); else event.dataTransfer.setData("application/x-prism-editor-clip", clip.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event: DragEvent<HTMLButtonElement>) => { event.stopPropagation(); moveClip(event.dataTransfer.getData("application/x-prism-editor-clip"), clip.id); }} onClick={() => { if (trimDragRef.current || suppressClipClickRef.current) { suppressClipClickRef.current = false; return; } setInspectorKind("video"); const range = clipRanges.find((item) => item.clip.id === clip.id); if (range) seekGlobal(range.start, isPlaying); }} title="拖动左右边缘裁剪；拖动片段主体可排序"><span className="clip-trim-handle start" aria-hidden="true" /><strong>{clip.title}</strong><small>{timeLabel(durationOf(clip))} · {clip.transition === "fade" ? "淡化" : "硬切"}</small><span className="clip-trim-handle end" aria-hidden="true" /></button>)}
          {!state.clips.length && <span className="timeline-drop-hint">将视频拖到这里</span>}
        </div></div>
        <div className="timeline-track audio"><b>原声</b><div className="timeline-audio-control"><label>总音量 {Math.round(state.nativeVolume * 100)}%<input type="range" min="0" max="2" step="0.01" value={state.nativeVolume} onChange={(event) => patchState({ nativeVolume: Number(event.target.value) })} /></label></div></div>
        <div className="timeline-track audio-clips"><b>音频</b><div className="timeline-audio-clips">
          {state.audioClips.map((clip) => <button key={clip.id} className={`timeline-audio-clip ${selectedAudioClip?.id === clip.id && inspectorKind === "audio" ? "selected" : ""}`} style={{ left: `${totalDuration ? clip.timelineStartSec / totalDuration * 100 : 0}%`, width: `${totalDuration ? Math.max(1.5, Math.min(100, durationOf(clip) / totalDuration * 100)) : 100}%` }} draggable onPointerDown={(event) => onAudioPointerDown(event, clip)} onPointerMove={onAudioPointerMove} onPointerUp={onAudioPointerUp} onPointerCancel={onAudioPointerUp} onDragStart={(event) => { if (audioTrimDragRef.current) event.preventDefault(); else event.dataTransfer.setData("application/x-prism-editor-audio", clip.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event: DragEvent<HTMLButtonElement>) => { event.stopPropagation(); moveAudioClip(event.dataTransfer.getData("application/x-prism-editor-audio"), clip.id); }} onClick={() => { if (audioTrimDragRef.current || suppressClipClickRef.current) { suppressClipClickRef.current = false; return; } setSelectedAudioClipId(clip.id); setInspectorKind("audio"); seekGlobal(clip.timelineStartSec, isPlaying); }} title="拖动主体调整顺序；拖动左右边缘裁剪"><span className="clip-trim-handle start" aria-hidden="true" /><strong>{clip.title}</strong><small>{timeLabel(durationOf(clip))} · 音量{Math.round(clip.volume * 100)}%</small><span className="clip-trim-handle end" aria-hidden="true" /></button>)}
          {!state.audioClips.length && <span className="timeline-drop-hint">双击音频素材或拖到时间线</span>}
        </div></div>
        <div className="timeline-track subtitles"><b>字幕</b><div className="subtitle-lane"><button onClick={() => patchState({ subtitles: [...state.subtitles, { id: newId("subtitle"), text: "新字幕", startSec: playheadSec, endSec: Math.min(totalDuration || playheadSec + 2, playheadSec + 2), enabled: true }] })}>+ 添加字幕</button>{state.subtitles.map((cue, index) => <div key={cue.id} className={cue.enabled ? "subtitle-cue" : "subtitle-cue disabled"}><input type="checkbox" checked={cue.enabled} onChange={(event) => patchState({ subtitles: state.subtitles.map((item) => item.id === cue.id ? { ...item, enabled: event.target.checked } : item) })} /><input value={cue.text} onChange={(event) => patchState({ subtitles: state.subtitles.map((item) => item.id === cue.id ? { ...item, text: event.target.value } : item) })} /><input type="number" min="0" step="0.1" value={cue.startSec} onChange={(event) => patchState({ subtitles: state.subtitles.map((item) => item.id === cue.id ? { ...item, startSec: Number(event.target.value) } : item) })} /><span>—</span><input type="number" min="0.04" step="0.1" value={cue.endSec} onChange={(event) => patchState({ subtitles: state.subtitles.map((item) => item.id === cue.id ? { ...item, endSec: Number(event.target.value) } : item) })} /><button disabled={index === 0} title="上移" onClick={() => moveSubtitle(cue.id, -1)}>↑</button><button disabled={index === state.subtitles.length - 1} title="下移" onClick={() => moveSubtitle(cue.id, 1)}>↓</button><button disabled={playheadSec <= cue.startSec + 0.04 || playheadSec >= cue.endSec - 0.04} title="在指针处分割字幕" onClick={() => splitSubtitle(cue)}>✂</button><button title="删除字幕" onClick={() => patchState({ subtitles: state.subtitles.filter((item) => item.id !== cue.id) })}>×</button></div>)}</div></div>
        {(state.renderError || latestRender) && <div className={`editor-render-result ${state.renderError ? "failed" : ""}`}>{state.renderError ? <span>{state.renderError}</span> : latestRender?.status === "complete" ? <><span>新成片已生成 · {timeLabel(latestRender.durationSec || 0)}</span><a href={latestRender.mediaUrl} target="_blank" rel="noreferrer">打开成片 ↗</a></> : null}</div>}
      </div>
    </div>
  </section>;
}
