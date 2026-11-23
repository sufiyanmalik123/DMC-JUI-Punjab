import { useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { BackgroundSlideshow } from './components/BackgroundSlideshow';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header';
import { ProfileEditor } from './components/ProfileEditor';
import {
  fetchCampaignConfig,
  getCachedCampaignConfig,
  subscribeLocalConfigUpdates,
} from './services/campaignService';
import {
  AppRoute,
  CampaignConfig,
} from './types/campaign';

function parseHashRoute(): AppRoute {
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  if (hash === 'admin') return 'admin';
  return 'editor';
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseHashRoute());
  const [config, setConfig] = useState<CampaignConfig>(() => getCachedCampaignConfig());

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHashRoute());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let active = true;

    void fetchCampaignConfig()
      .then((nextConfig) => {
        if (active) setConfig(nextConfig);
      })
      .catch(() => {
        // Keep cached/default config
      });

    const unsubConfig = subscribeLocalConfigUpdates((nextConfig) => {
      if (active) setConfig(nextConfig);
    });

    return () => {
      active = false;
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
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-[#141D18] relative">
      {(route === 'editor') && <BackgroundSlideshow />}

      <Header
        brandTitle={config.brandTitle}
        activeRoute={route}
        onNavigate={navigate}
      />

      <main className="relative z-10 flex-1">
        <ErrorBoundary>
          {route === 'editor' && (
            <ProfileEditor config={config} />
          )}
          {route === 'admin' && (
            <AdminDashboard config={config} />
          )}
        </ErrorBoundary>
      </main>

      <footer className="relative z-10 border-t border-[#E4E7E2] bg-white/95 mt-12">
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
