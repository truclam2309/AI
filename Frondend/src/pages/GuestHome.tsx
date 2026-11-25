import { Link } from 'react-router-dom';
import { ChefHatIcon, SearchIcon, SparklesIcon, UserPlusIcon, ClipboardPenLineIcon } from 'lucide-react';

const experiences = [
  { to: '/menu', Icon: SearchIcon, title: 'Khám phá món ăn', description: 'Tìm kiếm món, xem thành phần, dinh dưỡng và cách chế biến.' },
  { to: '/recommendations', Icon: SparklesIcon, title: 'Tìm món theo nguyên liệu', description: 'Nhập nguyên liệu đang có để tìm những công thức phù hợp.' },
  { to: '/roulette', Icon: ChefHatIcon, title: 'Quay món ngẫu nhiên', description: 'Để MyFit chọn giúp bạn món ăn hôm nay.' },
  { to: '/try-plan', Icon: ClipboardPenLineIcon, title: 'Tạo thực đơn thử', description: 'Nhập hồ sơ dinh dưỡng mẫu và xem thực đơn cá nhân hóa, không lưu lịch sử.' },
];

export function GuestHome() {
  return <div className="space-y-8">
    <header className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#F6F3EC] via-[#F6F3EC] to-[#F8E6DA] p-7 sm:p-10">
      <p className="text-sm font-semibold text-[#C4521F]">MyFit · Ăn khỏe dáng xinh</p>
      <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-5xl">Khám phá MyFit trước khi tạo tài khoản</h1>
      <p className="mt-4 max-w-2xl leading-7 text-[#5F6B63]">Thử tìm món theo nguyên liệu, xem công thức và khám phá thực đơn. Bạn chỉ cần đăng ký khi muốn lưu kế hoạch cá nhân.</p>
      <div className="mt-6 flex flex-wrap gap-3"><Link to="/menu" className="btn-primary h-12">Dùng thử ngay<SearchIcon className="h-4 w-4" /></Link><Link to="/register" className="btn-secondary h-12"><UserPlusIcon className="h-4 w-4" />Tạo tài khoản miễn phí</Link></div>
    </header>
    <section className="grid gap-4 md:grid-cols-3" aria-label="Chức năng có thể dùng thử">
      {experiences.map(({ to, Icon, title, description }) => <Link key={to} to={to} className="card group p-6 transition hover:-translate-y-1 hover:shadow-lg"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon className="h-5 w-5" /></span><h2 className="mt-4 text-lg font-semibold group-hover:text-brand">{title}</h2><p className="mt-2 text-sm leading-6 text-muted">{description}</p><span className="mt-4 inline-block text-sm font-semibold text-brand">Trải nghiệm →</span></Link>)}
    </section>
    <p className="text-center text-sm text-muted">Tài khoản miễn phí giúp lưu hồ sơ dinh dưỡng và thực đơn để xem lại sau.</p>
  </div>;
}
