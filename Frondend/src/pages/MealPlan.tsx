import { useEffect, useMemo, useState } from 'react';
import { CalendarDaysIcon, ImageIcon, LoaderCircleIcon, RefreshCwIcon, SparklesIcon, XIcon } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { resolveAssetUrl } from '../api/client';
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
const snackMeal = { key: 'snack', label: 'Bữa phụ', hint: 'Bữa ăn nhẹ trong ngày' } as const;
// Reference estimates for cooked foods; bowl/portion weights are explicit so
// the UI never presents an undefined “small serving”. Actual recipes vary.
const starchOptions = [
  { name: 'Cơm trắng', kcalPer100g: 130, carbPer100g: 28.2, portionLabel: '1 chén cơm gạt ngang ≈ 150 g', portionGrams: 150 },
  { name: 'Cơm gạo lứt', kcalPer100g: 123, carbPer100g: 25.6, portionLabel: '1 chén cơm gạt ngang ≈ 150 g', portionGrams: 150 },
  { name: 'Bún tươi', kcalPer100g: 109, carbPer100g: 25, portionLabel: '1 phần nhỏ ≈ 150 g', portionGrams: 150 },
  { name: 'Cháo trắng', kcalPer100g: 40, carbPer100g: 8.5, portionLabel: '1 tô nhỏ ≈ 250 g', portionGrams: 250 },
  { name: 'Khoai lang luộc', kcalPer100g: 86, carbPer100g: 20.1, portionLabel: '1 củ vừa ≈ 130 g', portionGrams: 130 },
];
type StarchChoice = { name: string; grams: number; calories: number; carb: number };
const STARCH_STORAGE_KEY = 'nutriai-meal-plan-starch-additions-v1';

function readStarchChoices(): Record<string, StarchChoice> {
  try {
    return JSON.parse(localStorage.getItem(STARCH_STORAGE_KEY) ?? '{}') as Record<string, StarchChoice>;
  } catch {
    return {};
  }
}

function starchAdviceSelections(planId: number | undefined, choices: Record<string, StarchChoice>): StarchChoice[] {
  if (planId === undefined) return [];
  const prefix = `${planId}:`;
  return Object.entries(choices).filter(([key]) => key.startsWith(prefix)).map(([, choice]) => choice);
}

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
  const [mainMeals, setMainMeals] = useState(3);
  const [sideMeals, setSideMeals] = useState(0);
  const [cookingIds, setCookingIds] = useState<number[]>([]);
  const [starchChoices, setStarchChoices] = useState<Record<string, StarchChoice>>(readStarchChoices);

  useEffect(() => {
    try { localStorage.setItem(STARCH_STORAGE_KEY, JSON.stringify(starchChoices)); } catch { /* Storage can be disabled; the current page still works. */ }
  }, [starchChoices]);

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
        const latest = result[result.length - 1] ?? null;
        setVersionId(latest?.id ?? null);
      })
      .catch((cause) => { if (active) setError(toApiError(cause).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedDate]);

  const plan = useMemo(() => plans.find((item) => item.id === versionId) ?? plans[plans.length - 1] ?? null, [plans, versionId]);
  useEffect(() => {
    if (!plan) return;
    setMainMeals(plan.meals.filter((item) => item.meal_type !== 'snack').length);
    setSideMeals(plan.meals.filter((item) => item.meal_type === 'snack').length);
  }, [plan]);
  const displayedMeals = useMemo(
    () => plan ? [...plan.meals].sort((a, b) => a.position - b.position).slice(0, mainMeals + sideMeals) : [],
    [plan, mainMeals, sideMeals]
  );
  const displayedNutrition = useMemo(() => displayedMeals.reduce((sum, dish) => ({
    calories: sum.calories + dish.calories,
    protein: sum.protein + dish.protein,
    carb: sum.carb + dish.carb,
    fat: sum.fat + dish.fat,
  }), { calories: 0, protein: 0, carb: 0, fat: 0 }), [displayedMeals]);
  const selectedAdditions = useMemo(() => starchAdviceSelections(plan?.id, starchChoices), [plan?.id, starchChoices]);
  const dailyNutrition = useMemo(() => ({
    calories: displayedNutrition.calories + selectedAdditions.reduce((sum, item) => sum + item.calories, 0),
    protein: displayedNutrition.protein,
    carb: displayedNutrition.carb + selectedAdditions.reduce((sum, item) => sum + item.carb, 0),
    fat: displayedNutrition.fat,
  }), [displayedNutrition, selectedAdditions]);
  const starchAdvice = useMemo(() => {
    if (!plan) return [];
    const split = { breakfast: 0.25, lunch: 0.40, dinner: 0.35 };
    return (['breakfast', 'lunch', 'dinner'] as const).map((mealType) => {
      const mealCalories = displayedMeals.filter((dish) => dish.meal_type === mealType).reduce((sum, dish) => sum + dish.calories, 0);
      const remaining = Math.max(0, plan.target_calories * split[mealType] - mealCalories);
      // Use part of a meaningful energy gap for starch; retain room for protein,
      // vegetables and fat instead of filling every missing kcal with carbs.
      const addKcal = remaining >= 50 ? Math.min(remaining * 0.4, 220) : 0;
      const options = addKcal ? starchOptions.map((food) => {
        const grams = Math.round(addKcal / food.kcalPer100g * 100 / 10) * 10;
        const calories = Math.round(grams * food.kcalPer100g / 100);
        const carb = Math.round(grams * food.carbPer100g / 100);
        const portions = grams / food.portionGrams;
        const portionText = portions < 0.8
          ? `${Math.round(portions * 4) / 4} ${food.name === 'Khoai lang luộc' ? 'củ' : food.name === 'Cháo trắng' ? 'tô' : food.name === 'Bún tươi' ? 'phần' : 'chén'} (quy đổi từ ${food.portionLabel})`
          : `${Math.round(portions * 4) / 4} ${food.name === 'Khoai lang luộc' ? 'củ' : food.name === 'Cháo trắng' ? 'tô' : food.name === 'Bún tươi' ? 'phần' : 'chén'}`;
        return { ...food, grams, calories, carb, portionText };
      }) : [];
      return { mealType, mealCalories, remaining, addKcal, options };
    });
  }, [plan, displayedMeals]);
  const completeProfile = Boolean(user?.profile?.date_of_birth && user.profile.height_cm && user.profile.weight_kg &&
    user.profile.sex_for_calculation && user.profile.activity_level && user.profile.goal);

  const createOrRegenerate = async () => {
    setWorking(true);
    try {
      const result = plan
        ? await mealPlanApi.regenerate(plan.id, mealSplit, { main_meals: mainMeals, side_meals: sideMeals })
        : await mealPlanApi.generate(selectedDate, mealSplit, { main_meals: mainMeals, side_meals: sideMeals });
      setPlans((current) => [...current, result.data]);
      setVersionId(result.data.id);
      const generatedMainMeals = result.data.meals.filter((item) => item.meal_type !== 'snack').length;
      const generatedSideMeals = result.data.meals.filter((item) => item.meal_type === 'snack').length;
      if (generatedMainMeals !== mainMeals || generatedSideMeals !== sideMeals) {
        toast.error(`Backend hiện chỉ trả ${generatedMainMeals} bữa chính và ${generatedSideMeals} bữa phụ. Hãy khởi động lại backend rồi tạo phiên bản mới.`);
      } else {
        toast.success(plan ? `Đã tạo phiên bản ${result.data.version}; bản cũ vẫn được lưu.` : 'Đã tạo và lưu thực đơn.');
      }
    } catch (cause) {
      toast.error(toApiError(cause).message);
    } finally {
      setWorking(false);
    }
  };

  const markCooked = async (dish: MealPlanDish) => {
    if (!dish.id || cookingIds.includes(dish.id)) return;
    setCookingIds((ids) => [...ids, dish.id!]);
    try {
      const result = await mealPlanApi.setCooked(dish.id, !dish.is_cooked);
      setPlans((all) => all.map((savedPlan) => savedPlan.id === plan?.id
        ? { ...savedPlan, meals: savedPlan.meals.map((item) => item.id === dish.id ? { ...item, is_cooked: result.is_cooked } : item) }
        : savedPlan));
      toast.success(result.is_cooked ? 'Đã xác nhận nấu món này.' : 'Đã bỏ xác nhận món đã nấu.');
    } catch (cause) {
      toast.error(toApiError(cause).message);
    } finally {
      setCookingIds((ids) => ids.filter((id) => id !== dish.id));
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
              {plan && <p className="mt-1 text-sm text-muted">Tổng trong ngày {fmt(dailyNutrition.calories)} / {fmt(plan.target_calories)} kcal mục tiêu (đã tính phần tinh bột chọn thêm)</p>}
            </div>
            <button onClick={createOrRegenerate} disabled={working} className="btn-primary h-11">
              {working ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : plan ? <RefreshCwIcon className="h-4 w-4" /> : <SparklesIcon className="h-4 w-4" />}
              {plan ? 'Tạo phiên bản mới' : 'Tạo thực đơn'}
            </button>
          </section>

          <section className="card flex flex-wrap items-end gap-4 p-5">
            <label className="grid gap-1 text-sm font-medium">Số bữa chính
              <select className="input" value={mainMeals} onChange={(event) => setMainMeals(Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} bữa</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm font-medium">Số bữa phụ
              <select className="input" value={sideMeals} onChange={(event) => setSideMeals(Number(event.target.value))}>{Array.from({ length: 7 }, (_, index) => index).map((count) => <option key={count} value={count}>{count} bữa</option>)}</select>
            </label>
            <p className="pb-2 text-sm text-muted">Áp dụng khi tạo phiên bản thực đơn mới.</p>
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
              {(() => {
                const orderedDishes = displayedMeals;
                const mainSlots = Array.from({ length: mainMeals }, (_, index) => ({
                  key: `main-${index}`,
                  type: meals[index % meals.length].key,
                  label: `${meals[index % meals.length].label}${index >= meals.length ? ` ${Math.floor(index / meals.length) + 1}` : ''}`,
                  hint: meals[index % meals.length].hint,
                }));
                const slots = [...mainSlots, ...Array.from({ length: sideMeals }, (_, index) => ({ key: `snack-${index}`, type: 'snack', label: `Bữa phụ ${index + 1}`, hint: snackMeal.hint }))];
                return <section className="grid gap-4 lg:grid-cols-3">
                  {slots.map((slot, index) => {
                    const dish = orderedDishes[index];
                    return <MealCard key={slot.key} label={slot.label} hint={slot.hint} dishes={dish ? [dish] : []} onSelectDish={setSelectedDish} onMarkCooked={markCooked} cookingIds={cookingIds} />;
                  })}
                </section>;
              })()}
              <section className="card p-5 sm:p-6">
                <h2 className="font-semibold">Tổng dinh dưỡng đã lưu</h2>
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Total label="Tổng năng lượng cả ngày" value={`${fmt(dailyNutrition.calories)} kcal`} />
                  <Total label="Protein cả ngày" value={`${fmt(dailyNutrition.protein, 1)} g`} />
                  <Total label="Carb cả ngày" value={`${fmt(dailyNutrition.carb, 1)} g`} />
                  <Total label="Fat cả ngày" value={`${fmt(dailyNutrition.fat, 1)} g`} />
                </div>
              </section>
              <section className="card p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><SparklesIcon className="h-5 w-5" /></span>
                  <div><h2 className="font-semibold">Gợi ý bổ sung tinh bột theo khẩu phần</h2><p className="mt-1 text-sm leading-6 text-muted">So sánh calo món đã có với mục tiêu từng bữa (sáng 25%, trưa 40%, tối 35%). Nếu còn thiếu đáng kể, gợi ý chỉ bù một phần bằng tinh bột để vẫn chừa chỗ cho đạm và rau.</p></div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  {starchAdvice.map((advice) => <article key={advice.mealType} className="rounded-2xl border border-line bg-surface/50 p-4">
                    <h3 className="font-semibold">{meals.find((meal) => meal.key === advice.mealType)?.label}</h3>
                    {advice.options.length ? <>
                      <p className="mt-2 text-sm text-muted">Còn khoảng {fmt(advice.remaining)} kcal theo mục tiêu bữa. Phần tinh bột gợi ý bù khoảng {fmt(advice.addKcal)} kcal:</p>
                      <ul className="mt-3 space-y-2">{advice.options.map((option) => {
                        const choiceKey = `${plan.id}:${advice.mealType}`;
                        const chosen = starchChoices[choiceKey]?.name === option.name;
                        return <li key={option.name} className={`rounded-xl border p-3 text-sm ${chosen ? 'border-brand bg-brand-soft/50' : 'border-line bg-white'}`}>
                          <p className="font-semibold text-brand">{option.name}: {option.grams} g · khoảng {option.portionText}</p>
                          <p className="mt-1 text-xs text-muted">~{option.calories} kcal · {option.carb} g carb</p>
                          <button type="button" aria-pressed={chosen} onClick={() => setStarchChoices((current) => {
                            const next = { ...current };
                            if (next[choiceKey]?.name === option.name) delete next[choiceKey];
                            else next[choiceKey] = { name: option.name, grams: option.grams, calories: option.calories, carb: option.carb };
                            return next;
                          })} className={`mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold ${chosen ? 'bg-brand text-white' : 'bg-surface text-brand hover:bg-brand-soft'}`}>{chosen ? 'Đã thêm · Bỏ chọn' : 'Chọn khẩu phần này'}</button>
                        </li>;
                      })}</ul>
                    </> : <p className="mt-2 text-sm text-muted">{advice.remaining < 50 ? 'Bữa này đã gần mục tiêu năng lượng; chưa cần gợi ý thêm tinh bột.' : 'Không đủ dữ liệu để tính gợi ý.'}</p>}
                  </article>)}
                </div>
                {selectedAdditions.length > 0 && <p className="mt-4 rounded-xl bg-brand-soft/50 p-3 text-sm text-brand">Đã chọn thêm {selectedAdditions.map((item) => `${item.name} ${item.grams} g`).join(' · ')}. Tổng ngày hiện tại: {fmt(dailyNutrition.calories)} kcal, {fmt(dailyNutrition.carb, 1)} g carb.</p>}
                <p className="mt-4 text-xs leading-5 text-muted">Khối lượng là thực phẩm đã nấu chín; 1 chén cơm gạt ngang quy ước khoảng 150 g, 1 tô cháo nhỏ khoảng 250 g. Dinh dưỡng là ước tính tham khảo, thay đổi theo cách nấu và kích thước chén/tô. Chọn tối đa một lựa chọn cho mỗi bữa; lựa chọn được ghi nhớ trên thiết bị này. Gợi ý hiện dùng phân bổ mặc định 25/40/35.</p>
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

function MealCard({label, hint, dishes, onSelectDish, onMarkCooked, cookingIds}: {label: string; hint: string; dishes: MealPlanDish[]; onSelectDish: (dish: MealPlanDish) => void; onMarkCooked: (dish: MealPlanDish) => void; cookingIds: number[]}) {
  const calories = dishes.reduce((sum, dish) => sum + dish.calories, 0);
  return (
    <article className="card overflow-hidden">
      <div className="border-b border-line p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">{label}</p>
        <p className="mt-1 text-sm text-muted">{hint}</p>
        <p className="mt-3 text-xl font-semibold tabular-nums">{fmt(calories)} <span className="text-sm font-normal text-muted">kcal</span></p>
      </div>
      <div className="divide-y divide-line">
        {dishes.length ? dishes.map((dish) => <DishRow key={`${dish.position}-${dish.dish_id}`} dish={dish} onSelect={() => onSelectDish(dish)} onMarkCooked={() => onMarkCooked(dish)} busy={dish.id ? cookingIds.includes(dish.id) : true} />) : <p className="p-5 text-sm text-muted">Không có món trong bữa này.</p>}
      </div>
    </article>
  );
}

function DishRow({dish, onSelect, onMarkCooked, busy}: {dish: MealPlanDish; onSelect: () => void; onMarkCooked: () => void; busy: boolean}) {
  return (
    <div className="p-4">
      <DishImage src={dish.image_url} alt={dish.name} className="h-40 w-full rounded-xl object-cover" />
      <h3 className="mt-3">
        <button type="button" onClick={onSelect} className="text-left font-semibold text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          {dish.name}
        </button>
      </h3>
      <p className="mt-1 text-sm text-muted">{fmt(dish.serving_grams, 1)} g · {fmt(dish.calories)} kcal theo khẩu phần này</p>
      <p className="mt-2 text-xs text-muted">Protein {fmt(dish.protein, 1)} g · Carb {fmt(dish.carb, 1)} g · Fat {fmt(dish.fat, 1)} g</p>
      <p className="mt-3 text-xs leading-5 text-muted">{dish.reason}</p>
      <button type="button" disabled={busy} onClick={onMarkCooked} className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${dish.is_cooked ? 'bg-emerald-100 text-emerald-800' : 'bg-surface text-brand hover:bg-emerald-50'}`}>{busy ? 'Đang lưu…' : dish.is_cooked ? '✓ Đã nấu' : 'Xác nhận đã nấu'}</button>
    </div>
  );
}

function DishImage({src, alt, className}: {src: string | null; alt: string; className: string}) {
  const [failed, setFailed] = useState(false);
  const imageUrl = resolveAssetUrl(src);
  if (!imageUrl || failed) {
    return <div className={`${className} flex items-center justify-center bg-surface text-muted`} aria-label={`Chưa có ảnh: ${alt}`}><ImageIcon className="h-8 w-8" /></div>;
  }
  return <img src={imageUrl} alt={alt} loading="lazy" className={className} onError={() => setFailed(true)} />;
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
