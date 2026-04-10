export async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (isJson) {
    return {
      isJson: true,
      data: await response.json(),
      text: '',
    };
  }

  return {
    isJson: false,
    data: null,
    text: await response.text(),
  };
}

export function getApiErrorMessage(response, payload, fallback = '请求失败，请稍后重试') {
  if (payload?.data?.detail) {
    return payload.data.detail;
  }

  if (response.status === 504) {
    return '生成超时，请稍后重试或降低分辨率后再试';
  }

  if (response.status === 503) {
    return '生成服务暂时不可用，请稍后重试';
  }

  if (!payload?.isJson && payload?.text) {
    return fallback;
  }

  return fallback;
}
