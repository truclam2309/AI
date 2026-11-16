import { ImageIcon, XIcon } from 'lucide-react';
import { resolveAssetUrl } from '../../api/client';
import { CatalogDish } from '../../types/recommendations';

export function RouletteResult({
  dish,
  onClose,
}: {
  dish: CatalogDish;
  onClose: () => void;
}) {
  const imageUrl = resolveAssetUrl(dish.image_url);
  const dishName = dish.name.normalize('NFC');
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#1F5136]/60 p-3 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="roulette-result-title" className="my-auto max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-[#FFFFFF] font-sans shadow-2xl" style={{fontFamily: 'Arial, "Be Vietnam Pro", system-ui, sans-serif'}}>
      <div className="relative overflow-hidden bg-gradient-to-br from-[#F6F3EC] via-[#F6F3EC] to-[#F8E6DA] px-5 pb-7 pt-8 text-center sm:px-8">
        <span className="pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full bg-white/30" /><span className="pointer-events-none absolute -right-8 top-8 h-28 w-28 rounded-full bg-[#C4521F]/20" />
        <button type="button" onClick={onClose} aria-label="Đóng kết quả" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/65 text-[#1F5136] hover:bg-white"><XIcon className="h-4 w-4" /></button>
        <div className="relative mx-auto h-56 w-full max-w-sm overflow-hidden rounded-[1.5rem] border-4 border-white bg-[#F6F3EC] shadow-lg sm:h-72">
          {imageUrl ? <img src={imageUrl} alt={dishName} className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <span className="grid h-full place-items-center text-[#C4521F]"><ImageIcon className="h-12 w-12" /></span>}
        </div>
        <h2 id="roulette-result-title" className="relative mt-5 font-sans text-2xl font-bold leading-tight text-[#1F5136] sm:text-3xl">{dishName}</h2>
      </div>
    </section>
  </div>;
}
