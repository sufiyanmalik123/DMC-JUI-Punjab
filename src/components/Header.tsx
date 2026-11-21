import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: Array<{ route: AppRoute; label: string }> = [
    { route: 'editor', label: 'Profile Studio' },
    { route: 'gallery', label: 'DMC Gallery' },
  ];

  const handleNav = (route: AppRoute) => {
    onNavigate(route);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-[#E4E7E2]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Brand Wordmark (Top-Left) */}
        <a
          href="#editor"
          onClick={(e) => {
            e.preventDefault();
            handleNav('editor');
          }}
          className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#064E3B] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#064E3B] rounded"
        >
          {brandTitle}
        </a>

        {/* Zone 2: Single-line Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          {navItems.map((item) => {
            const isActive = activeRoute === item.route;
            return (
              <a
                key={item.route}
                href={`#${item.route}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleNav(item.route);
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

        {/* Zone 3: Live SUPPORTERS Counter (Top-Right) + Mobile Menu Trigger */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            className="flex items-baseline gap-2 px-3 py-1.5 border border-[#E4E7E2] bg-[#FAF9F6] rounded-lg"
            aria-label={`Supporters count: ${supportersCount.toLocaleString()}`}
          >
            <span className="text-[11px] font-semibold tracking-[0.08em] text-[#5C6660] whitespace-nowrap">
              SUPPORTERS
            </span>
            <span className="font-mono-tabular text-base sm:text-lg font-semibold text-[#064E3B] whitespace-nowrap">
              {supportersCount.toLocaleString()}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-[#E4E7E2] text-[#141D18] hover:bg-[#F3F5F2] transition-colors"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <nav className="md:hidden border-t border-[#E4E7E2] bg-white px-4 py-3 flex items-center justify-between gap-2">
          {navItems.map((item) => {
            const isActive = activeRoute === item.route;
            return (
              <button
                key={item.route}
                type="button"
                onClick={() => handleNav(item.route)}
                className={`flex-1 py-2.5 px-3 text-sm font-medium rounded-lg text-center whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-[#064E3B] text-white'
                    : 'text-[#5C6660] hover:bg-[#F3F5F2] hover:text-[#141D18]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
};
