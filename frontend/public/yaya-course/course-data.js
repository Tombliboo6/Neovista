const SOURCE = {
  dartmouth: { label: 'Dartmouth AI 史', url: 'https://ai.dartmouth.edu/our-story' },
  transformer: { label: 'Transformer 论文', url: 'https://arxiv.org/abs/1706.03762' },
  chatgpt: { label: 'OpenAI · ChatGPT', url: 'https://openai.com/index/chatgpt/' },
  soraHistory: { label: 'OpenAI · Sora 研究', url: 'https://openai.com/index/video-generation-models-as-world-simulators/' },
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
  zombie: { label: 'Bilibili ·《丧尸清道夫》案例报道', url: 'https://www.bilibili.com/video/BV1vT5t6GEx3/' },
  zombieProcess: { label: 'Bilibili · Mx-Shell 创作流程分享', url: 'https://www.bilibili.com/video/BV1G25v6fERZ/' }
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
        <div class="agenda-item"><b>08</b><span>作业与第一次共创</span></div>
      </div>`
  },
  {
    section: '课程内容介绍',
    title: '个人介绍',
    layout: 'profile',
    eyebrow: '周文龙',
    html: `
      <div class="profile-grid">
        <div class="profile-mark"><span>ZW</span><small>课程讲师</small></div>
        <div class="profile-facts">
          <div><b>川农设计专业本硕</b><p>熟悉校园与设计课程语境</p></div>
          <div><b>海外研究经历</b><p>参与生成式图片平台搭建</p></div>
          <div><b>AI创业与NeoVista实践</b><p>用真实项目拆解完整流程</p></div>
        </div>
      </div>
      <p class="profile-note">工具会换，项目判断、内容表达和交付能力会留下。</p>`
  },
  {
    section: '课程内容介绍',
    title: 'AIGC',
    layout: 'visual',
    lead: '生成式AI处理的是不同形态的数字内容，一条AI视频会同时用到它们。',
    html: `
      <div class="visual-split visual-split-wide">
        <figure class="visual-panel"><img src="assets/generated/ai-tool-categories-v1.jpg" alt="文字、图片与视频模型协作完成内容任务的示意图"></figure>
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
    title: 'IP视频',
    layout: 'compare',
    lead: '一条视频解决一次表达，IP视频积累一套可以继续使用的内容系统。',
    html: `
      <div class="compare-panels ip-compare">
        <article><small>一条视频</small><b>发完就结束</b><ul><li>角色与画风可随时更换</li><li>每次重新解释背景</li><li>素材难以接着使用</li></ul></article>
        <div class="compare-arrow">→</div>
        <article class="featured"><small>IP视频</small><b>每一条都在积累</b><ul><li>固定角色与关系</li><li>固定栏目与表达方式</li><li>角色板、场景和提示词持续复用</li></ul></article>
      </div>`
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
    layout: 'timeline',
    lead: 'AI视频由多条技术路线逐步汇合而来。',
    html: `
      <div class="timeline">
        <article><time>1956</time><b>人工智能命名</b><p>达特茅斯研讨会把研究方向正式聚在一起</p></article>
        <article><time>2017</time><b>Transformer</b><p>让模型更有效地理解与生成序列内容</p></article>
        <article><time>2022</time><b>ChatGPT</b><p>自然语言成为普通人调用模型的入口</p></article>
        <article><time>2024</time><b>视频世界模型</b><p>文本开始直接驱动画面、运动与镜头</p></article>
        <article><time>2026</time><b>统一多模态创作</b><p>文字、图片、声音和视频开始在同一流程中协作</p></article>
      </div>`,
    sources: [SOURCE.dartmouth, SOURCE.transformer, SOURCE.chatgpt, SOURCE.soraHistory, SOURCE.seedance]
  },
  {
    section: 'AI发展背景介绍',
    title: '为什么用',
    layout: 'cards',
    html: `
      <div class="big-number-grid">
        <article><strong>01</strong><b>先做出来</b><p>没有演员、场地或完整团队，也能先做一个可看的原型。</p></article>
        <article><strong>02</strong><b>快速试错</b><p>同一想法可以比较多个脚本、画面和镜头方向。</p></article>
        <article><strong>03</strong><b>小团队协作</b><p>一个人可以覆盖更多环节，团队仍要分工与互相检查。</p></article>
        <article><strong>04</strong><b>形成新岗位</b><p>企业已经在招聘会脚本、生成、剪辑、评估和交付的人。</p></article>
      </div>`,
    sources: [SOURCE.jobsFull, SOURCE.jobsIntern]
  },
  {
    section: 'AI发展背景介绍',
    title: '怎么用',
    layout: 'process',
    lead: '先确定想得到什么，再决定让哪一种模型接手。',
    html: `
      <div class="four-step">
        <article><b>定义结果</b><p>给谁看，要讲什么，最后交什么</p></article>
        <article><b>拆成任务</b><p>文字、图片、声音和视频分开处理</p></article>
        <article><b>选择模型</b><p>按输入、控制力、速度和成本做选择</p></article>
        <article><b>留下资产</b><p>保存提示词、参考图、源片和失败原因</p></article>
      </div>
      <p class="center-note">AI负责生成候选，人负责判断方向、选择结果和承担交付。</p>`
  },
  {
    section: '鸭鸭视频背景介绍',
    title: '鸭鸭视频背景介绍',
    layout: 'project',
    lead: '《一觉醒来，下午没了》等系列化心理知识科普视频已经形成。',
    html: `
      <div class="project-split">
        <figure><img src="assets/project/existing-work.jpg" alt="鸭鸭项目已有作品与角色素材"></figure>
        <div class="project-stats">
          <article><strong>3</strong><span>只固定IP角色</span></article>
          <article><strong>5</strong><span>类可复用资产库</span></article>
          <article><strong>8+6+4</strong><span>三个月内容结构</span></article>
          <p>心理知识进入宿舍、考试、开学、毕业等具体校园情境，角色可以陪着学生持续出现。</p>
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
        <figure><img src="assets/cases/benchmark-danmao.jpeg" alt="蛋猫账号作品截图"><figcaption><b>蛋猫</b><span>角色关系反复出现，形成陪伴感</span></figcaption></figure>
        <figure><img src="assets/cases/benchmark-xinliya.jpg" alt="心理鸭账号作品截图"><figcaption><b>心理鸭</b><span>用漫画与小动画承接心理主题</span></figcaption></figure>
        <figure><img src="assets/cases/benchmark-huanxiong.jpg" alt="小浣熊阿啼账号作品截图"><figcaption><b>小浣熊阿啼</b><span>动物IP让成长故事更容易被听见</span></figcaption></figure>
      </div>
      <p class="bottom-callout">可以学习内容机制，不能复制角色外形、语言和故事。</p>`
  },
  {
    section: '鸭鸭视频背景介绍',
    title: 'IP能够承载什么',
    layout: 'ecosystem',
    html: `
      <div class="orbit-map">
        <div class="orbit-core">IP</div>
        <article class="o1"><b>知识传播</b><p>心理主题与校园生活</p></article>
        <article class="o2"><b>线上线下活动</b><p>预热、展板、贴纸与回顾</p></article>
        <article class="o3"><b>账号栏目</b><p>固定角色、语气与更新方式</p></article>
        <article class="o4"><b>创新创业比赛</b><p>真实问题、作品与数据</p></article>
        <article class="o5"><b>合作与文创</b><p>联名、校园节点与周边</p></article>
        <article class="o6"><b>数字产品</b><p>科普、活动与资源导航</p></article>
      </div>`
  },
  {
    section: '鸭鸭视频背景介绍',
    title: '对于大家这个IP有什么用',
    layout: 'cards',
    html: `
      <div class="benefit-grid">
        <article><b>真实作品集</b><p>展示脚本、分镜、生成、修改和成片，不只放一张最终图。</p></article>
        <article><b>个人表达</b><p>把自己熟悉的专业、校区生活和审美带进同一个IP。</p></article>
        <article><b>比赛证据</b><p>大创、挑战杯等项目需要问题、过程、作品和反馈。</p></article>
        <article><b>账号经验</b><p>理解稳定栏目、持续更新和数据复盘怎样形成。</p></article>
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
        <article><strong>01</strong><b>1至2分钟心理微剧情</b><p>把一件校园小事讲完整，稳住角色与故事。</p></article>
        <article><strong>02</strong><b>校园热点回应视频</b><p>围绕开学、考试、毕业和活动快速表达。</p></article>
        <article><strong>03</strong><b>学生团队继续发展</b><p>进入大创、创新创业比赛、小型工作室或个人项目。</p></article>
      </div>`
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
      <p class="case-story">当时还不熟练，项目也已经转过几手。客户付费购买的是能按要求使用的结果、修改能力和交付时间。</p>
      <small class="fact-label">真实个案只说明市场存在，不代表普遍报价。</small>`
  },
  {
    section: '你们能够获得什么',
    title: '自媒体账号',
    layout: 'process',
    lead: 'AI可以把制作做快，账号为什么值得关注仍要由你回答。',
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
        <article><small>BONUS 01</small><b>免费课程Token</b><p>用于对话、图片和视频生成，真正走一遍完整流程。</p></article>
        <article><small>BONUS 02</small><b>优秀作品继续推进</b><p>获得额外Token，继续修改、展示或进入鸭鸭项目。</p></article>
      </div>
      <p class="bonus-note">Token会被消耗，生成判断、失败记录和可复用资产会留下。</p>`
  },
  {
    section: '你们能够获得什么',
    title: '分组',
    layout: 'visual',
    lead: '第一轮采用3组×4席。问卷现有10名同学，另外2席在课堂确认。角色是起点，后续可以轮换。',
    html: `
      <div class="visual-split roster-visual-split">
        <figure class="visual-panel"><img src="assets/generated/duck-team-roles-portrait-v2.jpg" alt="三只鸭鸭在校园中分别承担统筹、内容与视觉任务"></figure>
        <div class="roster-grid compact-roster">
          <article><header><b>A组</b><span>统筹与制作</span></header><p>杨蕊羽 · 统筹发布</p><p>卢秋江 · 分镜与视频</p><p>汪蕊 · 剪辑包装</p><p>桑学涵 · 图片与提示词</p></article>
          <article><header><b>B组</b><span>视频与运营</span></header><p>李国豪 · 视频统筹</p><p>杨瑞盈 · QA与发布</p><p>买尔哈巴·买买提 · 脚本剪辑</p><p>待确认1席 · 视觉方向</p></article>
          <article><header><b>C组</b><span>内容与归档</span></header><p>袁纤惠 · 剪辑统筹</p><p>蒋欣益 · 图片与视频</p><p>达珂遥 · QA与素材归档</p><p>待确认1席 · 自选方向</p></article>
        </div>
      </div>`
  },
  {
    section: 'AI工具介绍',
    title: 'AI工具介绍',
    layout: 'family',
    lead: '产品会换名字，先记住三类模型在流程里的位置。',
    html: `
      <div class="tool-family">
        <article class="language"><i>LLM</i><b>大语言与理解模型</b><p>调研 · 脚本 · 分镜 · 分析</p><div><span>DeepSeek</span><span>Kimi</span><span>GLM</span><span>OpenAI</span><span>Claude</span><span>Gemini</span></div></article>
        <article class="image"><i>IMG</i><b>图片生成与编辑模型</b><p>角色 · 场景 · 关键帧 · 封面</p><div><span>Seedream</span><span>GLM-Image</span><span>GPT Image</span><span>Nano Banana</span></div></article>
        <article class="video"><i>VID</i><b>视频生成与编辑模型</b><p>表演 · 动作 · 镜头 · 声音</p><div><span>Seedance</span><span>Kling</span><span>MiniMax</span><span>Veo</span><span>Runway</span></div></article>
      </div>`
  },
  {
    section: 'AI工具介绍',
    title: '三类模型',
    layout: 'table',
    html: `
      <div class="model-table">
        <div class="row head"><span>模型类型</span><span>输入</span><span>主要输出</span><span>在AI视频里的位置</span></div>
        <div class="row"><b>大语言模型</b><span>文字、资料、图像、视频</span><span>文字与分析</span><span>选题、脚本、分镜、评审</span></div>
        <div class="row"><b>图片模型</b><span>文字、参考图</span><span>静态画面</span><span>角色、场景、首尾帧、封面</span></div>
        <div class="row"><b>视频模型</b><span>文字、图像、音频、视频</span><span>动态镜头</span><span>表演、动作、镜头运动、声音</span></div>
      </div>
      <p class="table-note">“看懂视频”负责分析，“生成视频”负责制作。产品名是入口，模型名是其中实际工作的系统。</p>`
  },
  {
    section: 'AI工具介绍',
    title: '国内大语言模型',
    layout: 'visual',
    html: `
      <div class="visual-split model-family-split">
        <figure class="visual-panel"><img src="assets/generated/models-domestic-triad-v1.jpg" alt="国内大语言模型的推理、长上下文与结构化输出能力示意"></figure>
        <div class="model-fact-stack">
          <article><small>DeepSeek</small><b>V4-Pro / V4-Flash</b><p>100万上下文；Pro处理复杂任务，Flash适合快速批量。</p></article>
          <article><small>Kimi</small><b>K3</b><p>100万上下文与原生多模态，适合多文件和长时间知识工作。</p></article>
          <article><small>智谱</small><b>GLM-5.2</b><p>长上下文、超长输出和工具调用，适合方案与结构化交付。</p></article>
        </div>
      </div>`,
    sources: [SOURCE.deepseek, SOURCE.kimi, SOURCE.glm52]
  },
  {
    section: 'AI工具介绍',
    title: '国外大语言模型',
    layout: 'visual',
    html: `
      <div class="visual-split model-family-split">
        <figure class="visual-panel"><img src="assets/generated/models-international-triad-v1.jpg" alt="国外大语言模型的复杂推理、长任务和多模态能力示意"></figure>
        <div class="model-fact-stack">
          <article><small>OpenAI</small><b>GPT-5.6</b><p>Sol负责高难度工作，Terra平衡日常任务，Luna优先速度与成本。</p></article>
          <article><small>Anthropic</small><b>Claude Fable 5</b><p>长任务、知识工作与视觉理解突出；Mythos 5仅限可信项目访问。</p></article>
          <article><small>Google</small><b>Gemini 3.6 Flash</b><p>通用多模态主力；3.5 Flash-Lite适合高吞吐任务。</p></article>
        </div>
      </div>`,
    sources: [SOURCE.gpt56, SOURCE.claude5, SOURCE.gemini36]
  },
  {
    section: 'AI工具介绍',
    title: '对比差异如何使用',
    layout: 'priority',
    lead: '没有永久总冠军。把优先级绑定到任务，选择才有意义。',
    html: `
      <div class="priority-table">
        <div><b>复杂策划与最终复核</b><span>GPT-5.6 Sol · Claude Fable 5 · DeepSeek V4-Pro</span></div>
        <div><b>大量资料与长项目文件</b><span>Kimi K3 · GLM-5.2 · DeepSeek V4-Pro</span></div>
        <div><b>快速批量与低成本初稿</b><span>DeepSeek V4-Flash · GPT-5.6 Luna · Gemini 3.5 Flash-Lite</span></div>
        <div><b>看图、看片与多模态分析</b><span>Kimi K3 · Gemini 3.6 Flash · Claude Fable 5</span></div>
      </div>
      <p class="table-note">课堂建议只表示本节课的任务匹配，模型版本和使用场景都会改变排序。</p>`,
    sources: [SOURCE.deepseek, SOURCE.kimi, SOURCE.glm52, SOURCE.gpt56, SOURCE.claude5, SOURCE.gemini36]
  },
  {
    section: 'AI工具介绍',
    title: '图片模型',
    layout: 'visual',
    html: `
      <div class="visual-split model-family-split">
        <figure class="visual-panel"><img src="assets/generated/image-model-capabilities-v1.jpg" alt="角色参考、场景生成、局部编辑与版式输出能力示意"></figure>
        <div class="model-fact-stack four-facts">
          <article><small>字节</small><b>Seedream 5.0 Lite</b><p>视觉推理、风格迁移与多主体指令。</p></article>
          <article><small>智谱</small><b>GLM-Image</b><p>中文文字、海报、PPT与知识密集画面。</p></article>
          <article><small>OpenAI</small><b>GPT Image 2</b><p>高保真参考、生成和局部编辑。</p></article>
          <article><small>Google</small><b>Nano Banana 2</b><p>快速编辑、主体一致与多分辨率输出。</p></article>
        </div>
      </div>`,
    sources: [SOURCE.seedream, SOURCE.glmImage, SOURCE.gptImage2, SOURCE.nanoBanana2]
  },
  {
    section: 'AI工具介绍',
    title: '图片模型怎么选',
    layout: 'priority',
    html: `
      <div class="priority-table">
        <div><b>IP角色与参考图编辑</b><span>Nano Banana 2 · GPT Image 2</span></div>
        <div><b>中文海报与知识图解</b><span>GLM-Image · Seedream 5.0 Lite</span></div>
        <div><b>复杂构图与风格迁移</b><span>Seedream 5.0 Lite · GPT Image 2</span></div>
        <div><b>课堂最重要的顺序</b><span>先锁角色 → 再锁场景 → 最后生成关键帧</span></div>
      </div>
      <p class="table-note">同一角色先用参考图编辑，通常比每次只靠文字重新生成更稳定。</p>`,
    sources: [SOURCE.seedream, SOURCE.glmImage, SOURCE.gptImage2, SOURCE.nanoBanana2]
  },
  {
    section: 'AI工具介绍',
    title: 'Seedance 2.0',
    layout: 'model-hero',
    theme: 'dark',
    eyebrow: '字节跳动视频生成模型',
    html: `
      <div class="model-hero-grid">
        <div class="model-wordmark">SEEDANCE<br><strong>2.0</strong></div>
        <div class="model-hero-facts">
          <article><b>四类输入</b><p>文字、图片、音频、视频</p></article>
          <article><b>统一音视频生成</b><p>画面与声音进入同一创作架构</p></article>
          <article><b>更强控制</b><p>复杂动作、物理准确性、参考与编辑能力提升</p></article>
        </div>
      </div>
      <p class="model-hero-note">Seedance 2.0把文字、参考图、音频与视频接进同一条动态镜头创作流程。</p>`,
    sources: [SOURCE.seedance]
  },
  {
    section: 'AI工具介绍',
    title: '国内视频模型',
    layout: 'model-cards',
    html: `
      <div class="model-card-grid three">
        <article data-brand="SEED"><small>字节</small><b>Seedance 2.0</b><ul><li>多模态参考与编辑</li><li>复杂运动与物理稳定</li><li>适合控制要求高的镜头</li></ul></article>
        <article data-brand="KL"><small>快手</small><b>可灵 Video 3.0</b><ul><li>最长15秒</li><li>原生音频与多镜头</li><li>多角色和元素一致性</li></ul></article>
        <article data-brand="H3"><small>MiniMax</small><b>H3</b><ul><li>统一图像、视频与音频生成</li><li>最高2K、15秒与立体声</li><li>支持编辑和动作迁移</li></ul></article>
      </div>`,
    sources: [SOURCE.seedance, SOURCE.kling, SOURCE.minimax]
  },
  {
    section: 'AI工具介绍',
    title: '国外视频模型',
    layout: 'model-cards',
    html: `
      <div class="model-card-grid three">
        <article data-brand="VEO"><small>Google</small><b>Veo 3.1</b><ul><li>参考图要素控制</li><li>支持9比16竖屏</li><li>可输出1080P与4K选项</li></ul></article>
        <article data-brand="R"><small>Runway</small><b>Gen-4</b><ul><li>角色、物体与场景一致性</li><li>强调参考图驱动</li><li>适合连续世界与视觉开发</li></ul></article>
        <article class="muted" data-brand="S"><small>OpenAI</small><b>Sora 2</b><ul><li>曾是重要视频产品</li><li>官方已于2026年4月停止提供</li><li>不列入本课程当前工具清单</li></ul></article>
      </div>`,
    sources: [SOURCE.veo31, SOURCE.runway, SOURCE.sora2]
  },
  {
    section: 'AI工具介绍',
    title: '视频模型怎么选',
    layout: 'visual',
    html: `
      <div class="visual-split model-choice-split">
        <figure class="visual-panel"><img src="assets/generated/video-model-capabilities-v1.jpg" alt="参考图、角色一致性、运动和声音进入视频模型的示意图"></figure>
        <div class="priority-table compact-priority">
          <div><b>复杂动作与多模态控制</b><span>Seedance 2.0</span></div>
          <div><b>多镜头、多人和原生声音</b><span>可灵 Video 3.0</span></div>
          <div><b>统一生成、编辑和动作迁移</b><span>MiniMax H3</span></div>
          <div><b>参考一致性与连续世界</b><span>Runway Gen-4</span></div>
          <div><b>竖屏与高分辨率输出</b><span>Veo 3.1</span></div>
        </div>
      </div>
      <p class="table-note">先看输入和控制方式，再看一次生成效果。模型失败时要判断是换提示词、换关键帧还是换模型。</p>`,
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
    layout: 'venn',
    lead: '鸭鸭选题要同时落在三个圈里。',
    html: `
      <div class="venn-wrap">
        <div class="venn a"><b>学生正在经历</b><span>宿舍、考试、关系、成长</span></div>
        <div class="venn b"><b>心理知识可承接</b><span>有依据、有边界、能行动</span></div>
        <div class="venn c"><b>鸭鸭适合表达</b><span>轻剧情、角色关系、校园语言</span></div>
        <strong class="venn-center">可做选题</strong>
      </div>
      <p class="center-note">先写出一个具体瞬间，再决定它属于哪个心理主题。</p>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '脚本写作与分镜控制',
    layout: 'split',
    html: `
      <div class="two-lanes script-lanes">
        <article><small>脚本回答</small><b>这件事为什么值得看</b><ul><li>谁遇到了什么</li><li>情绪在哪里发生变化</li><li>最后留下什么行动</li></ul></article>
        <article class="accent"><small>分镜回答</small><b>观众具体看见什么</b><ul><li>景别与机位</li><li>角色动作与表情</li><li>每个镜头的时长与连接</li></ul></article>
      </div>
      <p class="bottom-callout">一段脚本可以对应多个镜头，一个镜头只承担一个主要任务。</p>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '分镜提示词控制',
    layout: 'formula',
    lead: '提示词要把导演判断翻译成模型可以执行的信息。',
    html: `
      <div class="prompt-formula"><span>主体</span><i>＋</i><span>场景</span><i>＋</i><span>镜头</span><i>＋</i><span>动作</span><i>＋</i><span>光线</span><i>＋</i><span>连续性</span></div>
      <div class="prompt-example"><small>示例</small><p>饭团站在傍晚宿舍床边，中近景固定机位，先低头看计划本，再轻轻叹气，暖黄台灯，蓝色领巾与上一镜一致。</p></div>
      <p class="table-note">“电影感、震撼、高级”无法替代具体的主体、空间、动作和镜头。</p>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '分镜视频生成',
    layout: 'process',
    html: `
      <div class="generation-steps">
        <article><b>先检查关键帧</b><p>角色、构图和道具不对时，不急着让它动。</p></article>
        <article><b>一镜一个动作</b><p>短时长先完成主要表演，减少互相打架。</p></article>
        <article><b>写清运动关系</b><p>谁动、怎样动、镜头是否跟随、声音何时发生。</p></article>
        <article><b>按错误类型返工</b><p>身份错回图片，动作错改视频，节奏错留给剪辑。</p></article>
      </div>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '整体调整与剪辑',
    layout: 'editor',
    html: `
      <div class="editor-timeline">
        <div class="track video"><span>镜头1</span><span>镜头2</span><span>镜头3</span><span>镜头4</span></div>
        <div class="track audio"><span>对白</span><span>环境音</span><span>音乐</span></div>
        <div class="track text"><span>字幕</span><span>知识卡</span><span>片尾</span></div>
      </div>
      <div class="edit-checks"><span>删掉不稳定镜头</span><span>统一节奏与颜色</span><span>补声音与字幕</span><span>复查知识边界</span></div>
      <p class="center-note">剪辑决定哪些生成结果真正留到成片里，也决定观众最后看见什么。</p>`
  },
  {
    section: 'AI视频工作流介绍',
    title: '发布准备与资料库整理',
    layout: 'library',
    lead: '成片只是一次交付，资料库决定下一条能不能接着做。',
    html: `
      <div class="library-grid">
        <article><b>IP资源库</b><p>角色板、比例、表情、声音</p></article>
        <article><b>图片库</b><p>场景、关键帧、封面与批准稿</p></article>
        <article><b>视频库</b><p>源片、通过镜头、失败镜头</p></article>
        <article><b>图片提示词库</b><p>角色、场景、构图与修改记录</p></article>
        <article><b>视频提示词库</b><p>动作、镜头、声音与模型参数</p></article>
      </div>
      <div class="publish-strip"><span>成片规格</span><span>封面与标题</span><span>字幕与文案</span><span>授权与来源</span><span>文件索引</span></div>`
  },
  {
    section: 'AI视频工作流介绍',
    title: 'T+3 / T+7 / T+14',
    layout: 'timeline-short',
    lead: '发布以后继续观察，账号才会积累自己的内容方法。',
    html: `
      <div class="review-timeline">
        <article><time>T+3</time><b>先看第一反应</b><p>停留、完播、评论在问什么，是否看懂主题。</p></article>
        <article><time>T+7</time><b>看内容结构</b><p>哪一段留住人，哪一段让人离开，哪些话被转发。</p></article>
        <article><time>T+14</time><b>决定是否复用</b><p>角色、栏目、标题和镜头做法哪些值得留下。</p></article>
      </div>`
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
        <figure class="case-photo portrait"><img src="assets/cases/mushroom-ip.jpg" alt="M Stand与小蘑菇秃秃的真实联名案例"><figcaption><span>内容IP进入现实合作</span><b>把故事做小<br>把角色做久</b></figcaption></figure>
        <div class="case-lessons"><article><b>固定角色</b><p>圆润蘑菇与微缩世界一眼可认</p></article><article><b>固定尺度</b><p>煮面、交朋友、休息也能成为一集</p></article><article><b>固定关系</b><p>内容积累以后，可以进入联名、周边和数字互动</p></article></div>
      </div>
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
        <figure class="case-photo landscape"><img src="assets/cases/mxshell-news.jpg" alt="丧尸清道夫作品画面与主角形象"><figcaption><span>AI短片</span><b>工具普及以后<br>作者性更容易被看见</b></figcaption></figure>
      </div>`,
    sources: [SOURCE.zombie, SOURCE.zombieProcess, SOURCE.seedance]
  },
  {
    section: '热门作品解析',
    title: '成熟商业动画与甲方项目单',
    layout: 'client',
    lead: '客户购买的是能按要求使用的结果，以及过程中的确定性。',
    html: `
      <div class="client-grid">
        <article><b>需求</b><p>用途、受众、平台、时长、画幅与日期</p></article>
        <article><b>确认</b><p>脚本、风格稿、分镜与关键帧</p></article>
        <article><b>制作</b><p>逐镜头源片、编号、初剪与修改记录</p></article>
        <article><b>交付</b><p>横竖版本、字幕、封面、授权与源文件</p></article>
      </div>
      <p class="client-note"><b>M Stand × 小蘑菇秃秃</b>把实体盲盒、NFC数字IP与场景故事同时落地。好看是基础，品牌准确、反馈改得动、按时交付，才构成商业完成度。</p>`,
    sources: [SOURCE.mushroomBrand]
  },
  {
    section: '作业与第一次共创',
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
    section: '作业与第一次共创',
    title: '第一次共创',
    layout: 'visual',
    html: `
      <div class="visual-split team-visual-split">
        <figure class="visual-panel"><img src="assets/generated/duck-mental-microstory-v1.jpg" alt="三只鸭鸭在宿舍围桌共同讨论心理微剧情"></figure>
        <div class="team-task-stack">
          <article><b>A组</b><p>定选题与发布目标</p><small>先明确作品给谁看</small></article>
          <article><b>B组</b><p>拆一个可生成镜头</p><small>说清画面、动作与声音</small></article>
          <article><b>C组</b><p>建立文件与QA规则</p><small>从第一版保存输入和问题</small></article>
        </div>
      </div>
      <div class="deliverable"><b>每组至少留下</b><span>一个清楚的选题</span><span>一份当前版本</span><span>一句具体卡点</span></div>`
  },
  {
    section: '作业与第一次共创',
    title: '问题解答',
    layout: 'questions',
    theme: 'dark',
    html: `
      <div class="question-grid">
        <article><b>哪个AI最好用</b><p>先说清任务，再比较模型。</p></article>
        <article><b>没有影视基础能不能做</b><p>可以从选题、筛选、QA和归档进入。</p></article>
        <article><b>提示词越长越好吗</b><p>信息要具体，任务要单一，参考不能打架。</p></article>
        <article><b>AI会替代做视频的人吗</b><p>重复环节会变快，判断与交付会更重要。</p></article>
      </div>
      <p class="end-line">先完成第一次，再从真实问题里继续学。</p>`
  }
];
