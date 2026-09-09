import { useEffect, useMemo, useRef, useState } from "react";

type PromptFormat = "five-section-zh" | "h3-en";
type PromptMediaType = "text" | "image" | "video" | "music";
type PromptTextTarget = "synopsis" | "script" | "storyboard";
type ProviderStatus = { configured?: boolean; baseUrl?: string; model?: string; keyHint?: string; activeProfileId?: string };
type ContextItem = { id: string; group: string; title: string; content: string };
type PromptVersion = { id: string; mediaType?: PromptMediaType; textTarget?: PromptTextTarget; format: PromptFormat; source: string; result: string; createdAt: string };
type AgentMessage = { id: string; role: "user" | "agent"; content: string };

const VERSION_KEY = "prism-prompt-director-versions-v2";
const DRAFT_KEY = "prism-prompt-director-draft-v2";
const promptFormats: Array<{ id: PromptFormat; label: string; hint: string }> = [
  { id: "five-section-zh", label: "中文五段式", hint: "完整中文生产结构" },
  { id: "h3-en", label: "H3标准英文格式", hint: "英文H3执行格式" },
];
const promptMediaTypes: Array<{ id: PromptMediaType; label: string; hint: string }> = [
  { id: "text", label: "文字提示词", hint: "梗概、剧本与分镜" },
  { id: "image", label: "图片提示词", hint: "静态构图与成像" },
  { id: "video", label: "视频提示词", hint: "动作、镜头与声音" },
  { id: "music", label: "音乐提示词", hint: "风格、结构与混音" },
];
const textTargets: Array<{ id: PromptTextTarget; label: string }> = [
  { id: "synopsis", label: "故事梗概" },
  { id: "script", label: "短剧本" },
  { id: "storyboard", label: "分镜脚本" },
];

function mediaLabel(mediaType: PromptMediaType): string {
  return promptMediaTypes.find((item) => item.id === mediaType)?.label.replace("提示词", "") || "视频";
}

function readVersions(): PromptVersion[] {
  try {
    const value = JSON.parse(localStorage.getItem(VERSION_KEY) || "[]") as PromptVersion[];
    return Array.isArray(value) ? value.filter((item) => promptFormats.some((format) => format.id === item.format)).slice(0, 30) : [];
  } catch { return []; }
}

function compactText(value: unknown, limit = 2400): string {
  if (typeof value === "string") return value.trim().slice(0, limit);
  if (value == null) return "";
  try { return JSON.stringify(value, null, 2).slice(0, limit); } catch { return ""; }
}

function contextFromSession(session: unknown): { projectName: string; items: ContextItem[] } {
  const state = (session && typeof session === "object" && "state" in session ? (session as { state?: Record<string, unknown> }).state : {}) || {};
  const script = state.ideaScript && typeof state.ideaScript === "object" ? state.ideaScript as Record<string, unknown> : null;
  const projectName = compactText(state.projectName, 120) || compactText(script?.title, 120) || "当前 Studio 项目";
  const items: ContextItem[] = [];
  if (script) items.push({ id: "script", group: "故事", title: compactText(script.title, 120) || "当前剧本", content: compactText(script, 5000) });
  for (const [key, group, nameKey] of [["characterProfiles", "角色", "name"], ["sceneProposals", "场景", "name"], ["propProposals", "道具", "name"], ["storyboardSegments", "分镜", "segmentKey"]] as const) {
    const values = Array.isArray(state[key]) ? state[key] as Array<Record<string, unknown>> : [];
    values.slice(0, 24).forEach((item, index) => items.push({ id: `${key}-${compactText(item[nameKey], 80) || index}`, group, title: compactText(item[nameKey], 120) || `${group}${index + 1}`, content: compactText(item, 4000) }));
  }
  return { projectName, items };
}

function PrismMark() {
  return <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 35 12v16L20 37 5 28V12Z" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="m20 3 7.2 17L20 37 12.8 20Z" fill="currentColor" opacity=".2"/><path d="M5 12h30L20 37Z" fill="none" stroke="currentColor" strokeWidth="1.25" opacity=".7"/></svg>;
}

function CopyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>;
}

function SettingsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(body.error || body.message || `请求失败（${response.status}）`);
  return body;
}

export function PromptMaster() {
  const [mediaType, setMediaType] = useState<PromptMediaType>("video");
  const [textTarget, setTextTarget] = useState<PromptTextTarget>("script");
  const [format, setFormat] = useState<PromptFormat>("five-section-zh");
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [projectName, setProjectName] = useState("正在读取 Studio…");
  const [contexts, setContexts] = useState<ContextItem[]>([]);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>(readVersions);
  const [duration, setDuration] = useState("5");
  const [ratio, setRatio] = useState("16:9");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-5.4");
  const [apiKey, setApiKey] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const sourceRef = useRef<HTMLTextAreaElement>(null);

  async function refreshProvider() {
    const body = await readJson<{ provider?: ProviderStatus }>(await fetch("/api/prompt-master/provider-settings/status", { cache: "no-store" }));
    const next = body.provider || null;
    setProvider(next);
    if (next?.baseUrl) setBaseUrl(next.baseUrl);
    if (next?.model) setModel(next.model);
    return next;
  }

  useEffect(() => {
    document.title = "PRISM 提示词导演";
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") as { mediaType?: PromptMediaType; textTarget?: PromptTextTarget; format?: PromptFormat; source?: string; result?: string; duration?: string; ratio?: string } | null;
      if (draft?.mediaType && promptMediaTypes.some((item) => item.id === draft.mediaType)) setMediaType(draft.mediaType);
      if (draft?.textTarget && textTargets.some((item) => item.id === draft.textTarget)) setTextTarget(draft.textTarget);
      if (draft?.mediaType && draft.mediaType !== "video") setFormat("five-section-zh");
      else if (draft?.format && promptFormats.some((item) => item.id === draft.format)) setFormat(draft.format);
      if (draft?.source) setSource(draft.source);
      if (draft?.result) setResult(draft.result);
      if (draft?.duration) setDuration(draft.duration);
      if (draft?.ratio) setRatio(draft.ratio);
    } catch { /* use a clean draft */ }
    void fetch("/api/creative-session", { cache: "no-store" }).then((response) => readJson<{ session?: unknown }>(response)).then((body) => { const next = contextFromSession(body.session); setProjectName(next.projectName); setContexts(next.items); }).catch(() => setProjectName("未连接 Studio 项目"));
    void refreshProvider().catch(() => setProvider(null));
  }, []);

  useEffect(() => { localStorage.setItem(DRAFT_KEY, JSON.stringify({ mediaType, textTarget, format, source, result, duration, ratio })); }, [mediaType, textTarget, format, source, result, duration, ratio]);

  const filteredContexts = useMemo(() => { const needle = query.trim().toLowerCase(); return needle ? contexts.filter((item) => `${item.group} ${item.title} ${item.content}`.toLowerCase().includes(needle)) : contexts; }, [contexts, query]);
  const selectedContexts = useMemo(() => contexts.filter((item) => selectedContextIds.includes(item.id)), [contexts, selectedContextIds]);
  const isAgentReady = Boolean(provider?.configured);

  function toggleContext(id: string) { setSelectedContextIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-8)); }

  function archiveResult(value = result) {
    if (!value.trim()) return;
    const next: PromptVersion[] = [{ id: crypto.randomUUID(), mediaType, textTarget, format, source: source.trim(), result: value.trim(), createdAt: new Date().toISOString() }, ...versions].slice(0, 30);
    setVersions(next); localStorage.setItem(VERSION_KEY, JSON.stringify(next));
  }

  function changeFormat(nextFormat: PromptFormat) {
    if (mediaType !== "video" && nextFormat === "h3-en") return;
    if (nextFormat === format) return;
    if (result.trim()) archiveResult(result);
    setFormat(nextFormat); setResult(""); setAgentMessages([]); setError("");
  }

  function changeMediaType(nextMediaType: PromptMediaType) {
    if (nextMediaType === mediaType) return;
    if (result.trim()) archiveResult(result);
    setMediaType(nextMediaType);
    if (nextMediaType !== "video") setFormat("five-section-zh");
    if (nextMediaType === "music" && !["30", "60", "120", "180"].includes(duration)) setDuration("30");
    if (nextMediaType === "video" && !["5", "10", "15", "30"].includes(duration)) setDuration("5");
    setResult(""); setAgentMessages([]); setError("");
  }

  function changeTextTarget(nextTextTarget: PromptTextTarget) {
    if (nextTextTarget === textTarget) return;
    if (result.trim()) archiveResult(result);
    setTextTarget(nextTextTarget); setResult(""); setAgentMessages([]); setError("");
  }

  async function generatePrompt() {
    if (!source.trim()) { setError("先写一句创意、剧情或制作要求。"); sourceRef.current?.focus(); return; }
    if (!isAgentReady) { setSettingsOpen(true); setError("先完成提示词导演自己的API设置。"); return; }
    setBusy(true); setError("");
    try {
      const body = await readJson<{ result?: { prompt?: string; replyZh?: string } }>(await fetch("/api/prompt-master/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaType, textTarget, format, idea: source.trim(), durationSec: Number(duration), aspectRatio: ratio, references: selectedContexts.map((item) => ({ title: `${item.group} · ${item.title}`, content: item.content })) }) }));
      if (!body.result?.prompt) throw new Error("提示词Agent没有返回可用成品。");
      if (result.trim()) archiveResult();
      setResult(body.result.prompt); setAgentMessages(body.result.replyZh ? [{ id: crypto.randomUUID(), role: "agent", content: body.result.replyZh }] : []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "提示词生成失败，请检查API连接。"); } finally { setBusy(false); }
  }

  async function reviseWithAgent() {
    const instruction = agentInstruction.trim();
    if (!result.trim() || !instruction || agentBusy) return;
    if (!isAgentReady) { setSettingsOpen(true); return; }
    const userMessage: AgentMessage = { id: crypto.randomUUID(), role: "user", content: instruction };
    setAgentMessages((current) => [...current, userMessage]); setAgentInstruction(""); setAgentBusy(true);
    try {
      const body = await readJson<{ result?: { prompt?: string; replyZh?: string } }>(await fetch("/api/prompt-master/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaType, textTarget, format, currentPrompt: result, instruction, durationSec: Number(duration), aspectRatio: ratio, references: selectedContexts.map((item) => ({ title: `${item.group} · ${item.title}`, content: item.content })), conversation: agentMessages.slice(-8).map((item) => ({ role: item.role, content: item.content })) }) }));
      if (!body.result?.prompt) throw new Error("Agent没有返回修改后的完整提示词。");
      archiveResult(result); setResult(body.result.prompt); setAgentMessages((current) => [...current, { id: crypto.randomUUID(), role: "agent", content: body.result?.replyZh || "已按你的要求生成新版本。" }]);
    } catch (caught) { setAgentMessages((current) => [...current, { id: crypto.randomUUID(), role: "agent", content: caught instanceof Error ? caught.message : "这次修改没有完成。" }]); } finally { setAgentBusy(false); }
  }

  async function saveSettings() {
    setSettingsBusy(true); setSettingsMessage("");
    try {
      const body = await readJson<{ provider?: ProviderStatus }>(await fetch("/api/prompt-master/provider-settings/configure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim(), profileName: "提示词导演" }) }));
      setProvider(body.provider || null); setApiKey(""); setSettingsMessage("配置已保存。可以检查连接或开始创作。");
    } catch (caught) { setSettingsMessage(caught instanceof Error ? caught.message : "API配置没有保存。"); } finally { setSettingsBusy(false); }
  }

  async function testSettings() {
    setSettingsBusy(true); setSettingsMessage("");
    try {
      const body = await readJson<{ result?: { status?: string; message?: string } }>(await fetch("/api/prompt-master/provider-settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: provider?.activeProfileId }) }));
      setSettingsMessage(body.result?.message || "连接检查已完成。"); await refreshProvider();
    } catch (caught) { setSettingsMessage(caught instanceof Error ? caught.message : "连接检查失败。"); } finally { setSettingsBusy(false); }
  }

  async function copyResult() { if (!result.trim()) return; await navigator.clipboard.writeText(result); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }

  return <main className="prompt-master-shell">
    <header className="pm-topbar">
      <a className="pm-brand" href="/" aria-label="返回 PRISM Story Studio"><span className="pm-brand-mark"><PrismMark /></span><span><strong>PRISM 提示词导演</strong><small>独立提示词创作与修改工作台</small></span></a>
      <div className="pm-project"><span className="pm-project-dot" />参考项目：<strong>{projectName}</strong></div>
      <button className={`pm-provider ${isAgentReady ? "ready" : "offline"}`} onClick={() => setSettingsOpen(true)}><span />{isAgentReady ? `${provider?.model || "文字API"} 已连接` : "设置独立API"}<SettingsIcon /></button>
    </header>
    <section className="pm-workspace">
      <aside className="pm-context-panel">
        <div className="pm-panel-heading"><div><h2>Studio参考</h2><p>只读取选中的项目内容</p></div><span>{selectedContextIds.length}/8</span></div>
        <label className="pm-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色、场景、分镜" /></label>
        <div className="pm-context-list">{filteredContexts.length ? filteredContexts.map((item) => <button key={item.id} className={selectedContextIds.includes(item.id) ? "selected" : ""} onClick={() => toggleContext(item.id)}><span>{item.group}</span><strong>{item.title}</strong><i aria-hidden="true" /></button>) : <div className="pm-empty-context"><strong>可以从空白开始</strong><span>Studio参考不是必需条件。</span></div>}</div>
      </aside>
      <section className="pm-authoring">
        <div className="pm-media-tabs" role="tablist" aria-label="创作类型">{promptMediaTypes.map((item) => <button key={item.id} role="tab" aria-selected={mediaType === item.id} className={mediaType === item.id ? "active" : ""} onClick={() => changeMediaType(item.id)}><strong>{item.label}</strong><span>{item.hint}</span></button>)}</div>
        <div className="pm-kind-tabs" aria-label="输出格式">{promptFormats.map((item) => { const unavailable = mediaType !== "video" && item.id === "h3-en"; return <button key={item.id} disabled={unavailable} className={format === item.id ? "active" : ""} onClick={() => changeFormat(item.id)}><strong>{item.label}</strong><span>{unavailable ? "仅用于视频提示词" : item.hint}</span></button>; })}</div>
        <div className="pm-brief-head"><div><h1>{mediaType === "text" ? "先说清楚你要创作什么" : mediaType === "music" ? "先说清楚你想听到什么" : "先说清楚你想看到什么"}</h1><p>{mediaType === "text" ? "选择故事梗概、短剧本或分镜脚本，再描述题材、人物、剧情和必须保留的语义。" : mediaType === "music" ? "描述用途、风格、情绪、乐器和结构，Agent会补齐音乐生成控制。" : mediaType === "image" ? "描述最终画面、主体关系、构图与必须保留的视觉语义，Agent会补齐成像控制。" : "写下剧情、动作、镜头和必须保留的语义，Agent会补齐生产控制。"}</p></div></div>
        <div className="pm-production-controls">{mediaType === "text" && <label><span>创作目标</span><select value={textTarget} onChange={(event) => changeTextTarget(event.target.value as PromptTextTarget)}>{textTargets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}{(mediaType === "video" || mediaType === "music") && <label><span>建议时长</span><select value={duration} onChange={(event) => setDuration(event.target.value)}>{mediaType === "music" ? <><option value="30">30秒</option><option value="60">60秒</option><option value="120">2分钟</option><option value="180">3分钟</option></> : <><option value="5">5秒</option><option value="10">10秒</option><option value="15">15秒</option><option value="30">30秒</option></>}</select></label>}{(mediaType === "image" || mediaType === "video") && <label><span>画面比例</span><select value={ratio} onChange={(event) => setRatio(event.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>3:4</option><option>4:3</option></select></label>}</div>
        <div className="pm-source-stage">
          <div className="pm-source-label"><strong>创作描述</strong><span>{source.length.toLocaleString("zh-CN")} 字</span></div>
          <textarea ref={sourceRef} className="pm-source" value={source} onChange={(event) => setSource(event.target.value)} placeholder={mediaType === "text" ? textTarget === "synopsis" ? "例如：都市悬疑短片，一个普通快递员收到写着自己死亡时间的包裹。整理完整人物动机、冲突升级、转折和结局……" : textTarget === "storyboard" ? "例如：把这段追逐戏拆成可拍摄的分镜脚本，保留事件顺序和对白，明确每个镜头的景别、动作、声音与建议时长……" : "例如：写一个3分钟都市悬疑短剧，快递员收到写着自己死亡时间的包裹。场次清楚，对白自然，结尾完成反转……" : mediaType === "music" ? "例如：为温暖的家庭短片创作60秒纯音乐，木吉他和轻柔钢琴为主，前段克制，中段逐渐明亮，结尾自然收束……" : mediaType === "image" ? "例如：雨夜码头，男人站在画面左侧，远处小船正在离岸。冷色电影光，潮湿木板反光，保持人物身份和空间关系……" : "例如：雨夜码头，男人追赶一艘正在离岸的小船。先正常奔跑，再被湿滑绳索绊倒，最后撑起上身望向远处。保持剧情因果，不增加对白……"} />
        </div>
        <div className="pm-selected-contexts">{selectedContexts.map((item) => <button key={item.id} onClick={() => toggleContext(item.id)}>{item.group} · {item.title}<span>移除</span></button>)}</div>
        {error && <div className="pm-error" role="alert"><strong>还不能生成</strong><span>{error}</span></div>}
        <div className="pm-primary-row"><p>{mediaType === "text" ? `输出${textTargets.find((item) => item.id === textTarget)?.label}创作提示词` : mediaType === "music" ? "输出完整中文音乐五段式" : mediaType === "image" ? "输出完整中文静态图片五段式" : format === "five-section-zh" ? "输出完整中文视频五段式" : "输出H3标准英文格式"}</p><button className="pm-generate" disabled={busy} onClick={() => void generatePrompt()}>{busy ? <><span className="pm-spinner" />Agent正在组织</> : <>生成完整提示词<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></>}</button></div>
      </section>
      <aside className="pm-result-panel">
        <div className="pm-panel-heading"><div><h2>成品提示词</h2><p>{result ? `${mediaType === "text" ? textTargets.find((item) => item.id === textTarget)?.label : mediaLabel(mediaType)} · ${promptFormats.find((item) => item.id === format)?.label}` : "生成后可直接编辑"}</p></div><div className="pm-heading-actions"><button onClick={() => setHistoryOpen((value) => !value)}>版本 {versions.length}</button>{result && <button className="pm-icon-button" onClick={() => void copyResult()} aria-label="复制提示词"><CopyIcon /></button>}</div></div>
        {historyOpen && <div className="pm-history-popover"><div><strong>最近版本</strong><button onClick={() => setHistoryOpen(false)}>关闭</button></div>{versions.slice(0, 10).map((version) => <button key={version.id} onClick={() => { setMediaType(version.mediaType || "video"); setTextTarget(version.textTarget || "script"); setFormat(version.format); setSource(version.source); setResult(version.result); setHistoryOpen(false); }}><span>{version.mediaType === "text" ? textTargets.find((item) => item.id === (version.textTarget || "script"))?.label : mediaLabel(version.mediaType || "video")} · {promptFormats.find((item) => item.id === version.format)?.label}</span><strong>{version.result.split("\n").find(Boolean)?.slice(0, 38)}</strong><time>{new Date(version.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></button>)}</div>}
        <div className={`pm-result ${result ? "has-result" : ""}`}>{result ? <textarea value={result} onChange={(event) => setResult(event.target.value)} aria-label="生成的提示词" /> : <div className="pm-result-empty"><span><PrismMark /></span><strong>创意在左，成品在这里</strong><p>选择一种格式，写下想法，Agent会返回可以继续修改的完整版本。</p></div>}</div>
        <div className="pm-result-actions"><button disabled={!result} onClick={() => archiveResult()}>保存版本</button><button className="primary" disabled={!result} onClick={() => void copyResult()}>{copied ? "已复制" : "复制成品"}</button></div>
        <section className="pm-agent-dock">
          <div className="pm-agent-head"><div><span className="pm-agent-orbit"><i /></span><span><strong>Agent修改</strong><small>直接告诉它想改哪里</small></span></div>{agentBusy && <span>正在生成新版本</span>}</div>
          <div className="pm-agent-messages">{agentMessages.length ? agentMessages.slice(-4).map((message) => <div key={message.id} className={message.role}>{message.content}</div>) : <p>{result ? "例如：动作再快一点，但不要改剧情和镜头方向。" : "先生成一版提示词，Agent就能按你的想法继续修改。"}</p>}</div>
          <div className="pm-agent-compose"><textarea value={agentInstruction} onChange={(event) => setAgentInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void reviseWithAgent(); } }} disabled={!result || agentBusy} placeholder="说出修改要求…" /><button disabled={!result || !agentInstruction.trim() || agentBusy} onClick={() => void reviseWithAgent()} aria-label="让Agent修改提示词"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-5-7-2Z"/><path d="m12 14 7-9"/></svg></button></div>
        </section>
      </aside>
    </section>
    {settingsOpen && <div className="pm-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="pm-settings" role="dialog" aria-modal="true" aria-labelledby="pm-settings-title">
      <header><div><h2 id="pm-settings-title">提示词导演 API</h2><p>这套配置只供当前独立前端使用。</p></div><button onClick={() => setSettingsOpen(false)} aria-label="关闭API设置">关闭</button></header>
      <div className="pm-settings-status"><span className={isAgentReady ? "ready" : ""} /><div><strong>{isAgentReady ? "已保存独立配置" : "还没有可用配置"}</strong><small>{provider?.keyHint ? `密钥 ${provider.keyHint}` : "密钥不会返回到网页"}</small></div></div>
      <label><span>接口地址</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /><small>可填写服务根地址，也可粘贴完整Responses端点。</small></label>
      <label><span>模型名称</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-5.4" /></label>
      <label><span>API Key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={provider?.keyHint ? `留空继续使用 ${provider.keyHint}` : "粘贴访问密钥"} autoComplete="off" /></label>
      {settingsMessage && <div className="pm-settings-message" role="status">{settingsMessage}</div>}
      <footer><button disabled={!isAgentReady || settingsBusy} onClick={() => void testSettings()}>检查连接</button><button className="primary" disabled={settingsBusy || !baseUrl.trim() || !model.trim() || (!apiKey.trim() && !isAgentReady)} onClick={() => void saveSettings()}>{settingsBusy ? "正在处理…" : "保存独立配置"}</button></footer>
    </section></div>}
  </main>;
}
