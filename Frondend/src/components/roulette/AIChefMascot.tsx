import { useState } from 'react';
import { ChefHatIcon, MessageCircleIcon, SparklesIcon, XIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { NutritionGoal } from '../../types/nutrition';

const goalNames: Record<NutritionGoal, string> = {
  lose_weight: 'giảm cân',
  gain_weight: 'tăng cân',
  gain_muscle: 'tăng cơ',
  maintain_weight: 'duy trì cân nặng',
};

export function AIChefMascot({goal, remainingCalories}: {goal: NutritionGoal; remainingCalories: number | null}) {
  const [open, setOpen] = useState(false);
  return <div className="absolute -bottom-2 -right-1 z-20 sm:bottom-0 sm:right-2">
    {open && <section className="absolute bottom-[4.5rem] right-0 w-[min(18rem,calc(100vw-3rem))] rounded-2xl border border-[#f0d9bd] bg-white p-4 text-left shadow-xl" role="dialog" aria-label="Tư vấn từ đầu bếp AI">
      <div className="flex items-start justify-between gap-2"><div><p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-[#d2603a]"><SparklesIcon className="h-3.5 w-3.5" /> Đầu bếp NutriAI</p><p className="mt-2 text-sm leading-5 text-[#624b3b]">Danh sách đang ưu tiên món phù hợp mục tiêu <strong>{goalNames[goal]}</strong>.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Đóng tư vấn" className="rounded-full p-1 text-[#927a65] hover:bg-[#f7efe4]"><XIcon className="h-4 w-4" /></button></div>
      <p className="mt-2 text-xs text-[#8d7968]">{remainingCalories === null ? 'Chọn một món để xem thông tin dinh dưỡng.' : remainingCalories > 0 ? `Thực đơn hiện còn khoảng ${Math.round(remainingCalories)} kcal tham khảo.` : `Thực đơn đã đạt mục tiêu calo tham khảo.`}</p>
      <Link to="/recommendations" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#c25333] hover:underline">Tìm món theo nguyên liệu <span aria-hidden="true">→</span></Link>
    </section>}
    <button type="button" onClick={() => setOpen((value) => !value)} aria-label="Mở tư vấn từ đầu bếp AI" aria-expanded={open} className="group grid h-14 w-14 place-items-center rounded-full border-[3px] border-white bg-gradient-to-br from-[#ffcb72] to-[#ec744b] text-white shadow-[0_6px_18px_rgba(126,64,35,0.3)] transition hover:-translate-y-1 sm:h-16 sm:w-16">
      <span className="relative grid h-10 w-10 place-items-center rounded-full bg-[#fff7e8] text-[#d55f3c] sm:h-12 sm:w-12"><ChefHatIcon className="h-6 w-6 sm:h-7 sm:w-7" /><span className="absolute -bottom-0.5 rounded-full bg-[#a9472e] px-1 text-[8px] font-black leading-3 text-white">AI</span></span>
      <MessageCircleIcon className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-white p-0.5 text-[#d55f3c]" />
    </button>
  </div>;
}
