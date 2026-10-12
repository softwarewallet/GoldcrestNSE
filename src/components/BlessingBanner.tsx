import React, { useState } from 'react';
import blessingImg from '../assets/images/blessings_banner_1791706429817.jpg';

export const BlessingBanner: React.FC = () => {
  const [imgError, setImgError] = useState(false);

  return (
    <div 
      className="flex items-center justify-center h-full max-h-[86px] transition-all duration-300"
      title="|| श्री गणेशाय नमः || || ॐ श्रीं महालक्ष्म्यै नमः || - Auspicious Blessings for Profitable Trades"
    >
      <div className="relative group flex items-center justify-center rounded-xl p-1 bg-gradient-to-r from-amber-950/40 via-amber-900/30 to-amber-950/40 border border-amber-500/40 shadow-[0_0_16px_rgba(245,158,11,0.18)] hover:shadow-[0_0_24px_rgba(245,158,11,0.3)] transition-all overflow-hidden h-10 sm:h-12 md:h-16 lg:h-20 xl:h-[84px] max-w-full">
        {/* Divine Aura Glow Accent */}
        <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/10 via-amber-500/5 to-yellow-500/10 pointer-events-none" />

        {!imgError ? (
          <img
            src={blessingImg}
            onError={() => {
              // Try public URL fallback, otherwise show SVG blessing artwork
              setImgError(true);
            }}
            alt="Blessings of Prosperity: Shree Ganesh, Maha Lakshmi, Om, Swastik"
            className="h-full w-auto object-contain rounded-lg transition-transform duration-300 group-hover:scale-[1.02] drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]"
          />
        ) : (
          /* High-Fidelity Auspicious Prosperity Artwork Fallback with Ganesh, Lakshmi, Om, Swastik */
          <div className="h-full px-3 py-1 flex items-center gap-3 text-amber-300 select-none">
            {/* Swastik Left */}
            <div className="flex flex-col items-center justify-center">
              <span className="text-rose-500 font-extrabold text-base md:text-xl xl:text-2xl drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]">卐</span>
              <span className="text-[9px] md:text-[10px] text-amber-400 font-bold tracking-wider">शुभ</span>
            </div>

            {/* Sacred Om & Divine Names */}
            <div className="flex flex-col items-center justify-center text-center px-1">
              <div className="flex items-center gap-1.5 md:gap-2">
                <span className="text-amber-400 font-serif font-black text-lg md:text-2xl xl:text-3xl drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]">ॐ</span>
                <div className="text-left font-serif leading-none">
                  <div className="text-[11px] md:text-sm xl:text-base font-extrabold text-amber-200 tracking-wide drop-shadow">
                    श्री गणेश • महालक्ष्मी
                  </div>
                  <div className="text-[8px] md:text-[10px] xl:text-[11px] text-amber-400 font-semibold tracking-widest mt-0.5">
                    समृद्धि एवं लाभ कृपा
                  </div>
                </div>
              </div>
            </div>

            {/* Swastik Right */}
            <div className="flex flex-col items-center justify-center">
              <span className="text-rose-500 font-extrabold text-base md:text-xl xl:text-2xl drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]">卐</span>
              <span className="text-[9px] md:text-[10px] text-amber-400 font-bold tracking-wider">लाभ</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
