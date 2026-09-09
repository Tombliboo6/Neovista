import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEpisodeCharacters } from '../src/episode-characters.ts';

test('action and sound attribution do not introduce extra character assets', () => {
  const script = { characters: [{name:'阿宁',role:'修钟师',goal:'修钟'}], scenes: [{
    blocks: [
      {type:'action',speaker:'画面',text:'阿宁打开钟盖。'},
      {type:'sfx',speaker:'环境',text:'清晨鸟鸣。'},
      {type:'sfx',speaker:'动作',text:'金属轻响。'},
      {type:'transition',speaker:'画面',text:'淡出。'},
    ],
  }] };
  assert.deepEqual(selectEpisodeCharacters(script).map(item=>item.name), ['阿宁']);
});

test('episode character selection excludes series-plan characters absent from the current episode', () => {
  const script = {
    characters: [
      { name: '林然', role: '女主', goal: '复仇' },
      { name: '陈曜', role: '本集目标', goal: '维持地位' },
      { name: '苏蔓', role: '幕后推手', goal: '取代林然' },
      { name: '赵东来', role: '终极反派', goal: '操控产业' },
    ],
    scenes: [{
      summary: '林然重生后锁定陈曜。',
      beats: [],
      dialogue: [{ speaker: '林然', line: '把陈曜的广告全撤了。' }],
      blocks: [{ speaker: '', text: '快速闪切：苏蔓的聊天记录。' }],
    }],
  };

  assert.deepEqual(selectEpisodeCharacters(script).map((character) => character.name), ['林然', '陈曜', '苏蔓']);
});

test('episode character selection retains a current-episode speaker missing from the global plan', () => {
  const script = {
    characters: [{ name: '阿岚', role: '主角', goal: '送信' }],
    scenes: [{ summary: '阿岚抵达门前。', beats: [], dialogue: [{ speaker: '门卫', line: '站住。' }] }],
  };

  assert.deepEqual(selectEpisodeCharacters(script).map((character) => character.name), ['阿岚', '门卫']);
});

test('episode character selection passes narration candidates to semantic review', () => {
  const script = {
    characters: [
      { name: '宋老太', role: '主角', goal: '送孙女上学' },
      { name: '旁白', role: '声音说明', goal: '交代背景' },
    ],
    scenes: [{ summary: '宋老太站在校门外。', dialogue: [{ speaker: '旁白', line: '她终于放心了。' }, { speaker: '宋老太', line: '去吧。' }] }],
  };

  assert.deepEqual(selectEpisodeCharacters(script).map((character) => character.name), ['宋老太', '旁白']);
});

test('episode character selection does not use a keyword list as the semantic classifier', () => {
  const script = {
    characters: [
      { name: '妈妈', role: '家庭成员', goal: '准备早餐' },
      { name: '环境', role: '家庭空间', goal: '营造日常氛围' },
      { name: '厨房场景', role: '地点说明', goal: '承载早餐情节' },
      { name: '酸奶产品', role: '商品', goal: '展示卖点' },
    ],
    scenes: [{ summary: '妈妈在厨房环境中拿起酸奶产品。', dialogue: [] }],
  };

  assert.deepEqual(selectEpisodeCharacters(script).map((character) => character.name), ['妈妈', '环境', '酸奶产品']);
});

test('current blocks govern character selection when a stale dialogue list is also saved',()=>{
 const script={characters:[{name:'阿岚',role:'主角',goal:'送信'},{name:'旧角色',role:'旧版人物',goal:'等候'}],scenes:[{summary:'阿岚敲门。',blocks:[{type:'dialogue',speaker:'阿岚',text:'有人吗？'}],dialogue:[{speaker:'旧角色',line:'旧对白。'}]}]};
 assert.deepEqual(selectEpisodeCharacters(script).map(x=>x.name),['阿岚']);
 assert.equal(script.scenes[0].dialogue[0].speaker,'旧角色');
 const legacy={...script,scenes:[{...script.scenes[0],blocks:[]}]};
 assert.deepEqual(selectEpisodeCharacters(legacy).map(x=>x.name),['阿岚','旧角色']);
});
