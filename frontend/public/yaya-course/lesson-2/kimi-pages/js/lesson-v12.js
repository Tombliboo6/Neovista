function lessonImage(file,label,cls="") {
  return '<figure class="lesson-figure '+cls+'"><img src="'+A+file+'" alt="'+label+'"><figcaption>'+label+'</figcaption></figure>';
}
function lessonNote(text){if(!text)return "";return '<p class="lesson-note">'+text+'</p>';}
function lessonButtons(p){return '<div class="lesson-actions"><button data-show-prompt>查看完整提示词</button><button class="solid" data-copy-prompt>复制提示词</button>'+ (p.files||[]).map(f=>'<a href="'+A+f[0]+'" download>'+f[1]+'</a>').join('')+(p.sourceLink?'<a href="'+p.sourceLink+'" target="_blank" rel="noopener">舞蹈来源</a>':'')+'</div>';}
function lessonRows(rows){return '<div class="lesson-rows">'+rows.map((r,i)=>'<section><b>'+String(i+1).padStart(2,"0")+'</b><div><h3>'+r[0]+'</h3><p>'+r[1]+'</p>'+(r[2]?'<small>'+r[2]+'</small>':'')+'</div></section>').join('')+'</div>';}
function renderLessonPage(p){
  if(p.kind==='lesson-homework')return '<div class="homework-final"><p class="homework-intro">'+p.intro+'</p><div class="homework-tasks">'+p.tasks.map((t,i)=>'<article><span>0'+(i+1)+'</span><h2>'+t[0]+'</h2><p>'+t[1]+'</p></article>').join('')+'</div><section class="homework-submit"><h2>请提交这三项</h2><div>'+p.deliverables.map(t=>'<article><h3>'+t[0]+'</h3><p>'+t[1]+'</p></article>').join('')+'</div></section><nav class="homework-guides" aria-label="课后资料"><b>课后资料</b>'+p.resources.map(r=>'<a href="'+A+r[2]+'" download>'+r[0]+' ↗</a>').join('')+'</nav></div>';
  if(p.kind==="lesson-practice-demo"){
    const asset=r=>r.kind==='video'?'<video src="'+r.file+'" controls preload="metadata" playsinline aria-label="'+r.label+'"></video>':'<img src="'+r.file+'" alt="'+r.label+'">';
    const refs=p.refs.map(r=>'<figure class="demo-reference"><figcaption>'+r.label+'</figcaption><div>'+asset(r)+'</div></figure>').join('');
    return '<div class="practice-demo"><p class="demo-lead">'+p.lead+'</p><div class="demo-media demo-'+p.mode+'"><div class="demo-inputs">'+refs+'</div><figure class="demo-result"><figcaption>生成结果 <span>'+p.mediaInfo+'</span></figcaption><div><video src="'+p.video+'" poster="'+p.poster+'" controls preload="metadata" playsinline aria-label="生成结果"></video></div></figure></div><div class="demo-footer"><span>'+p.params.join(' · ')+'</span><a href="'+p.libraryUrl+'" target="_blank" rel="noopener">打开实操素材 ↗</a></div></div>';
  }
  if(p.kind==="lesson-workflow-illustrated"){
    const caption=i=>'<div class="overview-step"><b>'+p.steps[i][0]+'</b><div><h2>'+p.steps[i][1]+'</h2><p>'+p.steps[i][2]+'</p></div></div>';
    const picture=(n,label)=>'<img src="'+A+p.images[n]+'" alt="'+label+'">';
    return '<div class="workflow-overview"><article>'+picture(0,'选题')+caption(0)+'</article><article class="overview-writing">'+picture(1,'故事与脚本')+'<div class="overview-writing-captions">'+caption(1)+caption(2)+'</div></article><article>'+picture(2,'文字分镜')+caption(3)+'</article><article>'+picture(3,'关键帧')+caption(4)+'</article><article>'+picture(4,'视频生成')+caption(5)+'</article><article class="overview-post"><div class="overview-post-images">'+p.images.slice(5).map((img,i)=>'<figure><img src="'+A+img+'" alt="'+p.postLabels[i]+'"><figcaption>'+p.postLabels[i]+'</figcaption></figure>').join('')+'</div>'+caption(6)+'</article></div>';
  }

  if(p.kind==="watch-film")return '<div class="film-stage"><video src="'+A+p.video+'" controls preload="metadata" playsinline aria-label="'+p.h+'"></video></div>';
  if(p.kind==="lesson-course-parts")return '<div class="course-parts-r2">'+p.parts.map((r,i)=>(i?'<div class="course-part-arrow">→</div>':'')+'<section class="course-part-r2 part-'+i+'"><b>'+r[0]+'</b><span>'+r[1]+'</span><h2>'+r[2]+'</h2></section>').join('')+'</div>';
  if(p.kind==="lesson-prompt-detail")return '<div class="prompt-detail-heading"><span>段落</span><span>主要写什么</span><span>书中校园示例</span></div><div class="prompt-detail-rows">'+p.rows.map((r,i)=>'<section><div class="prompt-detail-label"><b>0'+(i+1)+'</b><h2>'+r[0]+'</h2></div><div class="prompt-detail-content"><h3>'+r[1]+'</h3><p>'+r[2]+'</p></div><p class="prompt-detail-example">'+r[3]+'</p></section>').join('')+'</div>';

  if(p.kind==="lesson-cover")return '<div class="cover-v12"><div class="cover-v12-copy"><span>鸭鸭特工队 AIGC 课程</span><h1>'+p.h+'</h1><h2>'+p.lead+'</h2><p>'+p.sub+'</p><div class="cover-tags">'+p.tags.map(x=>'<b>'+x+'</b>').join('')+'</div><i>用一张好画面，开始一次创作。</i></div>'+lessonImage(p.image,'饭团的太空探索')+'</div>';
  if(p.kind==="lesson-goals")return '<h2 class="lesson-lead">'+p.h+'</h2><div class="goal-list">'+p.items.map(r=>'<section><b>'+r[0]+'</b><h3>'+r[1]+'</h3><p>'+r[2]+'</p></section>').join('')+'</div>'+lessonNote(p.noteText);
  if(p.kind==="lesson-agenda")return '<h2 class="lesson-lead">'+p.h+'</h2><div class="agenda-list">'+p.bands.map(r=>'<section><b>'+r[0]+'</b><h3>'+r[1]+'</h3><p>'+r[2]+'</p></section>').join('')+'</div>'+lessonNote(p.noteText);
  if(p.kind==="lesson-workflow")return '<div class="workflow-list">'+p.items.map((r,i)=>'<section><b>'+String(i+1).padStart(2,"0")+'</b><h3>'+r[0]+'</h3><p>'+r[1]+'</p></section>').join('')+'</div><div class="workflow-images">'+p.images.map(r=>lessonImage(r[0],r[1])).join('')+'</div>'+lessonNote(p.noteText);
  if(p.kind==="lesson-prompt-map")return '<div class="prompt-map-layout">'+lessonRows(p.rows)+'<div class="prompt-map-example">'+lessonImage(p.image,'示例：书中校园')+lessonNote(p.noteText)+'</div></div>';
  if(p.kind==="lesson-video-map")return '<div class="video-map-layout">'+lessonRows(p.rows)+'<div class="video-map-demo"><div class="video-map-frames">'+p.evidence.map(r=>lessonImage(r[0],r[1])).join('')+'</div><div class="video-map-timeline">'+p.timeline.map((r,i)=>'<section><b>'+r[0]+'</b><p>'+r[1]+'</p></section>').join('')+'</div>'+lessonNote(p.noteText)+'</div></div>';
  if(p.kind==="practice-personal"){
    const visual=p.video?'<video id="practice-preview" src="'+A+p.video+'" poster="'+A+p.preview+'" controls preload="metadata"></video>':p.secondPreview?'<div class="practice-pair">'+lessonImage(p.preview,'首帧：动作起点')+lessonImage(p.secondPreview,'尾帧：站稳抱头')+'</div>':'<img id="practice-preview" src="'+A+p.preview+'" alt="实操参考或示例">';
    if(pageNumber===45)return '<div class="personal-layout"><div class="personal-visual">'+visual+'<div class="variant-tabs">'+p.variants.map((v,i)=>'<button data-variant="'+i+'" class="'+(i===0?'active':'')+'">'+v.name+'</button>').join('')+'</div><section class="variant-inputs" data-variant-inputs hidden></section><p class="personal-output"><span>本轮保存</span>'+p.result+'</p></div><div class="personal-instructions"><section class="personal-inline-prompt"><header><div><span>完整提示词</span><h2 data-inline-prompt-title></h2></div><button data-copy-prompt>复制提示词</button></header><pre data-inline-prompt tabindex="0" role="region" aria-label="完整提示词，可上下滚动"></pre></section></div></div><p class="personal-wait">'+p.waitText+'</p>';
    return '<div class="personal-layout"><div class="personal-visual">'+visual+(p.variants?'<div class="variant-tabs">'+p.variants.map((v,i)=>'<button data-variant="'+i+'" class="'+(i===0?'active':'')+'">'+v.name+'</button>').join('')+'</div>':'')+'<p class="personal-output"><span>本轮保存</span>'+p.result+'</p></div><div class="personal-instructions"><p class="personal-intro">'+p.subtitle+'</p>'+lessonRows(p.steps)+lessonButtons(p)+'</div></div><p class="personal-wait">'+p.waitText+'</p>';
  }
  if(p.kind==="lesson-case-tabs")return '<div class="case-tabs-v12">'+p.cases.map((c,i)=>'<button data-case="'+i+'" class="'+(i===0?'active':'')+'">'+c.title+'</button>').join('')+'</div><div class="case-tab-layout"><video id="case-player" src="'+A+p.cases[0].video+'" controls preload="metadata"></video><div><span class="lesson-eyebrow">观察重点</span><h2 id="case-focus">'+p.cases[0].focus+'</h2><p id="case-copy">'+p.cases[0].copy+'</p>'+lessonNote(p.noteText)+'</div></div>';
  if(p.kind==="lesson-resources")return '<div class="resource-list">'+p.resources.map((r,i)=>'<a href="'+A+r[2]+'" download><b>0'+(i+1)+'</b><div><h2>'+r[0]+'</h2><p>'+r[1]+'</p></div><span>下载 Word</span></a>').join('')+'</div><div class="after-class"><h2>课后再试一次</h2><p>'+p.task+'</p><small>'+p.saveText+'</small></div>';
  if(p.kind==="mode-case"){
    const bullets={
      10:[['动作因果','前车入水，先形成水墙；后车再冲破遮挡。'],['动作结果','皮卡驶上对岸，继续追逐。'],['观察重点','水花、车身运动与落地重量感。']],
      11:[['首帧锁定','同一座灯塔、同一构图和风暴场景。'],['动作变化','灯室点亮，灯束转动，海浪撞击礁石。'],['观察重点','建筑稳定，变化按顺序发生。']],
      12:[['开始状态','黄铜星象仪处于收拢状态。'],['变化过程','环轨和机械臂逐步展开。'],['结束状态','抵达指定的完整结构与发光状态。']],
      13:[['外观参考','干净场景图决定建筑、地形与光线。'],['路径参考','标注图规定经过哪些位置。'],['观察重点','穿拱、抬升、接近穹顶的先后顺序。']]
    };
    const refs=p.gallery?.length?'<div class="mode-ref-strip">'+p.gallery.map(r=>lessonImage(r[0],r[1])).join('')+'</div>':'<div class="mode-input-note">文字输入<br><b>0 张参考图片</b></div>';
    return '<div class="mode-v12"><div class="mode-v12-media"><video src="'+A+p.video+'" '+(p.poster?'poster="'+A+p.poster+'"':'')+' controls preload="metadata"></video>'+refs+'</div><div class="mode-v12-copy"><h2>'+p.h+'</h2><p class="mode-meta">'+p.meta.join('　')+'</p>'+lessonRows(bullets[pageNumber]||[])+lessonButtons(p)+(p.sourceNote?'<p class="source-caption">'+p.sourceNote+' <a href="https://deepmind.google/models/veo/" target="_blank" rel="noopener">官方来源</a></p>':'')+'</div></div>';
  }
  if(p.kind==="full-video-prompt"){
    const refs='<div class="source-prompt-refs" data-source-refs>'+p.refs.map(r=>lessonImage(r[0],r[1]+'：'+r[2])).join('')+'</div>';
    const visual=p.resultVideo?'<section class="source-case-media"><nav class="source-case-tabs" aria-label="案例素材"><button data-source-view="refs" aria-pressed="true">参考素材</button><button data-source-view="result" aria-pressed="false">生成结果</button></nav>'+refs+'<div class="source-case-result" data-source-result hidden><video src="'+A+p.resultVideo+'" poster="'+A+p.resultPoster+'" controls playsinline preload="metadata" aria-label="踱步到抱头生成结果"></video></div></section>':refs;
    return '<div class="source-prompt-layout">'+visual+'<section class="source-inline-prompt"><header><h2>完整视频提示词</h2><span>上下滚动阅读</span></header><p class="source-caption">'+p.meta+'</p>'+(p.actionSummary?'<p class="source-action-summary">'+p.actionSummary+'</p>':'')+'<pre data-inline-prompt tabindex="0" role="region" aria-label="完整视频提示词，可上下滚动"></pre>'+lessonButtons(p)+'</section></div>';
  }
  if(p.kind==="case-comparison-videos"&&p.cases.every(c=>c.teaching)){
    return '<div class="error-workbench result-review"><div class="error-toolbar"><div class="error-tabs" role="group" aria-label="切换生成案例">'+p.cases.map((c,i)=>'<button data-error-case="'+i+'" aria-pressed="'+(i===0)+'">'+c.teaching.tab+'</button>').join('')+'</div><div class="error-actions"><button data-toggle-errors aria-pressed="true">隐藏重点</button><button data-copy-error>复制提示词</button></div></div><div class="error-layout"><section class="error-evidence"><span class="review-result-label">原始生成结果</span><video id="error-player" src="'+A+p.cases[0].video+'" controls preload="metadata" playsinline data-fullscreen-on-play aria-label="原始生成案例视频"></video><div class="error-observation"><h3>观察结果</h3><p data-error-observation></p></div><div class="error-treatment"><h3>处理方式</h3><p data-error-treatment></p></div></section><section class="error-prompt-panel"><header><div class="review-version-toolbar"><h2>完整提示词</h2><div class="review-version-tabs" role="group" aria-label="选择提示词版本"><button data-prompt-version="0" aria-pressed="false">原始提示词</button><button data-prompt-version="1" aria-pressed="true">调整后提示词</button></div></div><span data-error-source></span></header><div class="error-prompt-scroll" tabindex="0" role="region" aria-label="完整提示词，可上下滚动" data-error-prompt></div><footer data-prompt-footer>上下滚动 · 绿色编号对应本次重点调整</footer></section><aside class="error-analysis"><h2>针对性调整</h2><div data-error-notes></div><div class="error-question" hidden><b>先观察成片</b><p>哪些画面需要保持稳定？<br>哪些动作需要明确结束？</p><p>再决定下一次补充什么约束。</p></div><p class="error-takeaway" data-error-takeaway></p></aside></div></div>';
  }
  if(p.kind==="static-prompt-workbench")return '<div class="source-prompt-layout"><div class="source-prompt-refs two">'+p.refs.map(r=>lessonImage(r[0],r[1])).join('')+'</div><div class="source-prompt-summary"><h2>角色固定描述，也写进提示词</h2>'+lessonRows([['基础设定','饭团身份特征、黄昏卧室与画幅。'],['视觉风格','描边、明暗、光向与场景质感。'],['画面布局','A点站位、双翅动作与家具关系。'],['摄影成像','固定远景、平视、完整呈现双脚。'],['负面约束','外形漂移、肢体错误与空间变化。']])+lessonButtons(p)+'</div></div>';
  return null;
}
function lessonPromptText(p){
 if(p.promptText)return p.promptText;
 if(p.kind==="mode-case")return p.prompt.map(s=>s.title+"\n"+s.text).join("\n\n");
 if(p.kind==="full-video-prompt")return p.refs.map(r=>r[1]+"\n"+r[2]).join("\n\n")+"\n\n"+p.promptSections.map(s=>s.title+"\n"+s.paragraphs.join("\n")).join("\n\n");
 if(p.kind==="static-prompt-workbench")return p.referenceLine+"\n\n关键限制："+p.critical+"\n\n"+p.promptSections.map(s=>s.join("\n")).join("\n\n");
 return "";
}
function setupLessonInteractions(p){
 document.querySelectorAll('[data-source-view]').forEach(button=>button.onclick=()=>{const result=button.dataset.sourceView==='result';document.querySelector('[data-source-refs]').hidden=result;document.querySelector('[data-source-result]').hidden=!result;document.querySelectorAll('[data-source-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));if(!result)document.querySelector('[data-source-result] video').pause();});
 if(p.kind==='lesson-practice-demo')document.querySelectorAll('.practice-demo video').forEach(video=>video.addEventListener('play',()=>document.querySelectorAll('.practice-demo video').forEach(other=>{if(other!==video)other.pause();})));
 const dialog=document.createElement("dialog");dialog.className="prompt-dialog";dialog.innerHTML='<header><strong>完整提示词</strong><button data-close-prompt>关闭 ESC</button></header><pre></pre>';document.body.append(dialog);
 if(p.promptTitle)dialog.querySelector('header strong').textContent=p.promptTitle;
 let currentPrompt=lessonPromptText(p);
 const inlinePrompt=document.querySelector("[data-inline-prompt]");
 const updateInlinePrompt=name=>{if(!inlinePrompt)return;inlinePrompt.textContent=currentPrompt;inlinePrompt.scrollTop=0;const title=document.querySelector("[data-inline-prompt-title]");if(title)title.textContent=name;};
 updateInlinePrompt(p.variants?.[0]?.name||p.h);
 const setPrompt=()=>dialog.querySelector("pre").textContent=currentPrompt;
 document.querySelectorAll("[data-show-prompt]").forEach(b=>b.onclick=()=>{setPrompt();dialog.showModal();});
 document.querySelectorAll("[data-copy-prompt]").forEach(b=>b.onclick=async()=>{
  try{await navigator.clipboard.writeText(currentPrompt);b.textContent="已复制";}
  catch{const text=document.createElement("textarea");text.value=currentPrompt;document.body.append(text);text.select();const ok=document.execCommand("copy");text.remove();b.textContent=ok?"已复制":"请在完整提示词中复制";}
 });
 dialog.querySelector("[data-close-prompt]").onclick=()=>dialog.close();
 document.querySelectorAll("[data-variant]").forEach(b=>b.onclick=()=>{const v=p.variants[Number(b.dataset.variant)];currentPrompt=v.prompt;updateInlinePrompt(v.title||v.name);const inputs=document.querySelector("[data-variant-inputs]");if(inputs){inputs.hidden=!v.refs?.length;inputs.innerHTML=v.refs?.length?'<b>先上传三张人物板</b><div>'+v.refs.map(r=>'<a href="'+A+r[0]+'" download>'+r[1]+'</a>').join('')+'</div>':'';}document.getElementById("practice-preview").src=A+v.preview;document.querySelectorAll("[data-variant]").forEach(x=>x.classList.toggle("active",x===b));document.querySelector("[data-copy-prompt]").textContent="复制提示词";});
 document.querySelectorAll("[data-case]").forEach(b=>b.onclick=()=>{const c=p.cases[Number(b.dataset.case)],v=document.getElementById("case-player");v.pause();v.src=A+c.video;document.getElementById("case-focus").textContent=c.focus;document.getElementById("case-copy").textContent=c.copy;document.querySelectorAll("[data-case]").forEach(x=>x.classList.toggle("active",x===b));});
 setupErrorPromptInteractions(p);
 if(p.archiveLinks){const row=document.createElement("div");row.className="archive-links";row.innerHTML=p.archiveLinks.map(r=>'<a href="'+r[0]+'" target="_blank">'+r[1]+'</a>').join('');root.append(row);}
 if(pageNumber===22){const link=document.createElement("a");link.className="role-material-link";link.href=A+"handouts/鸭鸭角色素材与使用说明_V05.docx";link.download="";link.textContent="下载角色图片与固定提示词";root.append(link);}
 document.querySelectorAll(".story-full-copy,.full-script-copy,.full-storyboard-scroll").forEach(e=>{e.tabIndex=0;e.setAttribute("role","region");e.setAttribute("aria-label","完整内容，可上下滚动阅读");});
 const number=document.createElement("span");number.className="lesson-page-number";number.textContent=(query.get("n")||"")+" / "+(query.get("total")||44);root.append(number);
 addEventListener("keydown",e=>{if(document.querySelector("dialog[open]")||e.target.closest("input,textarea,video,audio,button,[data-inline-prompt],.error-prompt-scroll,.story-full-copy,.full-script-copy,.full-storyboard-scroll"))return;if(parent!==window&&["ArrowRight","PageDown","ArrowLeft","PageUp"].includes(e.key)){e.preventDefault();parent.postMessage({type:"lesson-nav",direction:["ArrowRight","PageDown"].includes(e.key)?1:-1},"*");}});
}

function lessonEscapeText(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function errorMarkedText(value,issues){
 const matches=issues.map((issue,i)=>({start:value.indexOf(issue.quote),quote:issue.quote,index:i})).filter(m=>m.start>=0).sort((a,b)=>a.start-b.start);
 let cursor=0,result='';
 for(const m of matches){result+=lessonEscapeText(value.slice(cursor,m.start))+'<mark data-issue="'+m.index+'"><sup>'+String(m.index+1).padStart(2,'0')+'</sup>'+lessonEscapeText(m.quote)+'</mark>';cursor=m.start+m.quote.length;}
 return result+lessonEscapeText(value.slice(cursor));
}
function setupErrorPromptInteractions(p){
 const bench=document.querySelector('.result-review');if(!bench)return;
 let selected=0,version=1;
 const video=document.getElementById('error-player'),scroll=document.querySelector('[data-error-prompt]'),copy=document.querySelector('[data-copy-error]');
 const renderPrompt=()=>{
  const t=p.cases[selected].teaching,v=t.variants[version];
  document.querySelectorAll('[data-prompt-version]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.promptVersion)===version)));
  document.querySelector('[data-error-source]').textContent=v.sourceLabel;
  scroll.innerHTML='<p class="error-inputs">'+lessonEscapeText(v.inputs)+'</p>'+v.sections.map((s,i)=>'<section><h3><span>0'+(i+1)+'</span>'+lessonEscapeText(s.title)+'</h3>'+s.paragraphs.map(text=>'<p>'+errorMarkedText(text,version===1?t.adjustments:[])+'</p>').join('')+'</section>').join('');
  document.querySelector('[data-prompt-footer]').textContent=version===1?'上下滚动 · 绿色编号对应本次重点调整':'上下滚动 · 结合原始生成结果阅读';
  scroll.scrollTop=0;copy.textContent='复制提示词';
 };
 const renderCase=index=>{
  const c=p.cases[index],t=c.teaching;
  if(index!==selected){video.pause();video.src=A+c.video;video.load();}selected=index;version=1;
  video.setAttribute('aria-label',t.tab+'，原始生成结果');
  document.querySelectorAll('[data-error-case]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.errorCase)===index)));
  renderPrompt();
  document.querySelector('[data-error-observation]').textContent=t.observation;
  document.querySelector('[data-error-treatment]').textContent=t.treatment;
  document.querySelector('[data-error-notes]').innerHTML=t.adjustments.map((a,i)=>'<section><h3><b>0'+(i+1)+'</b>'+lessonEscapeText(a.title)+'</h3><p>'+lessonEscapeText(a.reason)+'</p><div><b>调整方法</b><p>'+lessonEscapeText(a.fix)+'</p></div></section>').join('');
  document.querySelector('[data-error-takeaway]').textContent=t.takeaway;
 };
 document.querySelectorAll('[data-error-case]').forEach(b=>b.onclick=()=>renderCase(Number(b.dataset.errorCase)));
 document.querySelectorAll('[data-prompt-version]').forEach(b=>b.onclick=()=>{version=Number(b.dataset.promptVersion);renderPrompt();});
 document.querySelector('[data-toggle-errors]').onclick=e=>{
  const show=e.currentTarget.getAttribute('aria-pressed')!=='true';
  e.currentTarget.setAttribute('aria-pressed',String(show));e.currentTarget.textContent=show?'隐藏重点':'显示重点';
  bench.classList.toggle('annotations-hidden',!show);
  document.querySelector('[data-error-notes]').hidden=!show;
  document.querySelector('[data-error-takeaway]').hidden=!show;
  document.querySelector('.error-question').hidden=show;
 };
 copy.onclick=async()=>{
  const text=p.cases[selected].teaching.variants[version].promptText;
  try{await navigator.clipboard.writeText(text);copy.textContent='已复制';}
  catch{const input=document.createElement('textarea');input.value=text;document.body.append(input);input.select();const ok=document.execCommand('copy');input.remove();copy.textContent=ok?'已复制':'请选中提示词复制';}
 };
 renderCase(0);
}
