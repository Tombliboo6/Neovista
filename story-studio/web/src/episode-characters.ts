export type EpisodeCharacter = { name: string; role: string; goal: string };

type EpisodeScene = {
  summary?: string;
  beats?: string[];
  dialogue?: Array<{ speaker?: string; line?: string }>;
  blocks?: Array<{ type?: string; speaker?: string; text?: string }>;
};

type EpisodeScript = {
  characters?: EpisodeCharacter[];
  scenes?: EpisodeScene[];
};

export function selectEpisodeCharacters(script: EpisodeScript): EpisodeCharacter[] {
  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  const plannedCharacters = Array.isArray(script?.characters) ? script.characters : [];
  const sceneText = scenes.flatMap((scene) => [
    scene.summary,
    ...(Array.isArray(scene.beats) ? scene.beats : []),
    ...(!scene.blocks?.length && Array.isArray(scene.dialogue) ? scene.dialogue.flatMap((line) => [line?.speaker, line?.line]) : []),
    ...(Array.isArray(scene.blocks) ? scene.blocks.flatMap((block) => [block?.speaker, block?.text]) : []),
  ]).filter((value): value is string => typeof value === "string" && value.trim().length > 0).join("\n");

  const selected = plannedCharacters.filter((character) => {
    const name = typeof character?.name === "string" ? character.name.trim() : "";
    return Boolean(name) && sceneText.includes(name);
  });
  const selectedNames = new Set(selected.map((character) => character.name.trim()));

  for (const scene of scenes) {
    const speakers = [
      ...(!scene.blocks?.length && Array.isArray(scene.dialogue) ? scene.dialogue.map((line) => line?.speaker) : []),
      ...(Array.isArray(scene.blocks) ? scene.blocks.filter((block) => !block.type || block.type === 'dialogue' || block.type === 'os').map((block) => block?.speaker) : []),
    ];
    for (const value of speakers) {
      const name = typeof value === "string" ? value.trim() : "";
      if (!name || selectedNames.has(name)) continue;
      const planned = plannedCharacters.find((character) => character.name?.trim() === name);
      selected.push(planned ?? { name, role: "本集出场角色", goal: "以本集已确认剧本为准" });
      selectedNames.add(name);
    }
  }

  return selected;
}
