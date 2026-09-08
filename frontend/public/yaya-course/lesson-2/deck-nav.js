(() => {
  const scriptUrl = new URL(document.currentScript.src);
  const lessonRoot = new URL("./", scriptUrl);
  const pageOrder = [1,2,3,4,6,7,8,5,45,9,10,49,11,50,12,51,13,52,15,16,17,20,22,23,24,25,26,27,29,30,32,33,35,36,37,38,39,40,41,42,43,44];
  const pageLabels = {"1":"封面","2":"今天完成五项个人练习","3":"课程结构","4":"从想法到成片的完整流程","5":"图片提示词的五段结构","6":"故事","7":"脚本","8":"文字分镜","9":"四种视频生成方式","10":"文生视频｜从零创造世界","11":"图生视频｜让一张好画面动起来","12":"首尾帧｜锁定明确的起点和终点","13":"全能参考｜用路线图指挥运镜","14":"补充能力","15":"摄影语言：景别与机位","16":"摄影语言：运镜与视角","17":"三个案例，三种观察重点","18":"《钟馗嫁妹》","19":"《慢半拍的爱》","20":"看成片","22":"认识鸭鸭特工队","23":"选题依据","24":"完整故事","25":"故事到脚本","26":"脚本到分镜","27":"完整分镜表","28":"提取控制要求","29":"三个镜头，三种参考选择","30":"完整案例：踱步到抱头","31":"首帧提示词：写清动作起点","32":"首帧制作：角色参考与固定描述","33":"尾帧制作：确定结束状态","34":"视频提示词：写清动作过程","35":"四图分工与完整视频提示词","36":"案例成片：踱步到抱头","37":"参考素材各自负责什么","38":"筛选：动作做了，结果合格吗","39":"看生成结果，针对问题调整","40":"后期剪辑","41":"后期：把准确文字贴进画面","42":"声音：对准动作，听清关系","43":"个人结果检查","44":"课后创作｜你的角色，你的短片","45":"个人实操","46":"个人实操｜首帧生视频","47":"个人实操｜首尾帧生视频","48":"个人实操","49":"个人实操","50":"首帧实操｜失重抢饼干","51":"首尾帧实操｜纸箱飞船升级","52":"全能参考实操｜饭团城市摆荡"};
  const query = new URLSearchParams(location.search);
  const isKimiPage = location.pathname.includes("/kimi-pages/");
  const requestedPage = Number(query.get(isKimiPage ? "slide" : "page"));
  const inferredPage = isKimiPage ? 6 : 1;
  const currentPage = pageOrder.includes(requestedPage) ? requestedPage : inferredPage;
  const currentIndex = pageOrder.indexOf(currentPage);

  const createElement = (tagName, attributes = {}, text = "") => {
    const element = document.createElement(tagName);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    element.textContent = text;
    return element;
  };

  const stage = createElement("main", { id: "deck-stage" });
  const canvas = createElement("div", { id: "deck-canvas" });
  const contentNodes = [document.getElementById("slide") || document.getElementById("p01")];

  contentNodes.filter(Boolean).forEach((node) => canvas.appendChild(node));
  stage.appendChild(canvas);
  document.body.prepend(stage);

  const controls = createElement("nav", {
    id: "deck-controls",
    "aria-label": "幻灯片翻页",
  });
  const previousButton = createElement(
    "button",
    { id: "deck-prev", type: "button", "aria-label": "上一页" },
    "←",
  );
  const nextButton = createElement(
    "button",
    { id: "deck-next", type: "button", "aria-label": "下一页" },
    "→",
  );
  const menuButton = createElement("button", { id: "deck-menu", type: "button" }, "目录");
  const fullscreenButton = createElement(
    "button",
    { id: "deck-fullscreen", type: "button", "aria-label": "全屏" },
    "全屏",
  );
  const progress = createElement("div", { id: "deck-progress" });
  progress.appendChild(createElement("i"));
  const counter = createElement(
    "span",
    { id: "deck-counter", "aria-live": "polite" },
    `${String(currentIndex + 1).padStart(2, "0")} / ${String(pageOrder.length).padStart(2, "0")}`,
  );
  controls.append(previousButton, nextButton, menuButton, fullscreenButton, progress, counter);
  document.body.append(controls);

  const dialog = createElement("dialog", { id: "deck-toc" });
  const dialogHead = createElement("div", { class: "deck-toc-head" });
  dialogHead.append(
    createElement("strong", {}, "课程目录"),
    createElement("button", { id: "deck-toc-close", type: "button" }, "关闭 ESC"),
  );
  const dialogList = createElement("div", { id: "deck-toc-list" });
  dialog.append(dialogHead, dialogList);
  document.body.append(dialog);

  const pageUrl = (pageNumber) => {
    const filename = pageNumber === 1 ? "index.html" : pageNumber >= 6 && pageNumber <= 13 ? "kimi-pages/classic.html" : "kimi-pages/index.html";
    const url = new URL(filename, lessonRoot);
    url.searchParams.set(pageNumber === 1 ? "page" : "slide", String(pageNumber));
    url.searchParams.set("n", String(pageOrder.indexOf(pageNumber) + 1));
    url.searchParams.set("total", String(pageOrder.length));
    return url;
  };
  if (!isKimiPage && currentPage !== 1) { location.replace(pageUrl(currentPage)); return; }

  const pageLabel = (pageNumber) => pageLabels[pageNumber] || `第 ${pageNumber} 页`;

  pageOrder.forEach((pageNumber, index) => {
    const button = createElement("button", { type: "button" });
    button.append(
      createElement("b", {}, String(index + 1).padStart(2, "0")),
      createElement("span", {}, pageLabel(pageNumber)),
    );
    button.classList.toggle("active", index === currentIndex);
    button.addEventListener("click", () => location.assign(pageUrl(pageNumber)));
    dialogList.append(button);
  });

  const showIndex = (nextIndex) => {
    const boundedIndex = Math.max(0, Math.min(pageOrder.length - 1, nextIndex));
    if (boundedIndex === currentIndex) return;
    location.assign(pageUrl(pageOrder[boundedIndex]));
  };

  previousButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === pageOrder.length - 1;
  progress.firstElementChild.style.width = `${((currentIndex + 1) / pageOrder.length) * 100}%`;

  previousButton.addEventListener("click", () => showIndex(currentIndex - 1));
  nextButton.addEventListener("click", () => showIndex(currentIndex + 1));
  menuButton.addEventListener("click", () => dialog.showModal());
  document.getElementById("deck-toc-close").addEventListener("click", () => dialog.close());
  fullscreenButton.addEventListener("click", async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  });

  const fitDeck = () => {
    const scale = Math.min(stage.clientWidth / 1920, stage.clientHeight / 1080);
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };

  addEventListener("resize", fitDeck);
  addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea, select, button") || event.target.isContentEditable) return;
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      showIndex(currentIndex + 1);
    } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      showIndex(currentIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      showIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      showIndex(pageOrder.length - 1);
    }
  });

  fitDeck();
  window.focus();
})();
