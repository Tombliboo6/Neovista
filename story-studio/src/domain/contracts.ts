export type EntityId = string;

export type ApprovalState =
  | 'draft'
  | 'reviewing'
  | 'approved'
  | 'rejected';

export type FreshnessState = 'empty' | 'ready' | 'stale';

export interface VersionedEntity {
  id: EntityId;
  version: number;
  createdAt: string;
  updatedAt: string;
  approval: ApprovalState;
}

export interface NovelDocument extends VersionedEntity {
  title: string;
  sourceName: string;
  language: string;
  text: string;
  contentHash: string;
  characterCount: number;
}

export interface NovelSegment {
  id: EntityId;
  documentId: EntityId;
  documentVersion: number;
  order: number;
  sourceStart: number;
  sourceEnd: number;
  text: string;
  characterCount: number;
  heading?: string;
}

export interface EpisodePlanDraft {
  episodeNumber: number;
  title: string;
  sourceSegmentIds: EntityId[];
  sourceStart: number;
  sourceEnd: number;
  synopsis: string;
  openingHook: string;
  openingHookEvidence: string;
  endingHook: string;
  endingHookEvidence: string;
  targetDurationSec: number;
  keyCharacters: string[];
  dramaticArc: {
    setup: string;
    escalation: string;
    turningPoint: string;
    payoff: string;
  };
  continuityIn: string;
  continuityOut: string;
  boundaryReason: string;
}

export interface EpisodePlan extends VersionedEntity, EpisodePlanDraft {}

export type ScriptLineKind = 'dialogue' | 'voiceover' | 'internal_monologue';

export interface DialogueLine {
  kind: ScriptLineKind;
  speakerName: string;
  text: string;
  delivery: string;
  characterAssetId?: EntityId;
}

export type SceneTransition = 'cut' | 'continuous' | 'dissolve' | 'fade_to_black';

export interface ScriptSceneDraft {
  sceneKey: string;
  order: number;
  heading: string;
  location: string;
  timeOfDay: string;
  interiorExterior: 'interior' | 'exterior' | 'mixed';
  sourceSegmentIds: EntityId[];
  sourceStart: number;
  sourceEnd: number;
  sourceEvidence: string[];
  purpose: string;
  durationSec: number;
  action: string;
  dialogue: DialogueLine[];
  soundCues: string[];
  transitionOut: SceneTransition;
  transitionDirection?: string;
}

export interface ScriptDraft {
  title: string;
  logline: string;
  synopsis: string;
  targetDurationSec: number;
  estimatedDurationSec: number;
  openingHook: string;
  endingHook: string;
  scenes: ScriptSceneDraft[];
  adaptationNotes: string[];
  continuityOut: string;
}

export interface ScriptScene extends ScriptSceneDraft {
  id: EntityId;
}

export interface Script extends VersionedEntity, Omit<ScriptDraft, 'scenes'> {
  episodeId: EntityId;
  episodeVersion: number;
  documentId: EntityId;
  documentVersion: number;
  scenes: ScriptScene[];
}

export interface CharacterSourceFact {
  fact: string;
  sceneKey: string;
  evidence: string;
}

export interface CharacterRelationship {
  targetName: string;
  relationship: string;
}

export interface CharacterProfileDraft {
  participation?: 'visual' | 'voice';
  profileKey: string;
  name: string;
  aliases: string[];
  introduction: string;
  identity: string;
  storyRole: string;
  personality: string[];
  motivation: string;
  relationships: CharacterRelationship[];
  physicalKnownFacts: string[];
  wardrobeKnownFacts: string[];
  designOpenQuestions: string[];
  sourceSceneKeys: string[];
  sourceFacts: CharacterSourceFact[];
}

export interface CharacterProfile extends CharacterProfileDraft {
  id: EntityId;
}

export interface CharacterProfileSet extends VersionedEntity {
  scriptId: EntityId;
  scriptVersion: number;
  profiles: CharacterProfile[];
}

export type StyleSelectionSource =
  | 'recommended-preset'
  | 'style-library'
  | 'surprise-me'
  | 'custom-text'
  | 'reference-image';

export interface StyleRecommendation {
  id: EntityId;
  name: string;
  previewMediaPath?: string;
  stylePrompt: string;
  reason: string;
}

export interface StyleSelection extends VersionedEntity {
  characterProfileSetId: EntityId;
  characterProfileSetVersion: number;
  source: StyleSelectionSource;
  name: string;
  stylePrompt: string;
  referenceMediaPaths: string[];
  selectedBy: 'user';
}

export interface CharacterVisualDesignProposal {
  ageRange: string;
  faceAndFeatures: string;
  hair: string;
  bodyAndProportions: string;
  skinAndComplexion: string;
  wardrobe: string;
  footwear: string;
  accessories: string[];
  repeatableIdentityAnchors: string[];
  naturalAsymmetry: string[];
}

export interface CharacterAssetPromptSections {
  basicSetting: string;
  atmosphereQualityPhotography: string;
  contentSpecifics: string;
  cameraImaging: string;
  negativeTerms: string[];
}

export interface CharacterAssetPromptDraft {
  promptKey: string;
  characterProfileId: EntityId;
  characterName: string;
  visualDesignProposal: CharacterVisualDesignProposal;
  sections: CharacterAssetPromptSections;
}

export interface CharacterAssetPrompt extends CharacterAssetPromptDraft {
  id: EntityId;
  compiledPrompt: string;
}

export interface CharacterAssetPromptSet extends VersionedEntity {
  characterProfileSetId: EntityId;
  characterProfileSetVersion: number;
  styleSelectionId: EntityId;
  styleSelectionVersion: number;
  prompts: CharacterAssetPrompt[];
}

export interface SceneSourceFact {
  fact: string;
  sceneKey: string;
  evidence: string;
}

export interface SceneStateVariant {
  sceneKey: string;
  stateDescription: string;
  sourceEvidence: string[];
}

export interface SceneVisualDesignProposal {
  locationIdentity: string;
  spatialLayout: string;
  terrainAndArchitecture: string;
  materialsAndSurfaces: string;
  fixedLandmarks: string[];
  lightingAndColor: string;
  weatherAndAtmosphere: string;
  reusableCameraCoverage: string;
  designDecisions: string[];
}

export interface SceneAssetPromptSections {
  basicSetting: string;
  atmosphereQualityPhotography: string;
  contentSpecifics: string;
  cameraImaging: string;
  negativeTerms: string[];
}

export interface SceneAssetPromptDraft {
  promptKey: string;
  sceneAssetKey: string;
  name: string;
  sourceSceneKeys: string[];
  baseStateSceneKey: string;
  sourceFacts: SceneSourceFact[];
  stateVariants: SceneStateVariant[];
  visualDesignProposal: SceneVisualDesignProposal;
  sections: SceneAssetPromptSections;
}

export interface SceneAssetPrompt extends SceneAssetPromptDraft {
  id: EntityId;
  compiledPrompt: string;
}

export interface SceneAssetPromptSet extends VersionedEntity {
  scriptId: EntityId;
  scriptVersion: number;
  styleSelectionId: EntityId;
  styleSelectionVersion: number;
  prompts: SceneAssetPrompt[];
}

export interface PropSourceFact {
  fact: string;
  sceneKey: string;
  evidence: string;
}

export interface PropStateVariant {
  stateKey: string;
  sceneKey: string;
  sourceSceneKeys: string[];
  stateDescription: string;
  sourceEvidence: string[];
}

export interface PropVisualDesignProposal {
  objectIdentity: string;
  silhouetteAndProportions: string;
  materialsAndSurface: string;
  constructionAndDetails: string;
  colorAndFinish: string;
  scaleAndHandling: string;
  repeatableAnchors: string[];
  designDecisions: string[];
}

export interface PropAssetPromptSections {
  basicSetting: string;
  atmosphereQualityPhotography: string;
  contentSpecifics: string;
  cameraImaging: string;
  negativeTerms: string[];
}

export interface PropAssetPromptDraft {
  promptKey: string;
  propAssetKey: string;
  name: string;
  aliases: string[];
  sourceSceneKeys: string[];
  baseStateSceneKey: string;
  baseStateDescription: string;
  sourceFacts: PropSourceFact[];
  stateVariants: PropStateVariant[];
  visualDesignProposal: PropVisualDesignProposal;
  sections: PropAssetPromptSections;
}

export interface PropAssetPrompt extends PropAssetPromptDraft {
  id: EntityId;
  compiledPrompt: string;
}

export interface PropAssetPromptSet extends VersionedEntity {
  scriptId: EntityId;
  scriptVersion: number;
  styleSelectionId: EntityId;
  styleSelectionVersion: number;
  prompts: PropAssetPrompt[];
}

export type CharacterAssetPresentation = 'main-card' | 'turnaround';

export type AssetKind = 'character' | 'scene' | 'prop' | 'style';

export interface CreativeAsset extends VersionedEntity {
  kind: AssetKind;
  name: string;
  description: string;
  promptAnchor: string;
  mediaPaths: string[];
  sourceEntityIds: EntityId[];
}

export interface CharacterImageAsset extends CreativeAsset {
  kind: 'character';
  characterProfileId: EntityId;
  presentation: CharacterAssetPresentation;
  parentCharacterAssetId?: EntityId;
  parentCharacterAssetVersion?: number;
}

export interface Shot extends VersionedEntity {
  episodeId: EntityId;
  scriptId: EntityId;
  shotNumber: number;
  durationSec: number;
  characterAssetIds: EntityId[];
  sceneAssetId: EntityId;
  propAssetIds: EntityId[];
  imagePrompt: string;
  videoPrompt: string;
  storyboardImagePaths: string[];
  selectedStoryboardImagePath?: string;
  transition: 'cut' | 'continuous';
}

export type StoryboardEvidenceKind = 'action' | 'dialogue' | 'sound';

export interface StoryboardEvidence {
  evidenceId: string;
  sceneKey: string;
  kind: StoryboardEvidenceKind;
  text: string;
  speakerName?: string;
  delivery?: string;
  speechKind?: ScriptLineKind;
}

export interface StoryboardAssetReference {
  assetId: EntityId;
  version: number;
  approval: 'approved';
  assetKind: 'character' | 'scene' | 'prop';
  label: string;
  description: string;
  characterName?: string;
  sceneAssetKey?: string;
  sourceSceneKeys?: string[];
  viewKey?: string;
  propAssetKey?: string;
  stateKey?: 'dormant' | 'activated';
}

export interface StoryboardImagePromptSections {
  basicSetting: string;
  atmosphereQualityPhotography: string;
  contentSpecifics: string;
  cameraImaging: string;
  negativeTerms: string[];
}

export interface StoryboardShotPromptDraft {
  shotKey: string;
  sceneKey: string;
  order: number;
  title: string;
  durationSec: number;
  narrativePurpose: string;
  characters: string[];
  propStateKey: 'none' | 'dormant' | 'activated' | 'destroyed';
  actionEvidenceIds: string[];
  dialogueEvidenceIds: string[];
  soundCueIds: string[];
  visualAction: string;
  soundDesign: string;
  transition: 'cut' | 'continuous' | 'fade_to_black';
  referenceAssetIds: EntityId[];
  sections: StoryboardImagePromptSections;
}

export interface StoryboardShotPrompt extends StoryboardShotPromptDraft {
  id: EntityId;
  groundedEvidence: StoryboardEvidence[];
  compiledImagePrompt: string;
}

export interface StoryboardSegmentDraft {
  segmentKey: string;
  sceneKey: string;
  sceneKeys?: string[];
  order: number;
  title: string;
  durationSec: number;
  characters: string[];
  sceneAssetKey?: string;
  sceneViewKey: 'main' | 'reverse' | 'left-oblique' | 'right-oblique' | 'high-overview' | 'text-only';
  propStateKey: 'none' | 'dormant' | 'activated' | 'destroyed';
  actionEvidenceIds: string[];
  dialogueEvidenceIds: string[];
  soundCueIds: string[];
  referenceAssetIds: EntityId[];
  storyboardText: string;
  transition: 'cut' | 'continuous' | 'fade_to_black';
}

export interface StoryboardSegment extends StoryboardSegmentDraft {
  id: EntityId;
  groundedEvidence: StoryboardEvidence[];
}

export interface StoryboardPromptSet extends VersionedEntity {
  episodeId: EntityId;
  scriptId: EntityId;
  scriptVersion: number;
  styleSelectionId: EntityId;
  styleSelectionVersion: number;
  assetVersions: Record<EntityId, number>;
  estimatedDurationSec: number;
  segmentDurationSec: number;
  validationWarnings: string[];
  segments: StoryboardSegment[];
}

export type GenerationKind =
  | 'agent'
  | 'image'
  | 'video'
  | 'music'
  | 'composition';

export type GenerationStatus =
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface GenerationTask extends VersionedEntity {
  kind: GenerationKind;
  provider: string;
  sourceEntityIds: EntityId[];
  status: GenerationStatus;
  parameters: Record<string, unknown>;
  outputPaths: string[];
  externalTaskId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ReviewDecision {
  id: EntityId;
  entityId: EntityId;
  entityVersion: number;
  action: 'approve' | 'request_changes';
  comment?: string;
  createdAt: string;
}

export interface FinalTimeline extends VersionedEntity {
  episodeId: EntityId;
  shotVideoTaskIds: EntityId[];
  musicTaskId?: EntityId;
  subtitlePath?: string;
  outputPath?: string;
  actualDurationSec?: number;
}
