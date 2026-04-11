import TopNav from '../common/TopNav';
import HomeSearchBox from './HomeSearchBox';
import CategoryTabs from './CategoryTabs';
import RecentProjects from './RecentProjects';
import TemplateGallery from './TemplateGallery';

export default function HomePage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-0)' }}>
      <TopNav />

      <main className="pt-16">
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
