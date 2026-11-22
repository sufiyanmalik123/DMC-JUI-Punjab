import { useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { DmcGallery } from './components/DmcGallery';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header';
import { ProfileEditor } from './components/ProfileEditor';
import {
  initializeSupportersCounter,
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
    let active = true;
    void initializeSupportersCounter()
      .then((initialCount) => {
        if (active) setSupportersCount(initialCount);
      })
      .catch(() => {
        // Real-time listener below continues syncing
      });

    const unsubStats = subscribeSupportersCount((count) => {
      setSupportersCount(count);
    });
    const unsubConfig = subscribeCampaignConfig((nextConfig) => {
      setConfig(nextConfig);
    });
    return () => {
      active = false;
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
              onSupportersUpdated={(nextCount) => setSupportersCount(nextCount)}
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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-center text-xs text-[#5C6660] leading-relaxed">
          <p className="tracking-[0.06em] text-[11px] font-medium">
            Designed BY:
          </p>
          <p className="mt-0.5 font-display text-sm font-semibold text-[#141D18]">
            Muhammad Sufiyan Malik
          </p>
        </div>
      </footer>
    </div>
  );
}
