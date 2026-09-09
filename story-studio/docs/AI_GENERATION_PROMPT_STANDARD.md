## Global AI prompt writing standard

When writing AI image or AI video generation prompts in any project or conversation, use the user's Chinese production prompt template by default unless the user explicitly asks for another language, a compact prompt, or a platform-specific format.

Use different section orders for static image prompts and video prompts.

For static image prompts, use this five-section order:

1. 基础设定
2. 氛围、画质与摄影风格
3. 画面内容与布局
4. 摄影机与成像
5. 负面词

For video prompts, use this five-section order:

1. 基础设定
2. 声音总则
3. 氛围、画质与摄影风格
4. 画面内容与镜头执行
5. 负面词

Write section headings and prompt content fully in Chinese by default. Do not mix Chinese and English section labels or phrasing unless the user requests it.

Keep the structured positive prompt sections positive: describe only the desired setting, global sound policy when applicable, atmosphere/image quality/photography style, visible content, action, shot setup, camera behavior, and explicit results.

An optional `关键限制` block may appear before the structured sections when a small number of non-negotiable restrictions—normally one to three—would invalidate the result if missed. Prefer stating the required positive state. Use a concise prohibition only when positive wording would be ambiguous. Do not turn this block into a second negative-prompt list, scatter restrictions through the positive sections, or duplicate the same restriction again in `负面词` by default. Only when the same restriction is also one of the current task's highest-risk failure modes may it be repeated once in highly compressed form in the final `负面词` block.

Treat `负面词` as the final section for the applicable prompt type, not as a positive section. Outside the optional `关键限制` exception, do not repeat negative constraints inside the positive sections. Put ordinary negative constraints only in the final `负面词` block.

Keep the final `负面词` block concise by default. Select only the roughly 5-8 highest-risk failure modes for the current shot instead of listing every possible error.

### Section responsibility and de-duplication rules

- Before the structured sections, list only the input/reference fields actually used and the approximate duration when relevant, followed by the optional `关键限制` block only when it meets the strict exception above.
- `基础设定` contains only the output format, world/location/time, subject identity, wardrobe, prop relationships, and other stable story facts. For a video with complex spatial continuity, it may contain a short `场景与空间连续性` sub-block for fixed layout, prop positions, screen-space direction, axis continuity, and other facts that remain stable across shots. Do not place voice design, lighting treatment, shot-specific lens choice, camera position, or camera movement here unless one is indispensable to defining the premise.
- For static image prompts, do not add a `声音总则` section. For video prompts, `声音总则` contains only global voice profiles, music/dialogue/narration policy, overall sound mix, genuinely persistent ambience, and overlap/intelligibility rules. Put verbatim dialogue, line-specific emotional delivery, concrete sync sounds, and any sound that starts, stops, or changes at a particular time only in the corresponding beat of `画面内容与镜头执行`; do not summarize them again in `声音总则`.
- `氛围、画质与摄影风格` combines lighting, color, exposure, texture, material rendering, realism, grain, and overall performance/cinema style. Do not repeat focal length, camera position, subject placement, or camera motion here.
- For static image prompts, `画面内容与布局` contains the visible objects and their current states or explicit visible results, their physical and screen-space relationships, foreground/midground/background staging, subject placement, relative scale, and visual priority. It answers what is visible and where it appears in the finished frame; do not repeat camera height, lens choice, focus, or depth of field here.
- For static image prompts, `摄影机与成像` contains shot size, focal length/lens feel, camera location, height and angle, axis, focus target, depth of field, and other perspective or imaging characteristics. It answers how the camera records the arranged content; do not restate object identity, action state, or screen placement unless a short repeat is required to identify the focus target.
- For video prompts, `画面内容与镜头执行` is the single execution section for visible state, action, causal order, dialogue, line-specific emotion, shot setup, camera changes, and time-specific sound. Default to one chronological timeline that places each action, state transition, ownership, visible result, camera change, verbatim line, line-specific delivery, and concrete sound event only at the beat where it matters. Do not first narrate the same events in a general summary and then repeat them in the timeline.
- For a single-shot video task, begin `画面内容与镜头执行` with one short `镜头基准` that states the shot size, lens feel, camera position/height/angle, axis, focus, initial staging and visual priority, and initial camera-motion state. Then use the execution timeline for action and for any later camera or sound change. Do not repeat an unchanged camera baseline in every beat.
- For a multi-shot video task or a whole-video mother prompt, divide `画面内容与镜头执行` into chronological shot blocks. Give each block a time range or shot identifier, state its initial `镜头设置` once, and then write one `执行时间线` containing the visible action, state changes, later camera changes, verbatim dialogue, line-specific emotion, and concrete sync sounds at their actual beats. Do not create three separate full-length action, camera, and sound tracks.
- Do not invent a global camera block for a multi-shot video. Put stable layout, screen direction, and axis continuity in the optional `场景与空间连续性` sub-block; put every shot-specific framing, lens feel, camera position, focus, and camera movement only in that shot's `镜头设置` or `执行时间线`.
- Do not use a `全程不变量` or `固定条件` block by default. An optional static-condition line is allowed only when the fact remains visually unchanged from start to finish, is not already locked by the reference image or another section, and would otherwise need to be repeated in at least three timeline beats. Keep it to one or two short clauses and exclude timestamps, triggers, before/after logic, dialogue, sequential verbs, and action transitions. For first-frame image-to-video prompts, prefer placing the initial state in the first timeline beat and later changes at their actual timestamps.
- Do not mechanically require action, camera, and sound sub-lines at every timeline beat. State a shot's initial setup once and subsequently mention only what changes. When a camera or sound event must synchronize with an action, a short reference to the trigger is allowed, but do not fully restate the action.
- Each controlling fact should normally appear once in its primary section. Repeat it only when omitting the repeat would create a concrete high-risk ambiguity in action ownership, timing, spatial relationship, or safety, and keep that repeat as short as possible.
- Prefer deleting a sentence that merely paraphrases an earlier sentence. Concision must not remove identity anchors, causal order, action ownership, explicit visible results, sound intelligibility, or critical spatial relationships.

For video prompts, default to no background music, no dialogue, and no narration unless the user asks otherwise, and state that global policy in `声音总则`. Include relevant sync sound, environmental ambience, material sounds, movement sounds, and reaction sounds at their actual beats in `画面内容与镜头执行`; keep only genuinely persistent ambience in `声音总则`.

When a video has no requested dialogue, narration, voiceover, inner voice, singing, or on-screen text, treat it as a zero-human-voice production:

- Write `声音总则` as a closed allowlist. State that the audio track contains only the named ambience, material sounds, movement sounds, and sync effects; keep every visible person silent and exclude crowd chatter, laughter, exclamations, humming, announcements, and indistinct voices. Do not use a broad phrase such as `餐厅环境声` or `人群环境声` unless its permitted non-vocal components are named explicitly.
- Do not place quoted text anywhere in the positive prompt. Chinese or English quotation marks are reserved for approved verbatim speech or explicitly required visible text. A quoted slogan, theme phrase, emotional summary, or final-shot label can be interpreted as words to speak or render.
- Do not end a silent commercial or product shot with advertising copy, a slogan-like summary, or an audience-facing phrase. Convert the intended message into visible physical evidence: subject posture, gaze, object state, steam, material response, product arrangement, lighting, or the final composition.
- When mouth movement is visible, describe only the required physical action, such as taking a bite, closing the lips, chewing quietly, swallowing, breathing, or a closed-mouth smile. Do not leave generic smiling or social interaction available to expand into speech-like lip movement.
- If approved dialogue or visible text exists, quote only that exact approved text at its actual timeline beat. Do not quote surrounding direction, mood, campaign intent, or summaries.

For video prompts with multiple sequential actions or an emotional cause-and-effect transition, include a rough timeline by default. Use approximate ranges and allow reasonable timing drift rather than frame-precise commands. Make the causal order explicit, for example: normal state -> trigger event -> subject notices the trigger -> emotional reaction. Do not let the reaction occur before its trigger.

### Video action, pacing, and revision rules

- Use a "minimum complete control" standard rather than optimizing for prompt length alone. Keep a sentence when removing it would change character identity, action, sequence, force, spatial relationship, sound, camera behavior, or a key expression; remove it when it does not materially control the result.
- For a simple 4-6 second shot, default to roughly 3-5 timeline beats in `画面内容与镜头执行`. Prefer the form "subject -> action -> explicit visible result" for each beat, and avoid repeating the same constraint in every beat.
- Let the core action and its explicit result occupy at least about half of a 4-6 second shot by default. Any pause longer than roughly 0.5 seconds should serve emotion, causality, anticipation, or comic timing and include at least one subject-appropriate visible change, such as gaze or facial expression, posture or gesture, breathing, movement speed, deformation, material response, prop state, or interaction with the environment.
- Abstract performance or state words such as happy, smug, strained, elegant, heavy, unstable, or tense must be followed by subject-appropriate visible anchors. For people or animals, use cues such as gaze, facial expression, posture, gesture, breathing, movement quality, or hold duration. For objects, products, materials, or abstract subjects, use cues such as orientation, deformation, vibration, trajectory, surface response, lighting response, or interaction with props and the environment.
- For externally driven motion such as being thrown, pulled, pushed, pressed, dragged, or blown away, state the full physical chain: the subject receives force or speed -> the support or contact relationship changes -> inertia or continued force carries the motion -> the subject reaches an explicit landing point or final state. When passive motion could be mistaken for voluntary movement, add subject-appropriate inertia cues such as a change in orientation, lagging flexible or articulated parts, trailing clothing, hair, or held objects, deformation, shifting contact points, displaced particles, or material flow.
- When revising a generated video prompt after reviewing output, first identify the failed time range, action, ownership, spatial relationship, or high-risk instruction. Change only that failed part and preserve wording that already produced the intended result instead of rewriting the entire segment.

### Prompt information density and output modes

- Default to a `concise production version` that follows the minimum-complete-control standard. Keep only information that materially controls subject identity, action, causal order, spatial relationships, sound, camera behavior, key expression, or an explicit visible result.
- Treat the full global prompt rules as an internal quality checklist, not as text that must all be copied into every final prompt. When an approved first frame or reference image already locks clothing, materials, scene layout, lighting, or style and the current shot has low drift risk, compress that information to one short line or omit it.
- For a simple 4-6 second video shot, default to roughly 3-5 timeline beats. Keep `基础设定`, `声音总则`, and `氛围、画质与摄影风格` to one or two short paragraphs each, state `镜头基准` once, and let the execution timeline inside `画面内容与镜头执行` carry most of the prompt's detail.
- Automatically switch to a `high-control version` when the shot involves multiple subjects with action ownership, complex spatial relationships, externally driven motion, dense sequential causality, dialogue or overlapping sound, complex camera movement, no reliable approved first frame, or repeated generation failures. Expand only the necessary timeline, physical chain, ownership, visible results, and high-risk constraints.
- Do not output both density versions by default. Select one based on shot complexity; provide both only when the user explicitly asks for comparison, alternatives, or dual versions.
- Concision must not remove hard identity anchors, the acting subject, trigger-and-reaction order, critical spatial relationships, sync sound, camera behavior, or explicit visible results. Detail must not repeat the same controlling fact merely to create a false sense of control.

### Reference and character-consistency rules

- Before the structured prompt sections, dynamically list all input or reference fields actually needed for the current shot. Examples include `首帧`, `尾帧`, `角色资产参考`, `场景参考`, `动作参考`, and `风格参考`; do not mechanically include every possible field.
- Treat the reference fields as separate controls: the first or last frame locks composition and action state, character assets lock identity and clothing, and scene assets lock layout, lighting, and prop positions. For high-consistency shots, especially multi-character scenes, do not omit relevant character or scene assets merely because those subjects already appear in the first frame.
- Still use the fewest reference images that can reliably control the shot. If the platform limits image inputs, or multiple references cause jump cuts, identity contamination, or conflicting composition, reduce the inputs deliberately—prefer the approved first frame as the sole image when it already contains the required characters, scene, and starting pose—and state that choice explicitly.
- Prefill known filenames or asset names, omit unused fields, and leave a field blank only when the user needs to supply it.
- Use the fewest reference images needed for the task and explicitly assign one clear role to every uploaded image. Extra style or expression references can contaminate character identity.
- For recurring IP characters, separate hard identity anchors from flexible performance. Keep core proportions, silhouette language, colors, outline style, and signature anatomy stable; allow pose, eyes, mouth, brows, blush, sweat, and other expression elements to vary with the scene.
- Treat optional expression elements as a palette, not a checklist. If highlights, brows, blush, sweat, tears, or other symbols are merely allowed, select only the few that support the current emotion.
- When hands, limbs, or repeated subjects matter, state the total count first and assign every action to an existing hand or limb. When handedness is visually important, prefer a clear visual pose reference and describe the hand by screen position and action role as well as left/right naming.
- For deterministic micro-edits such as removing highlights, unifying a flat color, cropping, or other pixel-level cleanup, prefer a local edit when practical instead of asking a generative model to redraw the full image.

### Character asset-board generation template

When creating a new realistic human character asset, default to generating one complete asset-board image directly. Do not split the character into separately generated views and manually assemble them unless the one-shot board fails or the user explicitly requests the higher-precision workflow.

Use a horizontal 3:2 layout by default:

- Left, about 42% of the board: one large main full-body casting image, front-facing with a slight three-quarter angle. Keep the complete head, both hands, and both shoes visible.
- Upper right, about 58% of the board: one large, front-facing head-and-shoulders close-up. Treat this as the primary face and identity anchor.
- Lower right: three equal-width body-and-clothing views in this order: front, strict left profile, and full back.
- In the three lower views, place the top crop immediately below the chin so the neck, collar, shoulders, torso, arms, hands, legs, and shoes remain visible, while the chin, facial features, hair, and rest of the head stay outside the crop. These three panels control body proportions, clothing structure, and silhouette without introducing additional small, low-resolution faces that can compete with the main identity anchor.
- Keep the same person, age, body proportions, hairstyle, skin tone, clothing, footwear, and accessories across every panel. Keep lighting, exposure, white balance, background, and divider style consistent.
- Give each character several distinctive, repeatable facial anchors and some natural asymmetry. Avoid generic model, influencer, or stock-photo faces.
- Use a clean neutral studio background and narrow dividers. Do not ask the image model to render text labels; add metadata locally only when it is genuinely useful.

Apply this template to newly generated character assets by default. Do not retroactively rebuild already approved assets unless the user requests it. Use the character board to create and approve the shot's first frame; when that approved first frame already contains the required identity, wardrobe, scene, and starting pose, prefer the first frame alone as the video model's image input.

### Jimeng video prompt rules

When writing video prompts intended for Jimeng, treat every generation as a fresh isolated task. Jimeng receives only the images uploaded for that generation and the current prompt; it has no access to previous prompts, previous segments, failed generations, review notes, or the conversation context.

For multi-segment Jimeng video prompts:

- Each segment prompt must be independent and complete.
- A multi-shot mother prompt may use multiple shot blocks, but each Jimeng generation should normally be exported as its own independent prompt using the single-shot internal format. Treat natural hard cuts as editorial relationships between independently generated segments unless the user explicitly requests a multi-shot generation and the current platform supports it reliably.
- The finished prompt must not refer to production or revision history. Do not use context-dependent wording such as "上一段", "上一版", "之前", "继续前面的", "延续第一段", "同上", "保持之前", "再暗一点", or "比上次更快".
- Convert every historical comparison into an absolute target that can be understood from the current prompt alone. For example, write "断电后仅保留窗外冷色轮廓光，人物面部勉强可辨" instead of "比上一版再暗一点".
- Keep diagnosis, change summaries, and comparisons with failed outputs outside the finished prompt. When revising a prompt, deliver a clean full replacement rather than patch language that depends on earlier versions.
- For every segment, explicitly state what uploaded image is being used and whether it is the first frame, last frame, or reference image.
- Re-describe the full scene, subject, action state, camera behavior, style, sound, and constraints inside each segment prompt.
- Include an approximate video duration for every video prompt or segment, for example "建议时长：4秒".
- For multi-segment Jimeng videos, default to independent first-frame-only generation with natural editorial cuts between segments. Avoid start-and-end-frame or tail-frame chasing unless the user explicitly requests it.
- When an approved first frame already contains the character, scene, and intended starting pose, prefer using that first frame as the sole image input unless another reference is genuinely necessary.
- Never name or use a person, prop, action, event, or causal target that exists only in another segment and is absent from the images uploaded for the current Jimeng task. This applies especially to gaze targets, pointing, listening, reacting, entering, and cause-and-effect instructions. Jimeng must not be expected to infer editorial continuity or an off-screen object from the previous shot.
- If a subject looks toward or reacts to something that is not visible in the current uploaded images and is not intended to appear in the generated shot, describe only the self-contained visible behavior, such as the screen-space gaze direction, head orientation, expression, or body response. Do not name the absent object. Name an initially absent object only when the current prompt explicitly introduces it and the object is intended to become visible in this same generated shot.
- Before sending, perform an isolation check: imagine pasting the prompt into a brand-new Jimeng task with only the currently named uploads. If any sentence still requires chat history or knowledge of another generation to interpret, rewrite it as a self-contained instruction.
- For action-dense Jimeng clips, prefer one direct chronological timeline. Do not pair a broad narrative summary or pseudo-sequence with a second detailed version of the same events; keep stable scene/style facts and global sound policy in their own sections, and place every action change, camera change, concrete sound event, and line-specific delivery only once at its actual time.
