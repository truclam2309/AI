import { useEffect, useMemo, useState } from 'react';
import { CalendarDaysIcon, ImageIcon, LoaderCircleIcon, RefreshCwIcon, SparklesIcon, XIcon } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { mealPlanApi } from '../api/mealPlanApi';
import { toApiError } from '../api/errors';
import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../contexts/AuthContext';
import { DailyMealPlan, MealPlanDish } from '../types/nutrition';
import { formatLongDate, todayISO } from '../utils/date';
import { fmt } from '../utils/format';

const meals = [
  { key: 'breakfast', label: 'Bữa sáng', hint: 'Bắt đầu ngày mới' },
  { key: 'lunch', label: 'Bữa trưa', hint: 'Bữa ăn chính giữa ngày' },
  { key: 'dinner', label: 'Bữa tối', hint: 'Hoàn tất thực đơn trong ngày' }
] as const;

export function MealPlan() {
  const { user } = useAuth();
  const location = useLocation();
  const mealSplit = (location.state as {meal_split?: Record<string, number>} | null)?.meal_split;
  const [searchParams] = useSearchParams();
  const dateFromQuery = searchParams.get('date');
  const [selectedDate, setSelectedDate] = useState(() => dateFromQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateFromQuery) ? dateFromQuery : todayISO());
  const [plans, setPlans] = useState<DailyMealPlan[]>([]);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [selectedDish, setSelectedDish] = useState<MealPlanDish | null>(null);

  useEffect(() => {
    if (dateFromQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateFromQuery)) setSelectedDate(dateFromQuery);
  }, [dateFromQuery]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    mealPlanApi.getPlans(selectedDate)
      .then((result) => {
        if (!active) return;
        setPlans(result);
        setVersionId(result[result.length - 1]?.id ?? null);
      })
      .catch((cause) => { if (active) setError(toApiError(cause).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedDate]);

  const plan = useMemo(() => plans.find((item) => item.id === versionId) ?? plans[plans.length - 1] ?? null, [plans, versionId]);
  const completeProfile = Boolean(user?.profile?.date_of_birth && user.profile.height_cm && user.profile.weight_kg &&
    user.profile.sex_for_calculation && user.profile.activity_level && user.profile.goal);

  const createOrRegenerate = async () => {
    setWorking(true);
    try {
      const result = plan
        ? await mealPlanApi.regenerate(plan.id, mealSplit)
        : await mealPlanApi.generate(selectedDate, mealSplit);
      setPlans((current) => [...current, result.data]);
      setVersionId(result.data.id);
      toast.success(plan ? `Đã tạo phiên bản ${result.data.version}; bản cũ vẫn được lưu.` : 'Đã tạo và lưu thực đơn 3 bữa.');
    } catch (cause) {
      toast.error(toApiError(cause).message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-muted">Kế hoạch theo ngày</p>
          <h1 className="mt-1 text-3xl font-semibold">Thực đơn của bạn</h1>
          <p className="mt-2 text-sm text-muted">Chọn ngày để xem lịch sử hoặc tạo kế hoạch mới. Lịch sử món ăn được lưu và dùng để ưu tiên thực đơn đa dạng trong 30 ngày gần đây.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative">
            <span className="sr-only">Chọn ngày thực đơn</span>
            <CalendarDaysIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="input h-11 pl-10" />
          </label>
          {selectedDate !== todayISO() && <button className="btn-secondary" onClick={() => setSelectedDate(todayISO())}>Hôm nay</button>}
        </div>
      </header>

      {loading ? <LoadingState label="Đang tải thực đơn..." /> : error ? (
        <section className="card p-5" role="alert"><p className="text-sm text-accent">{error}</p></section>
      ) : !completeProfile ? (
        <section className="card p-6">
          <h2 className="text-lg font-semibold">Hoàn thiện hồ sơ trước</h2>
          <p className="mt-2 text-sm text-muted">Cần ngày sinh, chiều cao, cân nặng, giới tính tính BMR, mức vận động và mục tiêu.</p>
          <Link to="/profile" className="btn-primary mt-4">Mở hồ sơ</Link>
        </section>
      ) : (
        <>
          <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="text-sm capitalize text-muted">{formatLongDate(selectedDate)}</p>
              <h2 className="mt-1 text-xl font-semibold">{plan ? `Phiên bản ${plan.version}` : 'Chưa có thực đơn'}</h2>
              {plan && <p className="mt-1 text-sm text-muted">Tổng {fmt(plan.total_calories)} / {fmt(plan.target_calories)} kcal tham khảo</p>}
            </div>
            <button onClick={createOrRegenerate} disabled={working} className="btn-primary h-11">
              {working ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : plan ? <RefreshCwIcon className="h-4 w-4" /> : <SparklesIcon className="h-4 w-4" />}
              {plan ? 'Tạo phiên bản mới' : 'Tạo thực đơn 3 bữa'}
            </button>
          </section>

          {plans.length > 1 && (
            <label className="flex items-center gap-3 text-sm">
              <span className="font-medium">Xem phiên bản</span>
              <select className="input max-w-xs" value={versionId ?? ''} onChange={(event) => setVersionId(Number(event.target.value))}>
                {plans.map((item) => <option key={item.id} value={item.id}>Phiên bản {item.version} · {new Date(item.created_at).toLocaleString('vi-VN')}</option>)}
              </select>
            </label>
          )}

          {plan ? (
            <>
              <section className="grid gap-4 lg:grid-cols-3">
                {meals.map((meal) => {
                  const dishes = plan.meals.filter((item) => item.meal_type === meal.key);
                  return <MealCard key={meal.key} label={meal.label} hint={meal.hint} dishes={dishes} onSelectDish={setSelectedDish} />;
                })}
              </section>
              <section className="card p-5 sm:p-6">
                <h2 className="font-semibold">Tổng dinh dưỡng đã lưu</h2>
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Total label="Năng lượng" value={`${fmt(plan.total_calories)} kcal`} />
                  <Total label="Protein" value={`${fmt(plan.nutrition_totals.protein, 1)} g`} />
                  <Total label="Carb" value={`${fmt(plan.nutrition_totals.carb, 1)} g`} />
                  <Total label="Fat" value={`${fmt(plan.nutrition_totals.fat, 1)} g`} />
                </div>
              </section>
              {plan.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">{warning}</p>)}
            </>
          ) : (
            <section className="card p-8 text-center">
              <CalendarDaysIcon className="mx-auto h-8 w-8 text-brand" />
              <h2 className="mt-3 text-lg font-semibold">Chưa có kế hoạch cho ngày này</h2>
              <p className="mt-1 text-sm text-muted">Tạo thực đơn để lưu sáng, trưa và tối vào lịch sử của bạn.</p>
            </section>
          )}
        </>
      )}
      {selectedDish && <DishDetails dish={selectedDish} onClose={() => setSelectedDish(null)} />}
    </div>
  );
}

function MealCard({label, hint, dishes, onSelectDish}: {label: string; hint: string; dishes: MealPlanDish[]; onSelectDish: (dish: MealPlanDish) => void}) {
  const calories = dishes.reduce((sum, dish) => sum + dish.calories, 0);
  return (
    <article className="card overflow-hidden">
      <div className="border-b border-line p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">{label}</p>
        <p className="mt-1 text-sm text-muted">{hint}</p>
        <p className="mt-3 text-xl font-semibold tabular-nums">{fmt(calories)} <span className="text-sm font-normal text-muted">kcal</span></p>
      </div>
      <div className="divide-y divide-line">
        {dishes.length ? dishes.map((dish) => <DishRow key={`${dish.position}-${dish.dish_id}`} dish={dish} onSelect={() => onSelectDish(dish)} />) : <p className="p-5 text-sm text-muted">Không có món trong bữa này.</p>}
      </div>
    </article>
  );
}

function DishRow({dish, onSelect}: {dish: MealPlanDish; onSelect: () => void}) {
  return (
    <div className="p-4">
      <DishImage src={dish.image_url} alt={dish.name} className="h-40 w-full rounded-xl object-cover" />
      <h3 className="mt-3">
        <button type="button" onClick={onSelect} className="text-left font-semibold text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          {dish.name}
        </button>
      </h3>
      <p className="mt-1 text-sm text-muted">{fmt(dish.serving_grams, 1)} g · {fmt(dish.calories)} kcal</p>
      <p className="mt-2 text-xs text-muted">Protein {fmt(dish.protein, 1)} g · Carb {fmt(dish.carb, 1)} g · Fat {fmt(dish.fat, 1)} g</p>
      <p className="mt-3 text-xs leading-5 text-muted">{dish.reason}</p>
    </div>
  );
}

function DishImage({src, alt, className}: {src: string | null; alt: string; className: string}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className={`${className} flex items-center justify-center bg-surface text-muted`} aria-label={`Chưa có ảnh: ${alt}`}><ImageIcon className="h-8 w-8" /></div>;
  }
  return <img src={src} alt={alt} loading="lazy" className={className} onError={() => setFailed(true)} />;
}

function DishDetails({dish, onClose}: {dish: MealPlanDish; onClose: () => void}) {
  const ingredients = (dish.ingredients ?? '').split(/\r?\n|[|;]+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const cleaned = line.replace(/^[-•*]\s*/, '');
    const separator = cleaned.lastIndexOf(':');
    return separator >= 0
      ? { name: cleaned.slice(0, separator).trim(), amount: cleaned.slice(separator + 1).trim() }
      : { name: cleaned, amount: '' };
  });
  const steps = (dish.instructions ?? '').split(/\r?\n+/).map((line) => line.trim()).filter(Boolean)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ỹ“])/u).map((sentence) => sentence.trim()).filter(Boolean));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="dish-details-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }} className="my-auto max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-[#fff8f2] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#eee3d9] bg-[#fff8f2]/95 px-5 py-4 backdrop-blur sm:px-7">
          <h2 id="dish-details-title" className="text-sm font-semibold text-muted">Chi tiết món ăn</h2>
          <button type="button" autoFocus onClick={onClose} aria-label="Đóng chi tiết món ăn" className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink"><XIcon className="h-5 w-5" /></button>
        </div>
        <div className="space-y-8 p-5 sm:p-8">
          <DishImage src={dish.image_url} alt={dish.name} className="max-h-80 w-full rounded-2xl bg-surface object-cover" />
          <div>
            <h3 className="text-2xl font-semibold leading-tight sm:text-3xl">{dish.name}</h3>
            <p className="mt-2 text-sm text-muted">Khẩu phần {fmt(dish.serving_grams, 1)} g</p>
          </div>
          <section className="rounded-3xl border border-[#dfe1cf] bg-[#f2f1e3] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-lg font-semibold">Dinh dưỡng cả món</h4>
              <span className="text-sm text-brand">Theo khẩu phần catalog</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-5">
              <NutritionValue label="Carb" value={dish.carb} unit="g" />
              <NutritionValue label="Protein" value={dish.protein} unit="g" />
              <NutritionValue label="Béo" value={dish.fat} unit="g" />
              <NutritionValue label="Khẩu phần" value={dish.serving_grams} unit="g" />
              <NutritionValue label="Kcal" value={dish.calories} unit="kcal" />
            </div>
          </section>
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <h4 className="text-2xl font-medium">Nguyên liệu</h4>
              <span className="rounded-full bg-[#f0efdf] px-4 py-2 text-sm font-medium text-brand">{ingredients.length} mục</span>
            </div>
            {ingredients.length ? <ul className="divide-y divide-[#eee3d9]">
              {ingredients.map((ingredient, index) => <li key={`${ingredient.name}-${index}`} className="flex min-h-12 items-center gap-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 font-medium">{ingredient.name}</span>
                {ingredient.amount && <span className="shrink-0 text-right font-medium text-[#c95732]">{ingredient.amount}</span>}
              </li>)}
            </ul> : <p className="text-sm text-muted">Dataset chưa có thông tin nguyên liệu cho món này.</p>}
          </section>
          <section>
            <h4 className="mb-4 text-2xl font-medium">Các bước nấu</h4>
            {steps.length ? <ol className="space-y-3">
              {steps.map((step, index) => <li key={`${index}-${step}`} className="rounded-2xl bg-white p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#cf4f2c] text-base font-semibold text-white">{index + 1}</span>
                  <p className="pt-1 text-sm leading-6 sm:text-base">{step}</p>
                </div>
              </li>)}
            </ol> : <p className="text-sm text-muted">Dataset chưa có hướng dẫn chế biến cho món này.</p>}
          </section>
        </div>
      </section>
    </div>
  );
}

function NutritionValue({label, value, unit}: {label: string; value: number; unit: string}) {
  return <div><p className="font-serif text-2xl tabular-nums sm:text-3xl">{fmt(value, 1)}{unit === 'g' ? 'g' : ''}</p><p className="mt-1 text-sm text-muted">{unit === 'kcal' ? 'Kcal (cả món)' : label}</p></div>;
}

function Total({label, value}: {label: string; value: string}) {
  return <div><p className="text-xs text-muted">{label}</p><p className="mt-1 font-semibold tabular-nums">{value}</p></div>;
}
