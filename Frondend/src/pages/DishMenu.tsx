import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ImageIcon, LoaderCircleIcon, PlusIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { resolveAssetUrl } from '../api/client';
import { mealPlanApi } from '../api/mealPlanApi';
import { recommendationApi } from '../api/recommendationApi';
import { toApiError } from '../api/errors';
import { useAuth } from '../contexts/AuthContext';
import { MealType } from '../types/nutrition';
import { CatalogDish } from '../types/recommendations';
import { todayISO } from '../utils/date';
import { fmt } from '../utils/format';

const goals = [
  { value: '', label: 'Tất cả mục tiêu' },
  { value: 'gain_weight', label: 'Tăng cân' },
  { value: 'lose_weight', label: 'Giảm cân' },
  { value: 'maintain_weight', label: 'Duy trì' },
  { value: 'gain_muscle', label: 'Tăng cơ' }
];

const goalLabels: Record<string, string> = Object.fromEntries(goals.map(({ value, label }) => [value, label]));

export function DishMenu() {
  const location = useLocation();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [goal, setGoal] = useState<string>(user?.profile?.goal ?? '');
  const scoreGoal = goal || user?.profile?.goal || '';
  const [dishes, setDishes] = useState<CatalogDish[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CatalogDish | null>(null);
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [addingDishId, setAddingDishId] = useState<string | null>(null);

  useEffect(() => {
    const routedDish = (location.state as { rouletteDish?: CatalogDish } | null)?.rouletteDish;
    if (routedDish) setSelected(routedDish);
  }, [location.state]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      recommendationApi.dishes(query.trim(), scoreGoal, 100, 0)
        .then((result) => { if (active) { setDishes(result.results); setTotal(result.total); setError(''); } })
        .catch((cause) => { if (active) setError(toApiError(cause).message); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, goal, scoreGoal]);

  const loadMore = async () => {
    if (loadingMore || dishes.length >= total) return;
    setLoadingMore(true);
    try {
      const result = await recommendationApi.dishes(query.trim(), scoreGoal, 100, dishes.length);
      setDishes((current) => [...current, ...result.results]);
      setTotal(result.total);
    } catch (cause) {
      setError(toApiError(cause).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const addToMealPlan = async (dish: CatalogDish) => {
    setAddingDishId(dish.dish_id);
    try {
      await mealPlanApi.selectDish({ plan_date: todayISO(), meal_type: mealType, dish_id: dish.dish_id });
      toast.success(`Đã thêm ${dish.name} vào ${mealType === 'snack' ? 'bữa phụ' : `bữa ${mealType === 'breakfast' ? 'sáng' : mealType === 'lunch' ? 'trưa' : 'tối'}`}.`);
      setSelected(null);
    } catch (cause) {
      toast.error(toApiError(cause).message);
    } finally {
      setAddingDishId(null);
    }
  };

  return <div className="min-h-screen -mx-4 -mt-5 bg-[#fff1df] px-4 pb-8 pt-7 text-[#30251f] sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mt-10 lg:px-10 lg:pt-10">
    <header className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#ffe7ca] via-[#ffdec4] to-[#f5b28f] p-6 sm:p-9">
      <div className="pointer-events-none absolute -right-10 -top-24 h-72 w-72 rounded-full bg-[#e8794e]/20" />
      <div className="relative">
        <p className="text-sm font-medium text-[#b95232]">MyFit · Ăn khỏe dáng xinh</p>
        <h1 className="mt-2 max-w-2xl font-sans text-4xl font-semibold leading-tight sm:text-5xl">Menu món ăn</h1>
        <p className="mt-3 text-base text-[#76665a]">{total.toLocaleString('vi-VN')} món ăn · {scoreGoal ? `Điểm phù hợp theo ${goalLabels[scoreGoal]?.toLocaleLowerCase() ?? 'mục tiêu hồ sơ'}` : 'Chọn mục tiêu trong hồ sơ để xem điểm phù hợp'}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <label className="flex h-14 flex-1 items-center gap-3 rounded-2xl bg-white/80 px-4 shadow-sm"><SearchIcon className="h-5 w-5 text-[#8b7a6e]" /><span className="sr-only">Tìm món hoặc nguyên liệu</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm món, nguyên liệu..." className="w-full bg-transparent text-base outline-none placeholder:text-[#a3968b]" /></label>
  <label className="flex h-14 items-center gap-3 rounded-2xl bg-white/80 px-4 shadow-sm sm:min-w-56"><SlidersHorizontalIcon className="h-5 w-5 text-[#8b7a6e]" /><span className="sr-only">Chọn mục tiêu tính điểm</span><select value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full bg-transparent text-sm outline-none">{goals.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
      </div>
    </header>

    <section className="mt-7">
      <div className="mb-4 flex items-end justify-between gap-3"><div><p className="font-serif text-xl">🍲 {goal ? `Tất cả món · điểm theo mục tiêu ${goalLabels[goal]?.toLocaleLowerCase()}` : 'Tất cả món ăn'}</p><p className="mt-1 text-sm text-[#8a786b]">{loading ? 'Đang tải danh sách món...' : `Hiển thị ${dishes.length} / ${total.toLocaleString('vi-VN')} món`}</p></div>{goal && <button onClick={() => setGoal('')} className="flex items-center gap-1 text-sm text-[#bd4c2d]">Bỏ mục tiêu <XIcon className="h-4 w-4" /></button>}</div>
      {error ? <div role="alert" className="rounded-2xl bg-white p-6 text-sm text-red-700">{error}</div> : loading ? <div className="rounded-2xl bg-white/70 p-10 text-center text-sm text-[#8a786b]">Đang tải món ăn...</div> : dishes.length === 0 ? <div className="rounded-2xl bg-white/70 p-10 text-center text-sm text-[#8a786b]">Không tìm thấy món phù hợp. Thử từ khóa khác nhé.</div> : <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">{dishes.map((dish) => <DishCard key={dish.dish_id} dish={dish} onClick={() => setSelected(dish)} />)}</div>}
      {!loading && total > dishes.length && <div className="mt-6 text-center"><p className="mb-3 text-sm text-[#8a786b]">Đang hiển thị {dishes.length} / {total} món</p><button type="button" onClick={loadMore} disabled={loadingMore} className="btn-primary h-11 min-w-40">{loadingMore ? <><LoaderCircleIcon className="h-4 w-4 animate-spin" /> Đang tải...</> : 'Tải thêm món'}</button></div>}
    </section>
    {selected && <DishDetails dish={selected} mealType={mealType} onMealTypeChange={setMealType} adding={addingDishId === selected.dish_id} onAdd={() => addToMealPlan(selected)} onClose={() => setSelected(null)} />}
  </div>;
}

function displayText(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  // Covers UTF-8 text decoded as Latin-1/Windows-1252 by a stale or external API.
  if (/[ÃÂ]|á»|áº/.test(value)) {
    try {
      const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);
      const repaired = new TextDecoder('utf-8').decode(bytes);
      if ((repaired.match(/[ÃÂ]|á»|áº/g) ?? []).length < (value.match(/[ÃÂ]|á»|áº/g) ?? []).length) return repaired;
    } catch { /* Keep the original text when it cannot be repaired safely. */ }
  }
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function dishTitle(value: string) {
  return displayText(value, 'Món ăn')
    .replace(/\s*\(?\s*\d+(?:[.,]\d+)?\s*(?:g|kg)\s*\/\s*[^)]*\)?\s*$/i, '')
    .replace(/\s*[-–—]\s*\d+(?:[.,]\d+)?\s*(?:g|kg)\s*$/i, '')
    .trim();
}

function ingredientParts(value: string): { name: string; amount: string } {
  const match = value.match(/^(.+?):\s*(\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|quả|củ|nhánh|thìa|muỗng|con|miếng|lá|lát|bó)?)$/i);
  return match ? { name: match[1].trim(), amount: match[2].trim() } : { name: value.trim(), amount: '' };
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

function DishCard({ dish, onClick }: { dish: CatalogDish; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  return <button type="button" onClick={onClick} className="group overflow-hidden rounded-[1.5rem] bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
    <div className="relative aspect-[1.18] overflow-hidden bg-[#f0e6db]">{dish.image_url && !failed ? <img src={resolveAssetUrl(dish.image_url) ?? undefined} alt={dishTitle(dish.name)} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-[#ad9d90]"><ImageIcon className="h-9 w-9" /></div>}{dish.goal_fit_percent != null && <span className="absolute left-2 top-2 rounded-full bg-[#28623c]/95 px-2.5 py-1 text-[10px] font-bold text-white sm:text-xs">Phù hợp mục tiêu {dish.goal_fit_percent.toFixed(1)}%</span>}</div>
    <div className="p-3 sm:p-4"><h2 className="line-clamp-2 min-h-10 font-sans text-base font-medium leading-snug sm:text-lg">{dishTitle(dish.name)}</h2><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#66574d] sm:text-xs"><span>{dish.calories == null ? '—' : `${fmt(dish.calories)} kcal`}</span><span>Đạm {dish.protein == null ? '—' : `${fmt(dish.protein, 1)} g`}</span></div></div>
  </button>;
}

function DishDetails({ dish, mealType, onMealTypeChange, adding, onAdd, onClose }: { dish: CatalogDish; mealType: MealType; onMealTypeChange: (mealType: MealType) => void; adding: boolean; onAdd: () => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="dish-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} className="my-auto max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#fffaf5] shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-[#fffaf5]/95 px-5 py-3 backdrop-blur"><span className="text-sm text-[#8a786b]">Chi tiết món ăn</span><button onClick={onClose} aria-label="Đóng" className="rounded-full p-2 hover:bg-black/5"><XIcon className="h-5 w-5" /></button></div>
      <div className="space-y-6 p-5 pt-2 sm:p-7">
        {dish.image_url && <img src={resolveAssetUrl(dish.image_url) ?? undefined} alt={dish.name} className="max-h-72 w-full rounded-2xl object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="dish-title" className="font-sans text-2xl font-semibold">{dishTitle(dish.name)}</h2><p className="mt-1 text-sm text-[#8a786b]">{displayText(dish.food_group, 'Món ăn Việt')}</p></div>{dish.goal_fit_percent != null && <span className="rounded-full bg-[#e7f3e8] px-3 py-1.5 text-sm font-bold text-[#28623c]">Phù hợp mục tiêu {dish.goal_fit_percent.toFixed(1)}%</span>}</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[['Năng lượng', dish.calories, 'kcal'], ['Protein', dish.protein, 'g'], ['Carb', dish.carb, 'g'], ['Chất béo', dish.fat, 'g'], ['Khẩu phần', dish.serving_grams, 'g']].map(([label, value, unit]) => <div key={String(label)} className="rounded-xl bg-[#f4eee6] p-3"><p className="text-xs text-[#8a786b]">{label}</p><p className="mt-1 font-semibold">{value == null ? '—' : `${fmt(Number(value), 1)} ${unit}`}</p></div>)}</div>
        <div><h3 className="font-semibold">Nguyên liệu</h3>{dish.ingredients.length ? <ul className="mt-2 divide-y divide-[#eee3d9]">{dish.ingredients.map((item, i) => { const part = ingredientParts(item); return <li key={`${item}-${i}`} className="flex items-center justify-between gap-4 py-3 text-sm"><span>{part.name}</span>{part.amount && <span className="shrink-0 font-medium text-[#d75b35]">{part.amount}</span>}</li>; })}</ul> : <p className="mt-2 text-sm text-[#8a786b]">Chưa có thông tin nguyên liệu.</p>}</div>
        <div><h3 className="text-xl font-semibold">Các bước nấu</h3>{recipeSteps(dish.instructions).length ? <ol className="mt-4 space-y-3">{recipeSteps(dish.instructions).map((step, index) => <li key={`${index}-${step}`} className="flex items-start gap-4 rounded-2xl bg-white p-4 text-sm leading-6"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#d9512d] text-base font-bold text-white">{index + 1}</span><span className="pt-1">{step}</span></li>)}</ol> : <p className="mt-2 text-sm text-[#8a786b]">Chưa có hướng dẫn chế biến cho món này.</p>}</div>
        <div className="flex flex-col gap-3 border-t border-[#eee3d9] pt-4 sm:flex-row sm:items-end">
          <label className="text-sm font-medium">Thêm vào bữa
            <select value={mealType} onChange={(event) => onMealTypeChange(event.target.value as MealType)} className="input mt-1.5 h-11 w-full sm:w-48">
              <option value="breakfast">Bữa sáng</option><option value="lunch">Bữa trưa</option><option value="dinner">Bữa tối</option><option value="snack">Bữa phụ</option>
            </select>
          </label>
          <button type="button" onClick={onAdd} disabled={adding} className="btn-primary h-11 sm:ml-auto">{adding ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}{adding ? 'Đang thêm...' : 'Thêm vào thực đơn'}</button>
        </div>
      </div>
    </section>
  </div>;
}
