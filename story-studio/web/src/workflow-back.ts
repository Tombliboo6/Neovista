export type WorkflowBackApprovalKey =
  | "scriptApproval"
  | "characterApproval"
  | "characterAssetsApproval"
  | "sceneProposalApproval"
  | "sceneMainApproval"
  | "sceneAssetsApproval"
  | "propProposalApproval"
  | "propAssetsApproval"
  | "storyboardApproval"
  | "storyboardAssetsApproval"
  | "videoPromptsApproval"
  | "shotVideosApproval";

export type WorkflowBackState = {
  step: string;
  creationSource: "novel" | "idea";
  scriptApproval: string;
  characterApproval: string;
  characterAssetsApproval: string;
  sceneProposalApproval: string;
  sceneMainApproval: string;
  sceneAssetsApproval: string;
  propProposalApproval: string;
  propAssetsApproval: string;
  storyboardApproval: string;
  storyboardAssetsApproval: string;
  videoPromptsApproval: string;
  shotVideosApproval: string;
};

export type WorkflowBackTransition = {
  step?: string;
  activeStage?: "总览" | "剧本" | "角色" | "场景" | "道具" | "分镜" | "视频";
  reopenApproval?: WorkflowBackApprovalKey;
};

export function resolveWorkflowBack(state: WorkflowBackState): WorkflowBackTransition | null {
  if (state.step === "start") return null;
  if (state.step === "novel" || state.step === "idea") return { step: "start" };
  if (state.step === "format") return { step: state.creationSource };
  if (state.step === "parameters") return { step: "format" };
  if (state.step === "emotion") return { step: "parameters" };
  if (state.step === "idea-questions" || state.step === "idea-script") return { step: "emotion" };
  if (state.step !== "workspace") return null;

  if (state.shotVideosApproval === "approved") return { activeStage: "视频", reopenApproval: "shotVideosApproval" };
  if (state.videoPromptsApproval === "approved") return { activeStage: "视频", reopenApproval: "videoPromptsApproval" };
  if (state.storyboardAssetsApproval === "approved") return { activeStage: "分镜", reopenApproval: "storyboardAssetsApproval" };
  if (state.storyboardApproval === "approved") return { activeStage: "分镜", reopenApproval: "storyboardApproval" };
  if (state.propAssetsApproval === "approved") return { activeStage: "道具", reopenApproval: "propAssetsApproval" };
  if (state.propProposalApproval === "approved") return { activeStage: "道具", reopenApproval: "propProposalApproval" };
  if (state.sceneAssetsApproval === "approved") return { activeStage: "场景", reopenApproval: "sceneAssetsApproval" };
  if (state.sceneMainApproval === "approved") return { activeStage: "场景", reopenApproval: "sceneMainApproval" };
  if (state.sceneProposalApproval === "approved") return { activeStage: "场景", reopenApproval: "sceneProposalApproval" };
  if (state.characterAssetsApproval === "approved") return { activeStage: "角色", reopenApproval: "characterAssetsApproval" };
  if (state.characterApproval === "approved") return { activeStage: "角色", reopenApproval: "characterApproval" };
  if (state.scriptApproval === "approved") return { activeStage: "剧本", reopenApproval: "scriptApproval" };
  return { step: "emotion", activeStage: "总览" };
}
