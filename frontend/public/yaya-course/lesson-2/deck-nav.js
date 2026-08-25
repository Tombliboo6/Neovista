(() => {
  const scriptUrl = new URL(document.currentScript.src);
  const lessonRoot = new URL("./", scriptUrl);
  const validPages = Array.from({ length: 44 }, (_, index) => index + 1).filter(
    (pageNumber) => pageNumber !== 14 && pageNumber !== 28,
  );
  const query = new URLSearchParams(location.search);
  const isKimiPage = location.pathname.includes("/kimi-pages/");
  const requestedPage = Number(query.get(isKimiPage ? "slide" : "page"));
  const inferredPage = isKimiPage ? 6 : 1;
  const currentPage = validPages.includes(requestedPage) ? requestedPage : inferredPage;
  const currentIndex = validPages.indexOf(currentPage);

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

  const hint = createElement("div", { id: "deck-hint" }, "键盘：← → / PageUp PageDown / 空格");
  const controls = createElement("nav", {
    id: "deck-controls",
    "aria-label": "幻灯片翻页",
  });
  const previousButton = createElement(
    "button",
    { id: "deck-prev", type: "button", "aria-label": "上一页" },
    "← 上一页",
  );
  const counter = createElement(
    "span",
    { id: "deck-counter", "aria-live": "polite" },
    `${currentIndex + 1} / ${validPages.length}`,
  );
  const nextButton = createElement(
    "button",
    { id: "deck-next", type: "button", "aria-label": "下一页" },
    "下一页 →",
  );
  const fullscreenButton = createElement(
    "button",
    { id: "deck-fullscreen", type: "button", "aria-label": "全屏" },
    "全屏",
  );

  controls.append(previousButton, counter, nextButton, fullscreenButton);
  document.body.append(hint, controls);

  previousButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === validPages.length - 1;

  const fitDeck = () => {
    const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };

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

  const showIndex = (nextIndex) => {
    const boundedIndex = Math.max(0, Math.min(validPages.length - 1, nextIndex));
    if (boundedIndex === currentIndex) return;
    location.assign(pageUrl(validPages[boundedIndex]));
  };

  previousButton.addEventListener("click", () => showIndex(currentIndex - 1));
  nextButton.addEventListener("click", () => showIndex(currentIndex + 1));
  fullscreenButton.addEventListener("click", async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  });

  addEventListener("resize", fitDeck);
  addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea, select, button") || event.target.isContentEditable) {
      return;
    }
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
      showIndex(validPages.length - 1);
    }
  });

  fitDeck();
  window.focus();
})();
