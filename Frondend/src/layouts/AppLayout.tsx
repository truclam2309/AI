import { Link, NavLink, Outlet } from 'react-router-dom';
import { CalendarDaysIcon, ChefHatIcon, CircleUserRoundIcon, ClipboardListIcon, HouseIcon, LayoutDashboardIcon, LeafIcon, LogOutIcon, SearchIcon, SparklesIcon, UserRoundIcon, UtensilsIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Link as RouterLink } from 'react-router-dom';

const navItems = [
{ to: '/', label: 'Tổng quan', short: 'Tổng quan', Icon: LayoutDashboardIcon, end: true },
{ to: '/recommendations', label: 'Gợi ý món', short: 'Gợi ý', Icon: SparklesIcon, end: false },
{ to: '/menu', label: 'Menu món ăn', short: 'Menu', Icon: UtensilsIcon, end: false },
{ to: '/roulette', label: 'Vòng quay món ăn', short: 'Vòng quay', Icon: ChefHatIcon, end: false },
{ to: '/meal-plan', label: 'Thực đơn', short: 'Thực đơn', Icon: CalendarDaysIcon, end: false },
{ to: '/food-log', label: 'Nhật ký dinh dưỡng', short: 'Nhật ký', Icon: ClipboardListIcon, end: false },
{ to: '/profile', label: 'Hồ sơ sức khỏe', short: 'Hồ sơ', Icon: UserRoundIcon, end: false }];

const mobileNavItems = [
  { to: '/', label: 'Trang chủ', Icon: HouseIcon, end: true },
  { to: '/menu', label: 'Khám phá', Icon: SearchIcon, end: false },
  { to: '/roulette', label: 'Vòng quay', Icon: ChefHatIcon, end: false },
  { to: '/meal-plan', label: 'Thực đơn', Icon: CalendarDaysIcon, end: false },
  { to: '/food-log', label: 'Nhật ký', Icon: ClipboardListIcon, end: false },
  { to: '/profile', label: 'Cá nhân', Icon: CircleUserRoundIcon, end: false },
];


export function AppLayout() {
  const { user, status, logout } = useAuth();
  const displayName = user?.username ?? user?.email ?? 'Khách trải nghiệm';

  return (
    <div className="min-h-screen w-full bg-canvas lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex items-center gap-2 px-6 py-6 text-lg font-semibold text-brand">
          <LeafIcon className="h-6 w-6" aria-hidden="true" />
          <span>MyFit<span className="mt-0.5 block text-[10px] font-medium text-muted">Ăn khỏe dáng xinh</span></span>
        </div>
        <nav aria-label="Điều hướng chính" className="flex-1 space-y-1 px-3">
          {navItems.map(({ to, label, Icon, end }) =>
          (status === 'anonymous' && to === '/profile' ? <RouterLink key={to} to="/analysis" className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-canvas hover:text-ink"><Icon className="h-[18px] w-[18px]" aria-hidden="true" />Hồ sơ thử nghiệm</RouterLink> : status === 'anonymous' && to === '/food-log' ? <RouterLink key={to} to="/login" state={{from: to}} className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-canvas hover:text-ink"><Icon className="h-[18px] w-[18px]" aria-hidden="true" />{label} · cần đăng nhập</RouterLink> : <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
            `flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
            isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-canvas hover:text-ink'}`

            }>
            
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
              {label}
          </NavLink>))}
        </nav>
        {status === 'anonymous' ? <div className="space-y-3 border-t border-line p-4"><p className="text-xs leading-5 text-muted">Bạn đang trải nghiệm MyFit với quyền khách.</p><Link to="/register" className="btn-primary h-10 w-full">Đăng ký miễn phí</Link><Link to="/login" className="block text-center text-sm text-brand hover:underline">Đã có tài khoản? Đăng nhập</Link></div> : <div className="space-y-3 border-t border-line p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted">{user?.email ?? 'MyFit'}</p>
            </div>
            <button type="button" onClick={logout} className="btn-ghost h-9 w-9 px-0" aria-label="Đăng xuất">
              <LogOutIcon className="h-4 w-4" />
            </button>
          </div>
        </div>}
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2 font-semibold text-brand">
            <LeafIcon className="h-5 w-5" aria-hidden="true" />
            <span className="leading-tight">MyFit<span className="block text-[9px] font-medium text-muted">Ăn khỏe dáng xinh</span></span>
          </div>
          {status === 'anonymous' ? <div className="flex items-center gap-2"><Link to="/login" className="text-xs font-medium text-brand">Đăng nhập</Link><Link to="/register" className="btn-primary h-9 px-3 text-xs">Đăng ký</Link></div> : <button type="button" onClick={logout} className="btn-ghost h-10 gap-1.5 px-3" aria-label="Đăng xuất">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-xs font-semibold text-white">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <LogOutIcon className="h-4 w-4" />
          </button>}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Điều hướng chính"
        className="fixed inset-x-3 bottom-2 z-30 rounded-full border border-[#1F5136] bg-[#1F5136]/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_10px_35px_rgba(53,39,31,0.28)] backdrop-blur lg:hidden">
        
        <ul className="grid grid-cols-6">
          {mobileNavItems.map(({ to, label, Icon, end }) =>
          <li key={to}>
              {status === 'anonymous' && to === '/profile' ? <Link key={to} to="/analysis" className="flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium text-[#F8E6DA] sm:h-16 sm:text-[11px]"><span className="grid h-7 w-12 place-items-center"><Icon className="h-5 w-5" aria-hidden="true" /></span><span className="whitespace-nowrap">Hồ sơ thử</span></Link> : status === 'anonymous' && to === '/food-log' ? <Link key={to} to="/login" state={{from: to}} className="flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium text-[#F8E6DA] sm:h-16 sm:text-[11px]"><span className="grid h-7 w-12 place-items-center"><Icon className="h-5 w-5" aria-hidden="true" /></span><span className="whitespace-nowrap">Đăng nhập</span></Link> : <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
              `flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors duration-150 sm:h-16 sm:text-[11px] ${
              isActive ? 'text-[#FFFFFF]' : 'text-[#F8E6DA]'}`

              }>
              
                {({ isActive }) =>
              <>
                    <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors duration-150 ${isActive ? 'bg-[#C4521F] shadow-[0_3px_12px_rgba(233,107,61,0.45)]' : ''}`}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="whitespace-nowrap">{label}</span>
                  </>
              }
              </NavLink>}
            </li>
          )}
        </ul>
      </nav>
    </div>);

}
