import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { ActivityIcon, ArrowRightIcon, BookOpenIcon, CalendarClockIcon, DropletsIcon, FlameIcon, HeartPulseIcon, LoaderCircleIcon, RotateCwIcon, SaveIcon, WheatIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { nutritionApi } from '../api/nutritionApi';
import { mealPlanApi } from '../api/mealPlanApi';
import { toApiError } from '../api/errors';
import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../contexts/AuthContext';
import { ActivityLevel, NutritionCalculation, NutritionGoal, NutritionHistoryItem, ProfileUpdate, UserProfile } from '../types/nutrition';
import { userApi } from '../api/userApi';
import { fmt } from '../utils/format';
import { clearGuestDishSelection, getGuestDishSelection } from '../utils/guestExperience';

type Form = {full_name: string; date_of_birth: string; height_cm: string; weight_kg: string; sex_for_calculation: 'male' | 'female'; activity_level: ActivityLevel; goal: NutritionGoal};
const activityOptions: {value: ActivityLevel; label: string}[] = [
  {value: 'sedentary', label: 'Ít vận động'}, {value: 'light', label: 'Vận động nhẹ'},
  {value: 'moderate', label: 'Vận động vừa'}, {value: 'active', label: 'Vận động nhiều'},
  {value: 'very_active', label: 'Vận động rất nhiều'}
];
const goalOptions: {value: NutritionGoal; label: string}[] = [
  {value: 'lose_weight', label: 'Giảm cân'}, {value: 'maintain_weight', label: 'Duy trì cân nặng'},
  {value: 'gain_weight', label: 'Tăng cân'}, {value: 'gain_muscle', label: 'Tăng cơ'}
];
const emptyForm: Form = {full_name: '', date_of_birth: '', height_cm: '', weight_kg: '', sex_for_calculation: 'female', activity_level: 'light', goal: 'maintain_weight'};
const splitDefaults = {breakfast: 25, lunch: 40, dinner: 35};

function formFromProfile(profile?: Partial<UserProfile> | null): Form {
  return {
    full_name: profile?.full_name ?? '',
    date_of_birth: profile?.date_of_birth ?? '', height_cm: profile?.height_cm != null ? (profile.height_cm / 100).toString() : '',
    weight_kg: profile?.weight_kg?.toString() ?? '', sex_for_calculation: profile?.sex_for_calculation ?? 'female',
    activity_level: profile?.activity_level ?? 'light', goal: profile?.goal ?? 'maintain_weight'
  };
}

function payloadFromForm(form: Form): ProfileUpdate {
  return {full_name: form.full_name.trim() || null, date_of_birth: form.date_of_birth || null, height_cm: form.height_cm ? Number(form.height_cm) * 100 : null,
    weight_kg: form.weight_kg ? Number(form.weight_kg) : null, sex_for_calculation: form.sex_for_calculation,
    activity_level: form.activity_level, goal: form.goal};
}

function readGuestProfile(): ProfileUpdate | null {
  try { return (JSON.parse(sessionStorage.getItem('nutriai.guest-trial') ?? '{}') as {profile?: ProfileUpdate}).profile ?? null; }
  catch { return null; }
}

export function Analysis() {
  const { user, isGuest, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(() => {
    if (!isGuest) return emptyForm;
    try {
      const profile = (JSON.parse(sessionStorage.getItem('nutriai.guest-trial') ?? '{}') as {profile?: ProfileUpdate}).profile;
      return profile ? formFromProfile(profile) : emptyForm;
    } catch { return emptyForm; }
  });
  const [result, setResult] = useState<NutritionCalculation | null>(null);
  const [history, setHistory] = useState<NutritionHistoryItem[]>([]);
  const [split, setSplit] = useState(splitDefaults);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) setForm(formFromProfile(user.profile));
  }, [user?.profile]);

  useEffect(() => {
    let active = true;
    if (user) nutritionApi.history().then((items) => { if (active) setHistory(items); }).catch(() => undefined);
    const profile = user?.profile ? payloadFromForm(formFromProfile(user.profile)) : isGuest ? readGuestProfile() : null;
    if (!profile?.date_of_birth || !profile.height_cm || !profile.weight_kg ||
        !profile.sex_for_calculation || !profile.activity_level || !profile.goal) {
      setLoading(false);
      return () => { active = false; };
    }
    (isGuest ? nutritionApi.calculatePreview(profile) : nutritionApi.calculate()).then((value) => { if (active) setResult(value); })
      .catch((cause) => { if (active) setError(toApiError(cause).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.profile, isGuest]);

  const macroShares = useMemo(() => {
    if (!result?.target_calories) return {protein: 0, carb: 0, fat: 0};
    return {protein: result.protein_g * 4 / result.target_calories * 100,
      carb: result.carb_g * 4 / result.target_calories * 100,
      fat: result.fat_g * 9 / result.target_calories * 100};
  }, [result]);
  const splitTotal = split.breakfast + split.lunch + split.dinner;

  const recalculate = async (event?: FormEvent) => {
    event?.preventDefault();
    setCalculating(true); setError('');
    try {
      const payload = isGuest ? {...readGuestProfile(), ...payloadFromForm(form)} : payloadFromForm(form);
      const value = isGuest ? await nutritionApi.calculatePreview(payload) : await nutritionApi.calculate(payload);
      setResult(value);
      if (isGuest) {
        const previous = JSON.parse(sessionStorage.getItem('nutriai.guest-trial') ?? '{}');
        sessionStorage.setItem('nutriai.guest-trial', JSON.stringify({...previous, profile: payload}));
      }
    }
    catch (cause) { setError(toApiError(cause).message); }
    finally { setCalculating(false); }
  };

  const saveResult = async () => {
    setSaving(true); setError('');
    try {
      await userApi.updateProfile(payloadFromForm(form));
      await refreshUser();
      const saved = await nutritionApi.save();
      setResult(saved);
      setHistory((current) => [saved, ...current.filter((item) => item.id !== saved.id)].slice(0, 30));
      toast.success('Đã lưu hồ sơ và kết quả dinh dưỡng vào lịch sử.');
    } catch (cause) { setError(toApiError(cause).message); }
    finally { setSaving(false); }
  };

  const saveGuestProfile = () => {
    setError('');
    const profile = {...readGuestProfile(), ...payloadFromForm(form)};
    if (!profile.date_of_birth || !profile.height_cm || !profile.weight_kg || !profile.sex_for_calculation || !profile.activity_level || !profile.goal) {
      setError('Hãy nhập đủ ngày sinh, chiều cao, cân nặng và thông tin hồ sơ trước khi lưu.');
      return;
    }
    try {
      const previous = JSON.parse(sessionStorage.getItem('nutriai.guest-trial') ?? '{}');
      sessionStorage.setItem('nutriai.guest-trial', JSON.stringify({...previous, profile}));
      toast.success('Đã lưu hồ sơ thử trong phiên này. Hồ sơ không được lưu vào tài khoản.');
    } catch {
      setError('Không thể lưu tạm hồ sơ trên thiết bị này.');
    }
  };

  const createMealPlan = async () => {
    setSaving(true); setError('');
    try {
      if (isGuest) {
        const profile = {...readGuestProfile(), ...payloadFromForm(form)};
        if (!profile.date_of_birth || !profile.height_cm || !profile.weight_kg || !profile.sex_for_calculation || !profile.activity_level || !profile.goal) {
          setError('Hãy hoàn thiện ngày sinh, chiều cao, cân nặng và các thông tin hồ sơ để tính thực đơn thử.');
          return;
        }
        if (!result) setResult(await nutritionApi.calculatePreview(profile));
        const selection = getGuestDishSelection();
        const preview = await mealPlanApi.previewGuest(profile, {
          meal_split: {breakfast: split.breakfast / 100, lunch: split.lunch / 100, dinner: split.dinner / 100},
          ...(selection?.plan_date ? {plan_date: selection.plan_date} : {}),
          ...(selection ? {selected_dish_id: selection.dish_id, selected_meal_type: selection.meal_type} : {}),
          ...(selection?.meal_type === 'snack' ? {side_meals: 1} : {}),
        });
        clearGuestDishSelection();
        const previous = JSON.parse(sessionStorage.getItem('nutriai.guest-trial') ?? '{}') as {plans?: import('../types/nutrition').DailyMealPlan[]; plan?: import('../types/nutrition').DailyMealPlan};
        const versions = previous.plans ?? (previous.plan ? [previous.plan] : []);
        const nextId = Date.now();
        const planDate = selection?.plan_date ?? preview.plan_date;
        const dateVersions = versions.filter((item) => item.plan_date === planDate);
        const temporaryPlan = {...preview, ...(planDate ? {plan_date: planDate} : {}), id: nextId, version: dateVersions.reduce((max, item) => Math.max(max, item.version), 0) + 1,
          meals: preview.meals.map((meal, index) => ({...meal, id: nextId * 100 + index}))};
        const updatedPlans = [...versions.filter((item) => item.id !== temporaryPlan.id), temporaryPlan];
        sessionStorage.setItem('nutriai.guest-trial', JSON.stringify({...previous, profile, plan: temporaryPlan, plans: updatedPlans}));
        navigate(`/meal-plan${planDate ? `?date=${encodeURIComponent(planDate)}` : ''}`);
        return;
      }
      await userApi.updateProfile(payloadFromForm(form));
      await refreshUser();
      navigate('/meal-plan', {state: {meal_split: {breakfast: split.breakfast / 100, lunch: split.lunch / 100, dinner: split.dinner / 100}}});
    } catch (cause) { setError(toApiError(cause).message); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingState label="Đang tính nhu cầu dinh dưỡng..." />;
  const setField = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({...current, [key]: value}));
  };
  const labelFor = (items: {value: string; label: string}[], value?: string) => items.find((item) => item.value === value)?.label ?? 'Chưa thiết lập';
  const bmiCategory = result ? result.bmi < 18.5 ? 'Thiếu cân' : result.bmi < 25 ? 'Bình thường' : result.bmi < 30 ? 'Thừa cân' : 'Béo phì' : '';

  return <div className="space-y-7">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-sm font-medium text-brand">Nutrition Engine</p><h1 className="mt-1 text-3xl font-semibold">Nhu cầu dinh dưỡng cá nhân</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{isGuest ? 'Dùng hồ sơ thử để tính toán các chỉ số và tạo thực đơn; không lưu lịch sử.' : 'Phân tích thể trạng và tính toán nhu cầu phù hợp với hồ sơ, mức vận động và mục tiêu của bạn.'}</p></div>
      {(!isGuest || Boolean(readGuestProfile() || (form.date_of_birth && form.height_cm && form.weight_kg))) && <button type="button" onClick={createMealPlan} disabled={saving || (!isGuest && !result) || splitTotal !== 100} title={splitTotal !== 100 ? 'Tỷ lệ ba bữa cần bằng 100%.' : undefined} className="btn-primary h-11">{saving ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : null}{isGuest ? 'Tính và xem thực đơn' : 'Tạo thực đơn'} <ArrowRightIcon className="h-4 w-4" /></button>}
    </header>

    <form onSubmit={recalculate} className="card space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-semibold">Thông tin khách hàng</h2><p className="mt-1 text-sm text-muted">{form.full_name || user?.username || user?.email || 'Hồ sơ của bạn'} · Cập nhật để tính lại chỉ số.</p></div>
        {result && <span className="inline-flex items-center gap-1.5 text-xs text-muted"><CalendarClockIcon className="h-4 w-4" />Tính gần nhất {new Date(result.calculated_at).toLocaleString('vi-VN')}</span>}</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Họ và tên"><input className="input" type="text" maxLength={160} value={form.full_name} onChange={(e) => setField('full_name', e.target.value)} /></Field>
        <Field label="Ngày sinh"><input className="input" type="date" value={form.date_of_birth} onChange={(e) => setField('date_of_birth', e.target.value)} /></Field>
        <Field label="Giới tính dùng để ước tính BMR"><select className="input" value={form.sex_for_calculation} onChange={(e) => setField('sex_for_calculation', e.target.value as Form['sex_for_calculation'])}><option value="female">Nữ</option><option value="male">Nam</option></select></Field>
        <Field label="Chiều cao (m)"><input className="input" type="number" min="1" max="2.5" step="0.01" placeholder="Ví dụ: 1.65" value={form.height_cm} onChange={(e) => setField('height_cm', e.target.value)} /></Field>
        <Field label="Cân nặng (kg)"><input className="input" type="number" min="20" max="500" step="0.1" value={form.weight_kg} onChange={(e) => setField('weight_kg', e.target.value)} /></Field>
        <Field label="Mức độ vận động"><select className="input" value={form.activity_level} onChange={(e) => setField('activity_level', e.target.value as ActivityLevel)}>{activityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Mục tiêu dinh dưỡng"><select className="input" value={form.goal} onChange={(e) => setField('goal', e.target.value as NutritionGoal)}>{goalOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
      </div>
      <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
        <button type="submit" className="btn-secondary h-11" disabled={calculating}>{calculating ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <RotateCwIcon className="h-4 w-4" />}Tính toán lại</button>
        {isGuest && <button type="button" className="btn-primary h-11" disabled={saving || calculating} onClick={saveGuestProfile}><SaveIcon className="h-4 w-4" />Lưu hồ sơ thử</button>}
        {!isGuest && <button type="button" className="btn-primary h-11" disabled={saving || calculating} onClick={saveResult}>{saving ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}Lưu hồ sơ & kết quả</button>}
        {isGuest ? <p className="text-xs text-muted">Chế độ khách: thông tin và phép tính chỉ tồn tại tạm trong phiên này.</p> : <details className="relative sm:ml-auto"><summary className="btn-ghost h-11 cursor-pointer list-none"><BookOpenIcon className="h-4 w-4" />Xem lịch sử ({history.length})</summary>
          <div className="absolute right-0 z-20 mt-2 max-h-72 w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-line bg-white p-2 shadow-xl">
            {history.length ? history.map((item) => <button type="button" key={item.id} onClick={() => setResult(item)} className="flex w-full items-center justify-between gap-3 rounded-lg p-3 text-left hover:bg-surface"><span><span className="block text-sm font-medium">{fmt(item.target_calories)} kcal/ngày</span><span className="text-xs text-muted">{new Date(item.calculated_at).toLocaleString('vi-VN')}</span></span><span className="text-xs text-brand">Xem</span></button>) : <p className="p-3 text-sm text-muted">Chưa lưu lần tính nào.</p>}
          </div>
        </details>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-accent">{error}</p>}
    </form>

    {!result ? <section className="card p-8 text-center"><HeartPulseIcon className="mx-auto h-8 w-8 text-brand" /><h2 className="mt-3 text-lg font-semibold">Hoàn thiện hồ sơ để bắt đầu</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Nhập ngày sinh, chiều cao, cân nặng, giới tính, mức vận động và mục tiêu ở trên. Kết quả sẽ được tính từ thông tin cá nhân của bạn.</p></section> : <>
      {isGuest && <section className="card p-5"><h2 className="font-semibold">Dữ liệu hồ sơ thử</h2><p className="mt-1 text-sm text-muted">Bạn có thể cập nhật hồ sơ đầy đủ hơn, gồm dị ứng, nguyên liệu tránh và sở thích món ăn. Thông tin chỉ giữ trong phiên này.</p><Link to="/profile" className="mt-3 inline-flex text-sm font-semibold text-brand hover:underline">Mở hồ sơ thử nghiệm →</Link></section>}
      <section>
        <div className="mb-3 flex items-end justify-between"><div><h2 className="text-xl font-semibold">Phân tích thể trạng</h2><p className="mt-1 text-sm text-muted">Kết quả ước tính theo hồ sơ hiện tại.</p></div><Link to="/profile" className="text-sm font-medium text-brand hover:underline">{isGuest ? 'Sửa hồ sơ thử' : 'Hồ sơ đầy đủ'}</Link></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={<HeartPulseIcon className="h-5 w-5" />} label="BMI" value={fmt(result.bmi, 1)} unit={bmiCategory} hint="Chỉ số sàng lọc, không phải chẩn đoán." />
          <Stat icon={<ActivityIcon className="h-5 w-5" />} label="BMR" value={fmt(result.bmr_kcal)} unit="kcal lúc nghỉ" hint="Năng lượng cơ bản ước tính mỗi ngày." />
          <Stat icon={<ActivityIcon className="h-5 w-5" />} label="TDEE" value={fmt(result.tdee_kcal)} unit="kcal/ngày" hint={`BMR × hệ số hoạt động ${result.formula.activity_factor}.`} />
          <Stat icon={<FlameIcon className="h-5 w-5" />} label="Mục tiêu Calories" value={fmt(result.target_calories)} unit="kcal/ngày" hint={`${labelFor(goalOptions, result.goal)} · điều chỉnh ${(result.formula.goal_adjustment_fraction * 100).toFixed(0)}% TDEE`} highlight />
        </div>
      </section>

      <section>
        <div className="mb-3"><h2 className="text-xl font-semibold">Nhu cầu dinh dưỡng hằng ngày</h2><p className="mt-1 text-sm text-muted">Cá nhân hóa theo cân nặng, mục tiêu và tổng năng lượng.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MacroCard icon={<FlameIcon />} label="Calories" value={result.target_calories} unit="kcal/ngày" share={100} color="text-orange-600" note="Mục tiêu năng lượng" />
          <MacroCard icon={<ActivityIcon />} label="Protein" value={result.protein_g} unit="g/ngày" share={macroShares.protein} color="text-emerald-700" note={`${fmt(result.formula.protein_factor_g_per_kg, 1)} g/kg cân nặng`} />
          <MacroCard icon={<WheatIcon />} label="Carbohydrate" value={result.carb_g} unit="g/ngày" share={macroShares.carb} color="text-amber-700" note="Năng lượng còn lại sau Protein và Fat" />
          <MacroCard icon={<DropletsIcon />} label="Fat" value={result.fat_g} unit="g/ngày" share={macroShares.fat} color="text-sky-700" note={`${fmt(result.formula.fat_energy_fraction * 100, 0)}% năng lượng mục tiêu`} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="card p-5 sm:p-6"><h2 className="text-lg font-semibold">Tỷ lệ năng lượng đa lượng</h2><p className="mt-1 text-sm text-muted">Tỷ trọng Calories từ Protein, Carb và Fat.</p>
          <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row">
            <div role="img" aria-label={`Protein ${fmt(macroShares.protein, 0)}%, Carb ${fmt(macroShares.carb, 0)}%, Fat ${fmt(macroShares.fat, 0)}%`} className="relative h-44 w-44 shrink-0 rounded-full" style={{background: `conic-gradient(#1F5136 0 ${macroShares.protein}%, #C98F12 ${macroShares.protein}% ${macroShares.protein + macroShares.carb}%, #3F7CAC ${macroShares.protein + macroShares.carb}% 100%)`}}>
              <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white"><span className="text-xs text-muted">Tổng năng lượng</span><strong className="mt-1 text-xl">{fmt(result.target_calories)}</strong><span className="text-xs text-muted">kcal</span></div>
            </div>
            <div className="w-full space-y-3">{[
              {name: 'Protein', grams: result.protein_g, share: macroShares.protein, color: 'bg-emerald-700'},
              {name: 'Carbohydrate', grams: result.carb_g, share: macroShares.carb, color: 'bg-amber-600'},
              {name: 'Fat', grams: result.fat_g, share: macroShares.fat, color: 'bg-sky-700'}
            ].map((item) => <div key={item.name} className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><i className={`h-2.5 w-2.5 rounded-full ${item.color}`} />{item.name}</span><span className="font-medium tabular-nums">{fmt(item.grams, 1)} g · {fmt(item.share, 1)}%</span></div>)}</div>
          </div>
        </section>

        <section className="card p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-lg font-semibold">Phân bổ theo bữa</h2><p className="mt-1 text-sm text-muted">Điều chỉnh tỷ lệ; tổng ba bữa cần bằng 100%.</p></div><span className={`text-sm font-semibold ${splitTotal === 100 ? 'text-brand' : 'text-accent'}`}>Tổng {splitTotal}%</span></div>
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-line text-xs text-muted"><th className="py-2 font-medium">Bữa ăn</th><th className="py-2 font-medium">Tỷ lệ</th><th className="py-2 font-medium">Calories</th><th className="py-2 font-medium">Protein</th><th className="py-2 font-medium">Carb</th><th className="py-2 font-medium">Fat</th></tr></thead><tbody>
            {([['breakfast', 'Bữa sáng'], ['lunch', 'Bữa trưa'], ['dinner', 'Bữa tối']] as const).map(([key, label]) => <tr key={key} className="border-b border-line"><td className="py-3 font-medium">{label}</td><td className="py-2"><label className="flex items-center gap-1"><input aria-label={`Tỷ lệ ${label}`} className="input h-9 w-20" type="number" min="0" max="100" value={split[key]} onChange={(e) => setSplit((current) => ({...current, [key]: Number(e.target.value)}))} /><span>%</span></label></td><td className="py-3">{fmt(result.target_calories * split[key] / 100)} kcal</td><td className="py-3">{fmt(result.protein_g * split[key] / 100, 1)} g</td><td className="py-3">{fmt(result.carb_g * split[key] / 100, 1)} g</td><td className="py-3">{fmt(result.fat_g * split[key] / 100, 1)} g</td></tr>)}
            <tr className="font-semibold"><td className="py-3">Tổng ngày</td><td className="py-3">{splitTotal}%</td><td className="py-3">{fmt(result.target_calories * splitTotal / 100)} kcal</td><td className="py-3">{fmt(result.protein_g * splitTotal / 100, 1)} g</td><td className="py-3">{fmt(result.carb_g * splitTotal / 100, 1)} g</td><td className="py-3">{fmt(result.fat_g * splitTotal / 100, 1)} g</td></tr>
          </tbody></table></div>
          {splitTotal !== 100 && <p className="mt-3 text-xs text-accent">Hãy điều chỉnh tỷ lệ để tổng phân bổ bằng 100%.</p>}
        </section>
      </div>
    </>}
  </div>;
}

function Field({label, children}: {label: string; children: ReactNode}) { return <label className="block space-y-1.5 text-sm font-medium">{label}{children}</label>; }
function Stat({icon, label, value, unit, hint, highlight = false}: {icon: ReactNode; label: string; value: string; unit: string; hint: string; highlight?: boolean}) {
  return <article className={`card p-4 sm:p-5 ${highlight ? 'border-brand/30 bg-brand-soft/40' : ''}`}><div className="flex items-center gap-2 text-brand">{icon}<span className="text-sm font-medium text-muted">{label}</span></div><p className="mt-4 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-0.5 text-sm font-medium text-ink">{unit}</p><p className="mt-2 text-xs leading-5 text-muted">{hint}</p></article>;
}
function MacroCard({icon, label, value, unit, share, color, note}: {icon: ReactNode; label: string; value: number; unit: string; share: number; color: string; note: string}) {
  return <article className="card p-5"><div className={`flex items-center justify-between ${color}`}><span className="text-sm font-semibold">{label}</span>{icon}</div><p className="mt-4 text-3xl font-semibold tabular-nums">{fmt(value, 1)}</p><p className="text-sm text-muted">{unit}</p><div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs"><span className="text-muted">Năng lượng</span><strong>{fmt(share, 1)}%</strong></div><p className="mt-2 text-xs leading-5 text-muted">{note}</p></article>;
}
