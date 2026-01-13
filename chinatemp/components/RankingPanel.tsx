import React, { useState, useMemo } from 'react';
import { WeatherData, ForecastDay, Language } from '../types';
import { getColorForTemp } from './TemperatureLegend';

interface RankingPanelProps {
  title: string;
  data: WeatherData[];
  onBack?: () => void;
  lang: Language;
}

type SortOrder = 'desc' | 'asc';

// Sub-component for 7-Day Forecast visualization
const ForecastView: React.FC<{ forecast: ForecastDay[], lang: Language }> = ({ forecast, lang }) => {
  return (
    <div className="mt-3 pt-3 border-t border-gray-700/50 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex justify-between items-center mb-2">
         <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            {lang === 'zh' ? '未来7天预报' : '7-Day Forecast'}
         </h4>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {forecast.map((day, idx) => (
          <div key={idx} className="flex flex-col items-center group/day">
            <span className={`text-[9px] font-medium mb-1 ${idx === 0 ? 'text-blue-400' : 'text-gray-500'}`}>
              {lang === 'zh' ? day.dayName : day.dayNameEn}
            </span>
            
            {/* Temperature Bar Container */}
            <div className="w-full bg-gray-800/50 rounded-full h-20 relative w-1.5 md:w-2 mx-auto ring-1 ring-white/5">
               <div 
                  className="absolute w-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    bottom: `${Math.max(0, Math.min(100, (day.low + 10) * 2))}%`, 
                    height: `${Math.max(10, Math.min(100, (day.high - day.low) * 2))}%`, 
                    backgroundColor: getColorForTemp(day.high),
                    opacity: 0.8
                  }}
               />
            </div>
            
            <div className="flex flex-col items-center mt-1.5 gap-0.5">
              <span className="text-[10px] font-bold text-gray-300 leading-none">{day.high}°</span>
              <span className="text-[9px] text-gray-600 leading-none">{day.low}°</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Ad Component Placeholder
const AdSlot: React.FC = () => (
  <div className="my-4 mx-4 p-4 min-h-[100px] bg-gray-800/40 border border-gray-700 border-dashed rounded-lg flex flex-col items-center justify-center text-gray-500 text-xs hover:bg-gray-800/60 transition-colors cursor-pointer">
    <span className="uppercase tracking-widest font-semibold mb-1 opacity-50">广告 Ad</span>
    <div className="text-center opacity-70">Google AdSense Space</div>
  </div>
);

export const RankingPanel: React.FC<RankingPanelProps> = ({ 
  title, 
  data, 
  onBack,
  lang 
}) => {
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc'); 
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      return sortOrder === 'desc' 
        ? b.temperature - a.temperature 
        : a.temperature - b.temperature;
    });
  }, [data, sortOrder]);

  const toggleExpand = (name: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    setExpandedId(prev => prev === name ? null : name);
  };

  const getRankStyle = (index: number) => {
    if (index === 0) return {
      container: "border-yellow-500/40 bg-gradient-to-r from-yellow-900/20 to-transparent",
      badge: "bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.5)]",
      text: "text-yellow-100"
    };
    if (index === 1) return {
      container: "border-gray-400/40 bg-gradient-to-r from-gray-700/20 to-transparent",
      badge: "bg-gray-300 text-black shadow-[0_0_10px_rgba(209,213,219,0.5)]",
      text: "text-gray-100"
    };
    if (index === 2) return {
      container: "border-orange-600/40 bg-gradient-to-r from-orange-900/20 to-transparent",
      badge: "bg-orange-600 text-white shadow-[0_0_10px_rgba(234,88,12,0.5)]",
      text: "text-orange-100"
    };
    return {
      container: "border-gray-800 bg-gray-800 hover:bg-gray-750",
      badge: "bg-gray-700 text-gray-400",
      text: "text-gray-300"
    };
  };

  const t = {
    rank: lang === 'zh' ? '排行' : 'Ranking',
    regions: lang === 'zh' ? '地区' : 'Regions',
    back: lang === 'zh' ? '返回全国' : 'Back',
    hottest: lang === 'zh' ? '高温' : 'Hottest',
    coldest: lang === 'zh' ? '低温' : 'Coldest',
    wind: lang === 'zh' ? '风速' : 'Wind',
    nodata: lang === 'zh' ? '暂无数据' : 'No data'
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-700 shadow-2xl relative">
      {/* Header */}
      <div className="p-6 border-b border-gray-800 bg-gray-900/95 backdrop-blur z-10 sticky top-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex flex-col">
            <h2 className="text-xl font-bold text-white tracking-tight">{title} {t.rank}</h2>
            <div className="flex items-center gap-2 mt-1">
               <span className="text-xs text-gray-500">{data.length} {t.regions}</span>
            </div>
          </div>
          {onBack && (
            <button 
              onClick={onBack}
              className="px-3 py-1.5 text-xs font-medium text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors flex items-center gap-1 border border-gray-600"
            >
              <span>←</span> {t.back}
            </button>
          )}
        </div>

        {/* Sort Controls */}
        <div className="flex p-1 bg-gray-800 rounded-lg border border-gray-700">
          <button 
            onClick={() => setSortOrder('desc')}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all ${
              sortOrder === 'desc' 
                ? 'bg-red-500/10 text-red-400 shadow-sm ring-1 ring-red-500/50' 
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.hottest}
          </button>
          <button 
            onClick={() => setSortOrder('asc')}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all ${
              sortOrder === 'asc' 
                ? 'bg-blue-500/10 text-blue-400 shadow-sm ring-1 ring-blue-500/50' 
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.coldest}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth">
        {sortedData.map((item, index) => {
          const styles = getRankStyle(index);
          const isExpanded = expandedId === item.regionName;
          const name = lang === 'zh' ? item.regionName : item.regionNameEn;
          const condition = lang === 'zh' ? item.condition : item.conditionEn;

          return (
            <div 
              key={item.regionName}
              onClick={(e) => toggleExpand(item.regionName, e)}
              className={`group flex flex-col p-3 rounded-xl transition-all duration-300 border cursor-pointer select-none ${styles.container} ${isExpanded ? 'ring-1 ring-gray-500 bg-gray-800' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className={`flex justify-center items-center w-7 h-7 rounded-lg text-sm font-bold shadow-sm ${styles.badge}`}>
                    {index + 1}
                  </span>
                  <div>
                    <h3 className={`font-semibold ${styles.text} text-sm md:text-base`}>{name}</h3>
                    <div className="text-xs text-gray-500 flex gap-2 items-center mt-0.5">
                      <span>{condition}</span>
                      <span className="w-1 h-1 rounded-full bg-gray-600"></span>
                      <span>{t.wind}: {item.windSpeed} km/h</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div 
                      className="text-lg font-bold tabular-nums tracking-tight"
                      style={{ color: getColorForTemp(item.temperature) }}
                    >
                      {item.temperature}°
                    </div>
                  </div>
                  {/* Chevron Indicator */}
                  <div className={`p-1 rounded-full hover:bg-white/5 transition-transform duration-300 ${isExpanded ? 'rotate-180 bg-white/10' : ''}`}>
                    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* 7-Day Forecast Expansion */}
              {isExpanded && <ForecastView forecast={item.forecast} lang={lang} />}
            </div>
          );
        })}
        
        {/* Ad Slot */}
        <AdSlot />

        {sortedData.length === 0 && (
          <div className="text-center p-8 text-gray-500 text-sm">
            {t.nodata}
          </div>
        )}
      </div>
    </div>
  );
};