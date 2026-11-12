import { FormEvent, KeyboardEvent, useEffect, useState } from 'react';
import { ImageIcon, LoaderCircleIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { recommendationApi } from '../api/recommendationApi';
import { mealPlanApi } from '../api/mealPlanApi';
import { toApiError } from '../api/errors';
import { useAuth } from '../contexts/AuthContext';
import { MealType, NutritionGoal } from '../types/nutrition';
import { IngredientRecommendation, IngredientSearchResponse } from '../types/recommendations';
import { fmt } from '../utils/format';
import { todayISO } from '../utils/date';

const goals: { value: NutritionGoal; label: string }[] = [
  { value: 'lose_weight', label: 'Giảm cân' },
  { value: 'gain_weight', label: 'Tăng cân' },
  { value: 'gain_muscle', label: 'Tăng cơ' },
  { value: 'maintain_weight', label: 'Duy trì' }
];

function ingredientKey(value: string): string {
  return value.toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();
}

export function Recommendations() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [maxCalories, setMaxCalories] = useState('');
  const [minProtein, setMinProtein] = useState('');
  const [goal, setGoal] = useState<NutritionGoal | ''>('');
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [planDate, setPlanDate] = useState(todayISO());
  const [result, setResult] = useState<IngredientSearchResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingDishId, setSavingDishId] = useState<string | null>(null);
  const [selectedDish, setSelectedDish] = useState<IngredientRecommendation | null>(null);

  useEffect(() => {
    const query = draft.trim();
    if (!query) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      recommendationApi.suggestIngredients(query)
        .then(({ suggestions: values }) => { if (active) setSuggestions(values); })
        .catch(() => { if (active) setSuggestions([]); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [draft]);

  const chooseForMeal = async (dish: IngredientRecommendation) => {
    setSavingDishId(dish.dish_id);
    try {
      const saved = await mealPlanApi.selectDish({ plan_date: planDate, meal_type: mealType, dish_id: dish.dish_id });
      toast.success(`Đã lưu ${dish.name} vào thực đơn phiên bản ${saved.data.version}.`);
      navigate(`/meal-plan?date=${encodeURIComponent(planDate)}`);
    } catch (cause) {
      toast.error(toApiError(cause).message);
    } finally {
      setSavingDishId(null);
    }
  };

  const addIngredients = (raw: string) => {
    const values = raw.split(/[,;\n]+/).map((value) => value.trim()).filter(Boolean);
    if (!values.length) return;
    setIngredients((current) => {
      const keys = new Set(current.map(ingredientKey));
      const additions = values.filter((value) => {
        const key = ingredientKey(value);
        if (!key || keys.has(key)) return false;
        keys.add(key);
        return true;
      });
      return [...current, ...additions];
    });
    setDraft('');
    setSuggestions([]);
    setError('');
  };

  const toggleIngredient = (value: string) => {
    setIngredients((current) => current.some((item) => ingredientKey(item) === ingredientKey(value))
      ? current.filter((item) => ingredientKey(item) !== ingredientKey(value))
      : [...current, value]);
    setError('');
  };

  const onDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addIngredients(draft);
    }
  };

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ingredients.length) {
      setError('Hãy nhập ít nhất một nguyên liệu trước khi tìm.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await recommendationApi.byIngredients({
        ingredients,
        limit: 12,
        ...(maxCalories ? { max_calories: Number(maxCalories) } : {}),
        ...(minProtein ? { min_protein: Number(minProtein) } : {}),
        ...(goal ? { goal } : {})
      }));
    } catch (cause) {
      setError(toApiError(cause).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted">Tìm kiếm theo nguyên liệu</p>
        <h1 className="mt-1 text-3xl font-semibold">Nấu món gì hôm nay?</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Nhập nguyên liệu bạn đang có. NutriAI so khớp với công thức trong catalog và cho biết phần đã có, phần còn thiếu.
        </p>
      </header>

      <form onSubmit={search} className="card space-y-5 p-5 sm:p-7">
        <div>
          <label htmlFor="ingredient-input" className="text-sm font-semibold">Nguyên liệu hiện có</label>
          <div className="mt-2 flex gap-2">
            <input id="ingredient-input" className="input h-11 min-w-0 flex-1" value={draft}
              onChange={(event) => setDraft(event.target.value)} onKeyDown={onDraftKeyDown}
              placeholder="Ví dụ: thịt bò, cà chua, hành tây" aria-describedby="ingredient-hint" />
            <button type="button" className="btn-secondary h-11" onClick={() => addIngredients(draft)} disabled={!draft.trim()}>
              <PlusIcon className="h-4 w-4" /><span className="hidden sm:inline">Thêm</span>
            </button>
          </div>
          {suggestions.length > 0 && <section className="mt-4 overflow-hidden rounded-2xl border border-line bg-[#fffaf4]" aria-label="Danh mục nguyên liệu gợi ý">
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <div><h2 className="font-semibold">Chọn nguyên liệu</h2><p className="mt-0.5 text-xs text-muted">Các lựa chọn trong danh mục phù hợp với “{draft.trim()}”</p></div>
              <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">{suggestions.length} loại</span>
            </div>
            <ul className="max-h-64 overflow-y-auto px-4 sm:px-5">
              {suggestions.map((suggestion) => {
                const checked = ingredients.some((item) => ingredientKey(item) === ingredientKey(suggestion));
                return <li key={suggestion} className="border-b border-line last:border-0">
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2.5 text-sm sm:text-base">
                    <input type="checkbox" checked={checked} onChange={() => toggleIngredient(suggestion)} className="h-5 w-5 shrink-0 accent-brand" />
                    <span className="min-w-0 flex-1">{suggestion}</span>
                    <span className={`text-xs font-medium ${checked ? 'text-brand' : 'text-muted'}`}>{checked ? 'Đã chọn' : 'Thêm'}</span>
                  </label>
                </li>;
              })}
            </ul>
          </section>}
          <p id="ingredient-hint" className="mt-2 text-xs text-muted">Nhấn Enter hoặc dấu phẩy để thêm; có thể nhập nhiều nguyên liệu ngăn cách bằng dấu phẩy.</p>
        </div>

        {ingredients.length > 0 && <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-label="Nguyên liệu đã chọn">
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Nguyên liệu của bạn</h2><span className="text-xs text-muted">{ingredients.length} đã chọn</span></div>
          <ul>{ingredients.map((ingredient) => <li key={ingredientKey(ingredient)} className="border-b border-line last:border-0">
            <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2 text-sm sm:text-base">
              <input type="checkbox" checked onChange={() => toggleIngredient(ingredient)} className="h-5 w-5 shrink-0 accent-brand" />
              <span className="min-w-0 flex-1">{ingredient}</span><span className="text-xs font-medium text-brand">Đã chọn</span>
            </label>
          </li>)}</ul>
        </section>}

        <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm font-medium">Calo tối đa mỗi khẩu phần
            <input className="input mt-1.5 h-10" type="number" min="0" max="10000" step="1" value={maxCalories}
              onChange={(event) => setMaxCalories(event.target.value)} placeholder="Không giới hạn" />
          </label>
          <label className="text-sm font-medium">Protein tối thiểu mỗi khẩu phần (g)
            <input className="input mt-1.5 h-10" type="number" min="0" max="1000" step="0.1" value={minProtein}
              onChange={(event) => setMinProtein(event.target.value)} placeholder="Không giới hạn" />
          </label>
          <label className="text-sm font-medium">Mục tiêu (ưu tiên nhãn tham khảo)
            <select className="input mt-1.5 h-10" value={goal} onChange={(event) => setGoal(event.target.value as NutritionGoal | '')}>
              <option value="">Dùng mục tiêu hồ sơ</option>
              {goals.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Bữa muốn chọn món
            <select className="input mt-1.5 h-10" value={mealType} onChange={(event) => setMealType(event.target.value as MealType)}>
              <option value="breakfast">Bữa sáng</option><option value="lunch">Bữa trưa</option><option value="dinner">Bữa tối</option>
            </select>
          </label>
          <label className="text-sm font-medium">Ngày thực đơn
            <input className="input mt-1.5 h-10" type="date" value={planDate} onChange={(event) => setPlanDate(event.target.value)} />
          </label>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted">{user?.profile?.goal ? `Mục tiêu trong hồ sơ: ${goals.find((item) => item.value === user.profile?.goal)?.label ?? user.profile.goal}.` : 'Bạn chưa đặt mục tiêu trong hồ sơ.'} Nhãn AI chỉ là tín hiệu xếp hạng phụ.</p>
          <button type="submit" disabled={loading || ingredients.length === 0} className="btn-primary h-11 shrink-0">
            {loading ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
            {loading ? 'Đang tìm món…' : 'Tìm món phù hợp'}
          </button>
        </div>
        {error && <p role="alert" className="rounded-lg bg-accent-soft p-3 text-sm text-accent">{error}</p>}
      </form>

      {loading && <section className="card p-8 text-center" aria-live="polite"><LoaderCircleIcon className="mx-auto h-6 w-6 animate-spin text-brand" /><p className="mt-3 text-sm text-muted">Đang so khớp nguyên liệu với công thức…</p></section>}
      {!loading && result && result.results.length === 0 && <section className="card p-8 text-center">
        <SearchIcon className="mx-auto h-7 w-7 text-muted" /><h2 className="mt-3 font-semibold">Chưa tìm thấy món phù hợp</h2>
        <p className="mt-1 text-sm text-muted">Thử thêm nguyên liệu khác hoặc nới bộ lọc calo/protein.</p>
      </section>}
      {!loading && result && result.results.length > 0 && <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-xl font-semibold">Món có thể tham khảo</h2><p className="mt-1 text-sm text-muted">Tìm thấy {result.total} món · đang hiển thị {result.results.length} kết quả, xếp theo độ tương đồng và tỷ lệ nguyên liệu khớp.</p></div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {result.results.map((dish) => <RecommendationCard key={dish.dish_id} dish={dish} mealType={mealType}
            saving={savingDishId === dish.dish_id} busy={savingDishId !== null} onChoose={() => chooseForMeal(dish)} onOpen={() => setSelectedDish(dish)} />)}
        </div>
        <div className="space-y-2">{result.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">{warning}</p>)}</div>
      </section>}
      {!result && !loading && !error && <section className="card p-6 text-sm leading-6 text-muted">
        Nhập những nguyên liệu bạn có để bắt đầu. Dị ứng và nguyên liệu cần tránh trong hồ sơ sẽ tự động được loại khỏi kết quả khi xác định được từ công thức.
      </section>}
      {selectedDish && <RecommendationDetails dish={selectedDish} onClose={() => setSelectedDish(null)} />}
    </div>
  );
}

function RecommendationCard({dish, mealType, saving, busy, onChoose, onOpen}: {dish: IngredientRecommendation; mealType: MealType; saving: boolean; busy: boolean; onChoose: () => void; onOpen: () => void}) {
  const mealLabel = mealType === 'breakfast' ? 'bữa sáng' : mealType === 'lunch' ? 'bữa trưa' : 'bữa tối';
  const canSave = dish.serving_grams !== null && dish.calories !== null && dish.protein !== null && dish.carb !== null && dish.fat !== null;
  return <article className="card overflow-hidden">
    <div className="grid sm:grid-cols-[200px_minmax(0,1fr)]">
      <DishImage src={dish.image_url} alt={dish.name} />
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3><button type="button" onClick={onOpen} className="text-left text-lg font-semibold text-brand hover:underline">{dish.name}</button></h3><button type="button" onClick={onOpen} className="mt-1 text-xs font-medium text-muted hover:text-brand">Xem nguyên liệu và cách chế biến</button></div>
          {dish.nutrition_label && <span title={dish.nutrition_label_note ?? undefined} className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">Nhãn AI: {dish.nutrition_label}</span>}
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Nutrient label="Calo" value={dish.calories} unit="kcal" />
          <Nutrient label="Protein" value={dish.protein} unit="g" />
          <Nutrient label="Carb" value={dish.carb} unit="g" />
          <Nutrient label="Fat" value={dish.fat} unit="g" />
        </div>
        <p className="text-xs text-muted">Khẩu phần {dish.serving_grams === null ? 'không rõ' : `${fmt(dish.serving_grams, 1)} g`} · Tương đồng văn bản {fmt(dish.similarity_score * 100, 1)}% · Có {dish.matched_count}/{dish.required_count} thành phần ({fmt(dish.ingredient_match_ratio * 100, 0)}%)</p>
        {dish.nutrition_label_note && <p className="text-xs leading-5 text-muted">{dish.nutrition_label_note}</p>}
        <button type="button" onClick={onChoose} disabled={busy || !canSave} className="btn-primary h-10 w-full disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : null}
          {saving ? 'Đang lưu vào thực đơn…' : `Chọn cho ${mealLabel}`}
        </button>
        {!canSave && <p className="text-xs text-accent">Món thiếu dữ liệu khẩu phần/dinh dưỡng cần thiết nên chưa thể lưu.</p>}
      </div>
    </div>
  </article>;
}

function DishImage({src, alt}: {src: string | null; alt: string}) {
  const [failed, setFailed] = useState(false);
  return src && !failed
    ? <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="h-48 w-full bg-surface object-cover sm:h-full sm:min-h-56" />
    : <div className="flex h-48 items-center justify-center bg-surface text-muted sm:min-h-56"><ImageIcon className="h-8 w-8" /><span className="sr-only">Chưa có ảnh món {alt}</span></div>;
}

function RecommendationDetails({dish, onClose}: {dish: IngredientRecommendation; onClose: () => void}) {
  const steps = (dish.instructions ?? '').split(/\r?\n+/).map((line) => line.trim()).filter(Boolean)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ỹ“])/u).map((sentence) => sentence.trim()).filter(Boolean));
  const available = new Set(dish.matched_ingredients.map(ingredientKey));
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-3 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="recommendation-details-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }} className="my-auto max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-[#fff8f2] shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#eee3d9] bg-[#fff8f2]/95 px-5 py-3 backdrop-blur sm:px-7"><span className="text-sm font-semibold text-muted">Chi tiết món gợi ý</span><button type="button" autoFocus onClick={onClose} aria-label="Đóng chi tiết món" className="rounded-lg p-2 text-muted hover:bg-white"><XIcon className="h-5 w-5" /></button></div>
      <div className="space-y-7 p-5 sm:p-7">
        <div className="mx-auto w-full max-w-xl"><DishImage src={dish.image_url} alt={dish.name} /></div>
        <div><h2 id="recommendation-details-title" className="text-2xl font-semibold sm:text-3xl">{dish.name}</h2><p className="mt-2 text-sm text-muted">Khẩu phần {dish.serving_grams === null ? 'chưa rõ' : `${fmt(dish.serving_grams, 1)} g`} · Có {dish.matched_count}/{dish.required_count} thành phần</p></div>
        <section className="rounded-2xl border border-[#dfe1cf] bg-[#f2f1e3] p-4 sm:p-5"><h3 className="font-semibold">Dinh dưỡng theo khẩu phần</h3><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><Nutrient label="Calo" value={dish.calories} unit="kcal"/><Nutrient label="Protein" value={dish.protein} unit="g"/><Nutrient label="Carb" value={dish.carb} unit="g"/><Nutrient label="Fat" value={dish.fat} unit="g"/></div></section>
        <section><div className="mb-2 flex items-center justify-between"><h3 className="text-2xl font-medium">Nguyên liệu</h3><span className="rounded-full bg-[#f0efdf] px-3 py-1.5 text-xs font-medium text-brand">{dish.ingredients.length} mục</span></div>
          {dish.ingredients.length ? <ul className="divide-y divide-[#eee3d9]">{dish.ingredients.map((ingredient) => <li key={ingredient} className="flex min-h-12 items-center justify-between gap-3 py-2.5 text-sm"><span>{ingredient}</span><span className={`shrink-0 text-xs font-medium ${available.has(ingredientKey(ingredient)) ? 'text-brand' : 'text-accent'}`}>{available.has(ingredientKey(ingredient)) ? 'Đã có' : 'Còn thiếu'}</span></li>)}</ul> : <p className="text-sm text-muted">Chưa có danh sách nguyên liệu cho món này.</p>}
        </section>
        <section><h3 className="mb-3 text-2xl font-medium">Các bước nấu</h3>{steps.length ? <ol className="space-y-3">{steps.map((step, index) => <li key={`${index}-${step}`} className="rounded-2xl bg-white p-4 sm:p-5"><div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#cf4f2c] text-sm font-semibold text-white">{index + 1}</span><p className="pt-1 text-sm leading-6 sm:text-base">{step}</p></div></li>)}</ol> : <p className="text-sm text-muted">Catalog chưa có hướng dẫn chế biến cho món này.</p>}</section>
      </div>
    </section>
  </div>;
}

function Nutrient({label, value, unit}: {label: string; value: number | null; unit: string}) {
  return <div className="rounded-lg bg-surface px-2 py-1.5"><p className="text-[11px] text-muted">{label}</p><p className="font-medium">{value === null ? '—' : `${fmt(value, 1)} ${unit}`}</p></div>;
}
