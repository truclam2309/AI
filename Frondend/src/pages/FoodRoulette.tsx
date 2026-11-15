import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, TransitionEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChefHatIcon, DicesIcon, LoaderCircleIcon, PencilLineIcon, RotateCwIcon, SparklesIcon, StarIcon } from 'lucide-react';
import { recommendationApi } from '../api/recommendationApi';
import { nutritionApi } from '../api/nutritionApi';
import { mealPlanApi } from '../api/mealPlanApi';
import { toApiError } from '../api/errors';
import { LoadingState } from '../components/LoadingState';
import { AIChefMascot } from '../components/roulette/AIChefMascot';
import { FoodSelectorModal } from '../components/roulette/FoodSelectorModal';
import { RouletteResult } from '../components/roulette/RouletteResult';
import { RouletteWheel } from '../components/roulette/RouletteWheel';
import { useAuth } from '../contexts/AuthContext';
import { MealType, NutritionGoal } from '../types/nutrition';
import { CatalogDish } from '../types/recommendations';
import { todayISO } from '../utils/date';
import { fmt } from '../utils/format';

const GOALS: Record<NutritionGoal, string> = {
  lose_weight: 'Giảm cân',
  gain_weight: 'Tăng cân',
  gain_muscle: 'Tăng cơ',
  maintain_weight: 'Duy trì cân nặng',
};
const STORE_PREFIX = 'nutriai.food-roulette';
const PAGE_SIZE = 500;

function shuffle<T,>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function recipeSteps(instructions: string | null): string[] {
  if (!instructions?.trim()) return [];
  const cleaned = instructions.replace(/\r/g, '').trim();
  const numbered = cleaned.split(/\n+|(?<=[.!?])\s+(?=(?:Bước\s*)?\d+[.):\-])/i)
    .map((step) => step.replace(/^\s*(?:bước\s*)?\d+\s*[.):\-]?\s*/i, '').trim())
    .filter(Boolean);
  if (numbered.length > 1) return numbered;
  const lines = cleaned.split(/\n+|\s*;\s*/).map((step) => step.replace(/^\s*(?:bước\s*)?\d+\s*[.):\-]?\s*/i, '').trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  const sentences = cleaned.split(/(?<=[.!?])\s+/).map((step) => step.trim()).filter(Boolean);
  return sentences.length > 1 ? sentences : [cleaned];
}

async function loadGoalDishes(goal: NutritionGoal | null) {
  const firstPage = await recommendationApi.dishes('', goal || '', PAGE_SIZE, 0);
  const offsets = [];
  for (let offset = PAGE_SIZE; offset < firstPage.total; offset += PAGE_SIZE) offsets.push(offset);
  const remainingPages = await Promise.all(offsets.map((offset) => recommendationApi.dishes('', goal || '', PAGE_SIZE, offset)));
  const uniqueDishes = new Map<string, CatalogDish>();
  [firstPage, ...remainingPages].flatMap((page) => page.results).forEach((dish) => uniqueDishes.set(dish.dish_id, dish));
  // Goal now controls the model score and ordering, not which dishes are hidden.
  return [...uniqueDishes.values()];
}

export function FoodRoulette() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const profileGoal = user?.profile?.goal ?? null;
  const [goal, setGoal] = useState<NutritionGoal | null>(profileGoal);
  const storageKey = user ? `${STORE_PREFIX}.${user.id}.${goal ?? 'all'}` : null;
  const [dishes, setDishes] = useState<CatalogDish[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [winner, setWinner] = useState<CatalogDish | null>(null);
  const [featuredDishId, setFeaturedDishId] = useState<string | null>(null);
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [savingDishId, setSavingDishId] = useState<string | null>(null);
  const [remainingCalories, setRemainingCalories] = useState<number | null>(null);
  const pendingWinner = useRef<CatalogDish | null>(null);

  useEffect(() => {
    let active = true;
    setReadyKey(null);
    setLoading(true);
    setError('');
    setDishes([]);
    setSelectedIds([]);
    setVisibleIds([]);
    if (!storageKey) {
      setLoading(false);
      return () => { active = false; };
    }

    loadGoalDishes(goal)
      .then((result) => {
        if (!active) return;
        let saved: string[] | null = null;
        try {
          const raw = window.localStorage.getItem(storageKey);
          const parsed: unknown = raw ? JSON.parse(raw) : null;
          if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) saved = parsed;
        } catch { saved = null; }
        const availableIds = new Set(result.map((dish) => dish.dish_id));
        const initialIds = saved === null ? result.map((dish) => dish.dish_id) : saved.filter((id) => availableIds.has(id));
        setDishes(result);
        setSelectedIds(initialIds);
        setVisibleIds(shuffle(result.filter((dish) => initialIds.includes(dish.dish_id))).slice(0, 8).map((dish) => dish.dish_id));
        setReadyKey(storageKey);
      })
      .catch((cause) => { if (active) setError(toApiError(cause).message); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [goal, storageKey, reloadVersion]);

  useEffect(() => {
    if (readyKey !== storageKey || !storageKey) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(selectedIds)); } catch { /* Keep in-memory selection if storage is unavailable. */ }
  }, [readyKey, selectedIds, storageKey]);

  useEffect(() => {
    let active = true;
    if (!goal) { setRemainingCalories(null); return () => { active = false; }; }
    Promise.all([nutritionApi.calculate(), mealPlanApi.getPlans(todayISO())])
      .then(([nutrition, plans]) => {
        if (!active) return;
        const currentPlan = plans[plans.length - 1];
        setRemainingCalories(Math.max(0, nutrition.target_calories - (currentPlan?.total_calories ?? 0)));
      })
      .catch(() => { if (active) setRemainingCalories(null); });
    return () => { active = false; };
  }, [goal]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const eligibleDishes = useMemo(() => dishes.filter((dish) => selectedSet.has(dish.dish_id)), [dishes, selectedSet]);
  const visibleDishes = useMemo(() => {
    const visibleSet = new Set(visibleIds);
    const visible = visibleIds.map((id) => dishes.find((dish) => dish.dish_id === id)).filter((dish): dish is CatalogDish => Boolean(dish && selectedSet.has(dish.dish_id)));
    if (visible.length >= Math.min(8, eligibleDishes.length)) return visible;
    return [...visible, ...shuffle(eligibleDishes.filter((dish) => !visibleSet.has(dish.dish_id)))].slice(0, 8);
  }, [dishes, eligibleDishes, selectedSet, visibleIds]);
  const featuredDish = useMemo(() => {
    const selected = dishes.find((dish) => dish.dish_id === featuredDishId);
    return selected ?? winner ?? visibleDishes[0] ?? null;
  }, [dishes, featuredDishId, visibleDishes, winner]);

  const updateSelection = useCallback((nextIds: string[]) => {
    const uniqueIds = [...new Set(nextIds)];
    setSelectedIds(uniqueIds);
    setWinner(null);
    setVisibleIds(shuffle(dishes.filter((dish) => uniqueIds.includes(dish.dish_id))).slice(0, 8).map((dish) => dish.dish_id));
  }, [dishes]);

  const changeWheel = () => {
    if (spinning) return;
    if (eligibleDishes.length <= 8) {
      toast.info('Danh sách có tối đa 8 món; hãy chọn thêm món để đổi bộ trên vòng quay.');
      return;
    }
    const current = new Set(visibleDishes.map((dish) => dish.dish_id));
    const unseen = eligibleDishes.filter((dish) => !current.has(dish.dish_id));
    setVisibleIds(shuffle(unseen.length >= 8 ? unseen : eligibleDishes).slice(0, 8).map((dish) => dish.dish_id));
    setWinner(null);
  };

  const chooseRandom = () => {
    if (spinning || dishes.length < 1) return;
    const selectedDish = dishes[Math.floor(Math.random() * dishes.length)];
    setVisibleIds((current) => [selectedDish.dish_id, ...current.filter((id) => id !== selectedDish.dish_id)].slice(0, 8));
    setSelectedIds((current) => current.includes(selectedDish.dish_id) ? current : [...current, selectedDish.dish_id]);
    setFeaturedDishId(selectedDish.dish_id);
    setWinner(null);
  };

  const addToMealPlan = async (dish: CatalogDish) => {
    setSavingDishId(dish.dish_id);
    try {
      const planDate = todayISO();
      await mealPlanApi.selectDish({ plan_date: planDate, meal_type: mealType, dish_id: dish.dish_id });
      toast.success(`Đã thêm ${dish.name} vào thực đơn hôm nay.`);
      navigate(`/meal-plan?date=${encodeURIComponent(planDate)}`);
    } catch (cause) {
      toast.error(toApiError(cause).message);
    } finally {
      setSavingDishId(null);
    }
  };

  const startSpin = () => {
    if (spinning || visibleDishes.length < 2) return;
    const winningIndex = Math.floor(Math.random() * visibleDishes.length);
    const winningDish = visibleDishes[winningIndex];
    pendingWinner.current = winningDish;
    setWinner(null);
    setSpinning(true);
    const slice = 360 / visibleDishes.length;
    const targetAngle = (360 - (winningIndex + 0.5) * slice + 360) % 360;
    const currentAngle = ((rotation % 360) + 360) % 360;
    const delta = (targetAngle - currentAngle + 360) % 360;
    setRotation(rotation + 7 * 360 + delta);
  };

  const finishSpin = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform' || !spinning) return;
    setSpinning(false);
    setFeaturedDishId(pendingWinner.current?.dish_id ?? null);
    setWinner(pendingWinner.current);
    pendingWinner.current = null;
  };

  if (!user) return <LoadingState label="Đang tải tài khoản..." />;

  return <div className="-mx-4 -mt-5 min-h-[calc(100dvh-4rem)] overflow-hidden bg-[#fff6e9] px-4 pb-8 pt-6 text-[#52382d] sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mt-10 lg:px-10 lg:pt-9">
      <div className="pointer-events-none absolute left-0 top-24 h-56 w-56 -translate-x-1/2 rounded-full bg-[#ffdba5]/35 blur-2xl" />
    <div className="pointer-events-none absolute right-0 top-56 h-64 w-64 translate-x-1/3 rounded-full bg-[#ffc5a6]/30 blur-2xl" />
    <header className="relative mx-auto max-w-4xl text-center">
      <p className="flex items-center justify-center gap-2 text-xs font-black tracking-[0.28em] text-[#ac5336] sm:text-sm"><ChefHatIcon className="h-4 w-4" /> EM THÍCH ĂN GÌ? <StarIcon className="h-3.5 w-3.5 fill-[#efb84c] text-[#efb84c]" /></p>
      <h1 className="mt-2 font-serif text-5xl font-black tracking-tight text-[#c64f35] drop-shadow-[0_2px_0_rgba(255,255,255,0.8)] sm:text-7xl">EM HỔNG BIẾT</h1>
      <p className="mt-2 text-sm text-[#806b59] sm:text-base">Hôm nay ăn gì? Để vòng quay quyết!</p>
      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#edd9ba] bg-white/80 px-4 py-2 text-xs font-semibold text-[#76543e] shadow-sm sm:text-sm"><SparklesIcon className="h-4 w-4 text-[#d46842]" />{goal ? <>Điểm phù hợp đang tính theo mục tiêu: <span className="font-black text-[#c45232]">{GOALS[goal]}</span></> : <>Đang xem tất cả món ăn; chọn mục tiêu để xem điểm phù hợp</>}</div>
    </header>

    <section className="relative mx-auto mt-5 flex max-w-3xl flex-wrap items-center justify-center gap-2 rounded-3xl border border-[#eddcc5] bg-white/85 p-3 shadow-sm sm:mt-6 sm:p-4">
      <span className="px-2 text-xs font-bold text-[#76543e] sm:text-sm">Chấm điểm theo:</span>
      <button type="button" aria-pressed={goal === null} onClick={() => setGoal(null)} className={`rounded-full px-3 py-2 text-xs font-bold transition sm:text-sm ${goal === null ? 'bg-[#d85e3b] text-white shadow' : 'bg-[#fff3df] text-[#76543e] hover:bg-[#f8e5c8]'}`}>Tất cả món</button>
      {(Object.keys(GOALS) as NutritionGoal[]).map((value) => <button key={value} type="button" aria-pressed={goal === value} onClick={() => setGoal(value)} className={`rounded-full px-3 py-2 text-xs font-bold transition sm:text-sm ${goal === value ? 'bg-[#d85e3b] text-white shadow' : 'bg-[#fff3df] text-[#76543e] hover:bg-[#f8e5c8]'}`}>{GOALS[value]}</button>)}
    </section>

    {loading ? <div className="mx-auto mt-8 max-w-xl"><LoadingState label="Đang tải món từ MyFit..." /></div> : error ? <section role="alert" className="mx-auto mt-8 max-w-xl rounded-3xl border border-red-200 bg-white p-6 text-center"><p className="font-semibold text-red-700">Chưa tải được món ăn</p><p className="mt-2 text-sm text-red-600">{error}</p><button type="button" onClick={() => setReloadVersion((version) => version + 1)} className="mt-4 rounded-full bg-[#d65d3d] px-5 py-2 text-sm font-bold text-white">Thử lại</button></section> : dishes.length === 0 ? <section className="mx-auto mt-8 max-w-xl rounded-3xl border border-[#eddcc5] bg-white/90 p-7 text-center shadow-sm"><ChefHatIcon className="mx-auto h-9 w-9 text-[#ce6742]" /><h2 className="mt-3 font-serif text-xl font-bold">Không có món khớp bộ lọc này</h2><p className="mt-2 text-sm leading-6 text-[#806e5f]">Thử chọn mục tiêu khác hoặc xem tất cả món.</p></section> : <>
      <div className="relative mx-auto mt-5 max-w-3xl sm:mt-7">
        <div className="relative mx-auto w-fit">
          <RouletteWheel dishes={visibleDishes} rotation={rotation} spinning={spinning} onTransitionEnd={finishSpin} />
          <AIChefMascot goal={goal ?? profileGoal ?? 'maintain_weight'} remainingCalories={remainingCalories} />
        </div>
        <p className="mt-2 text-center text-xs font-medium text-[#927966]">{eligibleDishes.length} món trong catalog · {visibleDishes.length} món trên vòng quay · điểm % là xác suất Random Forest dự đoán lớp mục tiêu</p>
      </div>

      {featuredDish && <section className="relative mx-auto mt-6 max-w-3xl rounded-3xl border border-[#ecd9bd] bg-white/95 p-5 shadow-[0_12px_32px_rgba(104,69,42,0.08)] sm:p-7" aria-labelledby="roulette-recipe-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-[#c45b39]">{winner?.dish_id === featuredDish.dish_id ? 'Món được chọn' : 'Công thức trên vòng quay'}</p><h2 id="roulette-recipe-title" className="mt-1 font-serif text-2xl font-bold text-[#563a2e]">{featuredDish.name}</h2></div>
          {featuredDish.goal_fit_percent != null && <span className="rounded-full bg-[#e7f3e8] px-3 py-1.5 text-sm font-bold text-[#28623c]">Phù hợp mục tiêu {featuredDish.goal_fit_percent.toFixed(1)}%</span>}
          {featuredDish.calories != null && <span className="rounded-full bg-[#fff1dc] px-3 py-1.5 text-sm font-bold text-[#a64d31]">{fmt(featuredDish.calories, 1)} kcal</span>}
        </div>
        <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid grid-cols-2 gap-2 self-start">
            <RecipeMetric label="Protein" value={featuredDish.protein} />
            <RecipeMetric label="Carb" value={featuredDish.carb} />
            <RecipeMetric label="Fat" value={featuredDish.fat} />
            <RecipeMetric label="Khẩu phần" value={featuredDish.serving_grams} unit="g" />
          </div>
          <div className="space-y-4">
            <section className="rounded-2xl border border-[#f0e3d1] bg-[#fffaf3] p-4"><h3 className="text-sm font-bold text-[#604638]">Nguyên liệu</h3>{featuredDish.ingredients.length ? <ul className="mt-2 space-y-2">{featuredDish.ingredients.map((ingredient, index) => <li key={`${index}-${ingredient}`} className="flex items-start gap-2 text-sm leading-5 text-[#806d5d]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d9774f]" /><span>{ingredient}</span></li>)}</ul> : <p className="mt-2 text-sm text-[#806d5d]">Chưa có dữ liệu nguyên liệu cho món này.</p>}</section>
            <section className="rounded-2xl border border-[#f0e3d1] bg-[#fffaf3] p-4"><h3 className="text-sm font-bold text-[#604638]">Cách chế biến</h3>{recipeSteps(featuredDish.instructions).length ? <ol className="mt-3 space-y-3">{recipeSteps(featuredDish.instructions).map((step, index) => <li key={`${index}-${step}`} className="flex items-start gap-3 text-sm leading-6 text-[#806d5d]"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#f7e2c7] text-xs font-black text-[#a95435]">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol> : <p className="mt-2 text-sm text-[#806d5d]">Chưa có hướng dẫn chế biến cho món này.</p>}</section>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 border-t border-[#f0e5d6] pt-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="text-xs font-semibold text-[#806b59]">Thêm vào bữa
            <select value={mealType} onChange={(event) => setMealType(event.target.value as MealType)} className="mt-1.5 block h-10 w-full rounded-xl border border-[#e8d7c0] bg-[#fffaf2] px-3 text-sm text-[#563a2e] outline-none focus:border-[#d4774d] sm:w-48">
              <option value="breakfast">Bữa sáng</option><option value="lunch">Bữa trưa</option><option value="dinner">Bữa tối</option><option value="snack">Bữa phụ</option>
            </select>
          </label>
          <button type="button" onClick={() => addToMealPlan(featuredDish)} disabled={savingDishId === featuredDish.dish_id} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#1f563b] px-6 text-sm font-bold text-white shadow-sm transition hover:bg-[#17452f] active:scale-[0.98] disabled:cursor-wait disabled:opacity-70">
            {savingDishId === featuredDish.dish_id ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}{savingDishId === featuredDish.dish_id ? 'Đang thêm...' : 'Chọn món vào thực đơn'}
          </button>
        </div>
      </section>}

      <div className="relative mx-auto mt-4 flex max-w-sm flex-col items-center gap-3 sm:mt-5">
        <button type="button" onClick={startSpin} disabled={spinning || visibleDishes.length < 2} className="group inline-flex h-14 w-full items-center justify-center gap-3 rounded-full bg-gradient-to-b from-[#ee7b4c] to-[#d84f32] text-lg font-black tracking-[0.12em] text-white shadow-[0_7px_0_#a73f2b,0_12px_22px_rgba(204,81,47,0.26)] transition hover:-translate-y-0.5 hover:shadow-[0_9px_0_#a73f2b,0_15px_25px_rgba(204,81,47,0.3)] active:translate-y-1 active:shadow-[0_3px_0_#a73f2b] disabled:cursor-not-allowed disabled:opacity-55"><RotateCwIcon className={`h-5 w-5 ${spinning ? 'animate-spin' : 'transition-transform group-hover:rotate-45'}`} />{spinning ? 'ĐANG QUAY...' : 'QUAY!'}</button>
        {eligibleDishes.length < 2 && <p className="text-center text-xs text-[#b54f36]">Chọn ít nhất 2 món hợp mục tiêu để bắt đầu.</p>}
        <div className="grid w-full grid-cols-3 gap-2.5">
          <ActionButton icon={<PencilLineIcon className="h-4 w-4" />} label="Sửa món" disabled={spinning || dishes.length === 0} onClick={() => setEditing(true)} />
          <ActionButton icon={<SparklesIcon className="h-4 w-4" />} label="Bốc món" disabled={spinning || dishes.length < 1} onClick={chooseRandom} />
          <ActionButton icon={<DicesIcon className="h-4 w-4" />} label="Món khác" disabled={spinning || eligibleDishes.length <= 8} onClick={changeWheel} />
        </div>
        {eligibleDishes.length > 0 && <p className="text-center text-[11px] text-[#957f6a]">Lựa chọn của bạn được lưu trên thiết bị và dùng lại cho mục tiêu này.</p>}
      </div>
    </>}

    {editing && <FoodSelectorModal dishes={dishes} selectedIds={selectedIds} onSelectionChange={updateSelection} onClose={() => setEditing(false)} />}
    {winner && <RouletteResult dish={winner} onClose={() => setWinner(null)} onRecipe={() => { setWinner(null); setFeaturedDishId(winner.dish_id); }} onSpinAgain={() => { setWinner(null); window.setTimeout(startSpin, 80); }} />}
  </div>;
}

function RecipeMetric({label, value, unit = 'g'}: {label: string; value: number | null; unit?: string}) {
  return <div className="rounded-2xl bg-[#f8f0e5] px-3 py-2.5"><p className="text-[11px] text-[#907a66]">{label}</p><p className="mt-0.5 text-sm font-bold tabular-nums text-[#573b2e]">{value == null ? 'Chưa có dữ liệu' : `${fmt(value, 1)} ${unit}`}</p></div>;
}

function ActionButton({icon, label, onClick, disabled}: {icon: ReactNode; label: string; onClick: () => void; disabled: boolean}) {
  return <button type="button" onClick={onClick} disabled={disabled} className="flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border border-[#eddcc5] bg-white/90 text-[11px] font-bold text-[#704f3c] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#fff0dd] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-row sm:gap-2 sm:text-sm">{icon}{label}</button>;
}
