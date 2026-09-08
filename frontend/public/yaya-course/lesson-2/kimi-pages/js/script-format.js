// Present the complete source script with readable production hierarchy.
function renderFullScript(text) {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const focus = ['核心表达','结尾句','完美主义陷阱','能做一点，就先做一点','晚点开始，也算开始','双翅抱住头部','视线完全离开计划本并落向房门','四个红叉＋一个勾','轻轻松一口气'];
  function inline(value) {
    return value.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map(part => {
      if(part.startsWith('`'))return '<code>'+escape(part.slice(1,-1))+'</code>';
      if(part.startsWith('**'))return '<strong>'+escape(part.slice(2,-2))+'</strong>';
      let html=escape(part);
      for(const phrase of focus)html=html.replaceAll(phrase,'<mark>'+phrase+'</mark>');
      return html;
    }).join('');
  }
  let result=[],inCode=false,code=[],first=true;
  for(const line of text.split(/\r?\n/)){
    if(line.startsWith('```')){if(inCode){result.push('<pre class="script-prop">'+escape(code.join('\n'))+'</pre>');code=[];}inCode=!inCode;continue;}
    if(inCode){code.push(line);continue;}
    if(!line.trim())continue;
    if(/^---+$/.test(line.trim())){result.push('<hr>');continue;}
    const heading=/^(#{1,4})\s+(.+)$/.exec(line);
    if(heading){
      const level=heading[1].length,label=heading[2];let anchor='';
      if(first){anchor='script-overview';first=false;}
      else if(label==='一、计划本固定内容')anchor='script-plan';
      else if(label==='二、详细脚本')anchor='script-timeline';
      else if(label.startsWith('46.2 秒起'))anchor='script-explanation';
      else if(label.startsWith('69.1—74.3'))anchor='script-ending';
      result.push('<h'+(level+1)+' class="script-heading-'+level+'"'+(anchor?' id="'+anchor+'"':'')+'>'+inline(label)+'</h'+(level+1)+'>');continue;
    }
    if(line.startsWith('> ')){
      const value=line.slice(2),dialogue=/^(?:“|\*\*|`)/.test(value);
      result.push('<blockquote class="'+(dialogue?'script-dialogue':'script-production-note')+'">'+inline(value)+'</blockquote>');continue;
    }
    if(line.startsWith('- ')){
      const value=line.slice(2),colon=value.indexOf('：');
      const content=colon>0&&colon<14?'<b>'+inline(value.slice(0,colon+1))+'</b>'+inline(value.slice(colon+1)):inline(value);
      result.push('<p class="script-bullet">'+content+'</p>');continue;
    }
    const sound=/^(声音：|声音结构：)(.*)$/.exec(line);
    result.push('<p'+(sound?' class="script-sound"':'')+'>'+(sound?'<b>'+sound[1]+'</b>'+inline(sound[2]):inline(line))+'</p>');
  }
  return result.join('\n');
}
