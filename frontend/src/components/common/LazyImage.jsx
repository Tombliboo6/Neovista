import { useState } from 'react';

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

  return (
    <div className={`relative overflow-hidden ${wrapperClassName}`.trim()} style={style}>
      {!isLoaded && (
        <div className={`absolute inset-0 animate-pulse ${skeletonClassName}`.trim()} />
      )}
      <img
        src={src}
        alt={alt}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding={decoding}
        onLoad={() => setIsLoaded(true)}
        className={`${imgClassName} transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`.trim()}
      />
    </div>
  );
}
