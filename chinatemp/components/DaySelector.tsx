import React from 'react';
import { Language } from '../types';

interface DaySelectorProps {
  days: { zh: string; en: string }[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  lang: Language;
}

export const DaySelector: React.FC<DaySelectorProps> = ({ days, selectedIndex, onSelect, lang }) => {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 md:gap-2 p-1.5 bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-700/50 shadow-2xl shadow-black/50 max-w-[95%] overflow-x-auto no-scrollbar">
       {days.map((dayObj, idx) => (
         <button
            key={idx}
            onClick={() => onSelect(idx)}
            className={`
              relative px-3 md:px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 whitespace-nowrap
              flex flex-col items-center justify-center gap-0.5
              ${selectedIndex === idx 
                ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25 ring-1 ring-white/10' 
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}
            `}
         >
           <span>{lang === 'zh' ? dayObj.zh : dayObj.en}</span>
           {selectedIndex === idx && (
             <span className="w-1 h-1 bg-white rounded-full opacity-50 absolute bottom-1"></span>
           )}
         </button>
       ))}
    </div>
  );
}