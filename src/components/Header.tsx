import React from 'react';
import { AppRoute } from '../types/campaign';

interface HeaderProps {
  brandTitle: string;
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

export const Header: React.FC<HeaderProps> = ({
  brandTitle,
  activeRoute,
  onNavigate,
}) => {
  const navItems: Array<{ route: AppRoute; label: string }> = [
    { route: 'editor', label: 'Profile Studio' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-[#E4E7E2]">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4 sm:gap-8">
        {/* Brand Wordmark (Top-Left) */}
        <a
          href="#editor"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('editor');
          }}
          className="font-display text-sm sm:text-xl font-bold tracking-tight text-[#064E3B] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#064E3B] rounded-lg"
        >
          {brandTitle}
        </a>

        {/* Navigation Links */}
        <nav className="flex items-center gap-4 sm:gap-7 text-xs sm:text-sm font-medium min-w-0">
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
      </div>
    </header>
  );
};
