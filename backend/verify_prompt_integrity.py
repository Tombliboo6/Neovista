#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证拆分后的提示词是否保持语义完整性
"""

import json
from difflib import SequenceMatcher

def reconstruct_prompt(structure):
    """重组 prompt_structure 为完整提示词"""
    parts = []

    if structure.get('p0_text') and structure['p0_text'] != '标题：{title}，数据标注：{data}，字体：无衬线黑体':
        parts.append(structure['p0_text'])

    if structure.get('p1_user') and structure['p1_user'] != '{user_input}':
        parts.append(structure['p1_user'])

    if structure.get('p1_content'):
        parts.append(structure['p1_content'])

    if structure.get('p2_lighting') and structure['p2_lighting'] != '自然光照，柔和阴影':
        parts.append(structure['p2_lighting'])

    if structure.get('p3_composition') and structure['p3_composition'] != '标准构图':
        parts.append(structure['p3_composition'])

    if structure.get('p4_rendering') and structure['p4_rendering'] != '高质量渲染':
        parts.append(structure['p4_rendering'])

    return '\n'.join(parts)

def calculate_similarity(text1, text2):
    """计算两段文本的相似度"""
    return SequenceMatcher(None, text1, text2).ratio()

def main():
    with open('templates_light.json', 'r', encoding='utf-8') as f:
        original = json.load(f)

    with open('templates_structured_final.json', 'r', encoding='utf-8') as f:
        structured = json.load(f)

    print("验证提示词拆分的完整性...\n")
    print("="*80)

    issues = []

    for i, (orig, struct) in enumerate(zip(original, structured)):
        orig_prompt = orig.get('real_prompt', '')
        reconstructed = reconstruct_prompt(struct.get('prompt_structure', {}))

        # 计算相似度
        similarity = calculate_similarity(orig_prompt, reconstructed)

        # 检查长度差异
        orig_len = len(orig_prompt)
        recon_len = len(reconstructed)
        length_ratio = recon_len / orig_len if orig_len > 0 else 0

        if similarity < 0.85 or length_ratio < 0.7:
            issues.append({
                'id': orig['id'],
                'title': orig['title'],
                'similarity': similarity,
                'orig_len': orig_len,
                'recon_len': recon_len,
                'length_ratio': length_ratio
            })

    if issues:
        print(f"⚠️  发现 {len(issues)} 个可能有问题的模版：\n")
        for issue in issues[:10]:  # 只显示前10个
            print(f"ID: {issue['id']} - {issue['title']}")
            print(f"  相似度: {issue['similarity']:.2%}")
            print(f"  原长度: {issue['orig_len']} → 重组长度: {issue['recon_len']} ({issue['length_ratio']:.2%})")
            print()
    else:
        print("✅ 所有模版的语义完整性验证通过！")

    print("="*80)
    print(f"\n总计检查: {len(original)} 个模版")
    print(f"有问题: {len(issues)} 个")
    print(f"通过率: {(len(original) - len(issues)) / len(original) * 100:.1f}%")

if __name__ == '__main__':
    main()
