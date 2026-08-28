/* Shared renderer for P06-P48. Avoid placing page copy in this file. */

const query = new URLSearchParams(location.search);
const pageNumber = Math.max(6, Math.min(48, Number(query.get("slide")) || 6));
const page = slides[pageNumber];
const root = document.getElementById("slide");

const pointList = (items, compact = false) => `
  <div class="points${compact ? " compact" : ""}">
    ${items
      .map(
        (item, index) => `
      <article class="point">
        <b>${String(index + 1).padStart(2, "0")}</b>
        <p>${item}</p>
      </article>
    `,
      )
      .join("")}
  </div>
`;

const media = (data) => {
  if (data.video) {
    return `
      <div class="media-box">
        <video src="${A + data.video}" controls preload="metadata"></video>
        <span class="media-label">点击播放真实素材</span>
      </div>
    `;
  }
  if (data.img) {
    return `
      <div class="media-box">
        <img src="${A + data.img}" alt="${data.label || data.h}">
        <span class="media-label">${data.label || "真实项目素材"}</span>
      </div>
    `;
  }
  if (data.ph) {
    return `<div class="media-box"><div class="placeholder"><div>${data.ph}</div></div></div>`;
  }
  return "";
};

const gallery = (items) => {
  const sizeClass =
    items.length === 2 ? "two" : items.length === 4 ? "four" : "";
  return `
    <div class="gallery ${sizeClass}">
      ${items
        .map(
          (item) => `
        <figure>
          <img src="${A + item[0]}" alt="${item[1]}">
          <figcaption>${item[1]}</figcaption>
        </figure>
      `,
        )
        .join("")}
    </div>
  `;
};

const promptSections = (items) => `
  <div class="mode-case-prompt-scroll">
    ${items
      .map(
        (item) => `
      <section class="prompt-section">
        <h3>${item.title}</h3>
        <p>${item.text.replace(/\n/g, "<br>")}</p>
      </section>
    `,
      )
      .join("")}
  </div>
`;

const modeCaseAssets = (data) => {
  if (!data.gallery?.length) {
    return `
      <div class="mode-case-empty">
        <b>0 张图片输入</b>
        <span>${data.emptyAssetNote}</span>
      </div>
    `;
  }
  return `
    <div class="mode-case-assets ${data.gallery.length === 1 ? "one" : ""}">
      ${data.gallery
        .map(
          (item) => `
        <figure>
          <img src="${A + item[0]}" alt="${item[1]}">
          <figcaption>${item[1]}</figcaption>
        </figure>
      `,
        )
        .join("")}
    </div>
  `;
};

const tableContent = (data) => {
  const table = `
    <table class="table">
      <thead><tr>${data.cols.map((item) => `<th>${item}</th>`).join("")}</tr></thead>
      <tbody>
        ${data.rows
          .map(
            (row) => `
          <tr>${row.map((item) => `<td>${item}</td>`).join("")}</tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  `;
  return data.img
    ? `<div class="split media-wide"><div>${table}</div><div class="media-box"><img src="${A + data.img}" alt="分镜九宫格"></div></div>`
    : `<div class="table-full">${table}</div>`;
};

const renderBody = (data) => {
  if (data.kind === "practice-plan") {
    return `
      <div class="practice-one">
        <div class="practice-task-column">
          <div class="practice-task-intro"><span>小组任务</span><strong>${data.task}</strong></div>
          <div class="practice-step-list">
            ${data.steps.map((item, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><div><h2>${item[0]}</h2><p>${item[1]}</p></div></article>`).join("")}
          </div>
        </div>
        <div class="practice-visual-column">
          <figure class="practice-hero"><img src="${A + data.img}" alt="四名小鸭学生共同讨论短片方案"></figure>
          <div class="practice-deliverable"><span>本轮完成</span><strong>${data.deliverable}</strong></div>
        </div>
      </div>
    `;
  }
  if (data.kind === "practice-assets") {
    return `
      <div class="practice-two">
        <figure class="practice-asset-hero"><img src="${A + data.img}" alt="四名小鸭学生共同制作角色资产和关键帧"></figure>
        <section class="practice-asset-actions">
          <article class="practice-asset-action">
            <header><b>小组共同确定</b><span>所有人使用同一套制作依据</span></header>
            <div class="practice-asset-locks">${data.groupLocks.map((item, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><span>${item}</span></article>`).join("")}</div>
          </article>
          <article class="practice-asset-action">
            <header><b>每个人完成</b><span>把自己的镜头变成确定画面</span></header>
            <div class="practice-frame-decisions">${data.frameTasks.map((item) => `<article><b>${item[0]}</b><p>${item[1]}</p></article>`).join("")}</div>
          </article>
          <div class="practice-check-line"><span>小组一起看</span><strong>${data.check}</strong></div>
        </section>
      </div>
    `;
  }
  if (data.kind === "practice-video") {
    return `
      <div class="practice-three">
        <section class="practice-video-flow">
          ${data.steps.map((item, index) => `${index ? '<div class="practice-flow-link"></div>' : ""}<article class="practice-video-step ${index === 1 ? "is-focus" : ""}"><b>${String(index + 1).padStart(2, "0")}</b><div><h2>${item[0]}</h2><p>${item[1]}</p></div></article>`).join("")}
        </section>
        <section class="practice-video-visual">
          <figure><img src="${A + data.img}" alt="小鸭学生使用关键帧生成视频"></figure>
          <div class="practice-formula"><span>提示词重点</span><strong>${data.formula}</strong></div>
        </section>
        <footer class="practice-individual-output"><span>每人交付</span><strong>${data.deliverable}</strong></footer>
      </div>
    `;
  }
  if (data.kind === "practice-edit") {
    return `
      <div class="practice-four">
        <section class="practice-assembly">
          <div class="practice-clip-row">${data.clips.map((item, index) => `${index ? "<i>→</i>" : ""}<article><b>${String(index + 1).padStart(2, "0")}</b><span>${item}</span></article>`).join("")}</div>
          <div class="practice-film-result"><span>小组成片</span><strong>${data.result}</strong><p>${data.transitionNote}</p></div>
        </section>
        <section class="practice-finish-grid">
          <figure class="practice-finish-hero"><img src="${A + data.img}" alt="四名小鸭学生将四段胶片拼成完整故事"></figure>
          <div class="practice-final-checks">
            <header><b>播放前检查</b><span>小组四个人一起看一遍</span></header>
            ${data.checks.map((item, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><p>${item}</p></article>`).join("")}
          </div>
        </section>
      </div>
    `;
  }
  if (data.kind === "homework") {
    return `
      <div class="homework-layout">
        <section class="homework-tasks">
          ${data.tasks.map((item, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><div><h2>${item[0]}</h2><p>${item[1]}</p></div></article>`).join("")}
        </section>
        <section class="submission-pack">
          <span>${data.packageTitle}</span><strong>${data.packageFormula}</strong><h2>${data.packageSummary}</h2>
          <div class="pack-list">${data.packageItems.map((item) => `<p><b>${item[0]}</b>${item[1]}</p>`).join("")}</div>
        </section>
      </div>
    `;
  }
  if (data.kind === "ip-intro") {
    return `
      <div class="ip-intro">
        <figure class="ip-board">
          <img src="${A + data.img}" alt="${data.label}">
          <figcaption>${data.label}</figcaption>
        </figure>
        <div class="ip-characters">
          ${data.characters
            .map(
              (character, index) => `
            <article class="ip-character">
              <b>${String(index + 1).padStart(2, "0")}</b>
              <div>
                <h2>${character.name}<span>${character.role}</span></h2>
                <p>${character.line}</p>
              </div>
            </article>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
  }
  if (data.kind === "topic-rationale") {
    return `
      <div class="topic-rationale">
        <figure class="topic-visual">
          <img src="${A + data.img}" alt="${data.label}">
          <div class="topic-hook"><span>本集主题</span><strong>${data.topic}</strong></div>
        </figure>
        <div class="topic-reasoning">
          <div class="topic-cards">
            ${data.rationale
              .map(
                (item, index) => `
              <article class="topic-card">
                <div><b>${String(index + 1).padStart(2, "0")}</b><span>${item.label}</span></div>
                <h2>${item.title}</h2>
                <p>${item.text}</p>
              </article>
            `,
              )
              .join("")}
          </div>
          <div class="topic-boundary">${data.boundary}</div>
        </div>
      </div>
    `;
  }
  if (data.kind === "complete-story") {
    return `
      <div class="complete-story" data-story-tabs>
        <div class="story-tabs" role="tablist" aria-label="完整故事分段">
          ${data.parts
            .map(
              (part, index) => `
            <button class="story-tab ${index === 0 ? "is-active" : ""}" type="button" role="tab" aria-selected="${index === 0}" data-story-tab="${index}">
              <b>${String(index + 1).padStart(2, "0")}</b><span>${part.tab}</span>
            </button>
          `,
            )
            .join("")}
        </div>
        <div class="story-panels">
          ${data.parts
            .map(
              (part, index) => `
            <section class="story-panel ${index === 0 ? "is-active" : ""}" role="tabpanel" data-story-panel="${index}" ${index === 0 ? "" : "hidden"}>
              <figure class="story-visual">
                ${part.video
                  ? `<video src="${A + part.video}" poster="${A + part.img}" controls preload="metadata" playsinline></video>`
                  : `<img src="${A + part.img}" alt="${part.title}">`}
                <figcaption><span>${part.time}</span><strong>${part.title}</strong></figcaption>
              </figure>
              <div class="story-full-copy">${part.p.map((item) => `<p>${item}</p>`).join("")}</div>
            </section>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
  }
  if (data.kind === "script-to-storyboard") {
    return `
      <div class="script-to-storyboard">
        <div class="storyboard-left-stack">
          <section class="storyboard-script-source">
            <header><b>脚本原文</b><span>${data.scriptTitle}</span></header>
            <div class="storyboard-script-copy">
              ${data.scriptExcerpt.map((item) => `<p>${item}</p>`).join("")}
            </div>
          </section>
          <section class="storyboard-mini-table">
            <header><b>分镜表</b><span>把连续文字落实为可制作的镜头任务</span></header>
            <table>
              <tbody>
                ${data.storyboardRows
                  .map((row) => `<tr><th>${row[0]}</th><td>${row[1]}</td></tr>`)
                  .join("")}
              </tbody>
            </table>
          </section>
        </div>
        <section class="storyboard-result">
          <header><b>分镜之后</b><span>${data.boardTitle}</span></header>
          <div class="storyboard-frame-grid">
            ${data.storyboardFrames
              .map(
                (item) => `
              <figure class="storyboard-frame">
                <div class="storyboard-frame-visual" style="background-image:url('${A + data.boardImg}');background-position:${item[2]}"></div>
                <figcaption><b>${item[0]}</b><span>${item[1]}</span></figcaption>
              </figure>
            `,
              )
              .join("")}
          </div>
        </section>
      </div>
    `;
  }
  if (data.kind === "storyboard-table") {
    return `
      <div class="production-storyboard">
        <div class="production-storyboard-note">同一段剧情被拆成独立制作任务；对白、环境声和动作音效都写进“画面内容”。</div>
        <table>
          <thead><tr>${data.cols.map((item) => `<th>${item}</th>`).join("")}</tr></thead>
          <tbody>
            ${data.rows
              .map(
                (row) => `<tr>${row.map((item) => `<td>${item}</td>`).join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }
  if (data.kind === "full-storyboard") {
    return `
      <div class="full-storyboard">
        <div class="full-storyboard-toolbar">
          <div><b>前期分镜表结构示例</b><span>57条镜头节拍｜声音合并在“画面内容”</span></div>
          <em>${data.focusLabel}</em>
        </div>
        <div class="full-storyboard-scroll" data-storyboard-source="${A + data.storyboardSource}">
          <table>
            <thead><tr>
              <th>编号</th><th>作用</th><th>时长</th><th>景别与机位</th>
              <th>画面内容（含对白与声音）</th><th>衔接</th><th>对应素材</th><th>素材状态</th>
            </tr></thead>
            <tbody><tr><td colspan="8" class="storyboard-loading">正在载入完整分镜表……</td></tr></tbody>
          </table>
        </div>
      </div>
    `;
  }
  if (data.kind === "storyboard-control") {
    return `
      <div class="storyboard-control">
        <section class="control-source-line">
          <div><b>分镜要求</b><strong>${data.shotTitle}</strong></div>
          <div class="control-source-facts">${data.shotFacts.map((item) => `<span>${item}</span>`).join("")}</div>
        </section>
        <section class="control-focus-card">
          <header><b>图片负责锁定静态事实</b><span>把“不能错”的状态变成输入图</span></header>
          <div class="control-locks">
            ${data.imageLocks
              .map(
                (item, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><h2>${item[0]}</h2><p>${item[1]}</p></article>`,
              )
              .join("")}
          </div>
          <div class="control-prompt"><b>提示词负责动态过程</b><p>${data.promptControl}</p></div>
        </section>
        <section class="control-final-decision"><span>本镜头最终输入</span><strong>${data.decision}</strong></section>
      </div>
    `;
  }
  if (data.kind === "generation-choice") {
    return `
      <div class="generation-choice">
        ${data.choices
          .map(
            (choice, index) => `
          <article class="generation-choice-card ${choice.active ? "is-active" : ""}">
            <div class="generation-choice-media ${choice.imgs.length > 1 ? "is-multi" : ""}">
              ${choice.imgs
                .map(
                  (img, imageIndex) => `<figure><img src="${A + img}" alt="${choice.imageLabels[imageIndex]}"><figcaption>${choice.imageLabels[imageIndex]}</figcaption></figure>`,
                )
                .join("")}
              <b>${String(index + 1).padStart(2, "0")}</b>
            </div>
            <div class="generation-choice-copy">
              <span>${choice.label}</span><h2>${choice.title}</h2>
              <blockquote><b>分镜原文节选</b>${choice.source}</blockquote>
              <p>${choice.text}</p>
              ${choice.badge ? `<em>${choice.badge}</em>` : ""}
            </div>
          </article>
        `,
          )
          .join("")}
      </div>
    `;
  }
  if (data.kind === "keyframe-from-storyboard") {
    return `
      <div class="keyframe-from-storyboard">
        <section class="kfs-left">
          <div class="kfs-board">
            <header><b>动作板</b><span>${data.sourceTitle}</span></header>
            <img src="${A + data.boardImg}" alt="${data.sourceTitle}">
          </div>
          <blockquote class="kfs-script"><b>脚本原文节选</b><p>${data.scriptText}</p></blockquote>
        </section>
        <section class="kfs-reading">
          <div class="kfs-storyboard-table">
            <header><b>分镜表节选</b><span>把脚本整理成可执行的镜头任务</span></header>
            <table>
              <thead><tr><th>编号</th><th>时间</th><th>景别与机位</th><th>画面内容</th></tr></thead>
              <tbody>${data.storyboardRows.map((row) => `<tr>${row.map((item) => `<td>${item}</td>`).join("")}</tr>`).join("")}</tbody>
            </table>
          </div>
          <div class="kfs-facts">
            ${data.facts
              .map(
                (item, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><div><h2>${item[0]}</h2><p>${item[1]}</p></div></article>`,
              )
              .join("")}
          </div>
        </section>
      </div>
    `;
  }
  if (data.kind === "static-prompt-workbench") {
    return `
      <div class="static-prompt-workbench">
        <aside class="spw-inputs">
          <header><b>写提示词之前</b><span>先准备制作依据与身份参考</span></header>
          ${data.refs
            .map(
              (item) => `<figure><img src="${A + item[0]}" alt="${item[1]}"><figcaption>${item[1]}</figcaption></figure>`,
            )
            .join("")}
          <p>${data.note}</p>
        </aside>
        <section class="spw-prompt">
          <header><b>首帧图片提示词</b><span>${data.sourceLabel}</span></header>
          <div class="spw-prompt-scroll">
            <div class="spw-reference-line"><b>使用参考</b><p>${data.referenceLine}</p></div>
            <div class="spw-critical"><b>关键限制</b><p>${data.critical}</p></div>
            ${data.promptSections
              .map(
                (item) => `<section><h2>${item[0]}</h2><p>${item[1]}</p></section>`,
              )
              .join("")}
          </div>
        </section>
      </div>
    `;
  }
  if (data.kind === "keyframe-generation") {
    return `
      <div class="keyframe-generation">
        <section class="kfg-flow">
          <figure class="kfg-identity">
            <img src="${A + data.identity[0]}" alt="${data.identity[1]}">
            <figcaption><b>${data.identity[1]}</b><p>${data.identity[2]}</p></figcaption>
          </figure>
          <div class="kfg-symbol">＋</div>
          <article class="kfg-prompt-card">
            <header><b>${data.promptCard[0]}</b><p>${data.promptCard[1]}</p></header>
            <div class="kfg-prompt-details">
              ${data.promptDetails.map((item, index) => `<section><b>${String(index + 1).padStart(2, "0")}</b><div><h2>${item[0]}</h2><p>${item[1]}</p></div></section>`).join("")}
            </div>
            <footer>${data.promptFoot}</footer>
          </article>
          <div class="kfg-symbol">→</div>
          <figure class="kfg-result">
            <img src="${A + data.result[0]}" alt="${data.result[1]}">
            <figcaption><b>${data.result[1]}</b><p>${data.result[2]}</p></figcaption>
          </figure>
        </section>
        <section class="kfg-checks">
          ${data.checks
            .map(
              (item, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><div><h2>${item[0]}</h2><p>${item[1]}</p></div></article>`,
            )
            .join("")}
        </section>
      </div>
    `;
  }
  if (data.kind === "tailframe-continuity") {
    return `
      <div class="tailframe-continuity">
        <section class="kfc-main kfc-main-v3">
          <div class="kfc-frame-pair">
            <figure class="kfc-frame"><img src="${A + data.first[0]}" alt="${data.first[1]}"><figcaption>${data.first[1]}</figcaption></figure>
            <span class="kfc-frame-arrow">→</span>
            <figure class="kfc-frame"><img src="${A + data.last[0]}" alt="${data.last[1]}"><figcaption>${data.last[1]}</figcaption></figure>
          </div>
          <figure class="kfc-identity-large"><img src="${A + data.identity[0]}" alt="${data.identity[1]}"><figcaption>${data.identity[1]}</figcaption></figure>
        </section>
        <section class="kfc-checks kfc-checks-v2">
          ${data.changes.map((item, index) => `<article><h2>${["位置变化", "动作变化", "情绪变化"][index]}</h2><p>${item}</p></article>`).join("")}
          <article><h2>保持一致</h2><p>${data.keepShort || data.keep}</p></article>
        </section>
      </div>
    `;
  }
  if (data.kind === "prompt-calibration-case") {
    return `
      <div class="prompt-calibration-case">
        <section class="pcc-evidence">
          <header><b>关键帧依据</b><span>把分镜规定的起点和终点变成确定画面</span></header>
          <div>
            ${data.evidence.map((item) => `<figure><img src="${A + item[0]}" alt="${item[1]}"><figcaption>${item[1]}</figcaption></figure>`).join("")}
          </div>
        </section>
        <section class="pcc-compare">
          <article class="pcc-before">
            <header><b>分镜表已经规定</b></header>
            <blockquote>${data.before}</blockquote>
            <ul>${data.problems.map((item) => `<li>${item}</li>`).join("")}</ul>
          </article>
          <article class="pcc-after">
            <header><b>转译后｜视频执行时间线</b><span>D固定远景｜约5秒</span></header>
            <div>${data.afterTimeline.map((item) => `<section><time>${item[0]}</time><p>${item[1]}</p></section>`).join("")}</div>
          </article>
        </section>
        <section class="pcc-principles">
          ${data.principles.map((item, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><div><h2>${item[0]}</h2><p>${item[1]}</p></div></article>`).join("")}
        </section>
      </div>
    `;
  }
  if (data.kind === "full-video-prompt") {
    return `
      <div class="full-video-prompt">
        <aside class="fvp-refs">
          <header><b>实际使用的参考图</b><span>每张图只承担一种主要控制职责</span></header>
          <div>
            ${data.refs.map((item) => `<figure><img src="${A + item[0]}" alt="${item[1]}"><figcaption><h2>${item[1]}</h2><p>${item[2]}</p></figcaption></figure>`).join("")}
          </div>
        </aside>
        <section class="fvp-prompt">
          <header><b>完整视频提示词｜可滚动查看</b><span>${data.meta}</span></header>
          <div class="fvp-scroll">
            ${data.promptSections.map((section) => `<article class="${section.focus ? "fvp-focus" : ""}"><h2>${section.title}</h2>${section.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("")}</article>`).join("")}
          </div>
        </section>
      </div>
    `;
  }
  if (data.kind === "keyframe-control") {
    return `
      <div class="keyframe-control">
        <div class="keyframe-control-grid">
          ${data.frames
            .map(
              (frame, index) => `
            <figure class="keyframe-control-card">
              <div><img src="${A + frame[0]}" alt="${frame[1]}"><b>${String(index + 1).padStart(2, "0")}</b></div>
              <figcaption><h2>${frame[1]}</h2><p>${frame[2]}</p></figcaption>
            </figure>
          `,
            )
            .join("")}
        </div>
        <div class="keyframe-check"><span>筛选时只问三件事</span><strong>${data.check}</strong></div>
      </div>
    `;
  }
  if (data.kind === "script-study") {
    return `
      <div class="script-study">
        <section class="full-script-panel">
          <div class="full-script-head">
            <div><b>完整脚本</b><span>${data.scriptLabel}</span></div>
            <em>可滚动查看全部</em>
          </div>
          <pre class="full-script-copy" data-script-source="${A + data.scriptSource}">正在载入 EP04 完整脚本……</pre>
        </section>
        <section class="script-analysis">
          <div class="script-summary"><b>脚本的作用</b><p>${data.scriptSummary}</p></div>
          <div class="script-examples">
            ${data.examples
              .map(
                (example, index) => `
              <article class="script-example">
                <header><b>${String(index + 1).padStart(2, "0")}</b><h2>${example.title}</h2></header>
                <div class="script-mini-timeline">
                  ${example.timeline
                    .map(
                      (item) => `<div><time>${item[0]}</time><p>${item[1]}</p></div>`,
                    )
                    .join("")}
                </div>
              </article>
            `,
              )
              .join("")}
          </div>
        </section>
      </div>
    `;
  }
  if (data.kind === "watch-film") {
    return `
      <div class="watch-film">
        <div class="watch-film-video">
          <video src="${A + data.video}" controls preload="metadata" playsinline data-fullscreen-on-play></video>
        </div>
        <div class="watch-questions">
          ${data.questions
            .map(
              (item, index) => `
            <article class="watch-question">
              <b>${String(index + 1).padStart(2, "0")}</b>
              <p>${item}</p>
            </article>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
  }
  if (data.kind === "result-showcase") {
    return `
      <div class="result-showcase">
        <div class="result-showcase-video">
          <video src="${A + data.video}" controls preload="metadata" playsinline data-fullscreen-on-play></video>
          <span>点击播放｜自动进入全屏</span>
        </div>
        <section class="result-points">
          ${data.results.map((item, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><div><h2>${item[0]}</h2><p>${item[1]}</p></div></article>`).join("")}
        </section>
      </div>
    `;
  }
  if (data.kind === "case-comparison-videos") {
    return `
      <div class="case-comparison-videos${data.largeVideos ? " case-comparison-large-videos" : ""}">
        ${data.cases.map((item, index) => `
          <article class="case-video-card">
            <div class="case-video-media ${item.refs?.length ? "has-refs" : ""}">
              <div class="case-video-player">
                <video src="${A + item.video}" controls preload="metadata" playsinline data-fullscreen-on-play></video>
                <span>点击播放｜自动进入全屏</span>
              </div>
              ${item.refs?.length ? `<div class="case-video-refs">${item.refs.map((ref) => `<figure><img src="${A + ref[0]}" alt="${ref[1]}"><figcaption>${ref[1]}</figcaption></figure>`).join("")}</div>` : ""}
            </div>
            <div class="case-video-copy">
              <header><b>${String(index + 1).padStart(2, "0")}</b><div><span>${item.label}｜${item.duration}</span><h2>${item.title}</h2></div></header>
              ${data.largeVideos ? `
                <div class="case-video-facts case-video-diagnosis">
                  <section><b>错误表现</b><p>${item.result}</p></section>
                  <section class="case-result"><b>处理方式</b><p>${item.decision}</p></section>
                </div>
              ` : `
                <div class="case-video-facts">
                  <section><b>镜头任务</b><p>${item.task}</p></section>
                  <section><b>参考依据</b><p>${item.reference}</p></section>
                  <section><b>提示词重点</b><p>${item.execution}</p></section>
                  <section class="case-result"><b>结果观察</b><p>${item.result}</p></section>
                </div>
              `}
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }
  if (data.kind === "mode-case") {
    return `
      <div class="mode-case ${data.gallery?.length ? "" : "no-assets"}">
        <div class="mode-case-left">
          <div class="mode-case-video">
            <video src="${A + data.video}" controls preload="metadata" playsinline></video>
            <span class="media-label">点击播放生成结果｜${data.duration}</span>
          </div>
          ${modeCaseAssets(data)}
        </div>
        <div class="mode-case-right">
          <div class="mode-case-summary">
            <h2>${data.h}</h2>
            <p>${data.advantage}</p>
            <div class="mode-case-meta">${data.meta.map((item) => `<span>${item}</span>`).join("")}</div>
          </div>
          <div class="mode-case-prompt">
            <div class="mode-case-prompt-head"><b>即梦完整视频提示词</b><span>向下滚动查看全部</span></div>
            ${promptSections(data.prompt)}
          </div>
        </div>
      </div>
    `;
  }
  if (data.kind === "reference-pair") {
    return `
      <div class="reference-pair">
        ${data.refs
          .map(
            (item) => `
          <figure>
            <img src="${A + item[0]}" alt="${item[1]}">
          </figure>
        `,
          )
          .join("")}
      </div>
    `;
  }
  if (data.kind === "mode-cards") {
    return `
      <div class="mode-cards">
        ${data.modes
          .map(
            (item, index) => `
          <article class="mode-card">
            <div class="mode-card-head">
              <b>${String(index + 1).padStart(2, "0")}</b>
              <h2>${item.title}</h2>
            </div>
            <div class="mode-description"><strong>说明</strong><span>${item.desc}</span></div>
            <div class="mode-advantage"><strong>优势</strong><span>${item.advantage}</span></div>
          </article>
        `,
          )
          .join("")}
      </div>
    `;
  }
  if (data.kind === "story") {
    return `
      <div class="story-layout">
        <div class="story-copy">${data.p.map((item) => `<p>${item}</p>`).join("")}</div>
        ${media(data)}
      </div>
    `;
  }
  if (data.kind === "script-timeline") {
    return `
      <div class="script-timeline">
        <div class="script-copy">
          ${data.intro ? `<div class="script-definition">${data.intro}</div>` : ""}
          ${data.p.map((item) => `<p>${item}</p>`).join("")}
        </div>
        <div class="script-beats">
          ${data.nodes
            .map((item, index) => {
              const [time, label] = item.split("|");
              const frame = data.frames?.[index];
              return `<article class="script-beat">
                ${frame ? `<img class="script-beat-frame" src="${A + frame}" alt="${label}">` : ""}
                <div class="script-beat-copy"><b>${time}</b><span>${label}</span></div>
              </article>`;
            })
            .join("")}
        </div>
      </div>
    `;
  }
  if (data.kind === "script") {
    return `<div class="quote">${data.p.map((item) => `<p>${item}</p>`).join("")}</div>`;
  }
  if (data.kind === "table") {
    return tableContent(data);
  }
  if (data.kind === "chain") {
    const sizeClass =
      data.nodes.length === 7
        ? "many c7"
        : data.nodes.length === 8
          ? "many c8"
        : data.nodes.length === 10
          ? "many c10"
          : "";
    return `
      <div class="chain ${sizeClass}">
        ${data.nodes
          .map(
            (item, index) => `
          ${typeof item === "string"
            ? `<div class="node"><b>${String(index + 1).padStart(2, "0")}</b><span>${item}</span></div>`
            : `<div class="node has-media">
                <img src="${A + item.img}" alt="${item.text}">
                <div class="node-copy"><b>${String(index + 1).padStart(2, "0")}</b><span>${item.text}</span></div>
              </div>`}
          ${index < data.nodes.length - 1 ? "<i>→</i>" : ""}
        `,
          )
          .join("")}
      </div>
    `;
  }
  if (data.kind === "post-production-grid") {
    return `
      <div class="post-production-layout">
        <p class="post-production-subtitle">${data.h}</p>
        <div class="post-production-grid">
          ${data.items
            .map(
              (item, index) => `
                <article class="post-production-item">
                  <b>${String(index + 1).padStart(2, "0")}</b>
                  <div>
                    <h3>${item.title}</h3>
                    <p>${item.text}</p>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </div>
    `;
  }
  if (data.kind === "edit-overlay-cases") {
    return `
      <div class="edit-overlay-layout">
        <p class="edit-overlay-subtitle">${data.h}</p>
        <div class="edit-overlay-cases">
          ${data.cases
            .map(
              (item) => `
                <article class="edit-overlay-case">
                  <h3>${item.title}</h3>
                  <div class="edit-overlay-flow">
                    <figure>
                      <img src="${A + item.source[0]}" alt="${item.source[1]}">
                      <figcaption>${item.source[1]}</figcaption>
                    </figure>
                    <b class="edit-overlay-arrow">＋</b>
                    <figure>
                      <img class="asset" src="${A + item.asset[0]}" alt="${item.asset[1]}">
                      <figcaption>${item.asset[1]}</figcaption>
                    </figure>
                    <b class="edit-overlay-arrow">→</b>
                    <div class="edit-overlay-action"><strong>剪辑合成</strong><p>${item.action}</p></div>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
        <p class="edit-overlay-footer">${data.footer}</p>
      </div>
    `;
  }
  if (data.kind === "edit-overlay-showcase") {
    return `
      <div class="edit-showcase-layout">
        <p class="edit-showcase-subtitle">${data.h}</p>
        <div class="edit-showcase-main">
          <div class="edit-showcase-inputs">
            <figure>
              <span>01</span>
              <img src="${A + data.source[0]}" alt="${data.source[1]}">
              <figcaption>${data.source[1]}</figcaption>
            </figure>
            <b class="edit-showcase-plus">＋</b>
            <figure>
              <span>02</span>
              <img class="asset" src="${A + data.asset[0]}" alt="${data.asset[1]}">
              <figcaption>${data.asset[1]}</figcaption>
            </figure>
            <p class="edit-showcase-method">${data.method}</p>
          </div>
          <figure class="edit-showcase-result">
            <span>03｜剪辑合成后</span>
            <img src="${A + data.result[0]}" alt="${data.result[1]}">
            <figcaption>${data.result[1]}</figcaption>
          </figure>
        </div>
        <div class="edit-showcase-more">
          <strong>同样可以剪进去：</strong>
          ${data.more.map((item) => `<span>${item}</span>`).join("")}
        </div>
        <p class="edit-showcase-footer">${data.footer}</p>
      </div>
    `;
  }
  if (data.kind === "sound-sync-case") {
    return `
      <div class="sound-case-layout">
        <p class="sound-case-subtitle">${data.h}</p>
        <div class="sound-case-main">
          <figure class="sound-case-frame">
            <span>${data.duration}</span>
            <div class="sound-case-video">
              <video src="${A + data.video}" poster="${A + data.img}" controls preload="metadata" playsinline></video>
            </div>
            <figcaption>点击播放：台词结束、头像弹出、朋友进门</figcaption>
          </figure>
          <div class="sound-case-timeline">
            <div class="sound-avatar-row">
              ${data.avatars.map((item) => `<figure><img src="${A + item[0]}" alt="${item[1]}"><figcaption><strong>${item[1]}</strong><span>${item[2]}</span></figcaption></figure>`).join("")}
            </div>
            <div class="sound-axis"><span>0s</span><span>1s</span><span>2s</span><span>3s</span><span>4s</span><span>5s</span></div>
            <section class="sound-lane dialogue">
              <b>角色台词</b>
              <div><span style="width:52.2%"><strong>${data.dialogue.range}</strong>${data.dialogue.text}</span></div>
            </section>
            <section class="sound-lane knocks">
              <b>三声敲门</b>
              <div>${data.knocks.map((time, index) => `<i style="left:${[54.12, 59, 64][index]}%"><em>咚</em></i>`).join("")}<span class="sound-lane-times">${data.knocks.join(" / ")}s</span></div>
            </section>
            <section class="sound-lane dialogue xiaoxiao-dialogue">
              <b>小小台词</b>
              <div><span style="left:60%; width:40%"><strong>${data.xiaoxiaoDialogue.range}</strong>${data.xiaoxiaoDialogue.text}</span></div>
            </section>
            <p class="sound-sync-rule">饭团台词落下 → 三声敲门打断 → 小小台词接入</p>
            <article class="sound-post-role">
              <h3>${data.postRole.title}</h3>
              <div><p><b>声音线索</b>${data.postRole.sound}</p><p><b>视觉贴图</b>${data.postRole.visual}</p></div>
              <strong>${data.postRole.result}</strong>
            </article>
          </div>
        </div>
        <div class="sound-mix-priority">
          ${data.mix.map((item) => `<article><b>${item[0]}</b><strong>${item[1]}</strong><span>${item[2]}</span></article>`).join("")}
        </div>
        <p class="sound-case-note">${data.caseNote}</p>
      </div>
    `;
  }
  if (data.kind === "quality-check") {
    return `
      <div class="quality-check-layout">
        <p class="quality-check-subtitle">${data.h}</p>
        <div class="quality-check-grid">
          ${data.checks
            .map(
              (item, index) => `
                <article class="quality-check-card">
                  <b>${String(index + 1).padStart(2, "0")}</b>
                  <div><h2>${item[0]}</h2><p>${item[1]}</p></div>
                </article>
              `,
            )
            .join("")}
        </div>
      </div>
    `;
  }
  if (data.kind === "timeline") {
    return `
      <div class="timeline">
        ${data.nodes
          .map((item) => {
            const [time, label] = item.split("|");
            return `<div class="beat"><b>${time}</b><span>${label}</span></div>`;
          })
          .join("")}
      </div>
    `;
  }
  if (data.kind === "case") {
    return `
      <div class="case">
        ${media(data)}
        <div class="case-notes">
          ${data.p
            .map((item) => {
              const note =
                typeof item === "string"
                  ? { label: "课堂判断", text: item }
                  : item;
              return `
                <article><h3>${note.label}</h3><p>${note.text}</p></article>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }
  if (data.kind === "video") {
    return `<div class="split media-wide"><div>${media(data)}</div>${pointList(data.p)}</div>`;
  }
  if (data.kind === "gallery") {
    return (data.p || []).length <= 1
      ? `<div class="featured-gallery">${gallery(data.gallery)}${pointList(data.p || [])}</div>`
      : `<div class="split media-wide"><div>${gallery(data.gallery)}</div>${pointList(data.p || [])}</div>`;
  }
  if (data.kind === "steps") {
    return `<div class="split media-wide"><div>${data.gallery ? gallery(data.gallery) : media(data)}</div><div>${pointList(data.p, data.compact)}</div></div>`;
  }
  if (data.kind === "split") {
    return `<div class="split"><div>${pointList(data.p)}</div>${media(data)}</div>`;
  }
  if (media(data)) {
    return `<div class="split"><div>${pointList(data.p, data.p.length > 5)}</div>${media(data)}</div>`;
  }
  return `
    <div class="wide-points">
      ${data.p
        .map(
          (item, index) => `
        <article class="point"><b>${String(index + 1).padStart(2, "0")}</b><p>${item}</p></article>
      `,
        )
        .join("")}
    </div>
  `;
};

const darkPages = new Set([20, 24, 35, 36, 37, 38, 39, 44, 45, 46, 47, 48]);
const bodyContent = renderBody(page);
const isProjectPage = pageNumber >= 20;
const isPracticePage = page.kind.startsWith("practice-");
const ioHtml = isProjectPage && !page.hideIo
  ? `
  <div class="io-strip">
    <div class="io-cell"><b>输入</b><span>${io[pageNumber][0]}</span></div>
    <div class="io-cell"><b>产出</b><span>${io[pageNumber][1]}</span></div>
    <div class="io-cell"><b>人的判断</b><span>${io[pageNumber][2]}</span></div>
  </div>
`
  : "";
const noteHtml = page.note ? `<div class="takeaway">${page.note}</div>` : "";

root.className = `${darkPages.has(pageNumber) ? "dark-slide " : ""}${isProjectPage ? "project-slide " : ""}${isPracticePage ? "practice-slide " : ""}${page.hideIo ? "no-io " : ""}page-${pageNumber}`.trim();
root.innerHTML = isPracticePage
  ? `
    <p class="practice-kicker">${page.k}</p>
    <h1 class="practice-title">${page.h}</h1>
    <div class="practice-rule"></div>
    <div class="practice-number">${page.practiceNo}</div>
    <div class="body practice-body">${bodyContent}</div>
  `
  : `
    <h1 class="page-title">${page.k}</h1>
    <div class="body ${page.note ? "with-note" : ""}">${noteHtml}${bodyContent}</div>
    ${isProjectPage ? `<div class="section-tag">${page.sectionTag || "真实项目拆解｜鸭鸭 EP04"}</div>` : ""}
    ${ioHtml}
  `;

if (isProjectPage) {
  const moduleStartPages = [20, 22, 24, 26, 29, 32, 35, 38, 40, 43];
  const activeModule = Number.isInteger(page.moduleIndex)
    ? page.moduleIndex
    : moduleStartPages.findIndex(
        (start, index) =>
          pageNumber >= start && pageNumber < (moduleStartPages[index + 1] || Number.POSITIVE_INFINITY),
      );
  const moduleStrip = Array.from({ length: 10 }, (_, index) => {
    const state =
      index < activeModule ? "done" : index === activeModule ? "active" : "";
    return `<span class="${state}"></span>`;
  }).join("");
  root.insertAdjacentHTML(
    "beforeend",
    `<div class="module-strip">${moduleStrip}</div>`,
  );
}

const setupPageMotion = () => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const seen = new WeakSet();
  let cursor = 0;
  const add = (selector, effect = "rise", step = 58, duration = 480) => {
    const items = [...root.querySelectorAll(selector)].filter((item) => !seen.has(item));
    items.forEach((item, index) => {
      seen.add(item);
      item.classList.add("motion-item", `motion-${effect}`);
      item.style.setProperty("--motion-delay", `${Math.min(560, 70 + cursor + index * step)}ms`);
      item.style.setProperty("--motion-duration", `${duration}ms`);
    });
    if (items.length) cursor = Math.min(470, cursor + Math.min(210, items.length * step + 36));
  };

  add(".page-title", "waterfall", 0, 360);
  add(".takeaway", "wipe", 0, 420);

  const plans = {
    story: [[".story-copy", "rise"], [".media-box", "soft"]],
    "script-timeline": [[".script-copy", "soft"], [".script-beat", "rise", 52]],
    table: [[".table", "soft"]],
    "mode-cards": [[".mode-card", "pop", 54]],
    "mode-case": [[".mode-case-video", "soft"], [".mode-case-summary", "rise"], [".mode-case-assets", "soft"], [".mode-case-prompt", "rise"]],
    "reference-pair": [[".reference-pair > *", "rise", 70]],
    case: [[".case > .media-box", "soft"], [".case-notes > article", "rise", 62]],
    "watch-film": [[".watch-film-video", "soft"], [".watch-question", "rise", 64]],
    chain: [[".chain > .node", "waterfall", 48]],
    "ip-intro": [[".ip-board", "soft"], [".ip-character", "pop", 58]],
    "topic-rationale": [[".topic-hook", "wipe"], [".topic-card", "rise", 58], [".topic-boundary", "soft"]],
    "complete-story": [[".story-tab", "pop", 55], [".story-visual", "soft"], [".story-full-copy", "rise"]],
    "script-study": [[".full-script-panel", "soft"], [".script-analysis > *", "rise", 60]],
    "script-to-storyboard": [[".storyboard-script-source", "soft"], [".production-storyboard", "rise"], [".storyboard-frame", "pop", 48]],
    "full-storyboard": [[".full-storyboard-toolbar", "wipe"], [".full-storyboard-scroll", "soft"]],
    "storyboard-control": [[".control-source-facts", "soft"], [".control-locks > *", "rise", 48], [".control-prompt", "rise"], [".control-final-decision", "wipe"]],
    "generation-choice": [[".generation-choice-card", "pop", 62]],
    "keyframe-from-storyboard": [[".kfs-left > *", "rise", 56], [".kfs-board", "soft"]],
    "static-prompt-workbench": [[".spw-inputs > *", "pop", 54], [".spw-prompt", "rise"]],
    "keyframe-generation": [[".kfg-identity", "soft"], [".kfg-prompt-card", "rise"], [".kfg-result", "pop"], [".kfg-checks > *", "rise", 50]],
    "tailframe-continuity": [[".kfc-frame", "pop", 64], [".kfc-checks > *", "rise", 52]],
    "prompt-calibration-case": [[".pcc-before", "soft"], [".pcc-after", "rise"], [".pcc-evidence", "wipe"], [".pcc-principles > *", "rise", 50]],
    "full-video-prompt": [[".fvp-refs", "soft"], [".fvp-prompt", "rise"]],
    "result-showcase": [[".result-showcase-video", "soft"], [".result-points > *", "rise", 60]],
    "case-comparison-videos": [[".case-video-card", "pop", 70]],
    "post-production-grid": [[".post-production-subtitle", "soft"], [".post-production-item", "rise", 54]],
    "edit-overlay-showcase": [[".edit-showcase-inputs > figure", "pop", 64], [".edit-showcase-result", "soft"], [".edit-showcase-more > span", "rise", 48]],
    "sound-sync-case": [[".sound-case-frame", "soft"], [".sound-avatar-row > figure", "pop", 70], [".sound-lane.dialogue span", "fill"], [".sound-lane.knocks i", "pop", 45], [".sound-post-role", "rise"], [".sound-mix-priority > article", "rise", 52]],
    "quality-check": [[".quality-check-subtitle", "soft"], [".quality-check-card", "rise", 58]],
    "practice-plan": [[".practice-task-intro", "wipe"], [".practice-step-list > article", "rise", 52], [".practice-hero", "soft"], [".practice-deliverable", "rise"]],
    "practice-assets": [[".practice-asset-hero", "soft"], [".practice-asset-action", "rise", 64], [".practice-check-line", "wipe"]],
    "practice-video": [[".practice-video-step", "rise", 58], [".practice-video-visual > *", "soft", 64], [".practice-individual-output", "wipe"]],
    "practice-edit": [[".practice-clip-row article", "pop", 54], [".practice-film-result", "rise"], [".practice-finish-hero", "soft"], [".practice-final-checks > *", "rise", 46]],
    homework: [[".homework-tasks > article", "rise", 64], [".submission-pack", "soft"], [".pack-list > p", "rise", 48]],
    generic: [[".wide-points > .point, .points > .point", "rise", 58], [".split > .media-box", "soft"]],
  };

  (plans[page.kind] || [[".body > *", "soft"]]).forEach(([selector, effect, step, duration]) => {
    add(selector, effect, step, duration);
  });

  if (isProjectPage) add(".module-strip .active", "fill", 0, 520);
};

setupPageMotion();

const fullscreenVideos = [...root.querySelectorAll("[data-fullscreen-on-play]")];
fullscreenVideos.forEach((fullscreenVideo) => {
  fullscreenVideo.addEventListener("play", () => {
    if (document.fullscreenElement) return;
    const requestFullscreen =
      fullscreenVideo.requestFullscreen ||
      fullscreenVideo.webkitRequestFullscreen ||
      fullscreenVideo.msRequestFullscreen;
    if (requestFullscreen) {
      Promise.resolve(requestFullscreen.call(fullscreenVideo)).catch(() => {});
    } else if (fullscreenVideo.webkitEnterFullscreen) {
      fullscreenVideo.webkitEnterFullscreen();
    }
  });
});

const storyTabs = root.querySelector("[data-story-tabs]");
if (storyTabs) {
  const tabs = [...storyTabs.querySelectorAll("[data-story-tab]")];
  const panels = [...storyTabs.querySelectorAll("[data-story-panel]")];
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const activeIndex = tab.dataset.storyTab;
      tabs.forEach((item) => {
        const active = item.dataset.storyTab === activeIndex;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      panels.forEach((panel) => {
        const active = panel.dataset.storyPanel === activeIndex;
        panel.classList.toggle("is-active", active);
        panel.hidden = !active;
      });
    });
  });
}

function loadTextAsset(sourceUrl) {
  const assetName = decodeURIComponent(sourceUrl.split("/").pop().split("?")[0]);
  const offlineAssets = window.__OFFLINE_TEXT_ASSETS__ || {};
  if (Object.prototype.hasOwnProperty.call(offlineAssets, assetName)) {
    return Promise.resolve(offlineAssets[assetName]);
  }
  return fetch(sourceUrl).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  });
}

const fullScriptCopy = root.querySelector("[data-script-source]");
if (fullScriptCopy) {
  loadTextAsset(fullScriptCopy.dataset.scriptSource)
    .then((scriptText) => {
      fullScriptCopy.textContent = scriptText;
    })
    .catch(() => {
      fullScriptCopy.textContent = "完整脚本载入失败，请刷新页面后重试。";
    });
}

const fullStoryboard = root.querySelector("[data-storyboard-source]");
if (fullStoryboard) {
  loadTextAsset(fullStoryboard.dataset.storyboardSource)
    .then((storyboardText) => {
      const lines = storyboardText.split(/\r?\n/);
      const headerIndex = lines.findIndex((line) => line.startsWith("| 编号 |"));
      if (headerIndex < 0) throw new Error("storyboard table not found");
      const parsedRows = [];
      for (let index = headerIndex + 2; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.startsWith("|")) break;
        const cells = line
          .slice(1, -1)
          .split(/(?<!\\)\|/)
          .map((cell) => cell.trim().replace(/\\\|/g, "|"));
        if (cells.length === 8) parsedRows.push(cells);
      }
      const tbody = fullStoryboard.querySelector("tbody");
      tbody.innerHTML = parsedRows
        .map((row) => {
          const sourceText = row.join(" ");
          const isFocus = /SH09-B|SH09-C|SH11/.test(sourceText);
          return `<tr class="${isFocus ? "is-focus" : ""}">${row
            .map((cell) => `<td>${cell}</td>`)
            .join("")}</tr>`;
        })
        .join("");
    })
    .catch(() => {
      fullStoryboard.querySelector("tbody").innerHTML =
        '<tr><td colspan="8" class="storyboard-loading">完整分镜表载入失败，请刷新页面后重试。</td></tr>';
    });
}
