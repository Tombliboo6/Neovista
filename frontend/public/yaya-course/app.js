const deck = document.getElementById('deck');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const menuBtn = document.getElementById('menuBtn');
const fullBtn = document.getElementById('fullBtn');
const closeMenuBtn = document.getElementById('closeMenuBtn');
const menuPanel = document.getElementById('menuPanel');
const menuList = document.getElementById('menuList');
const progressBar = document.getElementById('progressBar');
const counter = document.getElementById('counter');
const sourcePanel = document.getElementById('sourcePanel');
const sourceList = document.getElementById('sourceList');
const sourceTitle = document.getElementById('sourceTitle');
const closeSourceBtn = document.getElementById('closeSourceBtn');

const slidesData = Array.isArray(window.COURSE_SLIDES) ? window.COURSE_SLIDES : [];
let slides = [];
let index = 0;
let touchStartX = null;
let touchStartY = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pageNumber(value) {
  return String(value + 1).padStart(2, '0');
}

function coverMarkup(slide, slideIndex, total) {
  return `
    <div class="cover-shell">
      <header class="slide-top">
        <div class="slide-index"><span>${pageNumber(slideIndex)}</span><b>${escapeHtml(slide.section)}</b></div>
        <strong>SESSION 01</strong>
      </header>
      <main class="cover-main">
        <div class="cover-copy">
          <small>${escapeHtml(slide.eyebrow || '')}</small>
          <h1>${escapeHtml(slide.title)}</h1>
          <div class="gold-line"></div>
          <h2>${escapeHtml(slide.lead || '')}</h2>
          <p>${escapeHtml(slide.sub || '')}</p>
        </div>
        <div class="cover-characters" aria-label="鸭鸭特工队三只固定IP角色">
          <figure class="duck fantuan"><img src="assets/ip/cover-fantuan.png" alt="饭团单独透明人物形象"><figcaption>饭团</figcaption></figure>
          <figure class="duck xiaoxiao"><img src="assets/ip/cover-xiaoxiao.png" alt="小小单独透明人物形象"><figcaption>小小</figcaption></figure>
          <figure class="duck mantou"><img src="assets/ip/cover-mantou.png" alt="馒头单独透明人物形象"><figcaption>馒头</figcaption></figure>
        </div>
      </main>
      <footer class="slide-footer"><span>霄启数智x四川农业大学学生处</span><span>${pageNumber(slideIndex)} / ${String(total).padStart(2, '0')}</span></footer>
    </div>`;
}

function sourceButton(slide, slideIndex) {
  if (!Array.isArray(slide.sources) || !slide.sources.length) return '';
  return `<button class="source-button" type="button" data-source-slide="${slideIndex}">资料来源 ${slide.sources.length}</button>`;
}

function slideMarkup(slide, slideIndex, total) {
  return `
    <div class="slide-shell">
      <header class="slide-top">
        <div class="slide-index"><span>${pageNumber(slideIndex)}</span><b>${escapeHtml(slide.section)}</b></div>
        <strong>SESSION 01</strong>
      </header>
      <main class="slide-main layout-${escapeHtml(slide.layout || 'default')}">
        <div class="title-block">
          ${slide.eyebrow ? `<small>${escapeHtml(slide.eyebrow)}</small>` : ''}
          <h2>${escapeHtml(slide.title)}</h2>
          ${slide.lead ? `<p>${escapeHtml(slide.lead)}</p>` : ''}
        </div>
        <div class="slide-content">${slide.html || ''}</div>
      </main>
      <footer class="slide-footer">
        <span>霄启数智x四川农业大学学生处</span>
        <div>${sourceButton(slide, slideIndex)}<span>${pageNumber(slideIndex)} / ${String(total).padStart(2, '0')}</span></div>
      </footer>
    </div>`;
}

function createSlide(slide, slideIndex, total) {
  const section = document.createElement('section');
  section.className = `slide ${slide.theme === 'dark' ? 'theme-dark' : 'theme-paper'} layout-root-${slide.layout || 'default'}`;
  section.dataset.label = slide.nav || slide.title;
  section.dataset.section = slide.section;
  section.innerHTML = slide.layout === 'cover'
    ? coverMarkup(slide, slideIndex, total)
    : slideMarkup(slide, slideIndex, total);
  section.querySelectorAll('img').forEach((image) => {
    image.decoding = 'async';
    image.loading = Math.abs(slideIndex - index) <= 1 ? 'eager' : 'lazy';
    if (Math.abs(slideIndex - index) > 1 && image.hasAttribute('src')) {
      image.dataset.src = image.getAttribute('src');
      image.removeAttribute('src');
    }
  });
  section.querySelectorAll('video').forEach((video) => {
    if (Math.abs(slideIndex - index) > 1) {
      video.preload = 'none';
      video.querySelectorAll('source[src]').forEach((source) => {
        source.dataset.src = source.getAttribute('src');
        source.removeAttribute('src');
      });
    }
  });
  return section;
}

function loadSlideMedia(slideIndex) {
  const slide = slides[slideIndex];
  if (!slide) return;
  slide.querySelectorAll('img[data-src]').forEach((image) => {
    image.src = image.dataset.src;
    image.removeAttribute('data-src');
    image.loading = 'eager';
  });
  slide.querySelectorAll('video').forEach((video) => {
    let restored = false;
    video.querySelectorAll('source[data-src]').forEach((source) => {
      source.src = source.dataset.src;
      source.removeAttribute('data-src');
      restored = true;
    });
    if (restored) {
      video.preload = 'metadata';
      video.load();
    }
  });
}

function buildDeck() {
  if (!slidesData.length) {
    deck.innerHTML = '<section class="loading-slide"><strong>课堂内容没有载入</strong></section>';
    return;
  }
  deck.innerHTML = '';
  slidesData.forEach((slide, slideIndex) => {
    deck.appendChild(createSlide(slide, slideIndex, slidesData.length));
  });
  slides = Array.from(deck.querySelectorAll('.slide'));
  deck.querySelectorAll('img').forEach((image) => {
    image.addEventListener('error', () => image.closest('figure, .case-visual')?.classList.add('image-missing'));
  });
  deck.querySelectorAll('.source-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openSources(Number(button.dataset.sourceSlide));
    });
  });
}

function buildMenu() {
  const groups = new Map();
  slidesData.forEach((slide, slideIndex) => {
    if (!groups.has(slide.section)) groups.set(slide.section, []);
    groups.get(slide.section).push({ slide, slideIndex });
  });
  menuList.innerHTML = '';
  groups.forEach((items, sectionName) => {
    const group = document.createElement('section');
    group.className = 'menu-group';
    group.innerHTML = `<h3>${escapeHtml(sectionName)}</h3>`;
    const list = document.createElement('div');
    items.forEach(({ slide, slideIndex }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu-item';
      button.dataset.slide = String(slideIndex);
      button.innerHTML = `<small>${pageNumber(slideIndex)}</small><span>${escapeHtml(slide.nav || slide.title)}</span>`;
      button.addEventListener('click', () => {
        setSlide(slideIndex);
        closeMenu();
      });
      list.appendChild(button);
    });
    group.appendChild(list);
    menuList.appendChild(group);
  });
}

function readHashIndex() {
  const match = location.hash.match(/\d+/);
  if (!match || !slides.length) return 0;
  const requested = Number.parseInt(match[0], 10) - 1;
  return Math.max(0, Math.min(slides.length - 1, Number.isFinite(requested) ? requested : 0));
}

function updateChrome() {
  const number = pageNumber(index);
  progressBar.style.width = `${((index + 1) / slides.length) * 100}%`;
  counter.textContent = `${number} / ${String(slides.length).padStart(2, '0')}`;
  if (location.hash !== `#${number}`) history.replaceState(null, '', `#${number}`);
  menuList.querySelectorAll('.menu-item').forEach((item) => {
    item.classList.toggle('active', Number(item.dataset.slide) === index);
  });
  prevBtn.disabled = index === 0;
  nextBtn.disabled = index === slides.length - 1;
  document.title = `${slidesData[index].title}｜AIGC课程`;
}

function setSlide(nextIndex, immediate = false) {
  if (!slides.length) return;
  const target = Math.max(0, Math.min(slides.length - 1, nextIndex));
  loadSlideMedia(target);
  loadSlideMedia(target + 1);
  const current = slides[index];
  if (current && target !== index) {
    current.classList.remove('active');
    if (!immediate) {
      current.classList.add('leaving');
      window.setTimeout(() => current.classList.remove('leaving'), 360);
    }
  }
  index = target;
  slides[index].classList.add('active');
  updateChrome();
}

function openMenu() {
  closeSources();
  menuPanel.classList.add('open');
  menuPanel.setAttribute('aria-hidden', 'false');
  menuList.querySelector('.menu-item.active')?.scrollIntoView({ block: 'center' });
}

function closeMenu() {
  menuPanel.classList.remove('open');
  menuPanel.setAttribute('aria-hidden', 'true');
}

function openSources(slideIndex) {
  const slide = slidesData[slideIndex];
  if (!slide?.sources?.length) return;
  closeMenu();
  sourceTitle.textContent = slide.title;
  sourceList.innerHTML = slide.sources.map((source, sourceIndex) => `
    <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">
      <small>${String(sourceIndex + 1).padStart(2, '0')}</small>
      <span>${escapeHtml(source.label)}</span>
      <b>↗</b>
    </a>`).join('');
  sourcePanel.classList.add('open');
  sourcePanel.setAttribute('aria-hidden', 'false');
}

function closeSources() {
  sourcePanel.classList.remove('open');
  sourcePanel.setAttribute('aria-hidden', 'true');
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen().catch(() => {});
  else await document.exitFullscreen().catch(() => {});
}

function bindControls() {
  prevBtn.addEventListener('click', () => setSlide(index - 1));
  nextBtn.addEventListener('click', () => setSlide(index + 1));
  menuBtn.addEventListener('click', openMenu);
  closeMenuBtn.addEventListener('click', closeMenu);
  fullBtn.addEventListener('click', toggleFullscreen);
  closeSourceBtn.addEventListener('click', closeSources);

  document.addEventListener('keydown', (event) => {
    if (menuPanel.classList.contains('open')) {
      if (event.key === 'Escape') closeMenu();
      return;
    }
    if (sourcePanel.classList.contains('open')) {
      if (event.key === 'Escape') closeSources();
      return;
    }
    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      setSlide(index + 1);
    }
    if (['ArrowLeft', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      setSlide(index - 1);
    }
    if (event.key === 'Home') setSlide(0);
    if (event.key === 'End') setSlide(slides.length - 1);
    if (event.key.toLowerCase() === 'm') openMenu();
    if (event.key.toLowerCase() === 'f') toggleFullscreen();
  });

  document.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0].clientX;
    touchStartY = event.changedTouches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', (event) => {
    if (touchStartX === null || touchStartY === null || menuPanel.classList.contains('open') || sourcePanel.classList.contains('open')) return;
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    const deltaY = event.changedTouches[0].clientY - touchStartY;
    touchStartX = null;
    touchStartY = null;
    if (Math.abs(deltaX) < 54 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
    setSlide(index + (deltaX < 0 ? 1 : -1));
  }, { passive: true });

  window.addEventListener('hashchange', () => {
    const target = readHashIndex();
    if (target !== index) setSlide(target);
  });
}

index = (() => {
  const match = location.hash.match(/\d+/);
  if (!match || !slidesData.length) return 0;
  const requested = Number.parseInt(match[0], 10) - 1;
  return Math.max(0, Math.min(slidesData.length - 1, Number.isFinite(requested) ? requested : 0));
})();
buildDeck();
buildMenu();
bindControls();
index = readHashIndex();
if (slides.length) {
  loadSlideMedia(index);
  loadSlideMedia(index + 1);
  slides[index].classList.add('active');
  updateChrome();
}

window.__courseDebug = {
  renderedSlideCount: slides.length,
  sections: [...new Set(slidesData.map((slide) => slide.section))],
  titles: slidesData.map((slide) => slide.title),
  layouts: slidesData.map((slide) => slide.layout),
  sourceCounts: slidesData.map((slide) => slide.sources?.length || 0)
};
