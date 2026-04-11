import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import LazyImage from '../common/LazyImage';
import { getImageLoadingStrategy } from '../../lib/galleryPerformance.js';

export default function ImageCarousel({ images, cardIndex = 0 }) {
  const [currentIndex, setCurrentIndex] = useState(images && images.length > 2 ? images.length - 1 : 0);
  const loadingStrategy = getImageLoadingStrategy(cardIndex);

  if (!images || images.length === 0) {
    return <div className="w-full h-48 bg-gray-100 flex items-center justify-center text-gray-400">暂无图片</div>;
  }

  const getImageUrl = (path) => {
    return path.startsWith('http') ? path : path;
  };

  // 如果刚好2张图，使用并排展示
  if (images.length === 2) {
    return (
      <div className="w-full h-48 bg-gray-900 flex gap-1">
        <div className="relative flex-1">
          <LazyImage
            src={getImageUrl(images[0])}
            alt="原图"
            wrapperClassName="w-full h-full"
            imgClassName="w-full h-full object-contain"
            loading={loadingStrategy.loading}
            fetchPriority={loadingStrategy.fetchPriority}
          />
          <div className="absolute top-2 left-2 bg-blue-500 text-white text-xs px-2 py-1 rounded">
            原图/底图
          </div>
        </div>
        <div className="relative flex-1">
          <LazyImage
            src={getImageUrl(images[1])}
            alt="效果图"
            wrapperClassName="w-full h-full"
            imgClassName="w-full h-full object-contain"
            loading="lazy"
            fetchPriority="auto"
          />
          <div className="absolute top-2 left-2 bg-green-500 text-white text-xs px-2 py-1 rounded">
            效果图
          </div>
        </div>
      </div>
    );
  }

  // 其他情况使用轮播
  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className="relative w-full h-48 bg-gray-900 group">
      <LazyImage
        src={getImageUrl(images[currentIndex])}
        alt={`图片 ${currentIndex + 1}`}
        wrapperClassName="w-full h-full"
        imgClassName="w-full h-full object-contain"
        loading={loadingStrategy.loading}
        fetchPriority={loadingStrategy.fetchPriority}
      />

      {images.length > 1 && (
        <>
          <button
            onClick={goToPrevious}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition"
          >
            <ChevronLeft size={20} />
          </button>

          <button
            onClick={goToNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition"
          >
            <ChevronRight size={20} />
          </button>

          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {images.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`w-2 h-2 rounded-full transition ${
                  idx === currentIndex ? 'bg-white' : 'bg-white/50'
                }`}
              />
            ))}
          </div>

          <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
            {currentIndex + 1} / {images.length}
          </div>
        </>
      )}
    </div>
  );
}
