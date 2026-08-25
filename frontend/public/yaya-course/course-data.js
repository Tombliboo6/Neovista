const SOURCE = {
  dartmouth: { label: 'Dartmouth AI 史', url: 'https://ai.dartmouth.edu/our-story' },
  alexnet: { label: 'AlexNet 论文', url: 'https://papers.nips.cc/paper_files/paper/2012/hash/c399862d3b9d6b76c8436e924a68c45b-Abstract.html' },
  gan: { label: 'GAN 论文', url: 'https://papers.nips.cc/paper_files/paper/2014/hash/f033ed80deb0234979a61f95710dbe25-Abstract.html' },
  transformer: { label: 'Transformer 论文', url: 'https://arxiv.org/abs/1706.03762' },
  diffusion: { label: '扩散模型论文', url: 'https://arxiv.org/abs/2006.11239' },
  stableDiffusion: { label: '潜空间扩散论文', url: 'https://arxiv.org/abs/2112.10752' },
  chatgpt: { label: 'OpenAI · ChatGPT', url: 'https://openai.com/index/chatgpt/' },
  soraHistory: { label: 'OpenAI · Sora 研究', url: 'https://openai.com/index/video-generation-models-as-world-simulators/' },
  adobeCreators2026: { label: 'Adobe · 2026 Creators’ Toolkit Report', url: 'https://news.adobe.com/news/2026/06/creators-toolkit-report-2026' },
  gpt56: { label: 'OpenAI · GPT-5.6', url: 'https://openai.com/index/gpt-5-6/' },
  gptImage2: { label: 'OpenAI · GPT Image 2', url: 'https://openai.com/index/introducing-chatgpt-images-2-0/' },
  sora2: { label: 'OpenAI · Sora 2 状态', url: 'https://openai.com/index/sora-2/' },
  claude5: { label: 'Anthropic · Claude Fable 5 / Mythos 5', url: 'https://www.anthropic.com/news/claude-fable-5-mythos-5' },
  gemini36: { label: 'Google · Gemini 3.6 Flash', url: 'https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/' },
  nanoBanana2: { label: 'Google · Nano Banana 2', url: 'https://blog.google/innovation-and-ai/technology/developers-tools/build-with-nano-banana-2/' },
  veo31: { label: 'Google · Veo 3.1', url: 'https://blog.google/innovation-and-ai/technology/ai/veo-3-1-ingredients-to-video/' },
  deepseek: { label: 'DeepSeek · V4', url: 'https://api-docs.deepseek.com/news/news260424/' },
  kimi: { label: 'Moonshot · Kimi K3', url: 'https://www.moonshot.cn/en' },
  glm52: { label: '智谱 · GLM-5.2', url: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2' },
  glmImage: { label: '智谱 · GLM-Image', url: 'https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image' },
  seedream: { label: '字节 Seed · Seedream 5.0 Lite', url: 'https://seed.bytedance.com/en/blog/deeper-thinking-more-accurate-generation-introducing-seedream-5-0-lite' },
  seedance: { label: '字节 Seed · Seedance 2.0', url: 'https://seed.bytedance.com/blog/seedance-2-0-official-launch' },
  kling: { label: '可灵 · Video 3.0', url: 'https://app.klingai.com/cn/quickstart/klingai-video-3-model-user-guide' },
  minimax: { label: 'MiniMax · H3', url: 'https://www.minimax.io/blog/minimax-h3' },
  runway: { label: 'Runway · Gen-4', url: 'https://runwayml.com/research/introducing-runway-gen-4' },
  jobsFull: { label: '猎聘 · AIGC 视频岗位样本', url: 'https://www.liepin.com/zpshipinbianjizhizuo/' },
  jobsEntry: { label: '猎聘 · AIGC 视频设计师样本', url: 'https://m.liepin.com/s/aigcltsjsi2rsazf/' },
  jobsIntern: { label: '牛客 · AIGC 内容创作实习样本', url: 'https://www.nowcoder.com/jobs/detail/444848' },
  jobsVideoIntern: { label: '牛客 · AI 视频生成运营实习样本', url: 'https://www.nowcoder.com/jobs/detail/362424' },
  mushroomVideo: { label: '抖音 · 小蘑菇秃秃《煮面条》', url: 'https://www.douyin.com/video/7636075646120152366' },
  mushroomBrand: { label: 'SocialBeta · M Stand × 小蘑菇秃秃', url: 'https://socialbeta.com/campaign/27698' },
  xinliyaFans: { label: '心理鸭 · 公开账号数据快照', url: 'https://toobigdata.com/red/xinliya22/' },
  zombie: { label: 'Bilibili ·《丧尸清道夫》案例报道', url: 'https://www.bilibili.com/video/BV1vT5t6GEx3/' },
  zombieProcess: { label: 'Bilibili · Mx-Shell 创作流程分享', url: 'https://www.bilibili.com/video/BV1G25v6fERZ/' },
  commercialGallery: { label: '一镜到底 · AIGC商业案例库', url: 'https://www.one-take.cn/case' },
  commercialVideo: { label: '京东物流《世界再大，心意总会抵达》', url: 'https://newshare-one-shot.oss-cn-beijing.aliyuncs.com/%E4%B8%80%E9%95%9C%E5%88%B0%E5%BA%95%E7%BD%91%E7%AB%99/AI%E8%A7%86%E9%A2%91/%E4%BA%AC%E4%B8%9C%E7%89%A9%E6%B5%81%E4%B8%96%E7%95%8C%E5%86%8D%E5%A4%A7%20%E5%BF%83%E6%84%8F%E6%80%BB%E4%BC%9A%E6%8A%B5%E8%BE%BE-AIGC%E5%88%9B%E6%84%8F%E8%A7%86%E9%A2%91-.mp4' }
};

window.COURSE_SLIDES = [
  {
    section: '课程内容介绍',
    title: 'AIGC课程',
    nav: '封面',
    layout: 'cover',
    theme: 'dark',
    eyebrow: 'AIGC COURSE · SESSION 01',
    lead: '从模型全貌到鸭鸭共创',
    sub: '看懂工具，走通流程，找到自己愿意先试的位置。'
  },
  {
    section: '课程内容介绍',
    title: '课程内容介绍',
    layout: 'agenda',
    theme: 'dark',
    html: `
      <div class="agenda-grid">
        <div class="agenda-item"><b>01</b><span>课程简介</span></div>
        <div class="agenda-item"><b>02</b><span>AI发展背景</span></div>
        <div class="agenda-item"><b>03</b><span>鸭鸭视频背景</span></div>
        <div class="agenda-item"><b>04</b><span>你们能够获得什么</span></div>
        <div class="agenda-item"><b>05</b><span>AI工具介绍</span></div>
        <div class="agenda-item"><b>06</b><span>AI视频工作流</span></div>
        <div class="agenda-item"><b>07</b><span>热门作品解析</span></div>
        <div class="agenda-item"><b>08</b><span>作业与问题解答</span></div>
      </div>`
  },
  {
    section: '课程内容介绍',
    title: '个人介绍',
    layout: 'profile',
    eyebrow: '周文龙',
    html: `
      <div class="profile-grid">
        <div class="profile-mark profile-name"><span>周文龙</span></div>
        <div class="profile-facts">
          <div><b>川农风景园林</b></div>
          <div><b>LSU 流域水文实验室</b></div>
          <div><b>霄启数智</b><p>正在做 AI 视频、AI 工作流与 NeoVista 生成平台<br><a href="https://neovista.cn" target="_blank" rel="noopener">neovista.cn ↗</a></p></div>
        </div>
      </div>`
  },
  {
    section: '课程内容介绍',
    title: 'AIGC',
    layout: 'visual',
    lead: '生成式AI处理的是不同形态的数字内容，一条AI视频会同时用到它们。',
    html: `
      <div class="visual-split visual-split-wide">
        <figure class="visual-panel media-contain"><img src="assets/generated/ai-tool-categories-v1.jpg" alt="文字、图片与视频模型协作完成内容任务的示意图"></figure>
        <div class="compact-media-grid">
          <article data-mark="文"><i>文</i><b>文字</b><p>选题、资料、脚本、分镜与提示词</p><small>决定讲什么</small></article>
          <article data-mark="图"><i>图</i><b>图片</b><p>角色板、场景板、关键帧与封面</p><small>决定长什么样</small></article>
          <article data-mark="声"><i>声</i><b>声音</b><p>对白、旁白、音乐与环境音</p><small>决定什么情绪</small></article>
          <article data-mark="影"><i>影</i><b>视频</b><p>表演、动作、镜头运动与剪辑</p><small>决定怎样发生</small></article>
        </div>
      </div>`
  },
  {
    section: '课程内容介绍',
    title: 'AI视频',
    layout: 'ai-video',
    lead: 'AI视频，就是用人工智能生成、修改或协助完成视频。',
    html: `
      <div class="ai-video-intro">
        <div class="ai-video-mode-heading"><b>按照输入素材区分</b><span>点击播放几秒示例，卡片下方可打开官方完整视频</span></div>
        <div class="ai-video-mode-grid">
          <article class="ai-video-mode-card">
            <video muted loop playsinline controls preload="metadata" aria-label="文生视频短示例">
              <source src="assets/examples/ai-video-t2v-seedance-demo.mp4" type="video/mp4">
            </video>
            <div class="ai-video-mode-copy">
              <header><small>TEXT → VIDEO</small><b>文生视频</b></header>
              <p>只输入文字，模型直接生成动态镜头。</p>
              <span><i>例子</i>输入一段爵士舞描述，生成约4秒双人舞。</span>
              <a href="https://lf3-static.bytednsdoc.com/obj/eden-cn/lapzild-tss/ljhwZthlaukjlkulzlp/user-upload/4uec3mljdroek.mp4" target="_blank" rel="noopener noreferrer">官方完整示例 ↗</a>
            </div>
          </article>
          <article class="ai-video-mode-card">
            <video muted loop playsinline controls preload="metadata" aria-label="图生视频短示例">
              <source src="assets/examples/ai-video-i2v-seedance-demo.mp4" type="video/mp4">
            </video>
            <div class="ai-video-mode-copy">
              <header><small>IMAGE → VIDEO</small><b>图生视频</b></header>
              <p>输入一张图片，让静态人物和场景产生动作。</p>
              <span><i>例子</i>输入晾衣服的女孩图片，让她取衣并抖开。</span>
              <a href="https://lf3-static.bytednsdoc.com/obj/eden-cn/lapzild-tss/ljhwZthlaukjlkulzlp/user-upload/3bnsnmneog23u.mov" target="_blank" rel="noopener noreferrer">官方完整示例 ↗</a>
            </div>
          </article>
          <article class="ai-video-mode-card">
            <video muted loop playsinline controls preload="metadata" aria-label="视频生视频短示例">
              <source src="assets/examples/ai-video-v2v-seedance-demo.mp4" type="video/mp4">
            </video>
            <div class="ai-video-mode-copy">
              <header><small>VIDEO → VIDEO</small><b>视频生视频</b></header>
              <p>输入已有视频，参考动作、运镜或内容继续生成。</p>
              <span><i>例子</i>输入骑马片段，让AI延长并续拍后续动作。</span>
              <a href="https://lf3-static.bytednsdoc.com/obj/eden-cn/lapzild-tss/ljhwZthlaukjlkulzlp/user-upload/4uec3mljdmuj3.mp4" target="_blank" rel="noopener noreferrer">官方完整示例 ↗</a>
            </div>
          </article>
          <article class="ai-video-mode-card">
            <video muted loop playsinline controls preload="metadata" aria-label="多模态参考生成短示例">
              <source src="assets/examples/ai-video-multimodal-seedance-demo.mp4" type="video/mp4">
            </video>
            <div class="ai-video-mode-copy">
              <header><small>MULTIMODAL</small><b>多模态生成</b></header>
              <p>组合文字、图片、视频或声音，分别控制不同内容。</p>
              <span><i>例子</i>同时输入脚本、人物、场景和道具参考图。</span>
              <a href="https://lf3-static.bytednsdoc.com/obj/eden-cn/lapzild-tss/ljhwZthlaukjlkulzlp/user-upload/4uec3mljde9rv.mp4" target="_blank" rel="noopener noreferrer">官方完整示例 ↗</a>
            </div>
          </article>
        </div>
        <div class="ai-video-basic-flow">
          <b>一条完整AI视频</b>
          <div>
            <span><i>01</i><b>选题</b><small>确定讲什么</small></span>
            <span><i>02</i><b>脚本</b><small>写清事件顺序</small></span>
            <span><i>03</i><b>分镜</b><small>拆成单个镜头</small></span>
            <span><i>04</i><b>关键帧</b><small>定角色、场景和构图</small></span>
            <span><i>05</i><b>视频生成</b><small>让每个镜头动起来</small></span>
            <span><i>06</i><b>剪辑</b><small>选择并连接镜头</small></span>
            <span><i>07</i><b>发布</b><small>准备成片、封面和文案</small></span>
            <span><i>08</i><b>复盘</b><small>根据反馈修改下一条</small></span>
          </div>
        </div>
      </div>
      <p class="ai-video-summary"><b>生成类型</b><span>说明单个镜头怎么产生</span><i></i><b>基本步骤</b><span>说明一条完整视频怎么完成</span></p>`,
    sources: [SOURCE.seedance]
  },
  {
    section: '课程内容介绍',
    title: '前一步越清晰，后一步返工越少',
    layout: 'statement',
    theme: 'dark',
    html: `
      <div class="statement-grid">
        <blockquote>前一步越清晰<br>后一步返工越少</blockquote>
        <div class="analogy-card"><small>像盖房子</small><p>施工前先看图纸。图纸每模糊一处，后面就多拆一次墙。</p></div>
      </div>
      <div class="chain"><span>选题</span><i>→</i><span>脚本</span><i>→</i><span>分镜</span><i>→</i><span>关键帧</span><i>→</i><span>视频</span><i>→</i><span>剪辑</span></div>
      <p class="statement-foot">只靠反复点击会得到随机结果。想稳定复现，就要让每一步都留下明确输入。</p>`
  },
  {
    section: 'AI发展背景介绍',
    title: 'AI发展背景介绍',
    layout: 'history-map',
    lead: 'AI创作来自70年的技术积累，能力从“识别世界”走到“协作完成项目”。',
    html: `
      <div class="history-map">
        <div class="history-track">
          <article class="above"><time>1956</time><b>人工智能成为研究领域</b><p>达特茅斯研讨会把“机器智能”聚成明确方向。</p></article>
          <article class="below"><time>2012</time><b>机器学会看图</b><p>AlexNet推动深度学习进入大规模视觉识别。</p></article>
          <article class="above"><time>2014</time><b>模型开始生成画面</b><p>GAN让模型从判断“是什么”走向创造“没见过的新图”。</p></article>
          <article class="below"><time>2017</time><b>Transformer出现</b><p>注意力机制后来成为语言与多模态模型的重要基础。</p></article>
          <article class="above"><time>2020</time><b>扩散生成更稳定</b><p>扩散模型逐步提高图像质量，也影响后来的图像与视频生成。</p></article>
          <article class="below"><time>2022</time><b>自然语言成为入口</b><p>ChatGPT与生成图像工具让普通人直接用语言创作。</p></article>
          <article class="above"><time>2024—2026</time><b>进入多模态工作流</b><p>文字、图片、声音和视频开始被同一项目连续调用与修改。</p></article>
        </div>
        <div class="history-shift"><span>识别世界</span><i>→</i><span>生成内容</span><i>→</i><span>理解参考</span><i>→</i><span>协作完成项目</span></div>
      </div>`,
    sources: [SOURCE.dartmouth, SOURCE.alexnet, SOURCE.gan, SOURCE.transformer, SOURCE.diffusion, SOURCE.stableDiffusion, SOURCE.chatgpt, SOURCE.soraHistory, SOURCE.seedance]
  },
  {
    section: 'AI发展背景介绍',
    title: '为什么用',
    layout: 'ai-why',
    lead: 'AI已经进入创作流程，但速度不等于自动完成；越靠近发布，人的判断越重要。',
    html: `
      <div class="ai-trend-stats">
        <article><strong>75%</strong><b>已经融入工作</b><p>受访创作者把创意AI描述为“已融入”或“不可缺少”。</p></article>
        <article><strong>93%</strong><b>制作速度更快</b><p>AI最直接的价值，是更快把想法变成第一版内容。</p></article>
        <article><strong>57%</strong><b>仍需明显修改</b><p>AI输出在分享前通常还需要中度或大量人工编辑。</p></article>
        <article><strong>85%</strong><b>最终决定属于人</b><p>受访者认为最终创意决策应始终由创作者完成。</p></article>
      </div>
      <div class="idea-to-decision">
        <article><small>01</small><b>模糊想法</b><p>“我想讲拖延，但还说不清。”</p></article><i>→</i>
        <article><small>02</small><b>可看Demo</b><p>先出现脚本、画面或短片小样。</p></article><i>→</i>
        <article><small>03</small><b>团队讨论</b><p>围绕同一个可见结果判断和修改。</p></article><i>→</i>
        <article><small>04</small><b>明确方案</b><p>确定脚本、分镜、风格与制作标准。</p></article>
      </div>
      <div class="ai-why-principle"><b>AI缩短的是“想法到可讨论对象”的距离。</b><span>目标、事实、审美、取舍和最终发布仍由人负责。</span></div>
      <p class="survey-note">Adobe × Harris Poll｜2026年5月｜8国16,000+内容创作者。75%对应工作流采用率；报告没有统计成片由AI生成的比例。</p>`,
    sources: [SOURCE.adobeCreators2026]
  },
  {
    section: 'AI发展背景介绍',
    title: '怎么用',
    layout: 'workflow-use',
    lead: '在真实视频工作流里，人先给标准，AI生成候选，人确认以后再进入下一步。',
    html: `
      <div class="workflow-stages">
        <article><strong>01</strong><b>选题与目标</b><small>选题卡</small></article>
        <i>→</i><article><strong>02</strong><b>脚本与分镜</b><small>脚本＋分镜表</small></article>
        <i>→</i><article><strong>03</strong><b>关键帧</b><small>批准关键帧</small></article>
        <i>→</i><article><strong>04</strong><b>视频片段</b><small>可用镜头</small></article>
        <i>→</i><article><strong>05</strong><b>剪辑与发布</b><small>成片＋资料库</small></article>
      </div>
      <div class="workflow-role-matrix">
        <div class="workflow-matrix-head"><b>每一步</b><span>选题与目标</span><span>脚本与分镜</span><span>关键帧</span><span>视频片段</span><span>剪辑与发布</span></div>
        <div class="workflow-matrix-row human"><b>人负责</b><span>受众、意义、内容边界</span><span>冲突、节奏、角色变化</span><span>角色、场景、构图标准</span><span>动作、运镜、声音、时长</span><span>筛选、审核与最终交付</span></div>
        <div class="workflow-matrix-row ai"><b>AI协助</b><span>查资料、比角度、列候选</span><span>写初稿、拆镜头、查遗漏</span><span>出候选、局部改、统一风格</span><span>按镜生成多个可比较版本</span><span>字幕、声音与多尺寸版本</span></div>
        <div class="workflow-matrix-row gate"><b>通过条件</b><span>一句话说清受众与问题</span><span>故事有变化，镜头能拆开</span><span>第一眼认得角色与场景</span><span>动作可用，前后镜头接得上</span><span>内容、版权与平台规格通过</span></div>
      </div>
      <div class="human-ai-rule"><span>人给标准</span><i>→</i><span>AI出候选</span><i>→</i><span>人做判断</span><i>→</i><span>通过后进入下一步</span></div>`
  },
  {
    section: '鸭鸭视频背景介绍',
    title: '鸭鸭视频背景介绍',
    layout: 'project',
    lead: '先看一条真实成片，再看鸭鸭IP接下来要走向哪里。',
    html: `
      <div class="project-video-split">
        <figure class="project-video">
          <video controls preload="metadata" poster="assets/project/ep04-poster-v1.jpg" playsinline>
            <source src="assets/video/ep04-afternoon-web-v1.mp4" type="video/mp4">
          </video>
          <figcaption>《一觉醒来，下午没了》｜鸭鸭心理知识科普系列</figcaption>
        </figure>
        <div class="project-next">
          <small>下一阶段</small>
          <h3>鸭鸭IP继续向五个方向生长</h3>
          <div class="next-direction-grid">
            <span>年度选题库</span><span>线下活动物料</span><span>校园特色动植物联动</span><span>鸭鸭AI对话模型</span><span>更完整的私域工作台</span>
          </div>
          <p>视频会继续连接知识内容、校园活动、学生共创与长期服务。</p>
        </div>
      </div>`
  },
  {
    section: '鸭鸭视频背景介绍',
    title: '为什么要打造IP',
    layout: 'evidence',
    lead: '成熟账号证明，固定角色可以把抽象情绪变成观众愿意持续追看的日常。',
    html: `
      <div class="evidence-grid">
        <figure><div class="evidence-shot"><img src="assets/cases/benchmark-danmao.jpeg" alt="蛋猫账号完整作品截图"></div><figcaption><b>蛋猫</b><strong>47条作品｜置顶最高142.7万赞</strong><span>固定毛绒角色承接治愈、陪伴与情绪故事；现有截图未显示粉丝数。</span></figcaption></figure>
        <figure><div class="evidence-shot"><img src="assets/cases/benchmark-xinliya.jpg" alt="心理鸭账号完整作品截图"></div><figcaption><b>心理鸭</b><strong>28.6万粉｜数据快照 2026.01</strong><span>以两只鸭鸭持续连载治愈漫画和小动画，主题与校园心理科普最接近。</span></figcaption></figure>
        <figure><div class="evidence-shot"><img src="assets/cases/benchmark-huanxiong.jpg" alt="小浣熊阿啼账号完整作品截图"></div><figcaption><b>小浣熊阿啼</b><strong>3.6万粉｜55万获赞</strong><span>用小浣熊讲等待、失落与成长，把小情绪变成可追更的日常。</span></figcaption></figure>
      </div>
      <p class="bottom-callout">这些账号靠角色固定、主题稳定和连续更新，让内容一集一集积累。</p>`,
    sources: [SOURCE.xinliyaFans]
  },
  {
    section: '鸭鸭视频背景介绍',
    title: 'IP能够承载什么',
    layout: 'visual',
    html: `
      <div class="visual-split duck-capability-split">
        <figure class="visual-panel media-contain"><img src="assets/generated/duck-ip-capabilities-v2.png" alt="三只鸭鸭连接知识传播、账号内容、校园活动、比赛、文创和AI对话的示意图"></figure>
        <div class="capability-list">
          <article><b>知识内容</b><p>心理科普进入角色故事，不再只是一张知识海报。</p></article>
          <article><b>线上线下活动</b><p>预热视频、现场物料、互动任务与活动回顾共用一套IP。</p></article>
          <article><b>账号与合作</b><p>形成固定栏目，也能延伸到联名、校园文创和数字产品。</p></article>
          <article><b>比赛与创业</b><p>把真实需求、作品、传播数据和团队过程带进创新创业项目。</p></article>
        </div>
      </div>`
  },
  {
    section: '鸭鸭视频背景介绍',
    title: '对于大家这个IP有什么用',
    layout: 'visual',
    html: `
      <div class="visual-split duck-outcome-split">
        <figure class="visual-panel media-contain"><img src="assets/generated/duck-student-outcomes-v2.png" alt="大学生与三只鸭鸭共同完成分镜、账号运营、项目汇报和作品集"></figure>
        <div class="outcome-stack">
          <article><b>一份能说明过程的作品集</b><p>脚本、分镜、提示词、失败修改与成片都能留下。</p></article>
          <article><b>一次真实账号与项目经验</b><p>参与稳定栏目、持续更新和数据复盘，留下课堂以外的项目过程。</p></article>
          <article><b>一组可继续发展的成果</b><p>可以进入大创、挑战杯、个人账号、实习或后续合作。</p></article>
        </div>
      </div>`
  },
  {
    section: '鸭鸭视频背景介绍',
    title: 'IP打造',
    layout: 'visual',
    lead: '固定角色和制作资料已经准备好，课程要把它们用进持续更新。',
    html: `
      <div class="visual-split visual-split-wide">
        <figure class="visual-panel"><img src="assets/generated/duck-ip-ecosystem-v1.jpg" alt="三只固定鸭鸭角色与角色板、分镜、场景和视频资产"></figure>
        <div class="lane-stack">
          <article><small>已经完成</small><b>角色与制作资产</b><ul><li>三只固定角色与比例规则</li><li>角色板、场景板与固定提示词</li><li>脚本、分镜、关键帧和成片样本</li></ul></article>
          <article class="accent"><small>一起继续</small><b>内容与账号迭代</b><ul><li>校园观察与系列化栏目</li><li>逐镜头生成、剪辑与发布</li><li>T+3、T+7、T+14 数据复盘</li></ul></article>
        </div>
      </div>`
  },
  {
    section: '鸭鸭视频背景介绍',
    title: '发展方向',
    layout: 'cards',
    html: `
      <div class="direction-grid">
        <article><strong>8</strong><b>标准心理主题</b><p>围绕学生高频心理议题，形成稳定、可长期更新的知识内容。</p></article>
        <article><strong>6</strong><b>漫画与动画叙事</b><p>让三只鸭鸭进入宿舍、考试、关系和成长等具体校园情境。</p></article>
        <article><strong>4</strong><b>热点短视频</b><p>连接开学、毕业、校园活动和阶段性热点，保持账号当下感。</p></article>
      </div>
      <p class="bottom-callout">线上内容之外，还会继续延伸到线下活动物料、校园特色联动与学生共创。</p>`
  },
  {
    section: '你们能够获得什么',
    title: '你们能够获得什么',
    layout: 'cards',
    theme: 'dark',
    html: `
      <div class="gain-grid">
        <article><b>课程Token</b><p>真正使用对话、生图和生视频模型</p></article>
        <article><b>完整流程</b><p>从想法走到发布，不停在单个工具演示</p></article>
        <article><b>真实项目</b><p>优秀内容有机会继续进入鸭鸭项目</p></article>
        <article><b>可展示成果</b><p>作品、过程、分工和复盘都能进入作品集</p></article>
      </div>`
  },
  {
    section: '你们能够获得什么',
    title: 'AIGC设计师',
    layout: 'salary',
    lead: '下面来自2026年公开岗位页面，只代表对应招聘样本。',
    html: `
      <div class="salary-grid">
        <article><small>入门全职样本</small><strong>7至10K</strong><b>经验不限</b><p>AIGC视频设计方向管培岗位</p></article>
        <article class="featured"><small>进阶全职样本</small><strong>20至30K</strong><b>14薪 · 1年以上</b><p>AIGC视频制作师</p></article>
        <article><small>内容实习样本</small><strong>160至300元/天</strong><b>作品集与审美</b><p>内容创作、模型评估与视频运营</p></article>
      </div>
      <p class="salary-note">岗位同时要求脚本、画面判断、剪辑、评估、资料整理和交付，单独会用生成按钮还不够。</p>`,
    sources: [SOURCE.jobsEntry, SOURCE.jobsFull, SOURCE.jobsIntern, SOURCE.jobsVideoIntern]
  },
  {
    section: '你们能够获得什么',
    title: '自由职业接单',
    layout: 'case-number',
    eyebrow: '讲师个人案例',
    html: `
      <div class="case-number-grid">
        <div><strong>18秒</strong><span>视频时长</span></div>
        <div><strong>1000元</strong><span>项目收费</span></div>
        <div><strong>半个下午＋晚上</strong><span>制作时间</span></div>
      </div>
      <p class="case-story">这笔项目已经经过多层转接，我承担的是最后的制作与交付。到最终执行环节，18秒成片仍有1000元制作费，说明上游预算、协调成本和利润空间远高于最终执行价。</p>
      <small class="fact-label">个案不代表统一报价，但说明市场愿意为确定的成片、修改能力和交付效率付费。</small>`
  },
  {
    section: '你们能够获得什么',
    title: '自媒体账号',
    layout: 'process',
    lead: '账号的长期价值来自稳定主题、固定表达、持续更新和数据复盘。',
    html: `
      <div class="account-loop">
        <article><b>固定主题</b><p>愿意长期讲什么</p></article>
        <article><b>固定表达</b><p>角色、语气与栏目</p></article>
        <article><b>持续更新</b><p>AI协助调研与生产</p></article>
        <article><b>数据复盘</b><p>留下有效的栏目做法</p></article>
      </div>
      <p class="center-note">偶然爆一条是结果，稳定做出一类内容才是能力。</p>`
  },
  {
    section: '你们能够获得什么',
    title: 'Token激励与项目参与',
    layout: 'bonus',
    theme: 'dark',
    html: `
      <div class="bonus-grid">
        <article><small>BONUS 01</small><b>课程Token支持</b><p>支持形式、额度与发放方式，将和学校老师及项目团队进一步沟通确认。</p></article>
        <article><small>BONUS 02</small><b>后续项目参与</b><p>表现合适的作品与同学，有机会继续参与鸭鸭内容的修改、展示和建设。</p></article>
      </div>
      <p class="bonus-note">我们的目标，是在条件允许的范围内，尽量覆盖对话、图片与视频练习，让大家完整走一遍流程。</p>`
  },
  {
    section: '你们能够获得什么',
    title: '分组',
    layout: 'visual',
    lead: '根据课前问卷信息先整理为三组。本页只公布名单，具体方向与分工在课堂说明，并可随项目调整。',
    html: `
      <div class="visual-split roster-visual-split">
        <figure class="visual-panel media-contain"><img src="assets/generated/duck-team-roles-portrait-v2.jpg" alt="三只鸭鸭与学生团队共同讨论项目"></figure>
        <div class="roster-grid compact-roster">
          <article><header><b>A组</b><span>4人</span></header><p>杨蕊羽</p><p>卢秋江</p><p>汪蕊</p><p>桑学涵</p></article>
          <article><header><b>B组</b><span>4人</span></header><p>李国豪</p><p>杨瑞盈</p><p>买尔哈巴·买买提</p><p>艾尼尔</p></article>
          <article><header><b>C组</b><span>3人</span></header><p>袁纤惠</p><p>蒋欣益</p><p>达珂遥</p><p class="roster-open">组内分工课堂确认</p></article>
        </div>
      </div>`
  },
  {
    section: 'AI工具介绍',
    title: 'AI工具介绍',
    layout: 'family',
    lead: '一条AI视频通常由大语言、图片和视频模型连续接力完成。',
    html: `
      <div class="tool-family enriched-family">
        <article class="language"><i>LLM</i><b>大语言与理解模型</b><p>把模糊想法整理成可执行的选题、资料、脚本、分镜与检查表。</p><ul><li>理解文字、图片、文件与部分视频</li><li>负责推理、组织、改写与评审</li></ul><div><span><img src="assets/logos/deepseek.svg" alt="">DeepSeek</span><span><img src="assets/logos/kimi.webp" alt="">Kimi</span><span><img src="assets/logos/glm.png" alt="">GLM</span><span>OpenAI</span><span><img src="assets/logos/anthropic.svg" alt="">Claude</span><span><img src="assets/logos/gemini.svg" alt="">Gemini</span></div></article>
        <article class="image"><i>IMG</i><b>图片生成与编辑模型</b><p>把角色规则、场景与镜头构图变成可以检查的静态画面。</p><ul><li>角色板、场景板、首尾帧与封面</li><li>局部修改比反复重生成更可控</li></ul><div><span><img src="assets/logos/bytedance.svg" alt="">Seedream</span><span><img src="assets/logos/glm.png" alt="">GLM-Image</span><span>GPT Image</span><span><img src="assets/logos/gemini.svg" alt="">Nano Banana</span></div></article>
        <article class="video"><i>VID</i><b>视频生成与编辑模型</b><p>让已确认的画面产生表演、动作、镜头运动与声音。</p><ul><li>文生视频、图生视频与参考视频</li><li>按镜头生成，再进入剪辑与QA</li></ul><div><span><img src="assets/logos/bytedance.svg" alt="">Seedance</span><span><img src="assets/logos/kuaishou.svg" alt="">Kling</span><span>MiniMax</span><span><img src="assets/logos/gemini.svg" alt="">Veo</span><span><img src="assets/logos/runway.svg" alt="">Runway</span></div></article>
      </div>`
  },
  {
    section: 'AI工具介绍',
    title: '三类模型',
    layout: 'table',
    html: `
      <div class="model-table dense-model-table">
        <div class="row head"><span>模型类型</span><span>主要输入</span><span>在鸭鸭项目里完成什么</span><span>交给下一步前检查什么</span></div>
        <div class="row"><b>大语言模型</b><span>需求、资料、历史脚本、图片与文件</span><span>选题调研、心理知识边界、脚本、分镜表、提示词与QA清单</span><span>事实是否可靠；角色语气、受众和交付格式是否说清</span></div>
        <div class="row"><b>图片模型</b><span>文字、固定角色板、场景参考与构图草图</span><span>角色表情、场景板、镜头关键帧、封面与活动视觉</span><span>角色身份、配饰、比例、构图与前后镜头是否一致</span></div>
        <div class="row"><b>视频模型</b><span>文字、关键帧、音频、动作参考与已有视频</span><span>角色表演、物体运动、镜头运动、环境变化与部分声音</span><span>动作逻辑、肢体、连续性、口型和可剪辑时长是否可用</span></div>
      </div>
      <p class="table-note">上一步越清楚，下一类模型越稳定。发现错误时，先判断该回到文字、关键帧还是视频环节修改。</p>`
  },
  {
    section: 'AI工具介绍',
    title: '国内大语言模型',
    layout: 'model-cards',
    lead: '三家的主要差异出现在上下文、多模态、工具调用和长任务稳定性。',
    html: `
      <div class="model-card-grid three brand-model-grid">
        <article><header><img src="assets/logos/deepseek.svg" alt="DeepSeek标志"><span>DeepSeek</span></header><b>V4-Pro / V4-Flash</b><ul><li><strong>1M上下文</strong>，支持思考与非思考模式</li><li><strong>Pro</strong>偏复杂知识与高难推理</li><li><strong>Flash</strong>以更低成本处理快速批量任务</li><li class="project-use">鸭鸭项目｜长资料梳理、脚本初稿与批量改写</li></ul></article>
        <article><header><img src="assets/logos/kimi.webp" alt="Kimi标志"><span>Kimi</span></header><b>K3</b><ul><li><strong>1M上下文</strong>，原生多模态</li><li>面向长周期编码、知识工作与深度推理</li><li>适合同时读取多份文件、图片和长材料</li><li class="project-use">鸭鸭项目｜方案资料、历史脚本与多文件对照</li></ul></article>
        <article><header><img src="assets/logos/glm.png" alt="智谱GLM标志"><span>智谱</span></header><b>GLM-5.2</b><ul><li><strong>1M上下文</strong>，最大输出128K</li><li>可连接外部MCP工具，处理多步骤任务</li><li>适合长方案、结构化资料与连续项目</li><li class="project-use">鸭鸭项目｜分镜表、资产清单与结构化交付</li></ul></article>
      </div>`,
    sources: [SOURCE.deepseek, SOURCE.kimi, SOURCE.glm52]
  },
  {
    section: 'AI工具介绍',
    title: '国外大语言模型',
    layout: 'model-cards',
    lead: 'OpenAI、Anthropic与Google各自形成了清晰的模型家族，选择时先看任务难度、模态和速度。',
    html: `
      <div class="model-card-grid three brand-model-grid">
        <article><header class="wordmark-logo"><span>OpenAI</span></header><b>GPT-5.6</b><ul><li><strong>Sol｜</strong>高难推理、编码、科学、设计与电脑操作</li><li><strong>Terra｜</strong>日常知识工作与成本的平衡</li><li><strong>Luna｜</strong>优先速度与价格的快速任务</li><li class="project-use">鸭鸭项目｜复杂策划、关键脚本与最终复核</li></ul></article>
        <article><header><img src="assets/logos/anthropic.svg" alt="Anthropic标志"><span>Anthropic</span></header><b>Claude Fable 5</b><ul><li>长而复杂的任务、知识工作与视觉理解</li><li>强调软件工程、科学研究与长任务记忆</li><li>Mythos 5采用可信项目访问，目前不作为普通学生入口</li><li class="project-use">鸭鸭项目｜长文档、脚本连续性与画面审查</li></ul></article>
        <article><header><img src="assets/logos/gemini.svg" alt="Gemini标志"><span>Google</span></header><b>Gemini 3.6 Flash</b><ul><li>面向编码、知识与多模态任务的主力模型</li><li><strong>3.5 Flash-Lite</strong>偏高吞吐与文档处理</li><li>适合图片、视频、文档混合输入后的快速迭代</li><li class="project-use">鸭鸭项目｜看图看片、资料理解与快速比较</li></ul></article>
      </div>`,
    sources: [SOURCE.gpt56, SOURCE.claude5, SOURCE.gemini36]
  },
  {
    section: 'AI工具介绍',
    title: '对比差异如何使用',
    layout: 'compare-models',
    lead: '模型会持续更新。下面比较当前版本的能力侧重和适用任务。',
    html: `
      <div class="model-compare-grid">
        <article><header><span>OpenAI</span><b>GPT-5.6 Sol</b></header><p>复杂推理、编码、科学与设计任务能力上限高。</p><small>可以先试｜关键策划、难题拆解、最终复核</small></article>
        <article><header><span>Anthropic</span><b>Claude Fable 5</b></header><p>长任务、长文档、知识工作和视觉理解是重点。</p><small>可以先试｜连续性检查、长脚本与资料审读</small></article>
        <article><header><span>Google</span><b>Gemini 3.6 Flash</b></header><p>多模态输入与快速迭代之间更均衡。</p><small>可以先试｜看图看片、文档混合分析</small></article>
        <article><header><span>DeepSeek</span><b>V4-Pro / Flash</b></header><p>同一家族内可在复杂能力与批量成本之间选择。</p><small>可以先试｜中文资料、脚本初稿、批量改写</small></article>
        <article><header><span>Moonshot</span><b>Kimi K3</b></header><p>1M上下文与原生多模态，适合长周期、多文件任务。</p><small>可以先试｜方案、脚本库与历史资料整合</small></article>
        <article><header><span>智谱</span><b>GLM-5.2</b></header><p>长上下文、超长输出与工具调用更适合结构化项目。</p><small>可以先试｜分镜表、清单、交付物和工作流</small></article>
      </div>
      <p class="table-note">同一段真实任务至少比较两家。看准确性、可修改性、速度与成本，再决定本项目的常用组合。</p>`,
    sources: [SOURCE.deepseek, SOURCE.kimi, SOURCE.glm52, SOURCE.gpt56, SOURCE.claude5, SOURCE.gemini36]
  },
  {
    section: 'AI工具介绍',
    title: '图片模型',
    layout: 'model-showcase',
    lead: '先看官方示例，再看它能不能解决项目里的角色、场景、关键帧和文字问题。',
    html: `
      <div class="image-showcase-grid">
        <article><figure><img src="assets/examples/seedream-5-lite-official-v1.jpg" alt="Seedream 5.0 Lite官方信息可视化示例"><figcaption>官方示例｜复杂信息可视化</figcaption></figure><header><span><img src="assets/logos/bytedance.svg" alt="">字节 Seed</span><b>Seedream 5.0 Lite</b></header><p>理解复杂指令、视觉推理、多主体参考与精确编辑。</p><div class="model-check"><b>输入</b><span>文字＋多张参考图</span><b>输出</b><span>新画面＋局部编辑</span><b>鸭鸭</b><span>复杂场景 · 多人构图 · 知识图解</span><b>检查</b><span>角色身份 · 画面文字 · 修改范围</span></div></article>
        <article><figure class="contain"><img src="assets/examples/glm-image-official-v2.jpeg" alt="GLM-Image官方中文长文字海报示例"><figcaption>官方示例｜中文长文字海报</figcaption></figure><header><span><img src="assets/logos/glm.png" alt="">智谱</span><b>GLM-Image</b></header><p>重点处理中文文字、海报、PPT、科普图与多格画面。</p><div class="model-check"><b>输入</b><span>中文要求＋参考图片</span><b>输出</b><span>海报 · PPT · 多格画面</span><b>鸭鸭</b><span>活动视觉 · 心理知识卡 · 信息图</span><b>检查</b><span>错别字 · 数值 · 信息层级</span></div></article>
        <article><figure class="contain"><img src="assets/examples/gpt-image-2-official-v5.jpg" alt="GPT Image 2官方文字版式示例"><figcaption>官方示例｜文字版式与细节</figcaption></figure><header><span class="text-logo">OpenAI</span><b>GPT Image 2</b></header><p>参考图生成、局部编辑、文字版式与细节控制更完整。</p><div class="model-check"><b>输入</b><span>文字＋固定角色参考图</span><b>输出</b><span>生成、编辑与反复修改</span><b>鸭鸭</b><span>角色修正 · 关键帧 · 复杂改图</span><b>检查</b><span>固定配饰 · 未编辑区域 · 中文细节</span></div></article>
        <article><figure><img src="assets/examples/nano-banana-2-official-v2.webp" alt="Nano Banana 2官方多角色连续故事示例"><figcaption>官方示例｜多角色连续故事</figcaption></figure><header><span><img src="assets/logos/gemini.svg" alt="">Google</span><b>Nano Banana 2</b></header><p>快速生成、高保真编辑、主体一致与多画幅迭代。</p><div class="model-check"><b>输入</b><span>文字＋主体或场景参考</span><b>输出</b><span>快速生成＋高保真编辑</span><b>鸭鸭</b><span>换场景 · 改道具 · 多尺寸版本</span><b>检查</b><span>身份漂移 · 背景重画 · 多图顺序</span></div></article>
      </div>`,
    sources: [SOURCE.seedream, SOURCE.glmImage, SOURCE.gptImage2, SOURCE.nanoBanana2]
  },
  {
    section: 'AI工具介绍',
    title: '图片模型怎么选',
    layout: 'priority',
    html: `
      <div class="choice-table image-choice-table">
        <div class="choice-head"><span>当前任务</span><span>可以先试</span><span>选择理由</span><span>生成后重点检查</span></div>
        <div><b>固定IP角色改动作、表情或场景</b><span>GPT Image 2<br>Nano Banana 2</span><p>强调参考图编辑与主体保持</p><small>胸前配饰、头顶毛、体型比例、脚部是否变化</small></div>
        <div><b>中文海报、心理知识卡、PPT插图</b><span>GLM-Image<br>Seedream 5.0 Lite</span><p>中文文字和知识密集画面更值得比较</p><small>文字准确、层级清楚、信息是否可读</small></div>
        <div><b>复杂场景、多角色、风格迁移</b><span>Seedream 5.0 Lite<br>GPT Image 2</span><p>兼顾构图理解、多主体参考与细节控制</p><small>角色身份、遮挡关系、空间逻辑是否稳定</small></div>
        <div><b>快速换背景、改道具、出多个尺寸</b><span>Nano Banana 2<br>GPT Image 2</span><p>适合反复编辑和多画幅迭代</p><small>未修改区域有没有被意外重画</small></div>
      </div>
      <p class="table-note">鸭鸭项目的第一原则是先用固定角色板做参考图编辑。同一任务AB测试后，再确定常用模型。</p>`,
    sources: [SOURCE.seedream, SOURCE.glmImage, SOURCE.gptImage2, SOURCE.nanoBanana2]
  },
  {
    section: 'AI工具介绍',
    title: 'Seedance 2.0',
    layout: 'seedance-showcase',
    theme: 'dark',
    eyebrow: '字节跳动视频生成模型',
    html: `
      <div class="seedance-showcase">
        <figure><img src="assets/examples/seedance-2-official-v1.jpg" alt="Seedance 2.0官方复杂双人运动示例画面"><figcaption>官方示例｜复杂双人运动、物理交互与镜头跟随</figcaption></figure>
        <div class="seedance-copy">
          <div class="seedance-wordmark">SEEDANCE <strong>2.0</strong></div>
          <div class="seedance-fact-grid">
            <article><b>四种输入</b><p>文字、图片、音频、视频可以组合参考。</p></article>
            <article><b>15秒多镜头</b><p>支持高质量多镜头音视频联合生成。</p></article>
            <article><b>生成＋编辑</b><p>定向修改、视频延长与已有视频编辑。</p></article>
            <article><b>原生声音</b><p>对白、环境音和双声道声音跟随画面。</p></article>
          </div>
        </div>
      </div>
      <p class="seedance-note">鸭鸭最需要的是“固定角色参考图＋单镜头动作＋明确运镜”。多主体一致、画面文字和复杂编辑仍有稳定性问题。</p>`,
    sources: [SOURCE.seedance]
  },
  {
    section: 'AI工具介绍',
    title: '国内视频模型',
    layout: 'video-showcase',
    lead: '用同一分镜比较“可用镜头率”。三家都在加强参考控制、原生声音与生成编辑一体化。',
    html: `
      <div class="video-showcase-grid three">
        <article><figure><img src="assets/examples/seedance-2-official-v1.jpg" alt="Seedance 2.0官方双人运动视频画面"><figcaption>官方示例｜复杂运动与物理交互</figcaption></figure><header><span><img src="assets/logos/bytedance.svg" alt="">字节 Seed</span><b>Seedance 2.0</b></header><p>多模态参考、镜头语言、定向编辑与原生声音。</p><div class="model-check"><b>输入</b><span>文字 · 图片 · 音频 · 视频</span><b>输出</b><span>15秒多镜头音视频＋编辑</span><b>鸭鸭</b><span>固定角色参考 · 明确动作与运镜</span><b>检查</b><span>多角色身份 · 四肢 · 长镜头漂移</span></div></article>
        <article><figure><img src="assets/examples/kling-3-official-v1.jpg" alt="可灵Video 3.0官方视频示例画面"><figcaption>官方示例｜连续表演与电影感画面</figcaption></figure><header><span><img src="assets/logos/kuaishou.svg" alt="">快手</span><b>可灵 Video 3.0</b></header><p>面向多镜头叙事、多人一致、连续表演与原生音频。</p><div class="model-check"><b>重点</b><span>多人一致 · 多镜头 · 原生声音</span><b>输出</b><span>连续表演与叙事短片段</span><b>鸭鸭</b><span>双人对话 · 连续动作 · 声音镜头</span><b>检查</b><span>口型 · 说话人 · 镜头衔接</span></div></article>
        <article><figure><img src="assets/examples/minimax-h3-official-v2.jpg" alt="MiniMax H3官方视频示例画面"><figcaption>官方示例｜生活化表演与自然光影</figcaption></figure><header><span class="text-logo">MiniMax</span><b>Hailuo H3</b></header><p>四模态输入，支持动作迁移、视频编辑、15秒与2K输出。</p><div class="model-check"><b>输入</b><span>文字 · 图片 · 音频 · 视频</span><b>输出</b><span>15秒、2K与视频编辑</span><b>鸭鸭</b><span>动作参考 · 广告感镜头 · 声音段落</span><b>检查</b><span>动作物理 · 主体外形 · 品牌文字</span></div></article>
      </div>`,
    sources: [SOURCE.seedance, SOURCE.kling, SOURCE.minimax]
  },
  {
    section: 'AI工具介绍',
    title: '国外视频模型',
    layout: 'video-showcase',
    lead: 'Veo强调多参考要素，Runway强调连续世界；Sora 2保留为“产品会下线”的流程提醒。',
    html: `
      <div class="video-showcase-grid three">
        <article><figure class="contain"><img src="assets/examples/veo-3-1-official-v1.png" alt="Veo 3.1 Ingredients to Video官方示例合集"><figcaption>官方示例｜多参考图控制人物、物体与风格</figcaption></figure><header><span><img src="assets/logos/gemini.svg" alt="">Google</span><b>Veo 3.1</b></header><p>多参考要素控制、竖屏生成与高分辨率输出。</p><div class="model-check"><b>输入</b><span>文字＋多张人物、物体与风格参考</span><b>输出</b><span>横竖画幅与高分辨率视频</span><b>鸭鸭</b><span>多参考图 · 竖屏发布 · 高分辨率交付</span><b>检查</b><span>入口可用性 · 身份连续 · 声画关系</span></div></article>
        <article><figure><img src="assets/examples/runway-gen4-official-v1.png" alt="Runway Gen-4官方跨镜头角色一致示例"><figcaption>官方示例｜同一人物在不同镜头保持连续</figcaption></figure><header><span><img src="assets/logos/runway.svg" alt="">Runway</span><b>Gen-4</b></header><p>用视觉参考保持人物、地点、物体和世界连续。</p><div class="model-check"><b>输入</b><span>文字＋视觉参考</span><b>重点</b><span>人物、地点与物体的连续世界</span><b>鸭鸭</b><span>固定校园场景 · 道具 · 连续镜头</span><b>检查</b><span>动作稳定 · 空间关系 · 镜间变化</span></div></article>
        <article class="video-status-card"><div class="status-visual"><span>STOPPED</span><strong>SORA 2</strong><small>2026.04</small></div><header><span class="text-logo">OpenAI</span><b>Sora 2</b></header><p>曾是重要研究与产品路线，官方已经停止提供。</p><div class="model-check"><b>状态</b><span>产品停止提供，历史研究资料仍可查看</span><b>提醒</b><span>项目流程不能绑死在单一工具</span><b>保留</b><span>角色板 · 分镜 · 提示词 · 版本与源文件</span></div></article>
      </div>`,
    sources: [SOURCE.veo31, SOURCE.runway, SOURCE.sora2]
  },
  {
    section: 'AI工具介绍',
    title: '视频模型怎么选',
    layout: 'priority',
    html: `
      <div class="choice-table video-choice-table">
        <div class="choice-head"><span>镜头需求</span><span>可以先试</span><span>选择理由</span><span>仍要检查</span></div>
        <div><b>固定鸭鸭参考图＋明确动作＋镜头运动</b><span>Seedance 2.0</span><p>多模态参考、镜头语言和定向编辑组合完整</p><small>多角色身份、四肢、复杂动作与长镜头漂移</small></div>
        <div><b>双人表演、多镜头叙事、需要原生声音</b><span>可灵 Video 3.0<br>Seedance 2.0</span><p>都值得用同一分镜测试人物关系和声音</p><small>口型、说话人、镜头衔接和背景声</small></div>
        <div><b>动作参考、视频编辑、广告感短镜头</b><span>Hailuo H3<br>Seedance 2.0</span><p>动作迁移与生成编辑一体化更有价值</p><small>品牌文字、动作物理、主体外形变化</small></div>
        <div><b>多参考图、竖屏发布、高分辨率交付</b><span>Veo 3.1<br>Runway Gen-4</span><p>前者关注参考要素和输出，后者关注连续世界</p><small>入口可用性、成本、比例和跨镜头一致性</small></div>
      </div>
      <p class="table-note">先用同一个关键帧、动作与时长做小样；判断依据是可用镜头率，单次惊艳结果只作参考。</p>`,
    sources: [SOURCE.seedance, SOURCE.kling, SOURCE.minimax, SOURCE.veo31, SOURCE.runway]
  },
  {
    section: 'AI视频工作流介绍',
    title: 'AI视频工作流介绍',
    layout: 'visual',
    lead: '一条可交付视频，是多个模型与人工判断连续接力的结果。',
    html: `
      <div class="visual-split workflow-visual-split">
        <figure class="visual-panel"><img src="assets/generated/duck-video-workflow-v1.jpg" alt="三只鸭鸭从想法、脚本、分镜到剪辑归档的制作流程"></figure>
        <div class="workflow-step-grid">
          <span><b>01</b>选题</span><span><b>02</b>脚本</span>
          <span><b>03</b>分镜</span><span><b>04</b>关键帧</span>
          <span><b>05</b>视频生成</span><span><b>06</b>剪辑</span>
          <span><b>07</b>发布</span><span><b>08</b>复盘</span>
        </div>
      </div>
      <div class="workflow-tools"><span>语言模型</span><span>图片模型</span><span>视频模型</span><span>剪辑软件</span><span>人工QA</span></div>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '如何制作一个可控AI视频',
    layout: 'statement',
    theme: 'dark',
    html: `
      <div class="control-statement"><strong>可控</strong><span>来自清楚的输入</span><b>失败以后知道该回到哪一步修改</b></div>
      <div class="control-grid">
        <article><b>角色约束</b><p>长相、比例、配饰、性格</p></article>
        <article><b>场景约束</b><p>空间、时间、光线、道具</p></article>
        <article><b>镜头约束</b><p>景别、机位、运动、时长</p></article>
        <article><b>连续性约束</b><p>前后镜头的身份与状态</p></article>
      </div>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '和传统流程对比',
    layout: 'visual',
    html: `
      <div class="visual-split compare-visual-split">
        <figure class="visual-panel"><img src="assets/generated/traditional-vs-ai-video-v1.jpg" alt="传统片场与AI辅助视频工作室的流程对比"></figure>
        <div class="compare-table compact-compare">
          <div class="row head"><span></span><span>传统制作</span><span>AI辅助</span></div>
          <div class="row"><b>时间</b><span>排期较长</span><span>原型更快</span></div>
          <div class="row"><b>效率</b><span>过程较稳定</span><span>可快速比版本</span></div>
          <div class="row"><b>成本</b><span>人、设备、场地</span><span>Token与筛选</span></div>
          <div class="row"><b>风险</b><span>执行与协调</span><span>随机性与一致性</span></div>
        </div>
      </div>
      <p class="table-note">AI改变了成本结构，没有把成本和专业判断变成零。</p>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '选题',
    layout: 'topic-selection',
    lead: '好选题先落在一个学生能马上认出的具体瞬间，再提炼心理知识。',
    html: `
      <div class="topic-selection-layout">
        <figure class="topic-selection-visual"><img src="assets/generated/duck-topic-selection-workshop-v1.jpg" alt="三只鸭鸭从校园真实瞬间筛选可拍故事"></figure>
        <div class="topic-chain">
          <article><span>真实瞬间</span><b>17:48醒来，天已经快黑了</b><p>时间、地点和动作都具体，学生一眼能认出这个处境。</p></article>
          <article><span>真实感受</span><b>“今天又被我毁掉了”</b><p>把角色当时脑中最直接的一句话写出来。</p></article>
          <article><span>心理落点</span><b>计划中断后，把一天判断成彻底失败</b><p>知识只解释故事里已经发生的现象，不先贴诊断标签。</p></article>
          <article><span>鸭鸭故事</span><b>饭团卡住，小小听见，馒头推动一步</b><p>最后落到今晚还能完成的一件小事。</p></article>
        </div>
      </div>
      <div class="topic-gate"><b>可进入脚本的选题</b><span>生活中发生过</span><span>一句话说得清</span><span>画面拍得出</span><span>结尾有行动</span></div>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '脚本写作与分镜控制',
    layout: 'script-storyboard',
    lead: '脚本确定故事怎样变化，分镜把变化拆成可以生成和剪辑的画面。',
    html: `
      <div class="script-storyboard-layout">
        <figure><img src="assets/generated/duck-script-storyboard-control-v1.jpg" alt="三只鸭鸭把同一段脚本拆成连续分镜和批准关键帧"></figure>
        <div class="script-storyboard-copy">
          <article><small>脚本确定</small><b>角色、冲突、变化、结尾行动</b><p>饭团醒来发现计划被打乱；她从“今天全毁了”走到“今晚先完成一件事”。</p></article>
          <article class="accent"><small>分镜确定</small><b>景别、动作、时长、镜头连接</b><p>每个镜头只承担一个主要信息，保证图片能定、视频能动、剪辑能接。</p></article>
          <div class="shot-sequence"><span><i>01</i>中景交代宿舍与时间</span><span><i>02</i>近景看见计划本与表情</span><span><i>03</i>三人镜头完成行动变化</span></div>
        </div>
      </div>
      <p class="bottom-callout"><b>一段脚本可以拆成多个镜头；一个镜头只承担一个主要任务。</b></p>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '分镜提示词控制',
    layout: 'prompt-control',
    lead: '提示词要把导演判断翻译成模型可以执行的信息。',
    html: `
      <div class="prompt-control-layout">
        <figure><img src="assets/generated/duck-mental-microstory-v1.jpg" alt="饭团在傍晚宿舍经历计划被打乱的具体场景"></figure>
        <div class="prompt-control-copy">
          <div class="prompt-parts">
            <span><b>主体</b>饭团</span><span><b>场景</b>傍晚宿舍床边</span><span><b>镜头</b>中近景固定机位</span>
            <span><b>动作</b>看计划本后轻叹气</span><span><b>光线</b>暖黄台灯＋窗外夕光</span><span><b>连续性</b>蓝领巾与计划本位置不变</span>
          </div>
          <div class="prompt-example"><small>组合以后</small><p><span>饭团</span><span>傍晚宿舍床边</span><span>中近景固定机位</span><span>先低头看计划本</span><span>再轻轻叹气</span><span>暖黄台灯</span><span>蓝色领巾与上一镜一致</span></p></div>
          <p class="prompt-warning">“电影感、震撼、高级”不能替代具体的主体、空间、动作和镜头。</p>
        </div>
      </div>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '分镜视频生成',
    layout: 'generation-control',
    lead: '先锁定关键帧，再用同一份输入生成候选；错误属于哪一类，就退回哪一步。',
    html: `
      <div class="generation-control-layout">
        <figure><img src="assets/generated/duck-video-generation-review-v1.jpg" alt="三只鸭鸭比较同一关键帧生成的多个视频候选并选出可用镜头"></figure>
        <div class="generation-control-copy">
          <article><strong>01</strong><b>关键帧先通过</b><p>角色、构图、道具不对时，先回图片环节修改。</p></article>
          <article><strong>02</strong><b>一镜一个主动作</b><p>先完成“低头—看计划本—叹气”，不要同时塞进多段表演。</p></article>
          <article><strong>03</strong><b>同一输入出多个候选</b><p>比较稳定性和可剪辑性，不把第一条结果当成答案。</p></article>
          <article><strong>04</strong><b>按错误类型返工</b><p>身份错回图片；动作错改视频；节奏问题进入剪辑。</p></article>
        </div>
      </div>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '整体调整与剪辑',
    layout: 'editing-control',
    lead: '生成模型提供素材，剪辑决定哪些素材真正进入成片。',
    html: `
      <div class="editing-control-layout">
        <figure><img src="assets/generated/duck-editing-room-v1.jpg" alt="三只鸭鸭在剪辑室选择镜头、整理声音和审核成片"></figure>
        <div class="editing-decision-stack">
          <article><span>选择</span><b>只留下服务故事的镜头</b><p>最惊艳的画面如果破坏角色或节奏，也要删除。</p></article>
          <article><span>删减</span><b>去掉漂移、重复与拖沓</b><p>短视频里每一秒都要推动信息或情绪。</p></article>
          <article><span>统一</span><b>画幅、颜色、响度和字幕</b><p>不同模型产生的片段最终要像同一条视频。</p></article>
          <article><span>复核</span><b>知识边界、版权和平台规格</b><p>发布前完成最后一次人工责任检查。</p></article>
        </div>
      </div>
      <div class="editing-tracks"><span>画面｜镜头1 · 镜头2 · 镜头3 · 镜头4</span><span>声音｜对白 · 环境音 · 音乐</span><span>文字｜字幕 · 知识卡 · 片尾</span></div>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '发布准备与资料库整理',
    layout: 'asset-library',
    lead: '成片只是一次交付，资料库决定下一条能不能接着做。',
    html: `
      <div class="asset-library-layout">
        <figure><img src="assets/generated/duck-asset-library-v1.jpg" alt="三只鸭鸭把角色、图片、视频、提示词和交付文件整理进资料库"></figure>
        <div class="asset-tree">
          <article><b>01_IP</b><span>角色板 · 比例 · 表情 · 声音</span></article>
          <article><b>02_IMAGE</b><span>场景 · 关键帧 · 封面 · 批准稿</span></article>
          <article><b>03_VIDEO</b><span>源片 · 通过镜头 · 失败镜头</span></article>
          <article><b>04_PROMPT</b><span>图片/视频提示词 · 参数 · 修改原因</span></article>
          <article class="accent"><b>05_DELIVERY</b><span>横竖版 · 字幕 · 文案 · 授权与来源</span></article>
        </div>
      </div>
      <div class="asset-rule"><b>文件名必须能让下一位同学接手。</b><span>期数_镜号_版本_状态，例如 EP05_S03_v04_APPROVED。</span></div>`
  },
  {
    section: 'AI视频工作流介绍',
    title: 'T+3 / T+7 / T+14',
    layout: 'review-loop',
    lead: '发布以后进入三次复盘，把观众反应变成下一期可执行的修改。',
    html: `
      <div class="review-loop-layout">
        <figure><img src="assets/generated/duck-content-review-v1.jpg" alt="三只鸭鸭根据发布后的观看、评论与留存数据复盘下一期内容"></figure>
        <div class="review-stage-stack">
          <article><time>T+3</time><b>确认观众是否看懂</b><p>看停留、完播和评论；记录主题误读与高频问题。</p></article>
          <article><time>T+7</time><b>找出有效与失效的段落</b><p>对照留存曲线、转发点和评论，定位具体镜头与台词。</p></article>
          <article><time>T+14</time><b>写进下一期制作规则</b><p>明确保留、调整或停止的栏目、标题与镜头做法。</p></article>
        </div>
      </div>
      <div class="review-loop-rule"><span>发布</span><i>→</i><span>观察</span><i>→</i><span>定位</span><i>→</i><span>修改规则</span><i>→</i><span>下一期</span></div>`
  },
  {
    section: '热门作品解析',
    title: '热门作品解析',
    layout: 'visual',
    lead: '这次要看作品怎样建立角色、作者性和交付标准。',
    html: `
      <div class="visual-split case-mode-split">
        <figure class="visual-panel"><img src="assets/generated/case-study-three-modes-v1.jpg" alt="连载IP、作者短片与商业交付三类作品的视觉示意"></figure>
        <div class="case-mode-stack">
          <article><small>连载IP型</small><b>小蘑菇秃秃</b><p>角色、栏目和更新方式怎样稳定积累。</p></article>
          <article><small>个人表达型</small><b>Mx-Shell《丧尸清道夫》</b><p>工具相同，作者世界仍然不同。</p></article>
          <article><small>商业交付型</small><b>成熟动画与甲方项目</b><p>品牌、审核、规格和修改同时成立。</p></article>
        </div>
      </div>`
  },
  {
    section: '热门作品解析',
    title: '蘑菇IP账号',
    layout: 'case-study',
    eyebrow: '连载IP型',
    html: `
      <div class="case-study-grid">
        <figure class="case-photo portrait media-contain"><img src="assets/cases/mushroom-ip.jpg" alt="M Stand与小蘑菇秃秃的完整联名案例"><figcaption><span>内容IP进入现实合作</span><b>把故事做小<br>把角色做久</b></figcaption></figure>
        <div class="case-lessons"><article><b>固定角色</b><p>圆润蘑菇与微缩世界一眼可认</p></article><article><b>固定尺度</b><p>煮面、交朋友、休息也能成为一集</p></article><article><b>固定关系</b><p>内容积累以后，可以进入联名、周边和数字互动</p></article></div>
      </div>
      <div class="case-actions"><a href="https://www.douyin.com/video/7636075646120152366" target="_blank" rel="noopener">观看《煮面条》原视频 ↗</a><a href="https://socialbeta.com/campaign/27698" target="_blank" rel="noopener">查看M Stand联名案例 ↗</a></div>
      <p class="bottom-callout">鸭鸭要学稳定与连载，不复制蘑菇的外形和语言。</p>`,
    sources: [SOURCE.mushroomVideo, SOURCE.mushroomBrand]
  },
  {
    section: '热门作品解析',
    title: 'Mx-Shell《丧尸清道夫》',
    layout: 'case-study',
    eyebrow: '个人表达型',
    html: `
      <div class="case-study-grid reverse">
        <div class="case-lessons"><article><b>完整世界</b><p>末日类型、黑色幽默与机器人表情彼此服务</p></article><article><b>具体调度</b><p>地面、沙尘、表演与镜头都被明确安排</p></article><article><b>作者选择</b><p>同一个Seedance，差别仍然来自取舍与审美</p></article></div>
        <figure class="case-photo landscape media-contain"><img src="assets/cases/mxshell-news.jpg" alt="丧尸清道夫完整作品画面与主角形象"><figcaption><span>AI短片</span><b>工具普及以后<br>作者性更容易被看见</b></figcaption></figure>
      </div>
      <div class="case-actions"><a href="https://www.bilibili.com/video/BV1vT5t6GEx3/" target="_blank" rel="noopener">观看案例报道 ↗</a><a href="https://www.bilibili.com/video/BV1G25v6fERZ/" target="_blank" rel="noopener">观看创作全流程 ↗</a></div>`,
    sources: [SOURCE.zombie, SOURCE.zombieProcess, SOURCE.seedance]
  },
  {
    section: '热门作品解析',
    title: '成熟商业动画与甲方项目单',
    layout: 'case-study',
    lead: '以京东物流AIGC短片为例，商业完成度同时包含创意、品牌准确、审核与交付。',
    html: `
      <div class="case-study-grid commercial-case-grid">
        <figure class="case-photo landscape media-contain"><img src="assets/cases/commercial-jd-logistics.png" alt="京东物流世界再大心意总会抵达AIGC视频完整画面"><figcaption><span>AIGC商业短片</span><b>世界再大<br>心意总会抵达</b></figcaption></figure>
        <div class="case-lessons commercial-lessons"><article><b>需求</b><p>用途、受众、平台、时长、画幅与时间节点</p></article><article><b>确认</b><p>脚本、风格稿、分镜、关键帧与品牌元素</p></article><article><b>制作</b><p>逐镜头源片、编号、初剪、审核与修改记录</p></article><article><b>交付</b><p>横竖版本、字幕、封面、授权与源文件</p></article></div>
      </div>
      <div class="case-actions"><a href="https://newshare-one-shot.oss-cn-beijing.aliyuncs.com/%E4%B8%80%E9%95%9C%E5%88%B0%E5%BA%95%E7%BD%91%E7%AB%99/AI%E8%A7%86%E9%A2%91/%E4%BA%AC%E4%B8%9C%E7%89%A9%E6%B5%81%E4%B8%96%E7%95%8C%E5%86%8D%E5%A4%A7%20%E5%BF%83%E6%84%8F%E6%80%BB%E4%BC%9A%E6%8A%B5%E8%BE%BE-AIGC%E5%88%9B%E6%84%8F%E8%A7%86%E9%A2%91-.mp4" target="_blank" rel="noopener">观看完整商业短片 ↗</a></div>
      <p class="bottom-callout">好看是基础；品牌不能错、反馈改得动、各平台版本交得齐，才是商业项目。</p>`,
    sources: [SOURCE.commercialGallery, SOURCE.commercialVideo]
  },
  {
    section: '作业与问题解答',
    title: '作业',
    layout: 'visual',
    lead: '三组选一个方向，做到你们目前认为可以的程度。',
    html: `
      <div class="visual-split assignment-visual-split">
        <figure class="visual-panel"><img src="assets/generated/duck-assignment-topics-v1.jpg" alt="鸭鸭面对比较、开学准备与结识新朋友三类校园选题"></figure>
        <div class="assignment-stack">
          <article><small>小小主视角</small><b>我是不是落后了</b><p>回到自己今天能做的一步。</p></article>
          <article><small>饭团主视角</small><b>开学前还没准备好</b><p>先挑出今晚真正要做的事情。</p></article>
          <article><small>小小与饭团</small><b>不敢主动认识新朋友</b><p>设计一个低压力的开场。</p></article>
        </div>
      </div>
      <div class="assignment-levels"><span>想法</span><i>→</i><span>脚本</span><i>→</i><span>分镜</span><i>→</i><span>关键帧</span><i>→</i><span>短片段</span><i>→</i><span>简单成片</span></div>`
  },
  {
    section: '作业与问题解答',
    title: '问题解答',
    layout: 'qa',
    theme: 'dark',
    html: `
      <div class="qa-stage">
        <h3>问题解答</h3>
        <div class="likely-questions">
          <span>哪个AI更适合我的任务？</span>
          <span>没有影视基础，从哪里开始？</span>
          <span>生成结果不稳定，先改哪一步？</span>
          <span>如何保留鸭鸭角色一致性？</span>
          <span>Token大概怎样安排？</span>
          <span>分组以后可以调整方向吗？</span>
        </div>
      </div>
      <p class="end-line">把你现在最想解决的问题直接提出来。</p>`
  }
];
