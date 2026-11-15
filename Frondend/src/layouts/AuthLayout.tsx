import React from 'react';
import { ActivityIcon, CalendarDaysIcon, LeafIcon } from 'lucide-react';


export function AuthLayout({ children }: {children: React.ReactNode;}) {
  return (
    <div className="flex min-h-screen w-full bg-canvas">
      <aside className="hidden w-[44%] flex-col justify-between bg-brand p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <LeafIcon className="h-6 w-6" aria-hidden="true" />
          MyFit
        </div>
        <div className="max-w-md">
          <h2 className="text-4xl font-semibold leading-tight">Ăn khỏe dáng xinh</h2>
          <p className="mt-4 text-white/75">
            MyFit tính nhu cầu dinh dưỡng từ hồ sơ của bạn và đề xuất món Việt phù hợp với mục tiêu, khẩu vị và dị ứng.
          </p>
          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/10 p-4">
              <ActivityIcon className="h-5 w-5 text-white/80" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">Tính nhu cầu riêng</p>
              <p className="mt-1 text-xs leading-5 text-white/70">BMI, BMR và calo tham khảo từ hồ sơ của bạn.</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <CalendarDaysIcon className="h-5 w-5 text-white/80" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">Theo dõi thực đơn</p>
              <p className="mt-1 text-xs leading-5 text-white/70">Tạo và xem lại lịch sử theo từng ngày.</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-white/50">MyFit · Ăn khỏe dáng xinh</p>
      </aside>
      <main className="flex flex-1 flex-col px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(2rem+env(safe-area-inset-top))] sm:px-10">
        <div className="flex items-center gap-2 text-lg font-semibold text-brand lg:hidden">
          <LeafIcon className="h-6 w-6" aria-hidden="true" />
          <span className="leading-tight">MyFit<span className="block text-xs font-medium text-muted">Ăn khỏe dáng xinh</span></span>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>);

}
