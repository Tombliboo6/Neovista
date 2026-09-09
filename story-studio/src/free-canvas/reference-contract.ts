export type CanvasReferencePurpose = "text" | "image" | "character" | "scene" | "style" | "first" | "video" | "audio";
export const referencePurposeLabels: Record<CanvasReferencePurpose, string> = {
  text: "文本条件", image: "图片参考", character: "角色参考", scene: "场景参考", style: "风格参考", first: "首帧", video: "视频参考", audio: "音频参考",
};
type Reference = { kind: string; title?: string; content?: string; mediaUrl?: string; purpose?: CanvasReferencePurpose };
type Target = { kind: string; videoSettings?: { mode?: string } };
export function referencePurposes(source: string, target: string): CanvasReferencePurpose[] {
  if (source === "text" || source === "director") return ["text"];
  if (source === "image" && (target === "text" || target === "director")) return ["text"];
  if (source === "image") return target === "audio" ? [] : target === "video" ? ["image", "character", "scene", "style", "first"] : ["image", "character", "scene", "style"];
  if (source === "video") return target === "video" ? ["video"] : [];
  if (source === "audio") return target === "video" ? ["audio"] : [];
  return [];
}
export function referenceInputError(target: Target, references: Reference[], submitting = false): string {
  if (submitting && references.length > (target.kind === "audio" ? 20 : 30)) return "参考输入超出本次请求上限，请减少连线后提交。";
  for (const reference of references) {
    if (!reference || typeof reference !== "object") return "参考输入格式无效，请重新连接。";
    const allowed = referencePurposes(reference.kind, target.kind);
    if (!allowed.length || (reference.purpose && !allowed.includes(reference.purpose))) return `“${reference.title || "上游节点"}”的输入用途与当前节点不兼容，请调整连线。`;
    if (submitting && reference.kind !== "text" && reference.kind !== "director" && (typeof reference.mediaUrl !== "string" || !reference.mediaUrl.trim())) return `“${reference.title || "上游节点"}”还没有媒体结果，请先完成或移除该引用。`;
  }
  if (target.kind === "video") {
    const media = references.filter(r => r.kind !== "text" && r.kind !== "director");
    const mode = target.videoSettings?.mode || "auto";
    if (media.filter(r => r.kind === "image").length > 9 || media.filter(r => r.kind === "video").length > 3 || media.filter(r => r.kind === "audio").length > 3) return "H3全能参考最多接受9张图片、3段视频和3段独立音频。";
    if (mode === "reference" && media.some(r => r.purpose === "first")) return "首帧用途需要自动或首帧模式，请调整生成模式或输入用途。";
    if (mode === "text" && media.length) return "文生视频模式只接受文本条件，请调整模式或移除媒体连线。";
    if ((mode === "first" || media.some(r => r.purpose === "first")) && (media.length !== 1 || media[0].kind !== "image")) return "首帧输入需要且只接受一张图片，请调整媒体连线。";
    if (submitting && mode === "reference" && !media.length) return "全能参考模式需要至少一项媒体参考。";
  }
  return "";
}

export function referencePurposeContext(references: Reference[]): string {
  let imageIndex = 0;
  const lines = references.flatMap(reference => {
    if (reference.kind !== "image" || !reference.mediaUrl) return [];
    imageIndex += 1;
    const guidance = reference.purpose === "character" ? "用于人物身份、服装和体态一致性" : reference.purpose === "scene" ? "用于场景空间、布局与道具位置" : reference.purpose === "style" ? "用于画面风格、色彩与材质表现" : "";
    return guidance ? [`输入图片${imageIndex}：${guidance}。`] : [];
  });
  return lines.length ? `参考用途：\n${lines.join("\n")}\n\n` : "";
}
