import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/final-composition.css', import.meta.url), 'utf8');
const directorStyles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const localApi = readFileSync(new URL('../local-api.mjs', import.meta.url), 'utf8');
const prismProvider = readFileSync(new URL('../../src/providers/prism-h3.ts', import.meta.url), 'utf8');

test('H3 media streaming separates connection timeout from playback and catches stream aborts', () => {
  const mediaStart = prismProvider.indexOf('async media(externalTaskId');
  const mediaEnd = prismProvider.indexOf('async #readDiscovery', mediaStart);
  const mediaMethod = prismProvider.slice(mediaStart, mediaEnd);
  assert.match(mediaMethod, /const controller = new AbortController\(\)[\s\S]*clearTimeout\(timeout\)/u);
  assert.doesNotMatch(mediaMethod, /AbortSignal\.timeout\(30_000\)/u);
  assert.match(localApi, /pipeline\(Readable\.fromWeb\(media\.body\), response/u);
});

test('each segment uses one storyboard card with image and video workspaces', () => {
  assert.match(source, /className=\{`storyboard-media-panel state-\$\{imageState\} \$\{hasVideoWorkspace \? "integrated" : ""\}`\}/u);
  assert.match(source, /\(board \|\| prompt \|\| videoPrompt \|\| videoTask\) \? <StoryboardMediaPanel/u);
  assert.match(source, /: <StoryboardCardCopy segment=\{segment\} \/>\}/u);
  assert.match(source, /videoTask\?\.status === "awaiting_review" && hasVideoWorkspace/u);
  assert.match(source, /切换到提示词与镜头视频/u);
  assert.match(source, /<StoryboardVideoWorkspace/u);
  assert.match(source, /查看 \/ 编辑视频提示词/u);
  assert.match(source, /生成本镜头 · \$\{videoEngineLabel\(settings.engine\)\}/u);
  assert.match(source, /className="storyboard-image-workspace"/u);
  assert.match(source, /查看 \/ 编辑图片提示词/u);
});

test('workspace no longer renders separate prompt and H3 cards for every segment', () => {
  assert.doesNotMatch(source, /function ShotVideoNode/u);
  assert.doesNotMatch(source, /videoPromptNodes/u);
  assert.doesNotMatch(source, /shotVideoNodes/u);
  assert.doesNotMatch(source, /className=\{`integrated-video-prompt/u);
  assert.match(source, /const shotVideoPosition = \{ x: stageSpineX - 850 - 45, y: storyboardPosition\.y \}/u);
  assert.match(source, /const storyboardPosition = \{ x: rowStartX, y: 4500 \+ seriesLayoutOffset \}/u);
  assert.match(source, /视频设置 \/ 分镜 \/ 提示词 \/ 镜头视频/u);
});

test('native-audio post production exposes the existing explicit local final composition action', () => {
  assert.match(source, /state\.roughCutApproval === "approved" && state\.audioMode === "native"/u);
  assert.match(source, /onClick=\{onGenerateFinalComposition\}/u);
  assert.match(source, /"生成最终成片 · 本地合成"/u);
  assert.match(source, /disabled=\{state\.subtitles === "undecided" \|\| state\.finalComposition\.status === "running"\}/u);
  assert.doesNotMatch(source, /等待接入本地最终合成/u);
});

test('H3 polling is stable and interrupted submissions are recovered without resubmitting', () => {
  assert.match(source, /const activeShotVideoSignature = shotVideoTasks/u);
  assert.match(source, /\[sessionHydrated, activeShotVideoSignature\]/u);
  assert.doesNotMatch(source, /\[sessionHydrated, shotVideoTasks\]/u);
  assert.match(source, /shotVideoPollInFlight\.current/u);
  assert.match(source, /fetch\("\/api\/h3\/jobs"/u);
  assert.match(source, /Recovery is read-only and must never turn into a hidden resubmission/u);
});

test('left Agent can queue a dependent continuation and dispatch it after its source completes', () => {
  assert.match(source, /function LocalVideoGenerationStep/u);
  assert.match(source, /先生成第一段/u);
  assert.match(source, /生成全部视频/u);
  assert.match(source, /继续生成下一段/u);
  assert.match(source, /生成剩余全部/u);
  assert.match(source, /修改提示词/u);
  assert.match(source, /"waiting_dependency"/u);
  assert.match(source, /加入续接队列 · 暂不调用H3/u);
  assert.match(source, /前段成功返回Herrgotts结果后会按已保存参数自动提交/u);
  assert.match(source, /waitingShotVideoSignature/u);
  assert.match(source, /refreshH3Status\(true\)/u);
  assert.match(source, /submitShotVideo\(next\.segmentKey, true, next\.submissionIntent, true\)/u);
  assert.match(source, /if \(!accepted\) break/u);
});

test('Herrgotts continuity can be selected from both the canvas card and left storyboard list', () => {
  assert.match(source, /function ShotContinuityControl/u);
  assert.match(source, /作为独立的单段视频保存/u);
  assert.match(source, /建立连续链/u);
  assert.match(source, /续接上一段/u);
  assert.match(source, /continuityModes=\{props\.shotContinuityModes\}/u);
  assert.match(source, /continuityMode=\{shotContinuityModes\[segment\.segmentKey\] \|\| "independent"\}/u);
  assert.doesNotMatch(source, /className="h3-paid-action-note"/u);
});

test('approved shot videos switch the left Agent into post-production decisions', () => {
  assert.match(source, /function PostProductionStep/u);
  assert.match(source, /生成无配乐粗剪（推荐）/u);
  assert.match(source, /讨论声音 \/ 配乐 \/ 字幕方案/u);
  assert.match(source, /返回修改镜头/u);
  assert.match(source, /确认粗剪，选择声音 \/ 字幕/u);
  assert.match(source, /确认粗剪，跳过声音 \/ 配乐 \/ 字幕/u);
  assert.match(source, /跳过配乐设计，保留原声/u);
  assert.match(source, /当前原声粗剪可直接作为成片/u);
  assert.match(source, /下载当前成片/u);
  assert.match(source, /postWorkflowRequest<\{ roughCut\?: RoughCutResult; error\?: string \}>\("\/api\/postproduction\/rough-cut"/u);
  assert.match(source, /value=\{managerDraft\}/u);
  assert.match(source, /onManagerMessage/u);
  assert.match(source, /不会调用模型或覆盖旧文件/u);
});

test('rough cut playback lives on the canvas while the left Agent keeps controls', () => {
  assert.match(source, /function RoughCutNode/u);
  assert.match(source, /badge="09 · 粗剪"/u);
  assert.match(source, /className="rough-cut-canvas-player"/u);
  assert.match(source, /粗剪播放器已放到画布/u);
  assert.match(source, /const roughCutPosition = \{ x: storyboardPosition\.x, y: storyboardPosition\.y \+ storyboardBlockHeight \+ 160 \}/u);
  assert.match(source, /shotVideosApproval === "approved" && \(compactFinalReview \? <CombinedFinalReviewNode/u);
  assert.doesNotMatch(source, /className="rough-cut-result"/u);
});

test('rough cut generation uses a large synchronized editing timeline instead of a spinner', () => {
  assert.match(source, /className="rough-cut-generation-visual"/u);
  assert.match(source, /className="rough-cut-generation-monitor"/u);
  assert.match(source, /className="rough-cut-generation-frames"/u);
  assert.match(source, /className="rough-cut-generation-scan"/u);
  assert.match(source, /className="rough-cut-generation-timeline"/u);
  assert.match(source, /正在编排镜头并校验媒体/u);
  assert.doesNotMatch(source, /roughCut\.status === "running" \? "◌"/u);
  assert.match(directorStyles, /@keyframes rough-cut-scan/u);
  assert.match(directorStyles, /transform:scaleX\(0\)/u);
  assert.match(directorStyles, /\.rough-cut-generation-scan,\.rough-cut-generation-timeline > b \{ animation:none!important; \}/u);
});

test('music design separates prompt writing from explicit local ACE-Step generation', () => {
  assert.match(source, /生成配乐方案与提示词/u);
  assert.match(source, /postWorkflowRequest<\{ status\?: "complete" \| "needs_revision"/u);
  assert.match(source, /\("\/api\/postproduction\/music-prompt"/u);
  assert.match(source, /ACE-Step 1\.5提示词（可编辑）/u);
  assert.match(source, /确认配乐提示词/u);
  assert.match(source, /本机生成配乐 · ACE-Step 1\.5/u);
  assert.match(source, /\/api\/postproduction\/local-music/u);
  assert.match(source, /postWorkflowRequest<\{ music\?: MusicGenerationResult; error\?: string \}>\("\/api\/postproduction\/local-music", \{ seed: postProduction\.musicSeed/u);
  assert.match(source, /aria-label="ACE-Step Seed"/u);
  assert.match(source, /aria-label="ACE-Step BPM"/u);
  assert.match(source, /纯音乐标记固定为\[Instrumental\]/u);
  assert.match(source, /失败不会自动改参或重试/u);
  assert.match(source, /body\.music\.status === "unqualified" && body\.music\.mediaUrl/u);
  assert.match(source, /时长未达标，但可解码结果已经保留/u);
  assert.match(source, /该结果不能进入最终合成/u);
  assert.match(source, /约1\.25倍/u);
  assert.match(source, /本次不会调用音乐模型/u);
  assert.match(source, /status: "idle" \| "running" \| "complete" \| "needs_revision"/u);
  assert.match(source, /Agent草稿已返回，还需修改以下内容/u);
  assert.match(source, /系统已自动校正一次。直接编辑下方提示词即可/u);
  assert.match(source, /草稿未通过项/u);
  assert.match(directorStyles, /\.music-validation-guidance/u);
  assert.doesNotMatch(source, /备用：调用MiniMax云端/u);
});

test('failed music prompt generation exposes retry and a local editable draft on both surfaces', () => {
  assert.match(source, /重新生成配乐方案/u);
  assert.match(source, /建立本地可编辑草稿/u);
  assert.match(source, /const creatingLocalDraft = !current\.musicPrompt\.plan/u);
  assert.match(source, /status: creatingLocalDraft \? "needs_revision" : "complete"/u);
  assert.match(source, /这是本地建立的可编辑基础草稿/u);
  assert.match(source, /className="music-prompt-recovery-actions canvas"/u);
  assert.match(directorStyles, /\.music-prompt-recovery-actions/u);
});

test('the complete music plan and audio result live on a dedicated canvas node', () => {
  assert.match(source, /function MusicDesignNode/u);
  assert.match(source, /function MusicGenerationProgress/u);
  assert.match(source, /startedAt: new Date\(\)\.toISOString\(\)/u);
  assert.match(source, /当前生成接口不返回实时百分比，因此采用运行态进度轨，不显示虚假数值/u);
  assert.match(source, /<MusicGenerationProgress music=\{music\} targetDurationSec=\{prompt\.plan\.targetDurationSec\}/u);
  assert.match(source, /badge="10 · 配乐设计"/u);
  assert.match(source, /逐段音乐节点/u);
  assert.match(source, /ACE-Step 1\.5提示词/u);
  assert.match(source, /ACE-Step 1\.5提示词 · 可编辑/u);
  assert.match(source, /重新生成方案与提示词/u);
  assert.match(source, /确认当前提示词/u);
  assert.match(source, /生成来源未记录/u);
  assert.doesNotMatch(source, /music\.provider === "audiocpp-minimax-music-3" \? "本机 audio\.cpp 生成结果" : "MiniMax Music云端生成结果"/u);
  assert.match(source, /本机混音执行/u);
  assert.match(source, /<audio controls preload="metadata"/u);
  assert.match(source, /ACE-Step未达标结果（可试听）/u);
  assert.match(source, /music\.status === "unqualified" \? "时长未达标 · 可试听"/u);
  assert.match(source, /musicDesignVisible && !compactFinalReview && <MusicDesignNode/u);
});

test('completed music collapses rough cut and final output into one review player with a music summary', () => {
  assert.match(source, /const compactFinalReview = postProduction\.roughCut\.status === "complete"/u);
  assert.match(source, /function CombinedFinalReviewNode/u);
  assert.match(source, /badge="09-11 · 成片验收"/u);
  assert.match(source, /配乐 \{musicEnabled \? "开启" : "关闭"\}/u);
  assert.match(source, /className="final-composition-canvas-player"/u);
  assert.match(source, /function MusicSummaryNode/u);
  assert.match(source, /title="配乐简介"/u);
  assert.match(source, /查看配乐详情/u);
  assert.match(source, /function MusicDetailsDialog/u);
  assert.match(source, /成片与配乐已合并到画布同一验收区/u);
  assert.match(styles, /\.fixed-stage-layout \.combined-final-review-node \{[^}]*width: 1200px;[^}]*min-height: 820px;/u);
  assert.match(styles, /\.fixed-stage-layout \.music-summary-canvas-node \{[^}]*width: 560px;[^}]*min-height: 820px;/u);
});

test('asset library replacements expose a persistent whole-transaction undo action', () => {
  assert.match(source, /\/api\/asset-library\/undo/u);
  assert.match(source, /beforeState: creativeStateSnapshot\(\)/u);
  assert.match(source, /撤回刚才替换/u);
  assert.match(source, /替换前资产与审批状态均已恢复/u);
  assert.match(source, /applyCreativeSession\(body\.session\)/u);
});
