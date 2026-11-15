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

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#241b17]/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="roulette-selector-title" className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-[2rem] bg-[#fffaf1] p-5 shadow-2xl sm:rounded-[2rem] sm:p-7">
      <header className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#c35a37]">Danh sách vòng quay</p><h2 id="roulette-selector-title" className="mt-1 font-serif text-2xl font-bold text-[#53382d]">Chọn món muốn tham gia</h2><p className="mt-1 text-sm text-[#8d7868]">Đang chọn {selectedIds.length} / {dishes.length} món theo mục tiêu.</p></div>
        <button type="button" onClick={onClose} aria-label="Đóng danh sách món" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#f4ead9] text-[#735545] hover:bg-[#ead8be]"><XIcon className="h-5 w-5" /></button>
      </header>
      <label className="mt-5 flex h-12 items-center gap-2 rounded-2xl border border-[#eadcc6] bg-white px-4 focus-within:border-[#dc7848]">
        <SearchIcon className="h-4 w-4 text-[#9d8977]" /><span className="sr-only">Tìm món ăn</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm món trong danh sách..." className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#ae9d8e]" />
      </label>
      <div className="mt-3 flex gap-2 text-xs font-semibold">
        <button type="button" onClick={() => onSelectionChange([...new Set([...selectedIds, ...filtered.map((dish) => dish.dish_id)])])} className="rounded-full bg-[#f5e8d3] px-3 py-2 text-[#75503b] hover:bg-[#eed9b8]">Chọn {filtered.length} món đang lọc</button>
        <button type="button" onClick={() => { const remove = new Set(filtered.map((dish) => dish.dish_id)); onSelectionChange(selectedIds.filter((id) => !remove.has(id))); }} className="rounded-full bg-white px-3 py-2 text-[#75503b] ring-1 ring-[#eadcc6] hover:bg-[#fff4e3]">Bỏ chọn các món đang lọc</button>
      </div>
      <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {filtered.map((dish) => {
          const checked = selectedSet.has(dish.dish_id);
          const imageUrl = resolveAssetUrl(dish.image_url);
          return <button key={dish.dish_id} type="button" onClick={() => onSelectionChange(checked ? selectedIds.filter((id) => id !== dish.dish_id) : [...selectedIds, dish.dish_id])} aria-pressed={checked} className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition ${checked ? 'border-[#e39054] bg-[#fff1dc]' : 'border-[#eee5d8] bg-white hover:border-[#dfc4a3]'}`}>
            <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[#f1e4d2]">{imageUrl ? <img src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <span className="grid h-full place-items-center text-[#b38762]"><ImageIcon className="h-5 w-5" /></span>}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#51382d]">{dish.name}</span><span className="mt-1 block truncate text-xs text-[#8c7968]">{dish.food_group || 'Món ăn'} · {dish.calories == null ? 'Chưa có kcal' : `${dish.calories} kcal`}</span></span>
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${checked ? 'border-[#d7653f] bg-[#d7653f] text-white' : 'border-[#cdbba6] bg-white text-transparent'}`}><CheckIcon className="h-4 w-4" /></span>
          </button>;
        })}
        {!filtered.length && <p className="rounded-2xl bg-white p-8 text-center text-sm text-[#8d7868]">Không có món khớp tìm kiếm.</p>}
      </div>
      <footer className="mt-4 flex items-center justify-between gap-3 border-t border-[#eee3d3] pt-4">
        <p className={`text-xs ${selectedIds.length < 2 ? 'text-[#bd4d32]' : 'text-[#8d7868]'}`}>{selectedIds.length < 2 ? 'Chọn ít nhất 2 món để quay.' : `Vòng quay có ${selectedIds.length} lựa chọn.`}</p>
        <button type="button" onClick={onClose} className="rounded-full bg-[#d85e3b] px-6 py-2.5 text-sm font-bold text-white shadow-[0_5px_14px_rgba(216,94,59,0.25)] transition hover:bg-[#bb482c] active:scale-95">Xong</button>
      </footer>
    </section>
  </div>;
}
