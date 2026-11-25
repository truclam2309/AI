import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, CalendarDaysIcon, CheckIcon, LoaderCircleIcon, UtensilsIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { mealPlanApi } from '../api/mealPlanApi';
import { nutritionApi } from '../api/nutritionApi';
import { toApiError } from '../api/errors';
import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../contexts/AuthContext';
import { DailyMealPlan, MealPlanDish, MealType, NutritionCalculation, ProfileUpdate } from '../types/nutrition';
import { formatLongDate, todayISO } from '../utils/date';
import { fmt } from '../utils/format';

const trialKey = 'nutriai.guest-trial';
const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const meals: {type: MealType; label: string; hint: string}[] = [
  {type: 'breakfast', label: 'Bữa sáng', hint: 'Bắt đầu ngày mới'},
  {type: 'lunch', label: 'Bữa trưa', hint: 'Bữa ăn giữa ngày'},
  {type: 'dinner', label: 'Bữa tối', hint: 'Bữa ăn cuối ngày'},
  {type: 'snack', label: 'Bữa phụ', hint: 'Bữa ăn nhẹ'},
];

function readGuestDay(date: string): DailyMealPlan | null {
  try {
    const trial = JSON.parse(sessionStorage.getItem(trialKey) ?? '{}') as {plan?: DailyMealPlan; plans?: DailyMealPlan[]};
    const plans = [...(trial.plans ?? [])];
    if (trial.plan && !plans.some((plan) => plan.id === trial.plan?.id)) plans.push(trial.plan);
    return plans.filter((plan) => plan.plan_date === date).at(-1) ?? null;
  } catch { return null; }
}

function isoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function weekDays(value: string): string[] {
  const start = parseDate(value);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({length: 7}, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return isoDate(day);
  });
}

function updateConsumedTotals(plan: DailyMealPlan, mealsList: MealPlanDish[]): DailyMealPlan {
  const consumed_totals = mealsList.reduce((totals, meal) => {
    const ratio = Math.min(1, Math.max(0, meal.consumed_ratio ?? 0));
    return {
      calories: totals.calories + meal.calories * ratio,
      protein: totals.protein + meal.protein * ratio,
      carb: totals.carb + meal.carb * ratio,
      fat: totals.fat + meal.fat * ratio,
    };
  }, {calories: 0, protein: 0, carb: 0, fat: 0});
  return {...plan, meals: mealsList, consumed_totals};
}

export function FoodLog() {
  const { isGuest } = useAuth();
  const today = todayISO();
  const [selectedDate, setSelectedDate] = useState(today);
  const datePickerRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<DailyMealPlan | null>(null);
  const [calculation, setCalculation] = useState<NutritionCalculation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingIds, setSavingIds] = useState<number[]>([]);
  const days = useMemo(() => weekDays(selectedDate), [selectedDate]);
  const eaten = plan?.consumed_totals ?? {calories: 0, protein: 0, carb: 0, fat: 0};
  const caloriesLeft = Math.max(0, (calculation?.target_calories ?? plan?.target_calories ?? 0) - eaten.calories);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    let trialProfile: ProfileUpdate | null = null;
    if (isGuest) {
      try { trialProfile = (JSON.parse(sessionStorage.getItem(trialKey) ?? '{}') as {profile?: ProfileUpdate}).profile ?? null; }
      catch { trialProfile = null; }
    }
    const plansRequest = isGuest ? Promise.resolve(readGuestDay(selectedDate) ? [readGuestDay(selectedDate)!] : []) : mealPlanApi.getPlans(selectedDate);
    const calculationRequest = isGuest
      ? trialProfile ? nutritionApi.calculatePreview(trialProfile) : Promise.resolve(null)
      : nutritionApi.calculate();
    Promise.all([plansRequest, calculationRequest])
      .then(([plans, nutrition]) => { if (active) { setPlan(plans.at(-1) ?? null); setCalculation(nutrition); } })
      .catch((cause) => { if (active) setError(toApiError(cause).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isGuest, selectedDate]);

  const moveWeek = (direction: number) => {
    const date = parseDate(selectedDate);
    date.setDate(date.getDate() + direction * 7);
    const nextDate = isoDate(date);
    setSelectedDate(nextDate > today ? today : nextDate);
  };

  const openDatePicker = () => {
    const input = datePickerRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  };

  const setConsumed = async (dish: MealPlanDish, ratio: number) => {
    if (!plan || !dish.id || savingIds.includes(dish.id)) return;
    setSavingIds((ids) => [...ids, dish.id!]);
    const nextMeals = plan.meals.map((item) => item.id === dish.id ? {...item, consumed_ratio: ratio} : item);
    const nextPlan = updateConsumedTotals(plan, nextMeals);
    if (isGuest) {
      try {
        const previous = JSON.parse(sessionStorage.getItem(trialKey) ?? '{}') as {profile?: ProfileUpdate; plan?: DailyMealPlan; plans?: DailyMealPlan[]};
        const plans = (previous.plans ?? []).map((item) => item.id === plan.id ? nextPlan : item);
        const updated = {...previous, plan: previous.plan?.id === plan.id ? nextPlan : previous.plan, plans};
        sessionStorage.setItem(trialKey, JSON.stringify(updated));
        setPlan(nextPlan);
      } catch { toast.error('Không thể cập nhật dữ liệu trong phiên này.'); }
      finally { setSavingIds((ids) => ids.filter((id) => id !== dish.id)); }
      return;
    }
    try {
      const result = await mealPlanApi.setConsumption(dish.id, ratio);
      const savedMeals = plan.meals.map((item) => item.id === dish.id ? {...item, consumed_ratio: result.consumed_ratio} : item);
      setPlan(updateConsumedTotals(plan, savedMeals));
    } catch (cause) {
      toast.error(toApiError(cause).message);
    } finally {
      setSavingIds((ids) => ids.filter((id) => id !== dish.id));
    }
  };

  const titleDate = parseDate(selectedDate).toLocaleDateString('vi-VN', {month: 'long', year: 'numeric'});
  const weekLabel = `${parseDate(days[0]).toLocaleDateString('vi-VN', {day: 'numeric', month: 'short'})} – ${parseDate(days[6]).toLocaleDateString('vi-VN', {day: 'numeric', month: 'short', year: 'numeric'})}`;

  return <div className="mx-auto max-w-5xl space-y-6">
    <header className="relative overflow-hidden rounded-[2rem] border border-[#F8E6DA] bg-gradient-to-br from-[#F6F3EC] via-[#F6F3EC] to-[#F8E6DA] p-5 text-ink shadow-sm sm:p-8">
      <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-[#C4521F]/10" />
      <div className="relative flex items-center justify-between gap-4"><Link to="/" className="rounded-full bg-white p-2 text-brand shadow-sm" aria-label="Về tổng quan"><ArrowLeftIcon className="h-5 w-5" /></Link><span className="text-sm font-semibold tracking-wide text-brand">MYFIT · DINH DƯỠNG</span><CalendarDaysIcon className="h-5 w-5 text-brand" /></div>
      <h1 className="relative mt-7 text-3xl font-bold sm:text-4xl">Nhật ký dinh dưỡng</h1>
      <p className="relative mt-2 text-sm text-muted">Theo dõi bữa ăn và các chất dinh dưỡng đã ghi nhận trong ngày.</p>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm text-muted">Đã ghi nhận hôm nay</p><p className="mt-1 text-4xl font-bold tabular-nums text-brand">{fmt(eaten.calories)} <span className="text-base font-medium">kcal</span></p></div>
        <div className="text-right"><p className="text-sm text-muted">Mục tiêu tham khảo</p><p className="mt-1 text-xl font-semibold">{fmt(calculation?.target_calories ?? plan?.target_calories ?? 0)} kcal</p><p className="text-sm text-muted">Còn khoảng {fmt(caloriesLeft)} kcal</p></div>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-[#1F5136] transition-all" style={{width: `${calculation?.target_calories ? Math.min(100, eaten.calories / calculation.target_calories * 100) : 0}%`}} /></div>
      <p className="mt-2 text-xs text-muted">Tổng được tính theo tỷ lệ đã ghi cho từng món. Các mức dinh dưỡng chỉ mang tính tham khảo.</p>
    </header>

    <section className="card p-4 sm:p-6" aria-label="Chọn ngày">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => moveWeek(-1)} className="btn-ghost h-10 w-10 px-0" aria-label="Tuần trước"><ArrowLeftIcon className="h-4 w-4" /></button>
        <div className="text-center"><p className="text-xs uppercase tracking-wide text-muted">Tuần</p><h2 className="font-semibold capitalize">{weekLabel}</h2><p className="text-xs text-muted">{titleDate}</p></div>
        <button type="button" onClick={openDatePicker} className="btn-secondary h-10 w-10 px-0" aria-label="Chọn ngày, tháng và năm"><CalendarDaysIcon className="h-4 w-4 text-brand" /></button>
        <label className="sr-only" htmlFor="food-log-date">Chọn ngày, tháng và năm</label><input ref={datePickerRef} id="food-log-date" type="date" max={today} value={selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value); }} className="pointer-events-none absolute h-px w-px opacity-0" tabIndex={-1} />
        <button type="button" onClick={() => moveWeek(1)} disabled={days[6] >= today} className="btn-ghost h-10 w-10 px-0" aria-label="Tuần sau"><ArrowRightIcon className="h-4 w-4" /></button>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-2">{dayNames.map((name) => <div key={name} className="py-2 text-center text-xs font-semibold text-muted">{name}</div>)}{days.map((day) => {
        const date = parseDate(day);
        const selected = day === selectedDate;
        return <button type="button" key={day} disabled={day > today} aria-pressed={selected} onClick={() => setSelectedDate(day)} className={`grid min-h-11 place-items-center rounded-xl text-sm transition disabled:cursor-not-allowed disabled:opacity-30 sm:min-h-14 ${selected ? 'bg-[#1F5136] font-semibold text-white shadow-md' : 'text-ink hover:bg-[#F6F3EC]'}`}>{date.getDate()}</button>;
      })}</div>
      <p className="mt-3 text-center text-sm text-muted">{formatLongDate(selectedDate)}</p>
    </section>

    {loading ? <LoadingState label="Đang tải nhật ký..." /> : error ? <section className="card p-5" role="alert"><p className="text-sm text-accent">{error}</p></section> : <>
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Dinh dưỡng đã ghi nhận">
        <MacroRing label="Protein" value={eaten.protein} target={calculation?.protein_g ?? 0} color="#C4521F" />
        <MacroRing label="Chất béo" value={eaten.fat} target={calculation?.fat_g ?? 0} color="#1F5136" />
        <MacroRing label="Carbohydrate" value={eaten.carb} target={calculation?.carb_g ?? 0} color="#8A9E45" />
      </section>

      {!plan ? <section className="card p-8 text-center"><UtensilsIcon className="mx-auto h-9 w-9 text-brand"/><h2 className="mt-3 text-lg font-semibold">Chưa có thực đơn cho ngày này</h2><p className="mt-1 text-sm text-muted">Tạo thực đơn trước để ghi nhận các bữa đã ăn.</p><Link to={`/meal-plan?date=${encodeURIComponent(selectedDate)}`} className="btn-primary mt-4">Mở thực đơn</Link></section> : <section className="space-y-4" aria-label="Các bữa ăn">
        <div><h2 className="text-xl font-semibold">Các bữa trong ngày</h2><p className="mt-1 text-sm text-muted">Cập nhật tỷ lệ món đã ăn để tính lại tổng dinh dưỡng.</p></div>
        {meals.map((meal) => {
          const dishes = plan.meals.filter((dish) => dish.meal_type === meal.type).sort((a, b) => a.position - b.position);
          if (!dishes.length) return null;
          return <section key={meal.type} className="card overflow-hidden"><header className="flex items-center justify-between gap-3 border-b border-line p-4 sm:p-5"><div><h3 className="font-semibold">{meal.label}</h3><p className="text-xs text-muted">{meal.hint}</p></div><span className="text-sm font-semibold">{fmt(dishes.reduce((sum, dish) => sum + dish.calories * (dish.consumed_ratio ?? 0), 0))} kcal</span></header>
            <div className="divide-y divide-line">{dishes.map((dish) => <FoodLogRow key={`${dish.position}-${dish.dish_id}`} dish={dish} saving={Boolean(dish.id && savingIds.includes(dish.id))} onChange={(ratio) => setConsumed(dish, ratio)} />)}</div>
          </section>;
        })}
      </section>}
    </>}
    <p className="text-xs leading-5 text-muted">{isGuest ? 'Chế độ khách chỉ lưu tạm trên thiết bị trong phiên hiện tại.' : 'Thông tin nhật ký được lưu trong tài khoản của bạn.'} Lượng ăn và dinh dưỡng thực tế có thể khác theo khẩu phần và cách chế biến.</p>
  </div>;
}

function MacroRing({label, value, target, color}: {label: string; value: number; target: number; color: string}) {
  const percent = target > 0 ? Math.min(100, Math.max(0, value / target * 100)) : 0;
  return <article className="card flex items-center gap-4 p-4"><div className="grid h-16 w-16 shrink-0 place-items-center rounded-full" style={{background: `conic-gradient(${color} ${percent}%, #E8ECF1 ${percent}% 100%)`}}><div className="grid h-12 w-12 place-items-center rounded-full bg-white"><span className="text-xs font-semibold">{Math.round(percent)}%</span></div></div><div><p className="font-semibold">{label}</p><p className="mt-1 text-sm tabular-nums text-muted">{fmt(value, 1)} / {fmt(target, 1)} g</p></div></article>;
}

function FoodLogRow({dish, saving, onChange}: {dish: MealPlanDish; saving: boolean; onChange: (ratio: number) => void}) {
  const percent = Math.round((dish.consumed_ratio ?? 0) * 100);
  const [draftPercent, setDraftPercent] = useState(percent);
  useEffect(() => setDraftPercent(percent), [percent]);
  return <article className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5"><div><h4 className="font-medium">{dish.name}</h4><p className="mt-1 text-sm text-muted">{fmt(dish.calories)} kcal · {fmt(dish.serving_grams, 0)} g</p><p className="mt-1 text-xs text-muted">Protein {fmt(dish.protein, 1)} g · Carb {fmt(dish.carb, 1)} g · Fat {fmt(dish.fat, 1)} g</p></div><div className="flex items-center gap-3"><label className="min-w-0 flex-1 text-xs text-muted sm:w-44 sm:flex-none">Đã ăn {draftPercent}%<input aria-label={`Tỷ lệ đã ăn món ${dish.name}`} type="range" min="0" max="100" step="5" value={draftPercent} disabled={saving} onChange={(event) => setDraftPercent(Number(event.target.value))} onPointerUp={() => { if (draftPercent !== percent) onChange(draftPercent / 100); }} onBlur={() => { if (draftPercent !== percent) onChange(draftPercent / 100); }} className="mt-1 block w-full accent-[#1F5136]" /></label><button type="button" onClick={() => onChange(percent === 100 ? 0 : 1)} disabled={saving} className={`btn-secondary h-10 px-3 ${percent === 100 ? 'border-brand/30 text-brand' : ''}`}>{saving ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}{percent === 100 ? 'Đã ăn hết' : 'Ăn hết'}</button></div></article>;
}
