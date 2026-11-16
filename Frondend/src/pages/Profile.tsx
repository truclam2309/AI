import React, { useEffect, useState } from 'react';
import { LoaderCircleIcon, SaveIcon } from 'lucide-react';
import { toast } from 'sonner';
import { nutritionApi } from '../api/nutritionApi';
import { userApi } from '../api/userApi';
import { toApiError } from '../api/errors';
import { LoadingState } from '../components/LoadingState';
import { TextField } from '../components/TextField';
import { useAuth } from '../contexts/AuthContext';
import { ActivityLevel, NutritionCalculation, NutritionGoal, ProfileUpdate, UserProfile } from '../types/nutrition';
import { fmt } from '../utils/format';

type FormState = {
  full_name: string;
  date_of_birth: string;
  height_cm: string;
  weight_kg: string;
  sex_for_calculation: 'male' | 'female';
  activity_level: ActivityLevel;
  goal: NutritionGoal;
  target_weight_kg: string;
  allergies: string;
  avoid_ingredients: string;
  disliked_dishes: string;
  favorite_dishes: string;
};

const emptyForm: FormState = {
  full_name: '', date_of_birth: '', height_cm: '', weight_kg: '', sex_for_calculation: 'female',
  activity_level: 'light', goal: 'maintain_weight', target_weight_kg: '',
  allergies: '', avoid_ingredients: '', disliked_dishes: '', favorite_dishes: ''
};

const activities: {value: ActivityLevel; label: string}[] = [
  { value: 'sedentary', label: 'Ít vận động' },
  { value: 'light', label: 'Vận động nhẹ (1–3 buổi/tuần)' },
  { value: 'moderate', label: 'Vận động vừa (3–5 buổi/tuần)' },
  { value: 'active', label: 'Năng động (6–7 buổi/tuần)' },
  { value: 'very_active', label: 'Rất năng động' }
];

const goals: {value: NutritionGoal; label: string}[] = [
  { value: 'lose_weight', label: 'Giảm cân' },
  { value: 'gain_weight', label: 'Tăng cân' },
  { value: 'gain_muscle', label: 'Tăng cơ' },
  { value: 'maintain_weight', label: 'Duy trì cân nặng' }
];

const listText = (values: string[]) => values.join(', ');
const parseList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);

function toForm(profile?: Partial<UserProfile> | null): FormState {
  if (!profile) return emptyForm;
  return {
    full_name: profile.full_name ?? '',
    date_of_birth: profile.date_of_birth ?? '',
    height_cm: profile.height_cm != null ? (profile.height_cm / 100).toString() : '',
    weight_kg: profile.weight_kg?.toString() ?? '',
    sex_for_calculation: profile.sex_for_calculation ?? 'female',
    activity_level: profile.activity_level ?? 'light',
    goal: profile.goal ?? 'maintain_weight',
    target_weight_kg: profile.target_weight_kg?.toString() ?? '',
    allergies: listText(profile.allergies ?? []),
    avoid_ingredients: listText(profile.avoid_ingredients ?? []),
    disliked_dishes: listText(profile.disliked_dishes ?? []),
    favorite_dishes: listText(profile.favorite_dishes ?? [])
  };
}

function makePayload(form: FormState): ProfileUpdate {
  const numeric = (value: string) => value.trim() ? Number(value) : null;
  return {
    full_name: form.full_name.trim() || null,
    date_of_birth: form.date_of_birth || null,
    height_cm: numeric(form.height_cm) !== null ? numeric(form.height_cm)! * 100 : null,
    weight_kg: numeric(form.weight_kg),
    sex_for_calculation: form.sex_for_calculation,
    activity_level: form.activity_level,
    goal: form.goal,
    target_weight_kg: numeric(form.target_weight_kg),
    allergies: parseList(form.allergies),
    avoid_ingredients: parseList(form.avoid_ingredients),
    disliked_dishes: parseList(form.disliked_dishes),
    favorite_dishes: parseList(form.favorite_dishes)
  };
}

export function Profile() {
  const { user, refreshUser } = useAuth();
  const [form, setForm] = useState<FormState>(() => toForm(user?.profile));
  const [calculation, setCalculation] = useState<NutritionCalculation | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(toForm(user?.profile)), [user?.profile]);

  useEffect(() => {
    const profile = user?.profile;
    if (!profile?.date_of_birth || !profile.height_cm || !profile.weight_kg ||
        !profile.sex_for_calculation || !profile.activity_level || !profile.goal) {
      setCalculation(null);
      setCalculating(false);
      return;
    }
    setCalculating(true);
    nutritionApi.calculate().then(setCalculation).catch(() => setCalculation(null)).finally(() => setCalculating(false));
  }, [user?.profile]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await userApi.updateProfile(makePayload(form));
      await refreshUser();
      try {
        setCalculation(await nutritionApi.calculate());
      } catch {
        setCalculation(null);
      }
      toast.success('Đã lưu hồ sơ sức khỏe.');
    } catch (error) {
      toast.error(toApiError(error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <LoadingState label="Đang tải hồ sơ..." />;

  const hasCalculation = Boolean(calculation);
  const fieldClass = 'input h-11';
  const profile = user.profile;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted">Hồ sơ cá nhân</p>
        <h1 className="mt-1 text-3xl font-semibold">Sức khỏe & mục tiêu</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Thông tin này giúp tính BMI, BMR và nhu cầu calo tham khảo. Bạn có thể bổ sung sở thích sau.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={submit} className="card space-y-6 p-5 sm:p-7">
          <section>
            <h2 className="text-lg font-semibold">Thông tin cơ thể</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField label="Họ và tên" name="full_name" maxLength={160} value={form.full_name}
                onChange={(event) => set('full_name', event.target.value)} />
              <TextField label="Ngày sinh" name="date_of_birth" type="date" value={form.date_of_birth}
                onChange={(event) => set('date_of_birth', event.target.value)} />
              <label className="block text-sm font-medium">
                Giới tính dùng để ước tính BMR
                <select className={`${fieldClass} mt-1.5`} value={form.sex_for_calculation}
                  onChange={(event) => set('sex_for_calculation', event.target.value as FormState['sex_for_calculation'])}>
                  <option value="female">Nữ</option><option value="male">Nam</option>
                </select>
              </label>
              <TextField label="Chiều cao" name="height_cm" type="number" min="1" max="2.5" step="0.01" placeholder="Ví dụ: 1.65" suffix="m"
                value={form.height_cm} onChange={(event) => set('height_cm', event.target.value)} />
              <TextField label="Cân nặng hiện tại" name="weight_kg" type="number" min="20" max="500" step="0.1" suffix="kg"
                value={form.weight_kg} onChange={(event) => set('weight_kg', event.target.value)} />
              <TextField label="Cân nặng mục tiêu (tùy chọn)" name="target_weight_kg" type="number" min="20" max="500" step="0.1" suffix="kg"
                value={form.target_weight_kg} onChange={(event) => set('target_weight_kg', event.target.value)} />
              <label className="block text-sm font-medium">
                Mức độ vận động
                <select className={`${fieldClass} mt-1.5`} value={form.activity_level}
                  onChange={(event) => set('activity_level', event.target.value as ActivityLevel)}>
                  {activities.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="border-t border-line pt-6">
            <h2 className="text-lg font-semibold">Mục tiêu dinh dưỡng</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {goals.map((goal) => (
                <label key={goal.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${form.goal === goal.value ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                  <input type="radio" name="goal" value={goal.value} checked={form.goal === goal.value}
                    onChange={() => set('goal', goal.value)} className="accent-brand" />
                  <span className="text-sm font-medium">{goal.label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="border-t border-line pt-6">
            <h2 className="text-lg font-semibold">Sở thích và thực phẩm cần tránh</h2>
            <p className="mt-1 text-sm text-muted">Nhập nhiều mục và ngăn cách bằng dấu phẩy. Ví dụ: tôm, đậu phộng.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField label="Thực phẩm gây dị ứng" name="allergies" placeholder="Ví dụ: tôm, đậu phộng"
                value={form.allergies} onChange={(event) => set('allergies', event.target.value)} />
              <TextField label="Nguyên liệu muốn tránh" name="avoid_ingredients" placeholder="Ví dụ: thịt bò"
                value={form.avoid_ingredients} onChange={(event) => set('avoid_ingredients', event.target.value)} />
              <TextField label="Món ăn không thích" name="disliked_dishes" placeholder="Ví dụ: canh chua"
                value={form.disliked_dishes} onChange={(event) => set('disliked_dishes', event.target.value)} />
              <TextField label="Món ăn yêu thích" name="favorite_dishes" placeholder="Ví dụ: cá hồi"
                value={form.favorite_dishes} onChange={(event) => set('favorite_dishes', event.target.value)} />
            </div>
          </section>

          <button type="submit" className="btn-primary h-11 w-full sm:w-auto" disabled={saving}>
            {saving ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
            Lưu hồ sơ
          </button>
        </form>

        <aside className="space-y-4">
          <section className="card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Nhu cầu ước tính</h2>
              {calculating && <LoaderCircleIcon className="h-4 w-4 animate-spin text-brand" />}
            </div>
            {hasCalculation && calculation ? (
              <>
                <p className="mt-5 text-sm text-muted">Mục tiêu calo tham khảo</p>
                <p className="text-4xl font-semibold tabular-nums">{fmt(calculation.target_calories)} <span className="text-base font-normal text-muted">kcal/ngày</span></p>
                <dl className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between"><dt className="text-muted">BMI</dt><dd className="font-medium">{calculation.bmi}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">BMR</dt><dd className="font-medium">{fmt(calculation.bmr_kcal)} kcal</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">TDEE</dt><dd className="font-medium">{fmt(calculation.tdee_kcal)} kcal</dd></div>
                </dl>
                {calculation.warnings.map((warning) => <p key={warning} className="mt-4 rounded-lg bg-accent-soft p-3 text-sm text-accent">{warning}</p>)}
              </>
            ) : (
              <p className="mt-4 text-sm leading-6 text-muted">{profile?.date_of_birth && profile.height_cm && profile.weight_kg ? 'Đang tải phép tính…' : 'Nhập ngày sinh, chiều cao, cân nặng và lưu hồ sơ để xem kết quả.'}</p>
            )}
          </section>
          <p className="px-1 text-xs leading-5 text-muted">Thông tin này là ước tính, không thay thế tư vấn y tế. Hệ thống hiện chỉ tính thực đơn tự động cho người trưởng thành.</p>
        </aside>
      </div>
    </div>
  );
}
