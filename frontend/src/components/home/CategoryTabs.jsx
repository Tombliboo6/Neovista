import { useState } from 'react';

export default function CategoryTabs() {
  const categories = [
    { id: 'site', label: '场地语境' },
    { id: 'environment', label: '环境性能' },
    { id: 'massing', label: '体块推演' },
    { id: 'circulation', label: '流线组织' },
    { id: 'construction', label: '构造建造' },
    { id: 'planting', label: '植物分析' },
    { id: 'presentation', label: '成果展示' },
  ];
  const [selected, setSelected] = useState('site');

  return (
    <section className="mx-auto mt-5 w-full max-w-[1120px] px-4 sm:px-6">
      <div className="flex gap-2 overflow-x-auto rounded-full border p-1.5" style={{ borderColor: 'var(--border-subtle)', background: 'rgba(255,255,255,0.025)' }}>
        {categories.map((cat) => {
          const active = selected === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelected(cat.id)}
              className="flex-shrink-0 rounded-full px-4 py-2 text-sm transition active:scale-[0.98]"
              style={{
                background: active ? 'var(--accent-primary)' : 'transparent',
                color: active ? '#fff' : 'var(--text-muted)',
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
