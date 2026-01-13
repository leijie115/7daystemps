import React, { useEffect, useState, useRef, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { WeatherData, Language } from '../types';

interface MapChartProps {
  data: WeatherData[];
  onSelectProvince: (provinceName: string) => void;
  selectedProvince: string | null;
  selectedDayIndex: number; 
  lang: Language;
}

const GEO_BASE_URL = 'https://geo.datav.aliyun.com/areas_v3/bound';

export const MapChart: React.FC<MapChartProps> = ({ 
  data, 
  onSelectProvince, 
  selectedProvince,
  selectedDayIndex,
  lang
}) => {
  const [mapLoaded, setMapLoaded] = useState(false);
  const [currentMapName, setCurrentMapName] = useState('china');
  const chartRef = useRef<any>(null);

  // Load National Map
  useEffect(() => {
    fetch(`${GEO_BASE_URL}/100000_full.json`)
      .then(response => response.json())
      .then(geoJson => {
        echarts.registerMap('china', geoJson);
        setMapLoaded(true);
      })
      .catch(err => console.error("Failed to load China map", err));
  }, []);

  // Load Province Map
  useEffect(() => {
    if (!selectedProvince) {
      setCurrentMapName('china');
      return;
    }

    const provinceData = data.find(p => p.regionName === selectedProvince);
    if (provinceData && provinceData.adcode) {
      const adcode = provinceData.adcode;
      fetch(`${GEO_BASE_URL}/${adcode}_full.json`)
        .then(res => {
            if(!res.ok) throw new Error('Map not found');
            return res.json();
        })
        .then(geoJson => {
          echarts.registerMap(selectedProvince, geoJson);
          setCurrentMapName(selectedProvince);
        })
        .catch(err => {
          console.error("Failed to load province map", err);
        });
    }
  }, [selectedProvince, data]);

  const onChartClick = (params: any) => {
    if (params.name) {
      if (currentMapName === 'china') {
        // When in English, params.name is 'Beijing', but our state expects '北京市'
        let cnName = params.name;
        if (lang !== 'zh') {
            const found = data.find(d => d.regionNameEn === params.name);
            if (found) cnName = found.regionName;
        }
        onSelectProvince(cnName);
      }
    }
  };

  // Create a Name Map for ECharts to translate GeoJSON labels
  const nameMap = useMemo(() => {
    if (lang === 'zh') return undefined;
    const map: Record<string, string> = {};
    data.forEach(d => {
        if (d.regionName && d.regionNameEn) {
            map[d.regionName] = d.regionNameEn;
        }
    });
    return map;
  }, [data, lang]);

  const getOption = () => {
    let mapData: any[] = [];
    let minTemp = -15; // Adjusted min/max for better contrast range
    let maxTemp = 40;

    const getValue = (item: WeatherData) => {
        if (selectedDayIndex === 0) return item.temperature;
        return item.forecast[selectedDayIndex]?.high ?? item.temperature;
    };

    const getCondition = (item: WeatherData) => {
        if (selectedDayIndex === 0) return lang === 'zh' ? item.condition : item.conditionEn;
        return lang === 'zh' 
          ? (item.forecast[selectedDayIndex]?.condition ?? item.condition)
          : (item.forecast[selectedDayIndex]?.conditionEn ?? item.conditionEn);
    };
    
    if (currentMapName === 'china') {
      mapData = data.map(item => ({
        // Fix: If nameMap is active (English), data name must match the mapped name
        name: lang === 'zh' ? item.regionName : (item.regionNameEn || item.regionName),
        value: getValue(item),
        displayName: lang === 'zh' ? item.regionName : item.regionNameEn,
        condition: getCondition(item),
        forecastObj: item.forecast[selectedDayIndex],
        isForecast: selectedDayIndex > 0
      }));
    } else {
        mapData = []; 
    }

    // Translations for UI
    const texts = {
        temp: lang === 'zh' ? '温度' : 'Temp',
        high: lang === 'zh' ? '最高气温' : 'High',
        current: lang === 'zh' ? '当前气温' : 'Current',
        low: lang === 'zh' ? '最低' : 'Low'
    };

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
           if (isNaN(params.value)) return params.name;
           
           const d = params.data;
           const name = d?.displayName || params.name;
           const isForecast = d?.isForecast;
           const forecastObj = d?.forecastObj;
           const tempLabel = isForecast ? `${texts.high} (High)` : `${texts.current}`;
           const extraInfo = isForecast && forecastObj 
             ? `<br/>${texts.low}: ${forecastObj.low}°C` 
             : '';

           return `
             <div class="font-bold text-sm mb-1">${name}</div>
             <div class="text-xs text-gray-300">${d?.condition || ''}</div>
             <div class="text-xs mt-1">
               ${tempLabel}: <span class="font-bold text-white">${params.value}°C</span>
               ${extraInfo}
             </div>
           `;
        },
        backgroundColor: 'rgba(23, 23, 26, 0.95)',
        borderColor: '#374151',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#e5e7eb', fontSize: 12 }
      },
      visualMap: {
        show: false, // Hidden because we have a custom Legend component
        min: minTemp,
        max: maxTemp,
        calculable: true,
        inRange: {
          // Purple/Indigo -> Blue -> Cyan -> Green -> Yellow -> Orange -> Red
          color: [
            '#6366f1', // Indigo (<-10)
            '#3b82f6', // Blue (-10 to 0)
            '#06b6d4', // Cyan (0 to 10)
            '#10b981', // Emerald (10 to 20)
            '#eab308', // Yellow (20 to 28)
            '#f97316', // Orange (28 to 35)
            '#ef4444'  // Red (>35)
          ]
        },
      },
      geo: {
        map: currentMapName,
        roam: true,
        scaleLimit: { min: 0.5, max: 10 },
        center: currentMapName === 'china' ? [104, 37] : undefined,
        zoom: currentMapName === 'china' ? 1.2 : 1.2, 
        // Apply name map for labels
        nameMap: nameMap,
        label: {
          show: true,
          color: '#e5e7eb', // Lighter text for better contrast on dark map
          fontSize: 10,
          textBorderColor: '#111827',
          textBorderWidth: 2,
          formatter: (params: any) => {
             // Optional: Hide label if region is too small or crowded? 
             // keeping default for now
             return params.name;
          }
        },
        itemStyle: {
          areaColor: '#1f2937', 
          borderColor: '#111',
          borderWidth: 1
        },
        emphasis: {
          label: { show: true, color: '#fff' },
          itemStyle: {
            areaColor: '#4b5563',
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)'
          }
        }
      },
      series: [
        {
          name: 'Temperature',
          type: 'map',
          geoIndex: 0,
          data: mapData,
          animationDurationUpdate: 300
        }
      ]
    };
  };

  return (
    <div className="w-full h-full relative flex items-center justify-center">
      {mapLoaded ? (
        <ReactECharts 
            ref={chartRef}
            option={getOption()} 
            style={{ height: '100%', width: '100%' }}
            onEvents={{
                'click': onChartClick
            }}
            opts={{ renderer: 'canvas' }}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-gray-500 animate-pulse">
           {lang === 'zh' ? '地图加载中...' : 'Loading Map...'}
        </div>
      )}
    </div>
  );
};