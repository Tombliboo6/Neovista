export type AgentDraftValidationStage =
  | 'character-profile'
  | 'character-asset-prompt'
  | 'scene-proposal'
  | 'scene-asset-prompt'
  | 'prop-proposal'
  | 'prop-asset-prompt'
  | 'storyboard-segment'
  | 'storyboard-board'
  | 'video-prompt'
  | 'music-prompt';

export interface AgentDraftValidationReport {
  blockingIssues: string[];
  warnings: string[];
  issues: AgentDraftIssue[];
}

export interface AgentDraftIssue {
  code: string;
  severity: 'blocking' | 'warning';
  messageZh: string;
  suggestionZh: string;
  technicalMessage: string;
}

/**
 * Model-authored presentation lists are allowed to be absent or noisy. They do
 * not carry identity, evidence, coverage or timeline semantics, so callers can
 * safely normalize them before applying the stage's hard validation rules.
 */
export function normalizeOptionalAgentStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))];
}

interface AgentDraftIssueRule {
  code: string;
  pattern: RegExp;
  messageZh: string;
  suggestionZh: string;
}

/**
 * Creative quality is reviewed by the AI. Only deterministic contract issues
 * are surfaced by the application; legacy lexical advice is discarded. Rejection is
 * reserved for unreadable core content, a real approved-fact conflict, or a
 * reference that cannot be mapped safely. IDs, ordering, presentation fields,
 * density targets and wording preferences belong to normalization or review.
 */
const COMMON_BLOCKING_PATTERNS = [
  /must be an (?:array|object)/i,
  /^agent_draft_structure_invalid$/i,
];

// Keep actionable data diagnostics separate from AI editorial judgement.
const DATA_ADVISORY_PATTERNS = [
  /source mapping|source.?fact|source.?scene|evidence|unknown scene|unbound scene/i,
  /count must match|must cover (?:approved|every)|profiles must follow/i,
  /must use (?:promptKey|profileKey|R\d)|identity\/order mismatch/i,
  /has an invalid state variant|state variants do not match required states/i,
  /reference requirements mismatch|reference requirement mismatch|availability mismatch/i,
  /has no approved image|plan\.(?:semanticDecision|imagePromptSections|referenceRequirements) is invalid/i,
  /requires visible shot content|expected \d+ panels|time range is not continuous|panel timeline must end|time boundary changed/i,
];

const STAGE_BLOCKING_PATTERNS: Partial<Record<AgentDraftValidationStage, RegExp[]>> = {
  'character-profile': [
    /profiles must contain unique names selected from requiredCharacterNames/i,
    /missing required introduction fields/i,
  ],
  'character-asset-prompt': [
    /does not match the approved character profile/i,
    /does not reference an approved character profile/i,
  ],
  'scene-proposal': [
    /must name a scene and bind source scenes/i,
    /references unknown scene/i,
  ],
  'scene-asset-prompt': [
    /must name a scene and bind source scenes/i,
    /references unknown scene/i,
  ],
  'prop-proposal': [
    /requires a stable identity/i,
    /references an unknown scene/i,
  ],
  'prop-asset-prompt': [
    /identity does not match required prop/i,
    /references an unknown scene/i,
  ],
  'storyboard-segment': [
    /must preserve dialogue/i,
    /omits dialogue speaker/i,
    /segments contain a scene outside the approved script/i,
    /has invalid dialogue evidence/i,
  ],
  'video-prompt': [
    /^segment key mismatch$/i,
    /^duration mismatch$/i,
    /timeline beat \d+ time range mismatch/i,
    /timeline beats must end at segment duration/i,
    /timeline beats must cover panel keys exactly once and in order/i,
    /must preserve dialogue/i,
    /must preserve required transition text/i,
    /all video prompt sections are required/i,
    /execution is required/i,
    /references unavailable/i,
    /^reference contract:/i,
    /must not invent picture references/i,
  ],
  'music-prompt': [
    /output must be an object/i,
    /minimaxPrompt is required/i,
    /instrumental must be true/i,
  ],
};

export function partitionAgentDraftValidationIssues(
  stage: AgentDraftValidationStage,
  issues: string[]
): AgentDraftValidationReport {
  const blockingPatterns = [...COMMON_BLOCKING_PATTERNS, ...(STAGE_BLOCKING_PATTERNS[stage] ?? [])];
  const details = unique(issues.map(String)).filter((message) => [...blockingPatterns, ...DATA_ADVISORY_PATTERNS].some((pattern) => pattern.test(message))).map((technicalMessage) => classifyAgentDraftIssue(stage, technicalMessage, blockingPatterns.some((pattern) => pattern.test(technicalMessage)) ? 'blocking' : 'warning'));
  return {
    blockingIssues: details.filter((issue) => issue.severity === 'blocking').map((issue) => issue.technicalMessage),
    warnings: details.filter((issue) => issue.severity === 'warning').map((issue) => issue.technicalMessage),
    issues: details,
  };
}

export function classifyAgentDraftIssue(
  stage: AgentDraftValidationStage,
  technicalMessage: string,
  severity: AgentDraftIssue['severity'] = 'warning'
): AgentDraftIssue {
  const rule = AGENT_DRAFT_ISSUE_RULES.find((candidate) => candidate.pattern.test(technicalMessage));
  if (technicalMessage.startsWith('reference contract:')) return { code: 'reference_binding_missing', severity, messageZh: technicalMessage.slice('reference contract:'.length).trim(), suggestionZh: '核对来源与主体绑定、出场指代及故事板时间对应；参考关系可集中说明，保留当前剧情与对白。', technicalMessage };
  if (rule) return { code: rule.code, severity, messageZh: rule.messageZh, suggestionZh: rule.suggestionZh, technicalMessage };
  return {
    code: `${stage.replaceAll('-', '_')}_contract_violation`,
    severity,
    messageZh: severity === 'warning' ? '草稿已返回，但有一项表达质量建议。' : '草稿已返回，但有一项必要事实或结构没有通过校验。',
    suggestionZh: severity === 'warning' ? '可以保留当前草稿，也可以按建议优化表达。' : '保留现有草稿，对照已批准输入修正对应字段后再确认。',
    technicalMessage,
  };
}

const AGENT_DRAFT_ISSUE_RULES: AgentDraftIssueRule[] = [
  { code: 'dialogue_mismatch', pattern: /dialogue|对白逐字保留|说话人/i, messageZh: '对白、说话人或对白顺序与已批准剧本不一致。', suggestionZh: '从已批准剧本逐字复制对白，并绑定正确说话人与发生时间。' },
  { code: 'evidence_mismatch', pattern: /evidence|剧本证据/i, messageZh: '草稿引用了不存在或不属于当前场次的剧本依据。', suggestionZh: '只引用当前输入目录中存在的证据ID和原文，不新增事实。' },
  { code: 'coverage_mismatch', pattern: /cover every|coverage|场次覆盖|场次归属|scene order/i, messageZh: '项目覆盖范围或顺序与已批准输入不一致。', suggestionZh: '按输入顺序逐项覆盖，每项一次，不增不漏。' },
  { code: 'source_mapping_review', pattern: /source mapping/i, messageZh: '部分道具的剧本场次归属需要确认。', suggestionZh: '已保留道具文字设定；可继续制作其他道具，待确认归属后再建立该道具资产。' },
  { code: 'identity_mismatch', pattern: /identity|stable id|prompt\s*key|segment\s*key|asset\s*key/i, messageZh: '稳定ID、项目身份或返回顺序发生了漂移。', suggestionZh: '保留输入中的稳定ID和顺序，只修改创作内容字段。' },
  { code: 'timeline_mismatch', pattern: /time range|time boundary|timeline|duration|时长|时间线/i, messageZh: '时间线、分段时长或前后衔接不一致。', suggestionZh: '让时间段连续且不重叠，并保持已确认的总时长和动作顺序。' },
  { code: 'reference_binding_missing', pattern: /reference binding shot execution must use/i, messageZh: '已定义的角色、场景或道具参考没有在镜头执行中实际使用。', suggestionZh: '人物动作使用对应<Subject n>；场景或道具参考在首个相关镜头基准及重新建立空间关系时使用对应<Picture n>。' },
  { code: 'reference_mismatch', pattern: /reference|参考图|参考资产/i, messageZh: '草稿使用了未批准或当前镜头不需要的参考资产。', suggestionZh: '只保留当前镜头实际需要且已批准的角色、场景和道具参考。' },
  { code: 'internal_monologue_sync', pattern: /internal monologue|inner voice|内心声|内心独白/i, messageZh: '内心声、画外音或人物口型的关系没有说明清楚。', suggestionZh: '明确声音类型；内心声应可听见且人物不做说话口型。' },
  { code: 'unrequested_video_language', pattern: /silent video (?:positive prompt must not contain quoted|sound policy must)/i, messageZh: '无语言镜头仍包含可能触发人声的文字或声音描述。', suggestionZh: '声音总则改为零人声白名单；移除未批准的引号与宣传语，并把结尾写成可见物理状态。' },
  { code: 'negative_terms_quality', pattern: /negative terms must contain 5 to 8 items|negativeTerms must contain 5 to 8 items/i, messageZh: '负面词数量不够精炼。', suggestionZh: '保留约5至8个最容易生成错误的高风险项。' },
  { code: 'timeline_density_quality', pattern: /3 to 5 timeline beats|timeline beats count mismatch/i, messageZh: '短镜头的时间线密度可以更清晰。', suggestionZh: '简单4至6秒镜头可整理为约3至5个有因果顺序的动作节点。' },
  { code: 'music_instrument_assignment', pattern: /complete melodic role to instruments|instrumental film-score premise/i, messageZh: '配乐描述没有清楚说明由哪些乐器承担旋律。', suggestionZh: '明确主旋律、节奏和低频分别由哪些乐器承担，并保持纯器乐。' },
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
