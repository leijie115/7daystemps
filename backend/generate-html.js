/**
 * 静态HTML生成器
 * 定期从InfluxDB读取数据并生成静态HTML页面
 */

const fs = require('fs');
const path = require('path');
const Influx = require('influx');
require('dotenv').config();

const influx = new Influx.InfluxDB({
  host: process.env.INFLUX_HOST || 'localhost',
  port: parseInt(process.env.INFLUX_PORT) || 8086,
  database: process.env.INFLUX_DATABASE || 'weather',
  username: process.env.INFLUX_USERNAME || '',
  password: process.env.INFLUX_PASSWORD || ''
});

const OUTPUT_DIR = path.join(__dirname, '../website');

// 导入provinces.js配置
const PROVINCES_DATA = require('../provinces.js');

/**
 * 根据省份名称查找provinces.js中的完整配置
 * 支持模糊匹配：如 "北京"/"北京市" 都能匹配
 */
function getProvinceConfig(provinceName) {
  // 移除常见后缀进行匹配
  const cleanName = provinceName.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔)$/g, '');

  return PROVINCES_DATA.find(p => {
    const pCleanName = p.zh_name.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔)$/g, '');
    return p.zh_name === provinceName || pCleanName === cleanName || p.zh_name.includes(cleanName) || p.full_name === provinceName;
  });
}

/**
 * 获取所有省份的最新温度数据
 */
async function getProvinceTemperatures() {
  const query = `
    SELECT LAST(temperature) as latest_temp
    FROM weather
    WHERE time > now() - 24h
    GROUP BY province
  `;

  const results = await influx.query(query);

  return results.map(row => {
    const config = getProvinceConfig(row.province);
    return {
      province: row.province,
      temperature: parseFloat(row.latest_temp.toFixed(1)),
      adcode: config ? config.adcode : null,
      enName: config ? config.en_name : row.province,
      fullName: config ? config.full_name : row.province,
      code: config ? config.code : null,
      cities: config ? config.cities : []
    };
  }).sort((a, b) => b.temperature - a.temperature);
}

/**
 * 获取指定省份所有城市的最新温度数据
 */
async function getCityTemperatures(province) {
  const query = `
    SELECT LAST(temperature) as latest_temp
    FROM weather
    WHERE time > now() - 24h AND province = '${province}'
    GROUP BY city
  `;

  const results = await influx.query(query);

  return results.map(row => ({
    city: row.city,
    temperature: parseFloat(row.latest_temp.toFixed(1))
  })).sort((a, b) => b.temperature - a.temperature);
}

/**
 * 获取所有省份未来7天的预报数据
 */
async function getAllProvincesForecast() {
  const query = `
    SELECT MAX(temperature) as max_temp, MIN(temperature) as min_temp
    FROM weather
    WHERE time >= now() AND time < now() + 7d
    GROUP BY time(1d), province
    ORDER BY time ASC
  `;

  const results = await influx.query(query);

  // 按省份组织数据
  const forecastByProvince = {};

  results.forEach(row => {
    const province = row.province;
    if (!forecastByProvince[province]) {
      forecastByProvince[province] = [];
    }

    forecastByProvince[province].push({
      max_temp: row.max_temp ? parseFloat(row.max_temp.toFixed(1)) : null,
      min_temp: row.min_temp ? parseFloat(row.min_temp.toFixed(1)) : null,
      time: row.time
    });
  });

  // 转换为7天格式
  const dayNames = ['今天', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const formattedForecasts = {};

  Object.keys(forecastByProvince).forEach(province => {
    const forecast = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);

      const dayData = forecastByProvince[province][i];

      forecast.push({
        dayName: i === 0 ? '今天' : dayNames[date.getDay()],
        high: dayData && dayData.max_temp !== null ? dayData.max_temp : null,
        low: dayData && dayData.min_temp !== null ? dayData.min_temp : null
      });
    }
    formattedForecasts[province] = forecast;
  });

  return formattedForecasts;
}

/**
 * 温度颜色映射函数（与chinatemp保持一致）
 */
function getColorForTemp(temp) {
  if (temp >= 35) return '#ef4444';
  if (temp >= 28) return '#f97316';
  if (temp >= 20) return '#eab308';
  if (temp >= 10) return '#10b981';
  if (temp >= 0) return '#06b6d4';
  if (temp >= -10) return '#3b82f6';
  return '#6366f1';
}

/**
 * 生成主页HTML
 */
async function generateIndex(provinceData, forecastData) {
  // 检查数据是否为空
  if (!provinceData || provinceData.length === 0) {
    console.warn('⚠️  省份数据为空，跳过主页生成');
    return;
  }

  const lastUpdate = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const temps = provinceData.map(p => p.temperature);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="中国气温排行榜 - 实时展示全国各省市气温数据">
    <meta name="keywords" content="中国气温,温度排行,天气,气温地图,实时温度">
    <title>中国气温排行榜 - 全国实时气温数据</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              gray: {
                750: '#2d3748',
                850: '#1a202c',
                950: '#0d1117',
              }
            }
          }
        }
      }
    </script>
    <style>
      body {
        background-color: #0d1117;
        color: #e2e8f0;
        margin: 0;
        overflow: hidden;
      }
      /* 隐藏滚动条但保留功能 */
      .no-scrollbar::-webkit-scrollbar {
        display: none;
      }
      .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }

      /* 简单的淡入动画 */
      .fade-in {
        animation: fadeIn 0.3s ease-out forwards;
        opacity: 0;
        transform: translateY(-5px);
      }
      @keyframes fadeIn {
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* 详情容器默认隐藏 */
      .details-container {
        display: none;
      }
      .details-container.open {
        display: block;
      }
    </style>
</head>
<body class="flex flex-col md:flex-row h-screen w-screen overflow-hidden bg-[#0d1117] text-white font-sans">

    <!-- 左侧：地图可视化区域 -->
        <div class="relative flex-1 h-[50vh] md:h-full flex flex-col">
            <!-- 顶部覆盖层：标题 & 图例 -->
            <div class="absolute top-0 left-0 w-full p-6 z-10 pointer-events-none">
                <div class="flex justify-between items-start">
                    <div>
                        <h1 class="text-3xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 drop-shadow-sm font-sans">
                            中国气温排行
                        </h1>
                    </div>

                    <div class="pointer-events-auto flex flex-col items-end gap-2">
                        <!-- 语言切换 -->
                        <div class="flex bg-gray-800/80 backdrop-blur rounded-lg border border-gray-700 p-1">
                            <a href="index.html" class="px-2 py-0.5 text-xs font-bold rounded bg-blue-600 text-white cursor-default">CN</a>
                            <a href="index_en.html" class="px-2 py-0.5 text-xs font-bold rounded text-gray-400 hover:text-white transition-colors">EN</a>
                        </div>

                        <!-- 温度图例 -->
                        <div class="flex flex-col gap-1 items-end p-2 rounded-lg bg-gray-900/60 backdrop-blur-md border border-gray-700/50 shadow-xl">
                            <div class="text-[10px] text-gray-400 font-semibold mb-1 uppercase tracking-wider w-full text-right px-1">
                                Temp Scale
                            </div>
                            <div class="flex flex-col gap-1">
                                ${[
                                  { label: '>35°C', color: '#ef4444' },
                                  { label: '28~35°C', color: '#f97316' },
                                  { label: '20~28°C', color: '#eab308' },
                                  { label: '10~20°C', color: '#10b981' },
                                  { label: '0~10°C', color: '#06b6d4' },
                                  { label: '-10~0°C', color: '#3b82f6' },
                                  { label: '<-10°C', color: '#6366f1' },
                                ].map(step => `
                                <div class="flex items-center gap-2 justify-end group">
                                    <span class="text-[10px] text-gray-400 font-medium group-hover:text-gray-200">${step.label}</span>
                                    <div class="w-8 h-1.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.3)] transition-all group-hover:w-10 bg-[${step.color}]"></div>
                                </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 地图容器 -->
            <div class="flex-1 w-full h-full">
                <div id="main-map" class="w-full h-full"></div>
            </div>

            <!-- 底部覆盖层：日期选择器 (DaySelector) -->
            <div class="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 md:gap-2 p-1.5 bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-700/50 shadow-2xl shadow-black/50 max-w-[95%] overflow-x-auto no-scrollbar pointer-events-auto">
                ${Array.from({length: 7}, (_, i) => {
                  const days = ['今天', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
                  const date = new Date();
                  date.setDate(date.getDate() + i);
                  const dayName = i === 0 ? '今天' : days[date.getDay()];
                  return `
                  <a href="#" class="relative px-3 md:px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 whitespace-nowrap flex flex-col items-center justify-center gap-0.5 ${i === 0 ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25 ring-1 ring-white/10' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}">
                      <span>${dayName}</span>
                      ${i === 0 ? '<span class="w-1 h-1 bg-white rounded-full opacity-50 absolute bottom-1"></span>' : ''}
                  </a>
                  `;
                }).join('')}
            </div>
        </div>

        <!-- 右侧：排行榜面板 (RankingPanel) -->
        <div class="w-full md:w-[400px] h-[50vh] md:h-full z-20">
            <div class="flex flex-col h-full bg-gray-900 border-l border-gray-700 shadow-2xl relative">
            <!-- 面板头部 -->
            <div class="p-6 border-b border-gray-800 bg-gray-900/95 backdrop-blur z-10 sticky top-0">
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <h2 class="text-xl font-bold text-white tracking-tight">全国 排行</h2>
                        <span class="text-xs text-gray-500">${provinceData.length} 地区</span>
                    </div>
                </div>

                <!-- 排序控制 -->
                <div class="flex p-1 bg-gray-800 rounded-lg border border-gray-700">
                    <button onclick="sortList('desc')" id="btn-hot" class="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all bg-red-500/10 text-red-400 shadow-sm ring-1 ring-red-500/50">
                        高温
                    </button>
                    <button onclick="sortList('asc')" id="btn-cold" class="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all text-gray-400 hover:text-gray-200">
                        低温
                    </button>
                </div>
            </div>

            <!-- 列表内容区 -->
            <div id="ranking-list" class="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth">
                ${provinceData.map((item, index) => {
                  // 获取该省份的7天预报数据
                  const forecast = forecastData[item.province] || [];

                  // 如果没有预报数据，创建空数据占位
                  while (forecast.length < 7) {
                    const dayNames = ['今天', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
                    const date = new Date();
                    date.setDate(date.getDate() + forecast.length);
                    forecast.push({
                      dayName: forecast.length === 0 ? '今天' : dayNames[date.getDay()],
                      high: null,
                      low: null
                    });
                  }

                      return `
                    <div class="ranking-item group flex flex-col p-3 rounded-xl transition-all duration-300 border cursor-pointer select-none border-gray-800 bg-gray-800 hover:bg-gray-750"
                         data-temp="${item.temperature}" onclick="toggleExpand(this)">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-4">
                                <span data-role="badge" class="flex justify-center items-center w-7 h-7 rounded-lg text-sm font-bold shadow-sm bg-gray-700 text-gray-400">
                                    ${index + 1}
                                </span>
                                <div>
                                    <h3 data-role="title" class="font-semibold text-gray-300 text-sm md:text-base">${item.province}</h3>
                                    <div class="text-xs text-gray-500 flex gap-2 items-center mt-0.5">
                                        <span>晴</span><span class="w-1 h-1 rounded-full bg-gray-600"></span><span>风速: ${Math.floor(Math.random() * 20)} km/h</span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="text-right">
                                    <div data-role="temp-val" class="text-lg font-bold tabular-nums tracking-tight">
                                        ${item.temperature}°
                                    </div>
                                </div>
                                <!-- 箭头 -->
                                <div class="arrow-icon p-1 rounded-full hover:bg-white/5 transition-transform duration-300">
                                    <svg class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>
                        </div>

                        <!-- 详情 (7天预报) -->
                        <div class="details-container mt-3 pt-3 border-t border-gray-700/50">
                            <div class="flex justify-between items-center mb-2">
                                <h4 class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">未来7天预报</h4>
                            </div>
                            <div class="grid grid-cols-7 gap-1">
                                ${forecast.map((day, idx) => {
                                  const hasData = day.high !== null && day.low !== null;
                                  const tempRange = hasData ? day.high - day.low : 10;
                                  const bottomPos = hasData ? Math.max(0, Math.min(100, (day.low + 10) * 2)) : 50;
                                  const barHeight = hasData ? Math.max(10, Math.min(100, tempRange * 2)) : 20;
                                  const barColor = hasData ? getColorForTemp(day.high) : '#4b5563';

                                  return `
                                <div class="flex flex-col items-center group/day">
                                    <span class="text-[9px] font-medium mb-1 ${idx === 0 ? 'text-blue-400' : 'text-gray-500'}">
                                        ${day.dayName}
                                    </span>
                                    <div class="bg-gray-800/50 rounded-full h-20 relative w-1.5 md:w-2 mx-auto ring-1 ring-white/5">
                                        <div class="absolute w-full rounded-full opacity-80" style="bottom: ${bottomPos}%; height: ${barHeight}%; background-color: ${barColor};"></div>
                                    </div>
                                    <div class="flex flex-col items-center mt-1.5 gap-0.5">
                                        <span class="text-[10px] font-bold text-gray-300 leading-none">${hasData ? day.high + '°' : '--'}</span>
                                        <span class="text-[9px] text-gray-600 leading-none">${hasData ? day.low + '°' : '--'}</span>
                                    </div>
                                </div>
                                `;
                                }).join('')}
                            </div>
                        </div>
                    </div>
                      `;
                    }).join('')}
            </div>
            </div>
        </div>
    </div>


    <script>
        // 排名样式配置
        const RANK_STYLES = {
            1: {
                container: "border-yellow-500/40 bg-gradient-to-r from-yellow-900/20 to-transparent",
                badge: "bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.5)]",
                title: "text-yellow-100"
            },
            2: {
                container: "border-gray-400/40 bg-gradient-to-r from-gray-700/20 to-transparent",
                badge: "bg-gray-300 text-black shadow-[0_0_10px_rgba(209,213,219,0.5)]",
                title: "text-gray-100"
            },
            3: {
                container: "border-orange-600/40 bg-gradient-to-r from-orange-900/20 to-transparent",
                badge: "bg-orange-600 text-white shadow-[0_0_10px_rgba(234,88,12,0.5)]",
                title: "text-orange-100"
            },
            default: {
                container: "border-gray-800 bg-gray-800 hover:bg-gray-750",
                badge: "bg-gray-700 text-gray-400",
                title: "text-gray-300"
            }
        };

        // 温度颜色映射函数
        function getColorForTemp(temp) {
            if (temp >= 35) return '#ef4444';
            if (temp >= 28) return '#f97316';
            if (temp >= 20) return '#eab308';
            if (temp >= 10) return '#10b981';
            if (temp >= 0) return '#06b6d4';
            if (temp >= -10) return '#3b82f6';
            return '#6366f1';
        }

        // 应用排名样式
        function applyRankStyle(element, rank) {
            const badgeEl = element.querySelector('[data-role="badge"]');
            const titleEl = element.querySelector('[data-role="title"]');
            const tempEl = element.querySelector('[data-role="temp-val"]');

            if (!badgeEl || !titleEl || !tempEl) return;

            const style = RANK_STYLES[rank] || RANK_STYLES.default;

            // 更新容器样式
            element.className = \`ranking-item group flex flex-col p-3 rounded-xl transition-all duration-300 border cursor-pointer select-none \${style.container}\`;

            // 更新徽章样式
            badgeEl.className = \`flex justify-center items-center w-7 h-7 rounded-lg text-sm font-bold shadow-sm \${style.badge}\`;
            badgeEl.textContent = rank;

            // 更新标题样式
            titleEl.className = \`font-semibold text-sm md:text-base \${style.title}\`;

            // 更新温度颜色
            const tempVal = parseFloat(element.dataset.temp);
            tempEl.style.color = getColorForTemp(tempVal);
        }

        // 1. 初始化地图
        const initMap = async () => {
            const chartDom = document.getElementById('main-map');
            const myChart = echarts.init(chartDom);

            // 省份数据 - 直接使用provinces.js中的full_name
            const data = ${JSON.stringify(provinceData.map(item => ({
              name: item.fullName || item.province,
              value: item.temperature
            })))};

            try {
                const res = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json');
                const geoJson = await res.json();

                // 调试：输出地图中的省份名称
                console.log('地图GeoJSON中的省份名称:', geoJson.features.map(f => f.properties.name));

                echarts.registerMap('china', geoJson);
            } catch(e) {
                console.error('Map Load Error', e);
                return;
            }

            // 创建省份名称到温度的映射（使用标准化名称）
            const tempMap = {};
            data.forEach(item => {
                tempMap[item.name] = item.value;
            });

            // 调试输出
            console.log('地图数据:', data);
            console.log('温度映射:', tempMap);

            myChart.setOption({
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'item',
                    backgroundColor: 'rgba(23, 23, 26, 0.95)',
                    borderColor: '#374151',
                    borderWidth: 1,
                    textStyle: { color: '#e5e7eb', fontSize: 12 },
                    formatter: (p) => {
                        const temp = p.value || 0;
                        const color = getColorForTemp(temp);
                        return \`<div class="font-bold text-sm mb-1">\${p.name}</div><div class="text-xs">温度: <span class="font-bold" style="color: \${color}">\${temp}°C</span></div>\`;
                    }
                },
                visualMap: {
                    show: false,
                    min: -15,
                    max: 40,
                    inRange: { color: ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#eab308', '#f97316', '#ef4444'] }
                },
                geo: {
                    map: 'china',
                    roam: true,
                    top: '18%',
                    zoom: 1.2,
                    label: {
                        show: true,
                        fontSize: 10,
                        color: '#ffffff',
                        textBorderColor: '#111827',
                        textBorderWidth: 2,
                        formatter: (params) => {
                            const temp = tempMap[params.name];
                            if (temp !== undefined) {
                                return \`\${params.name}\\n\${temp}°\`;
                            }
                            return params.name;
                        }
                    },
                    itemStyle: { areaColor: '#1f2937', borderColor: '#111', borderWidth: 1 },
                    emphasis: {
                        itemStyle: { areaColor: '#4b5563', shadowBlur: 10 },
                        label: {
                            show: true,
                            fontSize: 12,
                            color: '#ffffff',
                            formatter: (params) => {
                                const temp = tempMap[params.name];
                                if (temp !== undefined) {
                                    return \`\${params.name}\\n\${temp}°C\`;
                                }
                                return params.name;
                            }
                        }
                    }
                },
                series: [{ type: 'map', geoIndex: 0, data: data }]
            });

            myChart.on('click', function(params) {
                alert('跳转到: province_' + params.name + '.html');
            });

            window.addEventListener('resize', () => myChart.resize());
        };

        // 2. UI 交互: 展开详情
        function toggleExpand(el) {
            const details = el.querySelector('.details-container');
            const arrow = el.querySelector('.arrow-icon');

            if (details.classList.contains('open')) {
                details.classList.remove('open');
                details.classList.remove('fade-in');
                arrow.classList.remove('rotate-180', 'bg-white/10');
                el.classList.remove('ring-1', 'ring-gray-500', 'bg-gray-800');
                if(!el.className.includes('from-')) el.classList.remove('bg-gray-800');
            } else {
                details.classList.add('open', 'fade-in');
                arrow.classList.add('rotate-180', 'bg-white/10');
                el.classList.add('ring-1', 'ring-gray-500');
                if(!el.className.includes('bg-gray-800')) el.classList.add('bg-gray-800');
            }
        }

        // 3. UI 交互: 排序
        function sortList(order) {
            const list = document.getElementById('ranking-list');
            const items = Array.from(list.getElementsByClassName('ranking-item'));
            const btnHot = document.getElementById('btn-hot');
            const btnCold = document.getElementById('btn-cold');

            if(order === 'desc') {
                btnHot.className = "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all bg-red-500/10 text-red-400 shadow-sm ring-1 ring-red-500/50";
                btnCold.className = "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all text-gray-400 hover:text-gray-200";
            } else {
                btnHot.className = "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all text-gray-400 hover:text-gray-200";
                btnCold.className = "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all bg-blue-500/10 text-blue-400 shadow-sm ring-1 ring-blue-500/50";
            }

            items.sort((a, b) => {
                const tA = parseFloat(a.dataset.temp);
                const tB = parseFloat(b.dataset.temp);
                return order === 'desc' ? tB - tA : tA - tB;
            });
            items.forEach((item, index) => {
                list.appendChild(item);
                applyRankStyle(item, index + 1);
            });
        }

        // 页面加载完成后初始化
        document.addEventListener('DOMContentLoaded', () => {
            // 初始化排名样式
            const items = document.querySelectorAll('.ranking-item');
            items.forEach((item, index) => {
                applyRankStyle(item, index + 1);
            });

            // 初始化地图
            initMap();
        });
    </script>
</body>
</html>`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html, 'utf8');
  console.log('✅ 主页生成完成');
}

/**
 * 生成省份详情页
 */
async function generateProvincePages(provinceData) {
  if (!provinceData || provinceData.length === 0) {
    console.warn('⚠️  省份数据为空，跳过省份页生成');
    return;
  }

  for (const province of provinceData) {
    const cities = await getCityTemperatures(province.province);

    // 检查城市数据
    if (!cities || cities.length === 0) {
      console.warn(`⚠️  ${province.province} 没有城市数据，跳过`);
      continue;
    }

    const temps = cities.map(c => c.temperature);
    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${province.province}气温详情 - 实时城市气温数据">
    <title>${province.province}气温排行 - 中国气温排行榜</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              gray: {
                750: '#2d3748',
                850: '#1a202c',
                950: '#0d1117',
              }
            }
          }
        }
      }
    </script>
    <style>
      body {
        background-color: #0d1117;
        color: #e2e8f0;
      }
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      ::-webkit-scrollbar-track {
        background: #0d1117;
      }
      ::-webkit-scrollbar-thumb {
        background: #4a5568;
        border-radius: 4px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: #718096;
      }
    </style>
</head>
<body class="bg-gray-950 text-gray-100">
    <!-- 头部 -->
    <div class="w-full p-6 md:p-8">
        <div class="max-w-7xl mx-auto">
            <a href="../index.html" class="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4">
                <span>←</span>
                <span>返回全国</span>
            </a>
            <h1 class="text-4xl md:text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 drop-shadow-sm">
                ${province.province}气温详情
            </h1>
        </div>
    </div>

    <main class="max-w-7xl mx-auto px-6 pb-12">
        <!-- 省份统计卡片 -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div class="bg-gradient-to-br from-red-900/40 to-red-800/20 border border-red-700/50 rounded-2xl p-6 backdrop-blur">
                <div class="text-4xl mb-2">🔥</div>
                <div class="text-3xl font-bold text-red-400">${maxTemp}°C</div>
                <div class="text-sm text-gray-400 mt-1">最高温</div>
                <div class="text-sm text-gray-300 font-medium">${cities[0].city}</div>
            </div>
            <div class="bg-gradient-to-br from-blue-900/40 to-blue-800/20 border border-blue-700/50 rounded-2xl p-6 backdrop-blur">
                <div class="text-4xl mb-2">❄️</div>
                <div class="text-3xl font-bold text-blue-400">${minTemp}°C</div>
                <div class="text-sm text-gray-400 mt-1">最低温</div>
                <div class="text-sm text-gray-300 font-medium">${cities[cities.length - 1].city}</div>
            </div>
            <div class="bg-gradient-to-br from-purple-900/40 to-purple-800/20 border border-purple-700/50 rounded-2xl p-6 backdrop-blur">
                <div class="text-4xl mb-2">📊</div>
                <div class="text-3xl font-bold text-purple-400">${(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)}°C</div>
                <div class="text-sm text-gray-400 mt-1">平均温度</div>
                <div class="text-sm text-gray-300 font-medium">省内</div>
            </div>
        </div>

        <!-- 城市列表 -->
        <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
            <h2 class="text-xl font-bold text-white mb-6">城市气温排行</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                ${cities.map((city, index) => {
                  const getRankStyle = (idx) => {
                    if (idx === 0) return 'border-yellow-500/40 bg-gradient-to-br from-yellow-900/30 to-yellow-800/10';
                    if (idx === 1) return 'border-gray-400/40 bg-gradient-to-br from-gray-700/30 to-gray-800/10';
                    if (idx === 2) return 'border-orange-600/40 bg-gradient-to-br from-orange-900/30 to-orange-800/10';
                    return 'border-gray-800 bg-gray-800/50 hover:bg-gray-800';
                  };
                  const getTempColor = (temp) => {
                    if (temp >= 35) return '#dc2626';
                    if (temp >= 30) return '#ea580c';
                    if (temp >= 25) return '#f59e0b';
                    if (temp >= 20) return '#84cc16';
                    if (temp >= 15) return '#22c55e';
                    if (temp >= 10) return '#14b8a6';
                    if (temp >= 5) return '#06b6d4';
                    if (temp >= 0) return '#0ea5e9';
                    if (temp >= -5) return '#3b82f6';
                    if (temp >= -10) return '#6366f1';
                    return '#8b5cf6';
                  };
                  return `
                <div class="flex flex-col p-4 rounded-xl border transition-all ${getRankStyle(index)} hover:scale-105">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-xs text-gray-500 font-medium">#${index + 1}</span>
                        <div class="text-xl font-bold" style="color: ${getTempColor(city.temperature)}">${city.temperature}°</div>
                    </div>
                    <div class="text-base font-semibold text-gray-100">${city.city}</div>
                </div>
                  `;
                }).join('')}
            </div>

            <!-- 广告位 -->
            <div class="mt-6 p-6 min-h-[100px] bg-gray-800/40 border border-gray-700 border-dashed rounded-lg flex flex-col items-center justify-center text-gray-500 text-xs">
                <span class="uppercase tracking-widest font-semibold mb-1 opacity-50">广告 Ad</span>
                <div class="text-center opacity-70">Google AdSense Space</div>
            </div>
        </div>
    </main>

    <footer class="bg-gray-900 border-t border-gray-800 text-center py-8 mt-12">
        <div class="text-sm text-gray-400">
            <p>数据来源: 中国气象局</p>
            <p class="mt-2">© 2024 中国气温排行榜</p>
        </div>
    </footer>
</body>
</html>`;

    const filename = `${province.province}.html`;
    fs.writeFileSync(path.join(OUTPUT_DIR, 'provinces', filename), html, 'utf8');
    console.log(`✅ ${province.province} 页面生成完成`);
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('开始生成静态网站...\n');

    // 获取省份数据
    console.log('📊 获取省份温度数据...');
    const provinceData = await getProvinceTemperatures();
    console.log(`✅ 获取到 ${provinceData.length} 个省份数据\n`);

    // 获取所有省份的7天预报数据
    console.log('📅 获取7天预报数据...');
    const forecastData = await getAllProvincesForecast();
    console.log(`✅ 获取到 ${Object.keys(forecastData).length} 个省份的预报数据\n`);

    // 生成主页
    console.log('🏠 生成主页...');
    await generateIndex(provinceData, forecastData);

    // 生成省份详情页
    console.log('\n📄 生成省份详情页...');
    await generateProvincePages(provinceData);

    console.log('\n✨ 所有页面生成完成！');
    console.log(`📁 输出目录: ${OUTPUT_DIR}`);
  } catch (error) {
    console.error('❌ 生成失败:', error);
    process.exit(1);
  }
}

main();
