import React from 'react';

// Unified Color Palette
// < -10: Indigo (#6366f1)
// -10 - 0: Blue (#3b82f6)
// 0 - 10: Cyan (#06b6d4)
// 10 - 20: Emerald (#10b981)
// 20 - 28: Yellow (#eab308)
// 28 - 35: Orange (#f97316)
// > 35: Red (#ef4444)

export const getColorForTemp = (temp: number): string => {
  if (temp >= 35) return '#ef4444'; // Red-500
  if (temp >= 28) return '#f97316'; // Orange-500
  if (temp >= 20) return '#eab308'; // Yellow-500
  if (temp >= 10) return '#10b981'; // Emerald-500 (Changed from Green-500 for better visibility)
  if (temp >= 0) return '#06b6d4';  // Cyan-500
  if (temp >= -10) return '#3b82f6'; // Blue-500
  return '#6366f1'; // Indigo-500
};

export const TemperatureLegend: React.FC = () => {
  // Ordered from High to Low for the legend display
  const steps = [
    { label: '>35°C', color: '#ef4444' },
    { label: '28~35°C', color: '#f97316' },
    { label: '20~28°C', color: '#eab308' },
    { label: '10~20°C', color: '#10b981' },
    { label: '0~10°C', color: '#06b6d4' },
    { label: '-10~0°C', color: '#3b82f6' },
    { label: '<-10°C', color: '#6366f1' },
  ];

  return (
    <div className="flex flex-col gap-1 items-end p-2 rounded-lg bg-gray-900/60 backdrop-blur-md border border-gray-700/50 shadow-xl">
      <div className="text-[10px] text-gray-400 font-semibold mb-1 uppercase tracking-wider w-full text-right px-1">
        Temp Scale
      </div>
      <div className="flex flex-col gap-1">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center gap-2 justify-end group">
            <span className="text-[10px] text-gray-400 font-medium group-hover:text-gray-200 transition-colors">
              {step.label}
            </span>
            <div 
              className="w-8 h-1.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.3)] transition-all group-hover:w-10 group-hover:brightness-110" 
              style={{ backgroundColor: step.color }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};