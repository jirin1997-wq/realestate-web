import { useState } from 'react';

function Arrow({ dir, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === 'prev' ? 'Předchozí fotka' : 'Další fotka'}
      className={`absolute top-1/2 -translate-y-1/2 ${dir === 'prev' ? 'left-3' : 'right-3'} w-10 h-10 rounded-full bg-white/90 shadow flex items-center justify-center text-slate-800 hover:bg-white`}
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={dir === 'prev' ? 'M12 4l-6 6 6 6' : 'M8 4l6 6-6 6'} />
      </svg>
    </button>
  );
}

export default function PhotoGallery({ photos = [] }) {
  const [broken, setBroken] = useState([]);
  const [index, setIndex] = useState(0);

  const visible = photos.filter((p) => !broken.includes(p));
  if (!visible.length) return null;

  const current = Math.min(index, visible.length - 1);
  const go = (delta) => setIndex((current + delta + visible.length) % visible.length);
  const markBroken = (src) => setBroken((b) => [...b, src]);

  return (
    <div className="mb-6">
      <div className="relative bg-slate-100 rounded-2xl overflow-hidden aspect-[4/3] sm:aspect-[16/9]">
        <img
          key={visible[current]}
          src={visible[current]}
          alt={`Fotka ${current + 1} z ${visible.length}`}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          onError={() => markBroken(visible[current])}
        />
        {visible.length > 1 && (
          <>
            <Arrow dir="prev" onClick={() => go(-1)} />
            <Arrow dir="next" onClick={() => go(1)} />
            <span className="absolute bottom-3 right-3 px-2 py-0.5 rounded-lg bg-slate-900/70 text-white text-xs font-medium">
              {current + 1} / {visible.length}
            </span>
          </>
        )}
      </div>

      {visible.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {visible.map((src, i) => (
            <button
              key={src}
              onClick={() => setIndex(i)}
              aria-label={`Zobrazit fotku ${i + 1}`}
              className={`shrink-0 w-20 h-14 rounded-lg overflow-hidden ring-2 ${i === current ? 'ring-slate-900' : 'ring-transparent opacity-70 hover:opacity-100'}`}
            >
              <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" onError={() => markBroken(src)} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
