/** Fixed asset boards have their own format, independent of the episode canvas. */
export function assetBoardLayoutIssues(prompt: string, assetName = '人物'): string[] {
  const positive = prompt.split(/(?:^|\n)\s*负面词\s*(?:\n|[:：])/)[0] + '\n' + prompt.split('\n').filter(line => /^\s*目标画面比例[:：]/.test(line)).join('\n');
  const format = /(?:画幅|比例|画布|横版|竖版|横向|纵向|构图|资产板)\s*(?:为|[:：])?\s*(\d+\s*[:：]\s*\d+)|(\d+\s*[:：]\s*\d+)\s*(?:横|竖|纵|画幅|画面|构图|剧情|人物|道具|资产板)/g;
  const ratios = [...positive.matchAll(format)].map(match => (match[1] || match[2]).replace(/\s/g, '').replace('：', ':'));
  return ratios.some(ratio => ratio !== '3:2') ? [`${assetName}资产板使用3:2，提示词仍包含其他画幅；请在编辑提示词中统一画幅后生成。`] : [];
}
