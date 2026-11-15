import { ImageIcon, RotateCwIcon, UtensilsIcon, XIcon } from 'lucide-react';
import { resolveAssetUrl } from '../../api/client';
import { CatalogDish } from '../../types/recommendations';
import { fmt } from '../../utils/format';

export function RouletteResult({
  dish,
  onClose,
  onRecipe,
  onSpinAgain,
}: {
  dish: CatalogDish;
  onClose: () => void;
  onRecipe: () => void;
  onSpinAgain: () => void;
}) {
  const imageUrl = resolveAssetUrl(dish.image_url);
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#241b17]/60 p-3 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="roulette-result-title" className="my-auto max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-[#fffaf1] shadow-2xl">
      <div className="relative overflow-hidden bg-gradient-to-br from-[#ffe9c8] via-[#ffdcc1] to-[#f5b190] px-5 pb-6 pt-5 text-center sm:px-8">
        <span className="pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full bg-white/30" /><span className="pointer-events-none absolute -right-8 top-8 h-28 w-28 rounded-full bg-[#f6a44e]/20" />
        <button type="button" onClick={onClose} aria-label="Đóng kết quả" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/65 text-[#724b39] hover:bg-white"><XIcon className="h-4 w-4" /></button>
        <p className="relative text-xs font-black uppercase tracking-[0.2em] text-[#b34a2f]">HÔM NAY ĂN MÓN NÀY NHÉ!</p>
        <h2 id="roulette-result-title" className="relative mt-1 font-serif text-2xl font-black leading-tight text-[#54372d] sm:text-3xl">Trúng món ngon rồi!</h2>
        <div className="relative mx-auto mt-5 h-48 w-full max-w-sm overflow-hidden rounded-[1.5rem] border-4 border-white bg-[#f0e5d5] shadow-lg sm:h-56">
          {imageUrl ? <img src={imageUrl} alt={dish.name} className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <span className="grid h-full place-items-center text-[#ad8a69]"><ImageIcon className="h-12 w-12" /></span>}
        </div>
        <h3 className="relative mt-4 font-serif text-2xl font-bold text-[#583b2e]">{dish.name}</h3>
      </div>
      <div className="space-y-5 p-5 sm:p-7">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Nutrition label="Năng lượng" value={dish.calories} unit="kcal" />
          <Nutrition label="Protein" value={dish.protein} unit="g" />
          <Nutrition label="Carb" value={dish.carb} unit="g" />
          <Nutrition label="Fat" value={dish.fat} unit="g" />
        </div>
        {dish.ingredients.length > 0 && <section><h4 className="flex items-center gap-2 text-sm font-bold text-[#604638]"><UtensilsIcon className="h-4 w-4 text-[#d15e3c]" />Nguyên liệu</h4><p className="mt-2 text-sm leading-6 text-[#806d5d]">{dish.ingredients.join(' · ')}</p></section>}
        {dish.instructions && <section><h4 className="text-sm font-bold text-[#604638]">Cách chế biến</h4><p className="mt-2 line-clamp-4 whitespace-pre-line text-sm leading-6 text-[#806d5d]">{dish.instructions}</p></section>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button type="button" onClick={onRecipe} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#d75d3a] px-4 text-sm font-bold text-white shadow-[0_5px_14px_rgba(215,93,58,0.24)] transition hover:bg-[#bd492e] active:scale-95"><UtensilsIcon className="h-4 w-4" />Xem công thức</button>
          <button type="button" onClick={onClose} className="h-11 rounded-full bg-[#f4eadb] px-4 text-sm font-bold text-[#6d513e] transition hover:bg-[#ecddc8] active:scale-95">Quay lại</button>
          <button type="button" onClick={onSpinAgain} className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#e8c8a3] bg-white px-4 text-sm font-bold text-[#b95737] transition hover:bg-[#fff4e5] active:scale-95"><RotateCwIcon className="h-4 w-4" />Quay lại lần nữa</button>
        </div>
      </div>
    </section>
  </div>;
}

function Nutrition({label, value, unit}: {label: string; value: number | null; unit: string}) {
  return <div className="rounded-2xl bg-[#f7efe2] px-3 py-3 text-center"><p className="text-[10px] font-semibold text-[#907a66] sm:text-xs">{label}</p><p className="mt-1 text-sm font-black tabular-nums text-[#573b2e]">{value == null ? 'Chưa có dữ liệu' : `${fmt(value, 1)} ${unit}`}</p></div>;
}
