import TopNav from '../common/TopNav';
import HomeSearchBox from './HomeSearchBox';
import CategoryTabs from './CategoryTabs';
import RecentProjects from './RecentProjects';
import TemplateGallery from './TemplateGallery';

export default function HomePage() {
  return (
    <div className="min-h-[100dvh] overflow-hidden" style={{ background: 'var(--surface-0)' }}>
      <TopNav />

      <main className="relative pt-16">
        <div
          className="pointer-events-none absolute inset-x-0 top-16 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, var(--border-strong), transparent)' }}
        />
        <HomeSearchBox />
        <CategoryTabs />
        <div className="max-w-7xl mx-auto px-6">
          <RecentProjects />
        </div>
        <TemplateGallery />
      </main>
    </div>
  );
}
