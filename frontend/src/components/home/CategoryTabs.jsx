import { useState } from 'react';

export default function CategoryTabs() {
  const categories = ['Design', 'Urban', 'Landscape', 'Architecture', 'Planning'];
  const [selected, setSelected] = useState('Design');

  return (
    <div className="flex gap-2 justify-center mt-6">
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => setSelected(cat)}
          className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
            selected === cat
              ? 'bg-slate-800 text-white'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
