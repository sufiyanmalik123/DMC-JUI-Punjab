import { useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { DmcGallery } from './components/DmcGallery';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header';
import { ProfileEditor } from './components/ProfileEditor';
import {
  subscribeCampaignConfig,
  subscribeSupportersCount,
} from './services/campaignService';
import {
  AppRoute,
  CampaignConfig,
  DEFAULT_CAMPAIGN_CONFIG,
} from './types/campaign';

function parseHashRoute(): AppRoute {
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  if (hash === 'gallery' || hash === 'dmc-gallery') return 'gallery';
  if (hash === 'admin') return 'admin';
  return 'editor';
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseHashRoute());
  const [supportersCount, setSupportersCount] = useState<number>(0);
  const [config, setConfig] = useState<CampaignConfig>(DEFAULT_CAMPAIGN_CONFIG);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHashRoute());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const unsubStats = subscribeSupportersCount((count) => {
      setSupportersCount(count);
    });
    const unsubConfig = subscribeCampaignConfig((nextConfig) => {
      setConfig(nextConfig);
    });
    return () => {
      unsubStats();
      unsubConfig();
    };
  }, []);

  const navigate = (nextRoute: AppRoute) => {
    const nextHash = nextRoute === 'editor' ? '#editor' : `#${nextRoute}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-[#141D18]">
      <Header
        brandTitle={config.brandTitle}
        supportersCount={supportersCount}
        activeRoute={route}
        onNavigate={navigate}
      />

      <main className="flex-1">
        <ErrorBoundary>
          {route === 'editor' && (
            <ProfileEditor
              config={config}
              onOpenGallery={() => navigate('gallery')}
            />
          )}
          {route === 'gallery' && (
            <DmcGallery onCreateOwn={() => navigate('editor')} />
          )}
          {route === 'admin' && (
            <AdminDashboard
              config={config}
              supportersCount={supportersCount}
            />
          )}
        </ErrorBoundary>
      </main>

      <footer className="border-t border-[#E4E7E2] bg-white mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#5C6660]">
          <span>
            {config.brandTitle} · Official Campaign Profile Platform
          </span>
          <div className="flex items-center gap-5">
            <a
              href="#editor"
              onClick={(e) => {
                e.preventDefault();
                navigate('editor');
              }}
              className="hover:text-[#141D18] transition-colors"
            >
              Profile Studio
            </a>
            <a
              href="#gallery"
              onClick={(e) => {
                e.preventDefault();
                navigate('gallery');
              }}
              className="hover:text-[#141D18] transition-colors"
            >
              DMC Gallery
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
