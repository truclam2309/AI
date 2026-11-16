import { useMemo, useState } from 'react';
import { CheckIcon, ImageIcon, SearchIcon, XIcon } from 'lucide-react';
import { resolveAssetUrl } from '../../api/client';
import { CatalogDish } from '../../types/recommendations';

export function FoodSelectorModal({
  dishes,
  selectedIds,
  onSelectionChange,
  onClose,
}: {
  dishes: CatalogDish[];
  selectedIds: string[];
  onSelectionChange: (dishIds: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi');
    return normalized ? dishes.filter((dish) => `${dish.name} ${dish.food_group ?? ''}`.toLocaleLowerCase('vi').includes(normalized)) : dishes;
  }, [dishes, query]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1F5136]/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="roulette-selector-title" className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-[2rem] bg-[#FFFFFF] p-5 font-sans shadow-2xl sm:rounded-[2rem] sm:p-7" style={{fontFamily: 'Arial, "Be Vietnam Pro", system-ui, sans-serif'}}>
      <header className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#C4521F]">Danh sách vòng quay</p><h2 id="roulette-selector-title" className="mt-1 font-sans text-2xl font-bold text-[#1F5136]">Chọn món muốn tham gia</h2><p className="mt-1 text-sm text-[#5F6B63]">Đang chọn {selectedIds.length} / {dishes.length} món theo mục tiêu.</p></div>
        <button type="button" onClick={onClose} aria-label="Đóng danh sách món" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F6F3EC] text-[#1F5136] hover:bg-[#F8E6DA]"><XIcon className="h-5 w-5" /></button>
      </header>
      <label className="mt-5 flex h-12 items-center gap-2 rounded-2xl border border-[#F8E6DA] bg-white px-4 focus-within:border-[#C4521F]">
        <SearchIcon className="h-4 w-4 text-[#C4521F]" /><span className="sr-only">Tìm món ăn</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm món trong danh sách..." className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#C4521F]" />
      </label>
      <div className="mt-3 flex gap-2 text-xs font-semibold">
        <button type="button" onClick={() => onSelectionChange([...new Set([...selectedIds, ...filtered.map((dish) => dish.dish_id)])])} className="rounded-full bg-[#F6F3EC] px-3 py-2 text-[#1F5136] hover:bg-[#F8E6DA]">Chọn {filtered.length} món đang lọc</button>
        <button type="button" onClick={() => { const remove = new Set(filtered.map((dish) => dish.dish_id)); onSelectionChange(selectedIds.filter((id) => !remove.has(id))); }} className="rounded-full bg-white px-3 py-2 text-[#1F5136] ring-1 ring-[#F8E6DA] hover:bg-[#F6F3EC]">Bỏ chọn các món đang lọc</button>
      </div>
      <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {filtered.map((dish) => {
          const checked = selectedSet.has(dish.dish_id);
          const imageUrl = resolveAssetUrl(dish.image_url);
          return <button key={dish.dish_id} type="button" onClick={() => onSelectionChange(checked ? selectedIds.filter((id) => id !== dish.dish_id) : [...selectedIds, dish.dish_id])} aria-pressed={checked} className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition ${checked ? 'border-[#C4521F] bg-[#F6F3EC]' : 'border-[#F6F3EC] bg-white hover:border-[#F8E6DA]'}`}>
            <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[#F6F3EC]">{imageUrl ? <img src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <span className="grid h-full place-items-center text-[#C4521F]"><ImageIcon className="h-5 w-5" /></span>}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#1F5136]">{dish.name}</span><span className="mt-1 block truncate text-xs text-[#5F6B63]">{dish.food_group || 'Món ăn'} · {dish.calories == null ? 'Chưa có kcal' : `${dish.calories} kcal`}</span></span>
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${checked ? 'border-[#C4521F] bg-[#C4521F] text-white' : 'border-[#F8E6DA] bg-white text-transparent'}`}><CheckIcon className="h-4 w-4" /></span>
          </button>;
        })}
        {!filtered.length && <p className="rounded-2xl bg-white p-8 text-center text-sm text-[#5F6B63]">Không có món khớp tìm kiếm.</p>}
      </div>
      <footer className="mt-4 flex items-center justify-between gap-3 border-t border-[#F6F3EC] pt-4">
        <p className={`text-xs ${selectedIds.length < 2 ? 'text-[#C4521F]' : 'text-[#5F6B63]'}`}>{selectedIds.length < 2 ? 'Chọn ít nhất 2 món để quay.' : `Vòng quay có ${selectedIds.length} lựa chọn.`}</p>
        <button type="button" onClick={onClose} className="rounded-full bg-[#C4521F] px-6 py-2.5 text-sm font-bold text-white shadow-[0_5px_14px_rgba(216,94,59,0.25)] transition hover:bg-[#C4521F] active:scale-95">Xong</button>
      </footer>
    </section>
  </div>;
}
