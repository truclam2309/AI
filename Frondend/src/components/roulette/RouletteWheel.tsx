import { useState } from 'react';
import { ImageIcon, UtensilsIcon } from 'lucide-react';
import { resolveAssetUrl } from '../../api/client';
import { CatalogDish } from '../../types/recommendations';

const colors = ['#f6a04d', '#e96c48', '#f3d986', '#7fa66c', '#f8c978', '#d95337', '#f4e6ad', '#80a779'];

function title(value: string) {
  return value.replace(/\s*[-–—]\s*\d+(?:[.,]\d+)?\s*(?:g|kg)\s*$/i, '').trim();
}

function WheelDishImage({dish}: {dish: CatalogDish}) {
  const [failed, setFailed] = useState(false);
  const url = resolveAssetUrl(dish.image_url);
  return url && !failed
    ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full rounded-full object-cover" />
    : <span className="grid h-full w-full place-items-center rounded-full bg-[#fff4df] text-[#b46b3b]"><ImageIcon className="h-5 w-5" aria-hidden="true" /></span>;
}

export function RouletteWheel({
  dishes,
  rotation,
  spinning,
  onTransitionEnd,
}: {
  dishes: CatalogDish[];
  rotation: number;
  spinning: boolean;
  onTransitionEnd: (event: React.TransitionEvent<HTMLDivElement>) => void;
}) {
  const count = Math.max(dishes.length, 1);
  const slice = 360 / count;
  const background = dishes.length
    ? `conic-gradient(from 0deg, ${dishes.map((_, index) => `${colors[index % colors.length]} ${index * slice}deg ${(index + 1) * slice}deg`).join(', ')})`
    : 'conic-gradient(#f6a04d 0deg 90deg, #e96c48 90deg 180deg, #f3d986 180deg 270deg, #7fa66c 270deg 360deg)';

  return (
    <div className="relative mx-auto aspect-square w-[min(86vw,35rem)] select-none">
      {Array.from({ length: 20 }, (_, index) => {
        const angle = (index / 20) * Math.PI * 2;
        return <span key={index} aria-hidden="true" className="absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#fff1c7] bg-[#ffe8a2] shadow-[0_0_10px_3px_rgba(255,218,115,0.85)] sm:h-3 sm:w-3" style={{left: `${50 + 48 * Math.sin(angle)}%`, top: `${50 - 48 * Math.cos(angle)}%`}} />;
      })}
      <div className="absolute left-1/2 top-0 z-30 -translate-x-1/2 drop-shadow-md" aria-hidden="true">
        <div className="h-0 w-0 border-x-[15px] border-t-[29px] border-x-transparent border-t-[#963d25] sm:border-x-[19px] sm:border-t-[36px]" />
        <div className="mx-auto -mt-[29px] h-0 w-0 border-x-[9px] border-t-[18px] border-x-transparent border-t-[#ffda79] sm:-mt-[36px] sm:border-x-[11px] sm:border-t-[22px]" />
      </div>
      <div className="absolute inset-[4%] rounded-full border-[9px] border-[#c98638] bg-[#f1c568] p-1.5 shadow-[0_16px_32px_rgba(127,65,28,0.25)] sm:border-[12px] sm:p-2">
        <div
          className="relative h-full w-full overflow-hidden rounded-full border-[3px] border-[#fff0c6] shadow-inner"
          style={{background, transform: `rotate(${rotation}deg)`, transition: spinning ? 'transform 5.2s cubic-bezier(0.12, 0.72, 0.12, 1)' : 'none'}}
          onTransitionEnd={onTransitionEnd}
          role="img"
          aria-label={`Vòng quay gồm ${dishes.length} món`}
        >
          {dishes.map((dish, index) => {
            const angle = ((index + 0.5) * slice * Math.PI) / 180;
            const x = 50 + 30 * Math.sin(angle);
            const y = 50 - 30 * Math.cos(angle);
            return <div key={dish.dish_id} className="absolute z-[1] flex w-[22%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center" style={{left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -50%) rotate(${-rotation}deg)`}}>
              <span className="h-11 w-11 rounded-full border-[3px] border-white bg-white p-0.5 shadow-md sm:h-[4.25rem] sm:w-[4.25rem] sm:border-4"><WheelDishImage dish={dish} /></span>
              <span className="max-w-full rounded-full bg-[#fffaf0]/90 px-1.5 py-0.5 text-[8px] font-bold leading-tight text-[#55372b] shadow-sm sm:text-[10px]">{title(dish.name).slice(0, 18)}</span>
              {dish.goal_fit_percent != null && <span className="rounded-full bg-[#28623c] px-1.5 py-0.5 text-[8px] font-black leading-tight text-white shadow-sm sm:text-[10px]">{Math.round(dish.goal_fit_percent)}%</span>}
            </div>;
          })}
        </div>
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 grid h-[4.4rem] w-[4.4rem] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[5px] border-[#f2d99f] bg-white text-[#d95d38] shadow-[0_4px_16px_rgba(75,47,31,0.24)] sm:h-24 sm:w-24 sm:border-[7px]">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#fff3df] sm:h-14 sm:w-14"><UtensilsIcon className="h-5 w-5 sm:h-7 sm:w-7" aria-hidden="true" /></span>
        </div>
      </div>
    </div>
  );
}
