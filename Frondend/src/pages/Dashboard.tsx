import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ActivityIcon, ArrowRightIcon, CalendarDaysIcon, FlameIcon, HeartPulseIcon, LoaderCircleIcon, ScaleIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { mealPlanApi } from '../api/mealPlanApi';
import { nutritionApi } from '../api/nutritionApi';
import { toApiError } from '../api/errors';
import { LoadingState } from '../components/LoadingState';
import { ProfileRequired } from '../components/ProfileRequired';
import { Analysis } from './Analysis';
import { useAuth } from '../contexts/AuthContext';
import { DailyMealPlan, NutritionCalculation, ProfileUpdate, WeightLog } from '../types/nutrition';
import { weightProgressApi } from '../api/weightProgressApi';
import { formatLongDate, todayISO } from '../utils/date';
import { fmt } from '../utils/format';

type TrialData = {profile?: ProfileUpdate; plan?: DailyMealPlan; plans?: DailyMealPlan[]; weightLogs?: WeightLog[]};
type RangeDays = 30 | 90 | 180;
const trialKey = 'nutriai.guest-trial';

function readTrial(): TrialData {
  try { return JSON.parse(sessionStorage.getItem(trialKey) ?? '{}') as TrialData; }
  catch { return {}; }
}

function guestPlansForDay(day: string): DailyMealPlan[] {
  const trial = readTrial();
  const plans = [...(trial.plans ?? [])];
  if (trial.plan && !plans.some((item) => item.id === trial.plan?.id)) plans.push(trial.plan);
  return plans.filter((plan) => plan.plan_date === day);
}

function dateDaysAgo(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function shortDate(value: string): string {
  const [, month, day] = value.split('-');
  return `${Number(day)}/${Number(month)}`;
}

export function Dashboard() {
  const { user, isGuest } = useAuth();
  const today = todayISO();
  const [profile, setProfile] = useState<ProfileUpdate | null>(() => isGuest ? readTrial().profile ?? null : user?.profile ?? null);
  const ready = Boolean(profile?.date_of_birth && profile.height_cm && profile.weight_kg && profile.sex_for_calculation && profile.activity_level && profile.goal);
  const [calculation, setCalculation] = useState<NutritionCalculation | null>(null);
  const [plan, setPlan] = useState<DailyMealPlan | null>(null);
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState<RangeDays>(30);
  const [measuredOn, setMeasuredOn] = useState(today);
  const [weightInput, setWeightInput] = useState(() => String(profile?.weight_kg ?? ''));
  const [weightNote, setWeightNote] = useState('');
  const [savingWeight, setSavingWeight] = useState(false);
  const [weightError, setWeightError] = useState('');

  useEffect(() => {
    if (isGuest) {
      const trial = readTrial();
      setProfile(trial.profile ?? null);
      setWeightLogs(trial.weightLogs ?? []);
      setWeightInput(String(trial.weightLogs?.at(-1)?.weight_kg ?? trial.profile?.weight_kg ?? ''));
    } else if (user?.profile) {
      setProfile(user.profile);
    }
  }, [isGuest, user?.profile]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    if (!ready) {
      setPlan(null);
      setCalculation(null);
      if (!isGuest) setWeightLogs([]);
      setLoading(false);
      return () => { active = false; };
    }
    const data = isGuest
      ? Promise.all([nutritionApi.calculatePreview(profile ?? {}), Promise.resolve(guestPlansForDay(today)), Promise.resolve(readTrial().weightLogs ?? [])])
      : Promise.all([nutritionApi.calculate(), mealPlanApi.getPlans(today), weightProgressApi.list()]);
    data.then(([result, plans, logs]) => {
      if (!active) return;
      setCalculation(result);
      setPlan(plans[plans.length - 1] ?? null);
      setWeightLogs(logs);
    }).catch((cause) => { if (active) setError(toApiError(cause).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ready, today, profile?.date_of_birth, profile?.height_cm, profile?.weight_kg, profile?.sex_for_calculation, profile?.activity_level, profile?.goal, isGuest]);

  const visibleLogs = useMemo(() => {
    const start = dateDaysAgo(range);
    return weightLogs.filter((item) => item.measured_on >= start && item.measured_on <= today);
  }, [weightLogs, range, today]);
  const currentWeight = weightLogs.at(-1)?.weight_kg ?? profile?.weight_kg ?? null;
  const previousWeight = weightLogs.length > 1 ? weightLogs[weightLogs.length - 2].weight_kg : null;
  const sinceLast = currentWeight != null && previousWeight != null ? currentWeight - previousWeight : null;
  const rangeChange = visibleLogs.length > 1 ? visibleLogs[visibleLogs.length - 1].weight_kg - visibleLogs[0].weight_kg : null;
  const consumed = plan?.consumed_totals ?? {calories: 0, protein: 0, carb: 0, fat: 0};
  const name = user?.username ?? user?.email ?? 'bạn';

  const saveWeight = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const weight = Number(weightInput);
    if (!measuredOn || !Number.isFinite(weight) || weight <= 0 || weight > 500) {
      setWeightError('Nhập ngày và cân nặng hợp lệ để lưu.');
      return;
    }
    setSavingWeight(true);
    setWeightError('');
    try {
      let saved: WeightLog;
      if (isGuest) {
        const previous = readTrial();
        const next: WeightLog = {id: Date.now(), measured_on: measuredOn, weight_kg: weight, note: weightNote.trim() || null, created_at: new Date().toISOString()};
        const logs = [...(previous.weightLogs ?? []).filter((item) => item.measured_on !== measuredOn), next].sort((a, b) => a.measured_on.localeCompare(b.measured_on));
        sessionStorage.setItem(trialKey, JSON.stringify({...previous, weightLogs: logs}));
        saved = next;
        setWeightLogs(logs);
      } else {
        saved = await weightProgressApi.save({measured_on: measuredOn, weight_kg: weight, ...(weightNote.trim() ? {note: weightNote.trim()} : {})});
        setWeightLogs((current) => [...current.filter((item) => item.measured_on !== saved.measured_on), saved].sort((a, b) => a.measured_on.localeCompare(b.measured_on)));
      }
      setWeightInput(String(saved.weight_kg));
      setWeightNote('');
    } catch (cause) {
      setWeightError(toApiError(cause).message);
    } finally {
      setSavingWeight(false);
    }
  };

  return <div className="space-y-7">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm capitalize text-muted">{formatLongDate(today)}</p>
        <h1 className="mt-1 text-3xl font-semibold">Xin chào, {isGuest ? 'bạn' : name}</h1>
        <p className="mt-2 text-sm text-muted">{isGuest ? 'Tổng quan dùng thử. Dữ liệu chỉ giữ trong phiên khách.' : 'Theo dõi dinh dưỡng và tiến độ cá nhân của bạn.'}</p>
      </div>
      <Link to="/meal-plan" className="btn-secondary"><CalendarDaysIcon className="h-4 w-4" />Xem lịch thực đơn</Link>
    </header>

    <section className="space-y-3" aria-labelledby="body-analysis-title">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-muted">Phân tích thể trạng</p><h2 id="body-analysis-title" className="text-xl font-semibold">Tóm tắt hồ sơ sức khỏe</h2><p className="mt-1 text-sm text-muted">Các chỉ số là ước tính tham khảo theo thông tin bạn đã nhập.</p></div><a href="#body-analysis-detail" className="btn-secondary h-10">{ready ? 'Đi tới phân tích chi tiết' : 'Nhập hồ sơ'} <ArrowRightIcon className="h-4 w-4" /></a></div>
      {calculation ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<HeartPulseIcon className="h-5 w-5" />} label="BMI tham khảo" value={fmt(calculation.bmi, 1)} detail="Không dùng riêng chỉ số này để kết luận sức khỏe." />
        <MetricCard icon={<ActivityIcon className="h-5 w-5" />} label="BMR ước tính" value={`${fmt(calculation.bmr_kcal)} kcal`} detail="Năng lượng cơ thể dùng lúc nghỉ." />
        <MetricCard icon={<ActivityIcon className="h-5 w-5" />} label="TDEE ước tính" value={`${fmt(calculation.tdee_kcal)} kcal`} detail="Ước tính theo hồ sơ và vận động." />
        <MetricCard icon={<FlameIcon className="h-5 w-5" />} label="Dinh dưỡng tham khảo" value={`${fmt(calculation.target_calories)} kcal`} detail="Mục tiêu tính toán trong hồ sơ." />
      </div> : <div className="card flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-sm text-muted">{ready ? 'Đang tính các chỉ số theo hồ sơ của bạn…' : 'Hoàn thiện hồ sơ để xem các chỉ số và phần phân tích chi tiết.'}</p>{!ready && <Link to="/analysis" className="font-semibold text-brand hover:underline">Mở hồ sơ thử →</Link>}</div>}
    </section>

    {!ready ? (isGuest ? null : <ProfileRequired />) : loading ? <LoadingState label="Đang tải tổng quan..." /> : error ? (
      <section className="card p-5" role="alert"><p className="font-medium">Chưa tải được dữ liệu</p><p className="mt-1 text-sm text-muted">{error}</p><button className="btn-secondary mt-4" onClick={() => window.location.reload()}>Thử lại</button></section>
    ) : <>
      {isGuest ? <section className="card flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="text-sm text-muted">Nhật ký dinh dưỡng</p><h2 className="mt-1 text-lg font-semibold">Chức năng dành cho tài khoản</h2><p className="mt-1 text-sm text-muted">Đăng nhập để xem và cập nhật nhật ký dinh dưỡng.</p></div><Link to="/login" state={{from: '/food-log'}} className="btn-primary h-10">Đăng nhập <ArrowRightIcon className="h-4 w-4" /></Link></section> : <Link to="/food-log" className="card flex flex-wrap items-center justify-between gap-4 p-5 transition hover:border-brand/40 hover:shadow-sm" aria-label="Mở nhật ký dinh dưỡng">
        <div className="min-w-0 flex-1"><p className="text-sm text-muted">Nhật ký dinh dưỡng · hôm nay</p><h2 className="mt-1 text-xl font-semibold">{fmt(consumed.calories)} <span className="text-base font-medium text-muted">kcal đã ghi nhận</span></h2><p className="mt-1 text-sm text-muted">{plan ? 'Xem lịch ngày, protein, chất béo, carbohydrate và cập nhật bữa ăn.' : 'Mở nhật ký để xem mục tiêu và các bữa ăn trong ngày.'}</p><div className="mt-3 max-w-xl"><ProgressBar value={consumed.calories} target={calculation?.target_calories ?? 0} color="bg-lime-500" /></div></div>
        <span className="btn-primary h-10">Mở nhật ký dinh dưỡng <ArrowRightIcon className="h-4 w-4" /></span>
      </Link>}

      {isGuest ? <section className="card flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="text-sm text-muted">Theo dõi cân nặng</p><h2 className="mt-1 text-lg font-semibold">Chức năng dành cho tài khoản</h2><p className="mt-1 text-sm text-muted">Đăng nhập để lưu các lần ghi và xem biểu đồ tiến độ.</p></div><Link to="/login" state={{from: '/'}} className="btn-primary h-10">Đăng nhập <ArrowRightIcon className="h-4 w-4" /></Link></section> : <section className="card p-5 sm:p-6" aria-labelledby="weight-progress-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm text-muted">My progress</p><h2 id="weight-progress-title" className="mt-1 text-xl font-semibold">Theo dõi cân nặng</h2><p className="mt-1 text-sm text-muted">Ghi nhận tùy chọn để xem thay đổi theo thời gian; số liệu không phải đánh giá sức khỏe.</p></div>
          <label className="text-sm font-medium">Khoảng thời gian<select value={range} onChange={(event) => setRange(Number(event.target.value) as RangeDays)} className="input mt-1 h-10 w-36"><option value={30}>30 ngày</option><option value={90}>3 tháng</option><option value={180}>6 tháng</option></select></label>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <WeightMetric label="Lần ghi gần nhất" value={currentWeight == null ? 'Chưa ghi' : `${fmt(currentWeight, 1)} kg`} />
          <WeightMetric label="So với lần trước" value={sinceLast == null ? 'Cần thêm lần ghi' : `${sinceLast > 0 ? '+' : ''}${fmt(sinceLast, 1)} kg`} />
          <WeightMetric label="Thay đổi trong kỳ" value={rangeChange == null ? 'Cần thêm lần ghi' : `${rangeChange > 0 ? '+' : ''}${fmt(rangeChange, 1)} kg`} />
        </div>
        <WeightChart logs={visibleLogs} />
        <form onSubmit={saveWeight} className="mt-5 grid gap-3 rounded-2xl bg-surface p-4 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
          <label className="text-sm font-medium">Ngày ghi<input type="date" max={today} value={measuredOn} onChange={(event) => setMeasuredOn(event.target.value)} className="input mt-1 h-10" required /></label>
          <label className="text-sm font-medium">Cân nặng (kg)<input type="number" min="0.1" max="500" step="0.1" value={weightInput} onChange={(event) => setWeightInput(event.target.value)} className="input mt-1 h-10" placeholder="Ví dụ: 60" required /></label>
          <label className="text-sm font-medium">Ghi chú (không bắt buộc)<input type="text" maxLength={300} value={weightNote} onChange={(event) => setWeightNote(event.target.value)} className="input mt-1 h-10" placeholder="Ví dụ: lần đo buổi sáng" /></label>
          <button type="submit" disabled={savingWeight} className="btn-primary h-10">{savingWeight && <LoaderCircleIcon className="h-4 w-4 animate-spin" />}Lưu lần ghi</button>
          {weightError && <p role="alert" className="text-sm text-accent sm:col-span-4">{weightError}</p>}
          <p className="text-xs text-muted sm:col-span-4">Mỗi ngày lưu một lần ghi; nếu lưu lại cùng ngày, số liệu cũ sẽ được cập nhật. {isGuest ? 'Chế độ khách chỉ giữ dữ liệu tạm trong phiên.' : 'Lịch sử chỉ hiển thị trong tài khoản của bạn.'}</p>
        </form>
        {visibleLogs.length > 0 && <div className="mt-5"><h3 className="text-sm font-semibold">Các lần ghi gần đây</h3><ul className="mt-2 divide-y divide-line">{visibleLogs.slice(-5).reverse().map((item) => <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{formatLongDate(item.measured_on)}{item.note && <span className="ml-2 text-muted">· {item.note}</span>}</span><strong>{fmt(item.weight_kg, 1)} kg</strong></li>)}</ul></div>}
      </section>}

      <section id="body-analysis-detail" className="scroll-mt-6" aria-label="Phân tích thể trạng chi tiết">
        <Analysis />
      </section>

      {calculation?.warnings.map((warning) => <p key={warning} className="rounded-xl bg-accent-soft p-4 text-sm text-accent">{warning}</p>)}
      <p className="text-xs leading-5 text-muted">BMR, TDEE, BMI và các mục tiêu dinh dưỡng chỉ mang tính tham khảo. Không dùng một lần cân hoặc số liệu trong ngày để tự đánh giá sức khỏe.</p>
    </>}
  </div>;
}

function MetricCard({icon, label, value, detail}: {icon: React.ReactNode; label: string; value: string; detail: string}) {
  return <article className="card p-5"><div className="flex items-center gap-2 text-brand">{icon}<span className="text-sm font-medium text-muted">{label}</span></div><p className="mt-4 text-3xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted">{detail}</p></article>;
}

function ProgressBar({value, target, color}: {value: number; target: number; color: string}) {
  const percent = target > 0 ? Math.min(100, Math.max(0, value / target * 100)) : 0;
  return <div className="mt-4 h-3 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Tiến độ năng lượng" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full transition-all ${color}`} style={{width: `${percent}%`}} /></div>;
}

function WeightMetric({label, value}: {label: string; value: string}) {
  return <article className="rounded-xl bg-[#DDF3F8] p-4"><p className="text-xs font-medium text-[#315270]">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums text-[#17305B]">{value}</p></article>;
}

function WeightChart({logs}: {logs: WeightLog[]}) {
  if (!logs.length) return <div className="mt-5 grid min-h-52 place-items-center rounded-2xl bg-surface p-6 text-center"><div><ScaleIcon className="mx-auto h-7 w-7 text-muted"/><p className="mt-2 font-medium">Chưa có dữ liệu biểu đồ</p><p className="mt-1 text-sm text-muted">Lưu các lần ghi theo thời gian để xem xu hướng.</p></div></div>;
  const width = 760, height = 270, left = 46, right = 20, top = 22, bottom = 42;
  const values = logs.map((log) => log.weight_kg);
  const min = Math.min(...values), max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const low = min - spread * 0.2, high = max + spread * 0.2;
  const dates = logs.map((log) => Date.parse(`${log.measured_on}T00:00:00Z`));
  const firstDate = dates[0], dateSpan = Math.max(dates[dates.length - 1] - firstDate, 1);
  const x = (index: number) => logs.length === 1 ? (width - left - right) / 2 + left : left + (dates[index] - firstDate) * (width - left - right) / dateSpan;
  const y = (value: number) => top + (high - value) * (height - top - bottom) / (high - low);
  const path = logs.map((log, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(log.weight_kg)}`).join(' ');
  return <div className="mt-5 overflow-hidden rounded-2xl bg-[#F4F7F9] p-2 sm:p-4"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ lịch sử cân nặng" className="h-56 w-full sm:h-64">
    {[0, 1, 2, 3].map((line) => { const yy = top + line * (height - top - bottom) / 3; const label = high - line * (high - low) / 3; return <g key={line}><line x1={left} x2={width - right} y1={yy} y2={yy} stroke="#DCE4E9" strokeDasharray="4 5"/><text x={left - 8} y={yy + 4} textAnchor="end" fontSize="11" fill="#637381">{fmt(label, 1)}</text></g>; })}
    <path d={path} fill="none" stroke="#17305B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    {logs.map((log, index) => <g key={log.id}><circle cx={x(index)} cy={y(log.weight_kg)} r="5" fill="#FFFFFF" stroke="#17305B" strokeWidth="3"><title>{formatLongDate(log.measured_on)}: {fmt(log.weight_kg, 1)} kg</title></circle>{(index === 0 || index === logs.length - 1 || logs.length <= 5) && <text x={x(index)} y={height - 12} textAnchor="middle" fontSize="11" fill="#526270">{shortDate(log.measured_on)}</text>}</g>)}
  </svg><p className="px-2 pb-1 text-xs text-muted">Đơn vị: kg · biểu đồ tự điều chỉnh theo khoảng số liệu đã ghi.</p></div>;
}
