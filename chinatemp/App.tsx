import React, { useState, useEffect, useMemo } from 'react';
import { MapChart } from './components/MapChart';
import { RankingPanel } from './components/RankingPanel';
import { TemperatureLegend } from './components/TemperatureLegend';
import { DaySelector } from './components/DaySelector';
import { WeatherData, ViewState, Language } from './types';
import { generateNationalData } from './services/dataService';

const getInitialLanguage = (): Language => {
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('zh')) {
      return 'zh';
    }
  }
  return 'en';
};

const App: React.FC = () => {
  const [nationalData, setNationalData] = useState<WeatherData[]>([]);
  const [viewState, setViewState] = useState<ViewState>(ViewState.NATIONAL);
  const [selectedProvinceName, setSelectedProvinceName] = useState<string | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(0); // 0 = Today
  const [lang, setLang] = useState<Language>(getInitialLanguage);

  // Initialize Data
  useEffect(() => {
    const data = generateNationalData();
    setNationalData(data);
  }, []);

  const handleSelectProvince = (name: string) => {
    if (selectedProvinceName === name) {
      handleBackToNational();
      return;
    }
    setSelectedProvinceName(name);
    setViewState(ViewState.PROVINCIAL);
  };

  const handleBackToNational = () => {
    setSelectedProvinceName(null);
    setViewState(ViewState.NATIONAL);
  };

  // Determine which list to show in RankingPanel
  const activeData = useMemo(() => {
    if (viewState === ViewState.PROVINCIAL && selectedProvinceName) {
      const province = nationalData.find(p => p.regionName === selectedProvinceName);
      return province?.children || [];
    }
    return nationalData;
  }, [viewState, selectedProvinceName, nationalData]);

  // Determine active title
  const activeTitle = useMemo(() => {
    if (lang === 'zh') {
        return selectedProvinceName || "中国气温";
    } else {
        if (selectedProvinceName) {
            const p = nationalData.find(x => x.regionName === selectedProvinceName);
            return p?.regionNameEn || selectedProvinceName;
        }
        return "China Climate";
    }
  }, [selectedProvinceName, lang, nationalData]);

  // Generate Day Labels for Selector
  const dayLabels = useMemo(() => {
    if (nationalData.length > 0 && nationalData[0].forecast) {
        return nationalData[0].forecast.map(f => ({
            zh: f.dayName,
            en: f.dayNameEn
        }));
    }
    return [
        { zh: '今天', en: 'Today' },
        { zh: '明天', en: 'Tomorrow' },
        { zh: '后天', en: 'Day After' },
        { zh: '周四', en: 'Thu' },
        { zh: '周五', en: 'Fri' },
        { zh: '周六', en: 'Sat' },
        { zh: '周日', en: 'Sun' }
    ];
  }, [nationalData]);

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen overflow-hidden bg-[#0d1117] text-white font-sans">
      
      {/* Left: Map Visualization */}
      <div className="relative flex-1 h-[50vh] md:h-full flex flex-col">
        {/* Header Overlay */}
        <div className="absolute top-0 left-0 w-full p-6 z-10 pointer-events-none">
          <div className="flex justify-between items-start">
             <div>
                <h1 className="text-3xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 drop-shadow-sm font-sans">
                  {lang === 'zh' ? '中国气温排行' : 'China Temperature'}
                </h1>
             </div>
             <div className="pointer-events-auto flex flex-col items-end gap-2">
               {/* Language Toggle */}
               <div className="flex bg-gray-800/80 backdrop-blur rounded-lg border border-gray-700 p-1">
                 <button 
                   onClick={() => setLang('zh')}
                   className={`px-2 py-0.5 text-xs font-bold rounded transition-colors ${lang === 'zh' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                 >
                   CN
                 </button>
                 <button 
                   onClick={() => setLang('en')}
                   className={`px-2 py-0.5 text-xs font-bold rounded transition-colors ${lang === 'en' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                 >
                   EN
                 </button>
               </div>
               <TemperatureLegend />
             </div>
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 w-full h-full">
           <MapChart 
             data={nationalData} 
             onSelectProvince={handleSelectProvince}
             selectedProvince={selectedProvinceName}
             selectedDayIndex={selectedDayIndex}
             lang={lang}
           />
        </div>

        {/* Timeline Selector (Bottom Overlay) */}
        <DaySelector 
           days={dayLabels}
           selectedIndex={selectedDayIndex}
           onSelect={setSelectedDayIndex}
           lang={lang}
        />
      </div>

      {/* Right: Data Ranking Panel */}
      <div className="w-full md:w-[400px] h-[50vh] md:h-full z-20">
        <RankingPanel 
          title={activeTitle}
          data={activeData}
          onBack={viewState === ViewState.PROVINCIAL ? handleBackToNational : undefined}
          lang={lang}
        />
      </div>

    </div>
  );
};

export default App;