import React, { useEffect, useState } from 'react';
import { ActivityIcon, ArrowRightIcon, CalendarDaysIcon, FlameIcon, LeafIcon, SparklesIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { mealPlanApi } from '../api/mealPlanApi';
import { nutritionApi } from '../api/nutritionApi';
import { ApiError, toApiError } from '../api/errors';
import { LoadingState } from '../components/LoadingState';
import { ProfileRequired } from '../components/ProfileRequired';
import { useAuth } from '../contexts/AuthContext';
import { DailyMealPlan, NutritionCalculation } from '../types/nutrition';
import { formatLongDate, todayISO } from '../utils/date';
import { fmt } from '../utils/format';

export function Dashboard() {
  const { user } = useAuth();
  const today = todayISO();
  const profile = user?.profile;
  const ready = Boolean(profile?.date_of_birth && profile.height_cm && profile.weight_kg &&
    profile.sex_for_calculation && profile.activity_level && profile.goal);
  const [calculation, setCalculation] = useState<NutritionCalculation | null>(null);
  const [plan, setPlan] = useState<DailyMealPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    if (!ready) {
      setPlan(null);
      setCalculation(null);
      setLoading(false);
      return () => { active = false; };
    }
    Promise.all([nutritionApi.calculate(), mealPlanApi.getPlans(today)])
      .then(([result, plans]) => {
        if (!active) return;
        setCalculation(result);
        setPlan(plans[plans.length - 1] ?? null);
      })
      .catch((cause) => { if (active) setError(toApiError(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ready, today, profile?.updated_at]);

  if (!user) return <LoadingState label="Đang tải tài khoản..." />;
  const name = user.username ?? user.email ?? 'bạn';

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm capitalize text-muted">{formatLongDate(today)}</p>
          <h1 className="mt-1 text-3xl font-semibold">Xin chào, {name}</h1>
          <p className="mt-2 text-sm text-muted">Theo dõi dinh dưỡng và kế hoạch hôm nay của bạn.</p>
        </div>
        <Link to="/meal-plan" className="btn-secondary"><CalendarDaysIcon className="h-4 w-4" />Xem lịch thực đơn</Link>
      </header>

      {!ready ? <ProfileRequired /> : loading ? <LoadingState label="Đang tải dữ liệu dinh dưỡng..." /> : error ? (
        <section className="card p-5" role="alert">
          <p className="font-medium">Chưa tải được dữ liệu</p>
          <p className="mt-1 text-sm text-muted">{error.message}</p>
          <button className="btn-secondary mt-4" onClick={() => window.location.reload()}>Thử lại</button>
        </section>
      ) : (
        <>
          {calculation && (
            <section className="grid gap-4 md:grid-cols-3" aria-label="Chỉ số dinh dưỡng">
              <MetricCard icon={<FlameIcon className="h-5 w-5" />} label="Calo mục tiêu tham khảo" value={`${fmt(calculation.target_calories)} kcal`} detail="Mức ăn ước tính theo mục tiêu" />
              <MetricCard icon={<ActivityIcon className="h-5 w-5" />} label="TDEE" value={`${fmt(calculation.tdee_kcal)} kcal`} detail="Nhu cầu duy trì ước tính" />
              <MetricCard icon={<LeafIcon className="h-5 w-5" />} label="BMI" value={calculation.bmi.toFixed(1)} detail="Chỉ số sàng lọc, không phải chẩn đoán" />
            </section>
          )}

          {calculation?.warnings.map((warning) => <p key={warning} className="rounded-xl bg-accent-soft p-4 text-sm text-accent">{warning}</p>)}

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5 sm:p-6">
              <div>
                <p className="text-sm text-muted">Thực đơn trong ngày</p>
                <h2 className="mt-1 text-xl font-semibold">{plan ? `${fmt(plan.total_calories)} kcal` : 'Chưa có kế hoạch'}</h2>
              </div>
              <Link to="/meal-plan" className="btn-primary"><SparklesIcon className="h-4 w-4" />{plan ? 'Mở thực đơn' : 'Tạo thực đơn'}<ArrowRightIcon className="h-4 w-4" /></Link>
            </div>
            {plan ? (
              <div className="grid gap-px bg-line sm:grid-cols-3">
                {(['breakfast', 'lunch', 'dinner'] as const).map((meal) => {
                  const dish = plan.meals.find((item) => item.meal_type === meal);
                  const label = meal === 'breakfast' ? 'Bữa sáng' : meal === 'lunch' ? 'Bữa trưa' : 'Bữa tối';
                  return (
                    <article key={meal} className="bg-surface p-5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
                      <p className="mt-2 font-medium">{dish?.name ?? 'Chưa có món'}</p>
                      {dish && <p className="mt-1 text-sm text-muted">{fmt(dish.calories)} kcal · {fmt(dish.serving_grams)} g</p>}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="p-5 text-sm leading-6 text-muted">Tạo thực đơn 3 bữa từ dữ liệu món ăn hiện có. Kế hoạch sẽ được lưu để xem lại sau.</p>
            )}
          </section>

          <p className="text-xs leading-5 text-muted">BMR là năng lượng tiêu hao lúc nghỉ; TDEE là mức duy trì ước tính. BMI và các mức calo chỉ mang tính tham khảo.</p>
        </>
      )}
    </div>
  );
}

function MetricCard({icon, label, value, detail}: {icon: React.ReactNode; label: string; value: string; detail: string}) {
  return (
    <article className="card p-5">
      <div className="flex items-center gap-2 text-brand">{icon}<span className="text-sm font-medium text-muted">{label}</span></div>
      <p className="mt-4 text-3xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </article>
  );
}
