import { NavLink, Outlet } from 'react-router-dom';
import { CalendarDaysIcon, ChartPieIcon, LayoutDashboardIcon, LeafIcon, LogOutIcon, SparklesIcon, UserRoundIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
{ to: '/', label: 'Tổng quan', short: 'Tổng quan', Icon: LayoutDashboardIcon, end: true },
{ to: '/recommendations', label: 'Gợi ý món', short: 'Gợi ý', Icon: SparklesIcon, end: false },
{ to: '/meal-plan', label: 'Thực đơn', short: 'Thực đơn', Icon: CalendarDaysIcon, end: false },
{ to: '/analysis', label: 'Phân tích', short: 'Phân tích', Icon: ChartPieIcon, end: false },
{ to: '/profile', label: 'Hồ sơ sức khỏe', short: 'Hồ sơ', Icon: UserRoundIcon, end: false }];


export function AppLayout() {
  const { user, logout } = useAuth();
  const displayName = user?.username ?? user?.email ?? 'Tài khoản';

  return (
    <div className="min-h-screen w-full bg-canvas lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex items-center gap-2 px-6 py-6 text-lg font-semibold text-brand">
          <LeafIcon className="h-6 w-6" aria-hidden="true" />
          NutriAI
        </div>
        <nav aria-label="Điều hướng chính" className="flex-1 space-y-1 px-3">
          {navItems.map(({ to, label, Icon, end }) =>
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
            `flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
            isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-canvas hover:text-ink'}`

            }>
            
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
              {label}
            </NavLink>
          )}
        </nav>
        <div className="space-y-3 border-t border-line p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted">{user?.email ?? 'NutriAI'}</p>
            </div>
            <button type="button" onClick={logout} className="btn-ghost h-9 w-9 px-0" aria-label="Đăng xuất">
              <LogOutIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2 font-semibold text-brand">
            <LeafIcon className="h-5 w-5" aria-hidden="true" />
            NutriAI
          </div>
          <button type="button" onClick={logout} className="btn-ghost h-10 gap-1.5 px-3" aria-label="Đăng xuất">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-xs font-semibold text-white">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <LogOutIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Điều hướng chính"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        
        <ul className="grid grid-cols-5">
          {navItems.map(({ to, short, Icon, end }) =>
          <li key={to}>
              <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
              `flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150 ${
              isActive ? 'text-brand' : 'text-muted'}`

              }>
              
                {({ isActive }) =>
              <>
                    <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors duration-150 ${isActive ? 'bg-brand-soft' : ''}`}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="whitespace-nowrap">{short}</span>
                  </>
              }
              </NavLink>
            </li>
          )}
        </ul>
      </nav>
    </div>);

}
