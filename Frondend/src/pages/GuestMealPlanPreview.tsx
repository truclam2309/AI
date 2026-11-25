import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardPenLineIcon, LoaderCircleIcon, UserPlusIcon } from 'lucide-react';
import { mealPlanApi } from '../api/mealPlanApi';
import { toApiError } from '../api/errors';
import { ActivityLevel, DailyMealPlan, NutritionGoal, ProfileUpdate } from '../types/nutrition';
import { fmt } from '../utils/format';
import { clearGuestDishSelection, getGuestDishSelection } from '../utils/guestExperience';

const activities = [
  ['sedentary', 'Ít vận động'], ['light', 'Vận động nhẹ (1–3 buổi/tuần)'],
  ['moderate', 'Vận động vừa (3–5 buổi/tuần)'], ['active', 'Năng động (6–7 buổi/tuần)'],
  ['very_active', 'Rất năng động'],
];
const goals = [
  ['lose_weight', 'Giảm cân'], ['gain_weight', 'Tăng cân'],
  ['maintain_weight', 'Duy trì cân nặng'], ['gain_muscle', 'Tăng cơ'],
];
const mealNames: Record<string, string> = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' };
const parseList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
const TRIAL_KEY = 'nutriai.guest-trial';

function readTrial() {
  try { return JSON.parse(sessionStorage.getItem(TRIAL_KEY) ?? '{}') as { profile?: ProfileUpdate; plan?: DailyMealPlan; plans?: DailyMealPlan[] }; }
  catch { return {}; }
}

export function GuestMealPlanPreview() {
  const [dateOfBirth, setDateOfBirth] = useState(() => readTrial().profile?.date_of_birth ?? '');
  const [height, setHeight] = useState(() => String(readTrial().profile?.height_cm ?? ''));
  const [weight, setWeight] = useState(() => String(readTrial().profile?.weight_kg ?? ''));
  const [sex, setSex] = useState<'female' | 'male'>(() => readTrial().profile?.sex_for_calculation ?? 'female');
  const [activity, setActivity] = useState<ActivityLevel>(() => readTrial().profile?.activity_level ?? 'light');
  const [goal, setGoal] = useState<NutritionGoal>(() => readTrial().profile?.goal ?? 'maintain_weight');
  const [allergies, setAllergies] = useState(() => (readTrial().profile?.allergies ?? []).join(', '));
  const [avoid, setAvoid] = useState(() => (readTrial().profile?.avoid_ingredients ?? []).join(', '));
  const [plan, setPlan] = useState<DailyMealPlan | null>(() => readTrial().plan ?? null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const previous = readTrial();
    const profile: ProfileUpdate = {
      date_of_birth: dateOfBirth || null,
      height_cm: height ? Number(height) : null,
      weight_kg: weight ? Number(weight) : null,
      sex_for_calculation: sex,
      activity_level: activity,
      goal,
      allergies: parseList(allergies),
      avoid_ingredients: parseList(avoid),
    };
    try { sessionStorage.setItem(TRIAL_KEY, JSON.stringify({...previous, profile})); } catch { /* Current form state remains available for this page. */ }
  }, [dateOfBirth, height, weight, sex, activity, goal, allergies, avoid]);

  const createPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setPlan(null);
    setLoading(true);
    const profile: ProfileUpdate = {
      date_of_birth: dateOfBirth,
      height_cm: Number(height),
      weight_kg: Number(weight),
      sex_for_calculation: sex,
      activity_level: activity,
      goal,
      allergies: parseList(allergies),
      avoid_ingredients: parseList(avoid),
    };
    try {
      const selection = getGuestDishSelection();
      const result = await mealPlanApi.previewGuest(profile, {
        ...(selection?.plan_date ? {plan_date: selection.plan_date} : {}),
        ...(selection ? {selected_dish_id: selection.dish_id, selected_meal_type: selection.meal_type} : {}),
        ...(selection?.meal_type === 'snack' ? {side_meals: 1} : {}),
      });
      clearGuestDishSelection();
      const previous = readTrial();
      const nextId = Number(result.id) > 0 ? Number(result.id) : Date.now();
      const versions = previous.plans ?? (previous.plan ? [previous.plan] : []);
      const temporaryPlan = {...result, id: nextId, version: versions.length + 1,
        meals: result.meals.map((meal, index) => ({...meal, id: nextId * 100 + index}))};
      setPlan(temporaryPlan);
      sessionStorage.setItem(TRIAL_KEY, JSON.stringify({...previous, profile, plan: temporaryPlan, plans: [...versions, temporaryPlan]}));
    } catch (cause) {
      setError(toApiError(cause).message);
    } finally {
      setLoading(false);
    }
  };

  return <div className="mx-auto max-w-4xl space-y-6">
    <header className="rounded-[2rem] bg-gradient-to-br from-[#F6F3EC] to-[#F8E6DA] p-6 sm:p-9">
      <p className="flex items-center gap-2 text-sm font-semibold text-brand"><ClipboardPenLineIcon className="h-4 w-4" />DÙNG THỬ KHÔNG CẦN TÀI KHOẢN</p>
      <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Tạo thực đơn thử nghiệm</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">Nhập hồ sơ thử để trải nghiệm phân tích và thực đơn. Thông tin được giữ tạm trong phiên này; không ghi vào tài khoản hay lịch sử.</p>
    </header>

    <form onSubmit={createPreview} className="card grid gap-4 p-5 sm:grid-cols-2 sm:p-7">
      <label className="text-sm font-medium">Ngày sinh<input required type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} className="input mt-1.5 h-11" /></label>
      <label className="text-sm font-medium">Chiều cao (cm)<input required type="number" min="80" max="260" step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} className="input mt-1.5 h-11" placeholder="Ví dụ: 165" /></label>
      <label className="text-sm font-medium">Cân nặng (kg)<input required type="number" min="20" max="500" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} className="input mt-1.5 h-11" placeholder="Ví dụ: 60" /></label>
      <label className="text-sm font-medium">Giới tính dùng để tính toán<select value={sex} onChange={(event) => setSex(event.target.value as 'female' | 'male')} className="input mt-1.5 h-11"><option value="female">Nữ</option><option value="male">Nam</option></select></label>
      <label className="text-sm font-medium">Mức độ vận động<select value={activity} onChange={(event) => setActivity(event.target.value as ActivityLevel)} className="input mt-1.5 h-11">{activities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-medium">Mục tiêu<select value={goal} onChange={(event) => setGoal(event.target.value as NutritionGoal)} className="input mt-1.5 h-11">{goals.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-medium sm:col-span-2">Dị ứng (cách nhau bằng dấu phẩy)<input value={allergies} onChange={(event) => setAllergies(event.target.value)} className="input mt-1.5 h-11" placeholder="Ví dụ: đậu phộng, tôm" /></label>
      <label className="text-sm font-medium sm:col-span-2">Nguyên liệu muốn tránh (cách nhau bằng dấu phẩy)<input value={avoid} onChange={(event) => setAvoid(event.target.value)} className="input mt-1.5 h-11" placeholder="Ví dụ: hành, ớt" /></label>
      {error && <p role="alert" className="rounded-xl bg-accent-soft p-3 text-sm text-accent sm:col-span-2">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2"><p className="max-w-lg text-xs leading-5 text-muted">Lọc dị ứng dựa trên chuỗi nguyên liệu trong dữ liệu món ăn, không bảo đảm an toàn tuyệt đối hoặc tránh nhiễm chéo.</p><button type="submit" disabled={loading} className="btn-primary h-12">{loading ? <><LoaderCircleIcon className="h-4 w-4 animate-spin" />Đang tạo thực đơn…</> : 'Tạo thực đơn thử'}</button></div>
    </form>

    {plan && <section className="space-y-4" aria-live="polite">
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="text-sm text-muted">Kết quả thử nghiệm · chưa lưu</p><h2 className="mt-1 text-2xl font-semibold">Thực đơn trong ngày</h2></div><div className="text-right"><p className="text-2xl font-semibold">{fmt(plan.total_calories)} kcal</p><p className="text-xs text-muted">Mục tiêu {fmt(plan.target_calories)} kcal</p></div></div>
      <div className="grid gap-3 sm:grid-cols-3">{plan.meals.map((meal) => <article key={`${meal.meal_type}-${meal.position}`} className="card overflow-hidden"><div className="p-5"><p className="text-xs font-semibold uppercase tracking-wide text-brand">{mealNames[meal.meal_type] ?? meal.meal_type}</p><h3 className="mt-2 text-lg font-semibold">{meal.name}</h3><p className="mt-2 text-sm text-muted">{fmt(meal.calories)} kcal · {fmt(meal.serving_grams, 0)} g</p><p className="mt-1 text-xs text-muted">Protein {fmt(meal.protein, 1)} g · Carb {fmt(meal.carb, 1)} g · Fat {fmt(meal.fat, 1)} g</p>{meal.ingredients && <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted">{meal.ingredients}</p>}</div></article>)}</div>
      {plan.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>)}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5"><p className="text-sm text-muted">Muốn lưu hồ sơ và các thực đơn để xem lại sau?</p><Link to="/register" className="btn-primary h-11"><UserPlusIcon className="h-4 w-4" />Tạo tài khoản miễn phí</Link></div>
    </section>}
  </div>;
}
