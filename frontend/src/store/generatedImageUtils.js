export const getGeneratedImageUrlOrThrow = (data) => {
  const imageUrl = typeof data?.image_url === 'string' ? data.image_url.trim() : '';

  if (!imageUrl) {
    throw new Error('生成成功，但未返回图片数据');
  }

  return imageUrl;
};

export const buildGeneratedImageMessage = ({
  imageUrl,
  templateName = null,
  content = '已生成图片',
  prompt = '',
}) => ({
  role: 'assistant',
  content,
  imageUrl,
  templateName,
  prompt,
});

export const summarizeGeneratedImageUrl = (imageUrl) => ({
  kind: imageUrl.startsWith('data:') ? 'data-url' : 'url',
  length: imageUrl.length,
  preview: imageUrl.slice(0, 80),
});
