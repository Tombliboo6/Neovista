(() => {
  const scriptUrl = new URL(document.currentScript.src);
  const lessonRoot = new URL("./", scriptUrl);
  const pageOrder = [
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21,
    45,
    22, 23, 24, 25, 26, 27, 29, 30, 31, 32, 33,
    46,
    34, 35, 36,
    47,
    37, 38, 39, 40, 41, 42,
    48,
    43, 44,
  ];
  const introLabels = {
    1: "封面",
    2: "课程目标",
    3: "课程结构",
    4: "完整流程",
    5: "选题",
  };
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
  const contentNodes = isKimiPage
    ? [document.getElementById("slide")]
    : [...document.querySelectorAll(".scene, #root-clock")];

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
    if (pageNumber <= 5) {
      const url = new URL("index.html", lessonRoot);
      url.searchParams.set("page", String(pageNumber));
      url.searchParams.set("at", String((pageNumber - 1) * 8 + 4));
      return url;
    }
    const url = new URL("kimi-pages/index.html", lessonRoot);
    url.searchParams.set("slide", String(pageNumber));
    return url;
  };

  const pageLabel = (pageNumber) => {
    if (pageNumber <= 5) return introLabels[pageNumber];
    if (typeof slides !== "undefined" && slides[pageNumber]) {
      return `${slides[pageNumber].k}｜${slides[pageNumber].h}`;
    }
    return `第 ${pageNumber} 页`;
  };

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
