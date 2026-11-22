import React from 'react';
import { AppRoute } from '../types/campaign';

interface HeaderProps {
  brandTitle: string;
  supportersCount: number;
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

export const Header: React.FC<HeaderProps> = ({
  brandTitle,
  supportersCount,
  activeRoute,
  onNavigate,
}) => {
  const navItems: Array<{ route: AppRoute; label: string }> = [
    { route: 'editor', label: 'Profile Studio' },
    { route: 'gallery', label: 'DMC Gallery' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-[#E4E7E2]">
      <div className="max-w-6xl mx-auto px-2.5 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-1.5 sm:gap-8">
        {/* Zone 1: Brand Wordmark (Top-Left) */}
        <a
          href="#editor"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('editor');
          }}
          className="font-display text-[12px] sm:text-xl font-bold tracking-tight text-[#064E3B] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#064E3B] rounded-lg"
        >
          {brandTitle}
        </a>

        {/* Zone 2: Single-line Navigation Links (Centered between Brand & Supporters on all screens) */}
        <nav className="flex items-center gap-2 sm:gap-7 text-[10.5px] sm:text-sm font-medium min-w-0">
          {navItems.map((item) => {
            const isActive = activeRoute === item.route;
            return (
              <a
                key={item.route}
                href={`#${item.route}`}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(item.route);
                }}
                className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                  isActive
                    ? 'text-[#064E3B] border-[#064E3B] font-semibold'
                    : 'text-[#5C6660] border-transparent hover:text-[#141D18] hover:border-[#C7CFC9]'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Zone 3: Live SUPPORTERS Counter (Top-Right) */}
        <div className="flex items-center shrink-0">
          <div
            className="flex items-baseline gap-1 sm:gap-2 px-1.5 sm:px-3 py-1 sm:py-1.5 border border-[#E4E7E2] bg-[#FAF9F6] rounded-lg"
            aria-label={`Supporters count: ${supportersCount.toLocaleString()}`}
          >
            <span className="text-[8.5px] sm:text-[11px] font-semibold tracking-[0.04em] sm:tracking-[0.08em] text-[#5C6660] whitespace-nowrap">
              SUPPORTERS
            </span>
            <span className="font-mono-tabular text-xs sm:text-lg font-semibold text-[#064E3B] whitespace-nowrap">
              {supportersCount.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
