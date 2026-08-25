import { useState } from 'react';
import { getVersionedGalleryAssetUrl } from '../../lib/galleryAssets.js';

export default function LazyImage({
  src,
  alt,
  wrapperClassName = '',
  imgClassName = '',
  skeletonClassName = 'bg-slate-100',
  style,
  loading = 'lazy',
  fetchPriority = 'auto',
  decoding = 'async',
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const resolvedSrc = getVersionedGalleryAssetUrl(src);

  return (
    <div
      className={`relative overflow-hidden ${wrapperClassName}`.trim()}
      style={style}
    >
      {!isLoaded && (
        <div className={`absolute inset-0 animate-pulse ${skeletonClassName}`.trim()} />
      )}
      <img
        src={resolvedSrc}
        alt={alt}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding={decoding}
        onLoad={() => setIsLoaded(true)}
        onError={() => setIsLoaded(true)}
        className={`${imgClassName} transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`.trim()}
      />
    </div>
  );
}
