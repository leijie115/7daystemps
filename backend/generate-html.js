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
 * 根据省份code查找provinces.js中的完整配置
 */
function getProvinceConfig(provinceCode) {
  return PROVINCES_DATA.find(p => p.code === provinceCode);
}

/**
 * 根据省份code和城市code查找城市配置
 */
function getCityConfig(provinceCode, cityCode) {
  const province = getProvinceConfig(provinceCode);
  if (!province || !province.cities) return null;
  return province.cities.find(c => c.code === cityCode);
}

/**
 * 获取风速值（直接返回数据库中的值，已包含单位）
 */
function getWindSpeed(windSpeedValue) {
  return windSpeedValue || '0';
}

/**
 * 获取指定日期所有省份的温度数据
 * @param {Date} date - 查询日期，默认为今天
 * @returns {Promise<Array>} 省份温度数据数组
 *
 * 逻辑：
 * 1. 查询该日期内所有城市的温度数据
 * 2. 按省份分组，获取每个省份所有城市中的：
 *    - 最高温度（作为该省份的代表温度）
 *    - 最低温度
 *    - 最大风速
 */
async function getProvinceTemperaturesByDate(date = new Date()) {
  // 获取日期的开始和结束时间
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // 查询该日期内每个省份所有城市的温度、风速和天气描述
  // 获取最高温、最低温、最大风速、最新天气描述
  const query = `
    SELECT MAX(temperature) as max_temp, MIN(temperature) as min_temp, MAX(windSpeed) as max_wind, LAST(weatherDesc) as weather_desc
    FROM weather
    WHERE time >= '${startOfDay.toISOString()}' AND time <= '${endOfDay.toISOString()}'
    GROUP BY province
  `;

  const results = await influx.query(query);

  return results.map(row => {
    const config = getProvinceConfig(row.province); // row.province 现在是 code

    return {
      province: config ? config.name : row.province, // 返回中文名称
      temperature: row.max_temp ? parseFloat(row.max_temp.toFixed(1)) : null,
      maxTemp: row.max_temp ? parseFloat(row.max_temp.toFixed(1)) : null,
      minTemp: row.min_temp ? parseFloat(row.min_temp.toFixed(1)) : null,
      windSpeed: getWindSpeed(row.max_wind),
      weatherDesc: row.weather_desc || '未知',
      adcode: config ? config.adcode : null,
      enName: config ? config.en_name : row.province,
      fullName: config ? config.name : row.province, // 使用 name 作为 fullName
      code: row.province, // code 就是 row.province
      cities: config ? config.cities : []
    };
  }).sort((a, b) => (b.temperature || -999) - (a.temperature || -999));
}

/**
 * 获取所有省份今天的温度数据（兼容旧接口）
 */
async function getProvinceTemperatures() {
  return await getProvinceTemperaturesByDate(new Date());
}

/**
 * 获取指定省份所有城市的最新温度数据
 * @param {string} provinceCode - 省份code (如 "ABJ")
 */
async function getCityTemperatures(provinceCode) {
  const query = `
    SELECT LAST(temperature) as latest_temp, LAST(windSpeed) as latest_wind, LAST(weatherDesc) as latest_weather
    FROM weather
    WHERE time > now() - 24h AND province = '${provinceCode}'
    GROUP BY city
  `;

  const results = await influx.query(query);

  return results.map(row => {
    const cityConfig = getCityConfig(provinceCode, row.city); // row.city 现在是 code

    return {
      city: cityConfig ? cityConfig.name : row.city, // 返回中文名称
      cityCode: row.city, // 保留 code
      temperature: parseFloat(row.latest_temp.toFixed(1)),
      windSpeed: getWindSpeed(row.latest_wind),
      weatherDesc: row.latest_weather || '未知'
    };
  }).sort((a, b) => b.temperature - a.temperature);
}

/**
 * 获取指定省份所有城市在指定日期的温度数据
 * @param {string} provinceCode - 省份code (如 "ABJ")
 */
async function getCityTemperaturesByDate(provinceCode, date = new Date()) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const query = `
    SELECT MAX(temperature) as max_temp, MIN(temperature) as min_temp, MAX(windSpeed) as max_wind, LAST(weatherDesc) as weather_desc
    FROM weather
    WHERE time >= '${startOfDay.toISOString()}' AND time <= '${endOfDay.toISOString()}' AND province = '${provinceCode}'
    GROUP BY city
  `;

  const results = await influx.query(query);

  return results.map(row => {
    const cityConfig = getCityConfig(provinceCode, row.city); // row.city 现在是 code

    return {
      city: cityConfig ? cityConfig.name : row.city, // 返回中文名称
      cityCode: row.city, // 保留 code
      temperature: row.max_temp ? parseFloat(row.max_temp.toFixed(1)) : null,
      maxTemp: row.max_temp ? parseFloat(row.max_temp.toFixed(1)) : null,
      minTemp: row.min_temp ? parseFloat(row.min_temp.toFixed(1)) : null,
      windSpeed: getWindSpeed(row.max_wind),
      weatherDesc: row.weather_desc || '未知'
    };
  }).sort((a, b) => (b.temperature || -999) - (a.temperature || -999));
}

/**
 * 获取指定省份所有城市未来7天的预报数据
 * @param {string} provinceCode - 省份code (如 "ABJ")
 */
async function getCityForecast(provinceCode) {
  const dayNames = ['今天', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const forecastByCity = {};

  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    const dayData = await getCityTemperaturesByDate(provinceCode, date);

    dayData.forEach(cityData => {
      if (!forecastByCity[cityData.city]) {
        forecastByCity[cityData.city] = [];
      }

      forecastByCity[cityData.city].push({
        dayName: i === 0 ? '今天' : dayNames[date.getDay()],
        high: cityData.maxTemp,
        low: cityData.minTemp
      });
    });
  }

  return forecastByCity;
}

/**
 * 获取所有省份未来7天的预报数据
 * 使用getProvinceTemperaturesByDate函数逐天查询
 */
async function getAllProvincesForecast() {
  const dayNames = ['今天', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const forecastByProvince = {};

  // 逐天查询未来7天的数据
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    // 使用统一的函数获取该日期所有省份的数据
    const dayData = await getProvinceTemperaturesByDate(date);

    // 组织数据到各个省份
    dayData.forEach(provinceData => {
      if (!forecastByProvince[provinceData.province]) {
        forecastByProvince[provinceData.province] = [];
      }

      forecastByProvince[provinceData.province].push({
        dayName: i === 0 ? '今天' : dayNames[date.getDay()],
        high: provinceData.maxTemp,
        low: provinceData.minTemp
      });
    });
  }

  return forecastByProvince;
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
 * 多语言配置对象
 */
const i18n = {
  zh: {
    title: '中国气温排行榜 - 全国实时气温数据',
    description: '中国气温排行榜 - {date}全国各省市气温数据',
    keywords: '中国气温,温度排行,天气,气温地图,实时温度',
    mainHeading: '中国气温排行',
    tempScale: 'Temp Scale',
    rankingTitle: '全国 排行',
    regions: '地区',
    sortHot: '高温',
    sortCold: '低温',
    wind: '风速',
    unknown: '未知',
    today: '今天',
    monday: '周一',
    tuesday: '周二',
    wednesday: '周三',
    thursday: '周四',
    friday: '周五',
    saturday: '周六',
    sunday: '周日',
    tempUnit: '°C',
    windUnit: 'm/s'
  },
  en: {
    title: 'China Temperature Rankings - Real-time Temperature Data',
    description: 'China Temperature Rankings - {date} Temperature data of provinces and cities across China',
    keywords: 'China temperature,temperature rankings,weather,temperature map,real-time temperature',
    mainHeading: 'China Temp Rankings',
    tempScale: 'Temp Scale',
    rankingTitle: 'National Rankings',
    regions: 'Regions',
    sortHot: 'Hot',
    sortCold: 'Cold',
    wind: 'Wind',
    unknown: 'Unknown',
    today: 'Today',
    monday: 'Mon',
    tuesday: 'Tue',
    wednesday: 'Wed',
    thursday: 'Thu',
    friday: 'Fri',
    saturday: 'Sat',
    sunday: 'Sun',
    tempUnit: '°C',
    windUnit: 'm/s'
  }
};

/**
 * 天气描述中英文对照表
 */
const weatherDescMap = {
  '晴': 'Sunny',
  '多云': 'Cloudy',
  '阴': 'Overcast',
  '阵雨': 'Shower',
  '雷阵雨': 'Thunderstorm',
  '雷阵雨伴有冰雹': 'Thunderstorm with Hail',
  '雨夹雪': 'Sleet',
  '小雨': 'Light Rain',
  '中雨': 'Moderate Rain',
  '大雨': 'Heavy Rain',
  '暴雨': 'Storm',
  '大暴雨': 'Heavy Storm',
  '特大暴雨': 'Severe Storm',
  '阵雪': 'Snow Shower',
  '小雪': 'Light Snow',
  '中雪': 'Moderate Snow',
  '大雪': 'Heavy Snow',
  '暴雪': 'Snowstorm',
  '雾': 'Fog',
  '冻雨': 'Freezing Rain',
  '沙尘暴': 'Sandstorm',
  '小雨-中雨': 'Light to Moderate Rain',
  '中雨-大雨': 'Moderate to Heavy Rain',
  '大雨-暴雨': 'Heavy Rain to Storm',
  '暴雨-大暴雨': 'Storm to Heavy Storm',
  '大暴雨-特大暴雨': 'Heavy Storm to Severe Storm',
  '小雪-中雪': 'Light to Moderate Snow',
  '中雪-大雪': 'Moderate to Heavy Snow',
  '大雪-暴雪': 'Heavy Snow to Snowstorm',
  '浮尘': 'Dust',
  '扬沙': 'Sand',
  '强沙尘暴': 'Severe Sandstorm',
  '霾': 'Haze',
  '未知': 'Unknown'
};

/**
 * 翻译天气描述
 * @param {string} weatherDesc - 中文天气描述
 * @param {string} lang - 目标语言 ('zh' | 'en')
 * @returns {string} 翻译后的天气描述
 */
function translateWeatherDesc(weatherDesc, lang) {
  if (lang === 'zh') {
    return weatherDesc;
  }
  return weatherDescMap[weatherDesc] || weatherDesc;
}

/**
 * 生成单个日期的HTML页面
 * @param {number} dayIndex - 天数索引 (0=今天, 1=明天, ...)
 * @param {Array} allForecastData - 包含7天数据的数组
 * @param {Object} forecastData - 7天预报数据
 */
async function generateDayPage(dayIndex, allForecastData, forecastData) {
  const provinceData = allForecastData[dayIndex];

  // 检查数据是否为空
  if (!provinceData || provinceData.length === 0) {
    console.warn(`⚠️  第${dayIndex}天数据为空，跳过生成`);
    return;
  }

  // 计算日期和文件路径
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + dayIndex);
  const dateStr = targetDate.toISOString().slice(0, 10).replace(/-/g, '');

  // 文件路径: 今天是 index.html, 其他天是 YYYYMMDD/index.html
  const filePath = dayIndex === 0 ? 'index.html' : `${dateStr}/index.html`;

  const lastUpdate = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const temps = provinceData.map(p => p.temperature);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);

  // 生成标题和描述(包含日期信息)
  const dateFormatted = targetDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const titleSuffix = dayIndex === 0 ? '' : ` - ${dateFormatted}`;
  const descriptionDate = dayIndex === 0 ? '实时' : dateFormatted;

  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="China Temperature Rankings - ${descriptionDate} Temperature data across China">
    <meta name="keywords" content="China temperature,temperature rankings,weather,temperature map,real-time temperature,${dateFormatted}">
    <title>China Temperature Rankings - Real-time Temperature Data${titleSuffix}</title>
    <script>
      // 多语言配置
      window.i18n = ${JSON.stringify(i18n)};

      // 省份名称映射（fullName -> 中英文）
      // 使用完整的provinces.js数据,确保覆盖所有省份
      window.provinceNameMap = ${JSON.stringify(
        (() => {
          const map = {};

          // 首先添加provinces.js中的所有省份
          PROVINCES_DATA.forEach(p => {
            const entry = {
              zh: p.name,
              en: p.en_name,
              fullName: p.full_name
            };

            // 添加全称映射
            map[p.full_name] = entry;

            // 添加简称映射
            if (p.name !== p.full_name) {
              map[p.name] = entry;
            }

            // 添加去除后缀的映射
            const cleanName = p.name.replace(/(省|市)$/g, '');
            if (cleanName !== p.name) {
              map[cleanName] = entry;
            }
          });

          // 特殊处理：南海诸岛
          map['南海诸岛'] = {
            zh: '南海诸岛',
            en: 'Nanhai Islands',
            fullName: '南海诸岛'
          };

          // 然后用当前数据覆盖（如果有的话）
          provinceData.forEach(item => {
            const fullName = item.fullName || item.province;
            const entry = {
              zh: item.province,
              en: item.enName || item.province,
              fullName: fullName
            };

            map[fullName] = entry;
            map[item.province] = entry;

            // 也添加去除后缀的版本
            const cleanName = item.province.replace(/(省|市)$/g, '');
            if (cleanName !== item.province) {
              map[cleanName] = entry;
            }
          });

          return map;
        })()
      )};

      // 天气描述中英文对照表
      window.weatherDescMap = ${JSON.stringify(weatherDescMap)};

      // 翻译天气描述
      window.translateWeatherDesc = function(weatherDesc, lang) {
        if (lang === 'zh') {
          return weatherDesc;
        }
        return window.weatherDescMap[weatherDesc] || weatherDesc;
      };

      // 获取省份显示名称（支持模糊匹配）
      window.getProvinceName = function(geoName, lang) {
        // 精确匹配
        if (window.provinceNameMap[geoName]) {
          return window.provinceNameMap[geoName][lang];
        }

        // 模糊匹配：移除常见后缀
        const cleanName = geoName.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔|蒙古族)$/g, '');

        // 尝试查找匹配的省份
        for (const [key, value] of Object.entries(window.provinceNameMap)) {
          const cleanKey = key.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔|蒙古族)$/g, '');

          // 精确匹配清理后的名称
          if (cleanKey === cleanName) {
            return value[lang];
          }

          // 包含匹配（两个方向都试）
          if (cleanKey.includes(cleanName) && cleanName.length >= 2) {
            return value[lang];
          }
          if (cleanName.includes(cleanKey) && cleanKey.length >= 2) {
            return value[lang];
          }
        }

        // 如果还是找不到,尝试更激进的匹配
        // 处理特殊情况: "内蒙古" vs "内蒙古自治区"
        const specialCases = {
          '内蒙古': '内蒙古自治区',
          '广西': '广西壮族自治区',
          '西藏': '西藏自治区',
          '宁夏': '宁夏回族自治区',
          '新疆': '新疆维吾尔自治区',
          '香港': '香港特别行政区',
          '澳门': '澳门特别行政区'
        };

        const normalized = specialCases[cleanName] || cleanName;
        if (window.provinceNameMap[normalized]) {
          return window.provinceNameMap[normalized][lang];
        }

        // 如果完全找不到,返回原始名称
        console.warn('未找到省份映射:', geoName);
        return geoName;
      };
    </script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
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
<body class="flex flex-col md:flex-row h-screen w-screen overflow-hidden bg-slate-50 dark:bg-[#0d1117] text-slate-900 dark:text-white font-sans transition-colors duration-300">

    <!-- 左侧：地图可视化区域 -->
        <div class="relative flex-1 h-[50vh] md:h-full flex flex-col">
            <!-- 顶部覆盖层：标题 & 图例 -->
            <div class="absolute top-0 left-0 w-full p-6 z-10 pointer-events-none">
                <div class="flex justify-between items-start">
                    <div>
                        <h1 id="main-heading" class="text-3xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-emerald-500 drop-shadow-sm font-sans">
                            China Temp Rankings
                        </h1>
                    </div>

                    <div class="pointer-events-auto flex flex-col items-end gap-2">
                        <div class="flex gap-2">
                            <!-- Theme Toggle -->
                            <button onclick="toggleTheme()" id="theme-btn" class="p-1.5 rounded-lg bg-white/80 dark:bg-gray-800/80 backdrop-blur border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 transition-colors shadow-sm cursor-pointer">
                                <!-- Icons are swapped by JS -->
                                <svg id="icon-sun" class="w-4 h-4 hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                                <svg id="icon-moon" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                            </button>

                            <!-- 语言切换 -->
                            <div class="flex bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-lg border border-slate-200 dark:border-gray-700 p-1">
                                <button onclick="switchLanguage('en')" id="lang-en" class="px-2 py-0.5 text-xs font-bold rounded bg-blue-600 text-white cursor-pointer">EN</button>
                                <button onclick="switchLanguage('zh')" id="lang-zh" class="px-2 py-0.5 text-xs font-bold rounded text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer">CN</button>
                            </div>
                        </div>

                        <!-- 温度图例 -->
                        <div class="flex flex-col gap-1 items-end p-2 rounded-lg bg-white/80 dark:bg-gray-900/60 backdrop-blur-md border border-slate-200 dark:border-gray-700/50 shadow-xl transition-colors duration-300">
                            <div id="temp-scale-label" class="text-[10px] text-slate-500 dark:text-gray-400 font-semibold mb-1 uppercase tracking-wider w-full text-right px-1">Temp Scale</div>
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
                                    <span class="text-[10px] text-slate-500 dark:text-gray-400 font-medium group-hover:text-slate-800 dark:group-hover:text-gray-200">${step.label}</span>
                                    <div class="w-8 h-1.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.1)] dark:shadow-[0_0_8px_rgba(0,0,0,0.3)] transition-all group-hover:w-10 bg-[${step.color}]"></div>
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
            <div class="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 md:gap-2 p-1.5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md rounded-2xl border border-slate-200 dark:border-gray-700/50 shadow-2xl shadow-slate-300/50 dark:shadow-black/50 max-w-[95%] overflow-x-auto no-scrollbar pointer-events-auto transition-colors duration-300">
                ${Array.from({length: 7}, (_, i) => {
                  const daysZh = ['今天', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
                  const daysEn = ['Today', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                  const date = new Date();
                  date.setDate(date.getDate() + i);
                  const dayNameZh = i === 0 ? '今天' : daysZh[date.getDay()];
                  const dayNameEn = i === 0 ? 'Today' : daysEn[date.getDay()];
                  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
                  const isActive = i === dayIndex;

                  // 链接路径: 今天是 index.html, 其他天是 YYYYMMDD/index.html
                  let href;
                  if (isActive) {
                    href = '#';
                  } else if (i === 0) {
                    // 如果当前不是首页,链接回首页需要根据当前位置调整
                    href = dayIndex === 0 ? 'index.html' : '../index.html';
                  } else {
                    // 链接到其他日期页面
                    href = dayIndex === 0 ? dateStr + '/index.html' : '../' + dateStr + '/index.html';
                  }

                  const targetAttr = isActive ? '' : 'target="_blank"';
                  const activeClass = isActive ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25 ring-1 ring-white/20' : 'text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5';
                  const indicator = isActive ? '<span class="w-1 h-1 bg-white rounded-full opacity-50 absolute bottom-1"></span>' : '';

                  return `
                  <a href="${href}" ${targetAttr} class="relative px-3 md:px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 whitespace-nowrap flex flex-col items-center justify-center gap-0.5 ${activeClass}">
                      <span class="day-label" data-day-zh="${dayNameZh}" data-day-en="${dayNameEn}">${dayNameEn}</span>
                      ${indicator}
                  </a>
                  `;
                }).join('')}
            </div>
        </div>

        <!-- 右侧：排行榜面板 (RankingPanel) -->
        <div class="w-full md:w-[400px] h-[50vh] md:h-full z-20">
            <div class="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-slate-200 dark:border-gray-700 shadow-2xl relative transition-colors duration-300">
            <!-- 面板头部 -->
            <div class="p-6 border-b border-slate-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur z-10 sticky top-0 transition-colors duration-300">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex flex-col">
                        <h2 id="ranking-title" class="text-xl font-bold text-slate-900 dark:text-white tracking-tight">National Rankings</h2>
                        <div class="flex items-center gap-2 mt-1">
                            <span class="text-xs text-slate-500 dark:text-gray-500">${provinceData.length} <span id="regions-label">Regions</span></span>
                        </div>
                    </div>
                </div>

                <!-- 排序控制 -->
                <div class="flex p-1 bg-slate-100 dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700">
                    <button onclick="sortList('desc')" id="btn-hot" class="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all bg-red-500/10 text-red-600 dark:text-red-400 shadow-sm ring-1 ring-red-500/50">
                        Hot
                    </button>
                    <button onclick="sortList('asc')" id="btn-cold" class="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all text-slate-400 dark:text-gray-400 hover:text-slate-600 dark:hover:text-gray-200">
                        Cold
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
                    <div class="ranking-item group flex flex-col p-3 rounded-xl transition-all duration-300 border cursor-pointer select-none border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-800 hover:bg-slate-50 dark:hover:bg-gray-750"
                         data-temp="${item.temperature}" onclick="toggleExpand(this)">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-4">
                                <span data-role="badge" class="flex justify-center items-center w-7 h-7 rounded-lg text-sm font-bold shadow-sm bg-slate-200 dark:bg-gray-700 text-slate-500 dark:text-gray-400">
                                    ${index + 1}
                                </span>
                                <div>
                                    <h3 data-role="title" data-province-zh="${item.province}" data-province-en="${item.enName || item.province}" class="font-semibold text-slate-700 dark:text-gray-300 text-sm md:text-base">${item.enName || item.province}</h3>
                                    <div class="text-xs text-slate-500 dark:text-gray-500 flex gap-2 items-center mt-0.5">
                                        <span class="weather-desc" data-weather-zh="${item.weatherDesc || '未知'}" data-weather-en="${translateWeatherDesc(item.weatherDesc || '未知', 'en')}">${translateWeatherDesc(item.weatherDesc || '未知', 'en')}</span><span class="w-1 h-1 rounded-full bg-slate-400 dark:bg-gray-600"></span><span class="wind-label">Wind</span>: ${item.windSpeed || '0'} m/s</span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="text-right">
                                    <div data-role="temp-val" class="text-lg font-bold tabular-nums tracking-tight">
                                        ${item.temperature !== null && item.temperature !== undefined && !isNaN(item.temperature) ? item.temperature + '°' : '-'}
                                    </div>
                                </div>
                                <!-- 箭头 -->
                                <div class="arrow-icon p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-transform duration-300">
                                    <svg class="w-4 h-4 text-slate-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>
                        </div>

                        <!-- 详情 (7天预报) -->
                        <div class="details-container mt-3 pt-3 border-t border-slate-200 dark:border-gray-700/50">
                            <div class="grid grid-cols-7 gap-1">
                                ${forecast.map((day, idx) => {
                                  const hasData = day.high !== null && day.low !== null;
                                  const tempRange = hasData ? day.high - day.low : 10;
                                  const bottomPos = hasData ? Math.max(0, Math.min(100, (day.low + 10) * 2)) : 50;
                                  const barHeight = hasData ? Math.max(10, Math.min(100, tempRange * 2)) : 20;
                                  const barColor = hasData ? getColorForTemp(day.high) : '#4b5563';

                                  // 获取中英文星期
                                  const daysZh = ['今天', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
                                  const daysEn = ['Today', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                                  const dayNameIndex = daysZh.indexOf(day.dayName);
                                  const dayNameEn = dayNameIndex >= 0 ? daysEn[dayNameIndex] : day.dayName;

                                  return `
                                <div class="flex flex-col items-center group/day">
                                    <span class="forecast-day-label text-[9px] font-medium mb-1 ${idx === dayIndex ? 'text-blue-500' : 'text-slate-500 dark:text-gray-500'}" data-day-zh="${day.dayName}" data-day-en="${dayNameEn}">
                                        ${dayNameEn}
                                    </span>
                                    <div class="w-full bg-slate-200 dark:bg-gray-800/50 rounded-full h-20 relative w-1.5 md:w-2 mx-auto ring-1 ring-black/5 dark:ring-white/5">
                                        <div class="absolute w-full rounded-full opacity-80" style="bottom: ${bottomPos}%; height: ${barHeight}%; background-color: ${barColor};"></div>
                                    </div>
                                    <div class="flex flex-col items-center mt-1.5 gap-0.5">
                                        <span class="text-[10px] font-bold text-slate-700 dark:text-gray-300 leading-none">${hasData ? day.high + '°' : '--'}</span>
                                        <span class="text-[9px] text-slate-500 dark:text-gray-600 leading-none">${hasData ? day.low + '°' : '--'}</span>
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
        let currentTheme = 'dark'; // 'light' | 'dark'
        let currentLang = 'en'; // 'en' | 'zh' - 默认英文
        let tempMapData = {}; // 全局温度映射

        // 初始化语言设置
        function initLanguage() {
            const savedLang = localStorage.getItem('preferredLanguage') || 'en';
            currentLang = savedLang;
            updateLanguageUI(savedLang);
        }

        // 切换语言
        function switchLanguage(lang) {
            if (lang === currentLang) return;

            currentLang = lang;
            localStorage.setItem('preferredLanguage', lang);
            updateLanguageUI(lang);
        }

        // 更新UI语言
        function updateLanguageUI(lang) {
            const t = window.i18n[lang];

            // 更新HTML lang属性
            document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

            // 更新按钮状态
            const langEn = document.getElementById('lang-en');
            const langZh = document.getElementById('lang-zh');
            const activeClass = 'px-2 py-0.5 text-xs font-bold rounded bg-blue-600 text-white cursor-pointer';
            const inactiveClass = 'px-2 py-0.5 text-xs font-bold rounded text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer';

            if (lang === 'en') {
                langEn.className = activeClass;
                langZh.className = inactiveClass;
            } else {
                langEn.className = inactiveClass;
                langZh.className = activeClass;
            }

            // 更新页面标题和meta
            document.title = t.title;
            document.querySelector('meta[name="description"]').content = t.description;

            // 更新主标题
            document.getElementById('main-heading').textContent = t.mainHeading;

            // 更新温度图例标签
            document.getElementById('temp-scale-label').textContent = t.tempScale;

            // 更新排行榜标题
            document.getElementById('ranking-title').textContent = t.rankingTitle;
            document.getElementById('regions-label').textContent = t.regions;

            // 更新排序按钮
            document.getElementById('btn-hot').textContent = t.sortHot;
            document.getElementById('btn-cold').textContent = t.sortCold;

            // 更新省份名称
            document.querySelectorAll('[data-province-zh]').forEach(el => {
                el.textContent = lang === 'zh' ? el.dataset.provinceZh : el.dataset.provinceEn;
            });

            // 更新日期标签
            document.querySelectorAll('.day-label').forEach(el => {
                el.textContent = lang === 'zh' ? el.dataset.dayZh : el.dataset.dayEn;
            });

            // 更新预报日期标签
            document.querySelectorAll('.forecast-day-label').forEach(el => {
                el.textContent = lang === 'zh' ? el.dataset.dayZh : el.dataset.dayEn;
            });

            // 更新天气描述
            document.querySelectorAll('.weather-desc').forEach(el => {
                el.textContent = lang === 'zh' ? el.dataset.weatherZh : el.dataset.weatherEn;
            });

            // 更新风速标签
            document.querySelectorAll('.wind-label').forEach(el => {
                el.textContent = t.wind;
            });

            // 重绘地图（更新省份名称和主题）
            if (window.myMapChart) {
                updateMapOption(window.myMapChart);
            }
        }

        // 排名样式配置
        const RANK_STYLES = {
            1: {
                container: "border-yellow-500/50 bg-gradient-to-r from-yellow-500/10 to-transparent dark:from-yellow-900/20",
                badge: "bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.4)]",
                title: "text-yellow-700 dark:text-yellow-100"
            },
            2: {
                container: "border-slate-400/50 dark:border-gray-400/40 bg-gradient-to-r from-slate-500/10 to-transparent dark:from-gray-700/20",
                badge: "bg-slate-300 dark:bg-gray-300 text-black shadow-[0_0_10px_rgba(209,213,219,0.4)]",
                title: "text-slate-700 dark:text-gray-100"
            },
            3: {
                container: "border-orange-500/50 dark:border-orange-600/40 bg-gradient-to-r from-orange-500/10 to-transparent dark:from-orange-900/20",
                badge: "bg-orange-500 dark:bg-orange-600 text-white shadow-[0_0_10px_rgba(234,88,12,0.4)]",
                title: "text-orange-700 dark:text-orange-100"
            },
            default: {
                container: "border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-800 hover:bg-slate-50 dark:hover:bg-gray-750",
                badge: "bg-slate-200 dark:bg-gray-700 text-slate-500 dark:text-gray-400",
                title: "text-slate-700 dark:text-gray-300"
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

        // 主题切换逻辑
        function toggleTheme() {
            const html = document.documentElement;
            const sunIcon = document.getElementById('icon-sun');
            const moonIcon = document.getElementById('icon-moon');

            if (html.classList.contains('dark')) {
                html.classList.remove('dark');
                currentTheme = 'light';
                sunIcon.classList.add('hidden');
                moonIcon.classList.remove('hidden');
            } else {
                html.classList.add('dark');
                currentTheme = 'dark';
                sunIcon.classList.remove('hidden');
                moonIcon.classList.add('hidden');
            }

            // 重绘地图以适应新配色
            if(window.myMapChart) {
                updateMapOption(window.myMapChart);
            }
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

        // 更新地图主题配色
        function updateMapOption(chart) {
            const isDark = document.documentElement.classList.contains('dark');
            const areaColor = isDark ? '#1f2937' : '#e2e8f0';
            const borderColor = isDark ? '#111' : '#cbd5e1';
            const hoverColor = isDark ? '#4b5563' : '#94a3b8';
            const labelColor = isDark ? '#e5e7eb' : '#334155';
            const emphasisLabelColor = isDark ? '#fff' : '#0f172a';
            const shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)';
            const tooltipBg = isDark ? 'rgba(23, 23, 26, 0.95)' : 'rgba(255, 255, 255, 0.95)';
            const tooltipText = isDark ? '#e5e7eb' : '#1e293b';
            const tooltipBorder = isDark ? '#374151' : '#e2e8f0';

            chart.setOption({
                tooltip: {
                    backgroundColor: tooltipBg,
                    borderColor: tooltipBorder,
                    textStyle: { color: tooltipText },
                    formatter: (p) => {
                        const displayName = window.getProvinceName(p.name, currentLang);
                        const temp = p.value;
                        const tempLabel = currentLang === 'zh' ? '温度' : 'Temperature';
                        if (temp === undefined || temp === null || isNaN(temp)) {
                            return \`<div class="font-bold text-sm mb-1">\${displayName}</div><div class="text-xs">\${tempLabel}: <span class="font-bold">-</span></div>\`;
                        }
                        const color = getColorForTemp(temp);
                        return \`<div class="font-bold text-sm mb-1">\${displayName}</div><div class="text-xs">\${tempLabel}: <span class="font-bold" style="color: \${color}">\${temp}°C</span></div>\`;
                    }
                },
                geo: {
                    label: {
                        show: true,
                        fontSize: 10,
                        color: labelColor,
                        textBorderColor: isDark ? '#111827' : '#f8fafc',
                        textBorderWidth: 2,
                        formatter: (params) => {
                            const displayName = window.getProvinceName(params.name, currentLang);
                            const temp = tempMapData[params.name];

                            if (temp !== undefined && temp !== null && !isNaN(temp)) {
                                return \`\${displayName}\\n\${temp}°\`;
                            }
                            return \`\${displayName}\\n-\`;
                        }
                    },
                    itemStyle: { areaColor: areaColor, borderColor: borderColor },
                    emphasis: {
                        label: {
                            show: true,
                            color: emphasisLabelColor,
                            fontSize: 12,
                            formatter: (params) => {
                                const displayName = window.getProvinceName(params.name, currentLang);
                                const temp = tempMapData[params.name];

                                if (temp !== undefined && temp !== null && !isNaN(temp)) {
                                    return \`\${displayName}\\n\${temp}°C\`;
                                }
                                return \`\${displayName}\\n-\`;
                            }
                        },
                        itemStyle: { areaColor: hoverColor, shadowColor: shadowColor, shadowBlur: 10 }
                    }
                }
            });
        }

        // 1. 初始化地图
        const initMap = async () => {
            const chartDom = document.getElementById('main-map');
            window.myMapChart = echarts.init(chartDom);

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
            data.forEach(item => {
                tempMapData[item.name] = item.value;
            });

            // 调试输出
            console.log('地图数据:', data);
            console.log('温度映射:', tempMapData);

            window.myMapChart.setOption({
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'item',
                    borderWidth: 1,
                    textStyle: { fontSize: 12 }
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
                    itemStyle: { borderWidth: 1 }
                },
                series: [{ type: 'map', geoIndex: 0, data: data }]
            });

            // 应用正确的主题颜色
            updateMapOption(window.myMapChart);

            window.myMapChart.on('click', function(params) {
                // 跳转到省份详情页
                const provinceName = params.name;

                // 查找对应的英文名称
                let enName = provinceName;
                for (const [key, value] of Object.entries(window.provinceNameMap)) {
                    if (value.fullName === provinceName || value.zh === provinceName) {
                        enName = value.en;
                        break;
                    }
                }

                // 使用英文名称小写作为文件名
                const fileName = enName.toLowerCase().replace(/\\s+/g, '') + '.html';
                window.location.href = fileName;
            });

            window.addEventListener('resize', () => window.myMapChart.resize());
        };

        // 2. UI 交互: 展开详情
        function toggleExpand(el) {
            const details = el.querySelector('.details-container');
            const arrow = el.querySelector('.arrow-icon');

            if (details.classList.contains('open')) {
                details.classList.remove('open', 'fade-in');
                arrow.classList.remove('rotate-180', 'bg-black/5', 'dark:bg-white/10');
                el.classList.remove('ring-1', 'ring-slate-400', 'dark:ring-gray-500');
            } else {
                details.classList.add('open', 'fade-in');
                arrow.classList.add('rotate-180', 'bg-black/5', 'dark:bg-white/10');
                el.classList.add('ring-1', 'ring-slate-400', 'dark:ring-gray-500');
            }
        }

        // 3. UI 交互: 排序
        function sortList(order) {
            const list = document.getElementById('ranking-list');
            const items = Array.from(list.getElementsByClassName('ranking-item'));
            const btnHot = document.getElementById('btn-hot');
            const btnCold = document.getElementById('btn-cold');

            const activeClass = "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all bg-blue-500/10 text-blue-600 dark:text-blue-400 shadow-sm ring-1 ring-blue-500/50";
            const hotActiveClass = "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all bg-red-500/10 text-red-600 dark:text-red-400 shadow-sm ring-1 ring-red-500/50";
            const inactiveClass = "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all text-slate-400 dark:text-gray-400 hover:text-slate-600 dark:hover:text-gray-200";

            if(order === 'desc') {
                btnHot.className = hotActiveClass;
                btnCold.className = inactiveClass;
            } else {
                btnHot.className = inactiveClass;
                btnCold.className = activeClass;
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
            // 初始化语言
            initLanguage();

            // 初始化主题图标显示
            if(!document.documentElement.classList.contains('dark')) {
                document.getElementById('icon-sun').classList.add('hidden');
                document.getElementById('icon-moon').classList.remove('hidden');
            } else {
                document.getElementById('icon-sun').classList.remove('hidden');
                document.getElementById('icon-moon').classList.add('hidden');
            }

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

  // 确保目录存在
  const fullPath = path.join(OUTPUT_DIR, filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, html, 'utf8');
  console.log(`✅ ${filePath} 生成完成`);
}

/**
 * 生成所有日期的主页
 */
async function generateAllIndexPages(allForecastData, forecastData) {
  console.log('🏠 生成所有日期页面...');

  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (let i = 0; i < 7; i++) {
    await generateDayPage(i, allForecastData, forecastData);
  }

  console.log('✅ 所有日期页面生成完成');
}


/**
 * 生成单个省份的详情页面
 * @param {string} provinceName - 省份名称（用于显示）
 * @param {Object} provinceConfig - 省份配置信息（来自provinces.js）
 */
async function generateProvincePage(provinceName, provinceConfig) {
  console.log(`  🏙️  生成省份页面: ${provinceName}`);

  if (!provinceConfig) {
    console.warn(`  ⚠️  ${provinceName} 未找到配置信息，跳过`);
    return;
  }

  // 使用省份code查询（数据库中存储的是code，如"ABJ"）
  const provinceCode = provinceConfig.code;

  // 获取今天的城市数据
  const cityData = await getCityTemperaturesByDate(provinceCode, new Date());

  if (!cityData || cityData.length === 0) {
    console.warn(`  ⚠️  ${provinceName} 暂无城市数据，跳过`);
    return;
  }

  // 为每个城市添加full_name（从provinceConfig.cities中查找，已在getCityTemperaturesByDate中处理）
  // cityData中已经包含了city（中文名）和cityCode
  if (provinceConfig && provinceConfig.cities) {
    cityData.forEach(city => {
      const cityConfig = provinceConfig.cities.find(c => c.code === city.cityCode);
      if (cityConfig && cityConfig.full_name) {
        city.fullName = cityConfig.full_name;
      } else {
        city.fullName = city.city;
      }
    });
  }

  // 获取该省份所有城市的7天预报数据
  const cityForecastData = await getCityForecast(provinceCode);

  // 获取省份的adcode（用于加载省份地图）
  const adcode = provinceConfig ? provinceConfig.adcode : null;

  if (!adcode) {
    console.warn(`  ⚠️  ${provinceName} 未找到adcode，无法生成地图`);
    return;
  }

  const lastUpdate = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const temps = cityData.map(c => c.temperature);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);

  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${provinceName} Temperature Rankings - City temperature data">
    <meta name="keywords" content="${provinceName},temperature,weather,cities">
    <title>${provinceName} Temperature Rankings</title>
    <script>
      // 多语言配置
      window.i18n = ${JSON.stringify(i18n)};

      // 天气描述中英文对照表
      window.weatherDescMap = ${JSON.stringify(weatherDescMap)};

      // 翻译天气描述
      window.translateWeatherDesc = function(weatherDesc, lang) {
        if (lang === 'zh') {
          return weatherDesc;
        }
        return window.weatherDescMap[weatherDesc] || weatherDesc;
      };
    </script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
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
        margin: 0;
        overflow: hidden;
      }
      .no-scrollbar::-webkit-scrollbar {
        display: none;
      }
      .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
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
      .details-container {
        display: none;
      }
      .details-container.open {
        display: block;
      }
    </style>
</head>
<body class="flex flex-col md:flex-row h-screen w-screen overflow-hidden bg-slate-50 dark:bg-[#0d1117] text-slate-900 dark:text-white font-sans transition-colors duration-300">

    <!-- 左侧：地图可视化区域 -->
    <div class="relative flex-1 h-[50vh] md:h-full flex flex-col">
        <!-- 顶部覆盖层：标题 & 图例 & 返回按钮 -->
        <div class="absolute top-0 left-0 w-full p-6 z-10 pointer-events-none">
            <div class="flex justify-between items-start">
                <div class="flex items-center gap-3">
                    <!-- 返回按钮 -->
                    <a href="index.html" class="pointer-events-auto p-2 rounded-lg bg-white/80 dark:bg-gray-800/80 backdrop-blur border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 transition-colors shadow-sm">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </a>
                    <div>
                        <h1 id="main-heading" class="text-3xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-emerald-500 drop-shadow-sm font-sans">
                            ${provinceName}
                        </h1>
                    </div>
                </div>

                <div class="pointer-events-auto flex flex-col items-end gap-2">
                    <div class="flex gap-2">
                        <!-- Theme Toggle -->
                        <button onclick="toggleTheme()" id="theme-btn" class="p-1.5 rounded-lg bg-white/80 dark:bg-gray-800/80 backdrop-blur border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 transition-colors shadow-sm cursor-pointer">
                            <svg id="icon-sun" class="w-4 h-4 hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                            <svg id="icon-moon" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                        </button>

                        <!-- 语言切换 -->
                        <div class="flex bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-lg border border-slate-200 dark:border-gray-700 p-1">
                            <button onclick="switchLanguage('en')" id="lang-en" class="px-2 py-0.5 text-xs font-bold rounded bg-blue-600 text-white cursor-pointer">EN</button>
                            <button onclick="switchLanguage('zh')" id="lang-zh" class="px-2 py-0.5 text-xs font-bold rounded text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer">CN</button>
                        </div>
                    </div>

                    <!-- 温度图例 -->
                    <div class="flex flex-col gap-1 items-end p-2 rounded-lg bg-white/80 dark:bg-gray-900/60 backdrop-blur-md border border-slate-200 dark:border-gray-700/50 shadow-xl transition-colors duration-300">
                        <div id="temp-scale-label" class="text-[10px] text-slate-500 dark:text-gray-400 font-semibold mb-1 uppercase tracking-wider w-full text-right px-1">Temp Scale</div>
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
                                <span class="text-[10px] text-slate-500 dark:text-gray-400 font-medium group-hover:text-slate-800 dark:group-hover:text-gray-200">${step.label}</span>
                                <div class="w-8 h-1.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.1)] dark:shadow-[0_0_8px_rgba(0,0,0,0.3)] transition-all group-hover:w-10 bg-[${step.color}]"></div>
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
        <div class="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 md:gap-2 p-1.5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md rounded-2xl border border-slate-200 dark:border-gray-700/50 shadow-2xl shadow-slate-300/50 dark:shadow-black/50 max-w-[95%] overflow-x-auto no-scrollbar pointer-events-auto transition-colors duration-300">
            ${(() => {
              const dayButtons = [];
              for (let i = 0; i < 7; i++) {
                const daysZh = ['今天', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
                const daysEn = ['Today', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                const date = new Date();
                date.setDate(date.getDate() + i);
                const dayNameZh = i === 0 ? '今天' : daysZh[date.getDay()];
                const dayNameEn = i === 0 ? 'Today' : daysEn[date.getDay()];

                const isActive = i === 0;
                let href = '#';
                if (!isActive) {
                  if (i === 0) {
                    href = 'index.html';
                  } else {
                    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
                    href = dateStr + '/index.html';
                  }
                }

                const targetAttr = isActive ? '' : 'target="_blank"';
                const activeClass = isActive ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25 ring-1 ring-white/20' : 'text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5';
                const indicator = isActive ? '<span class="w-1 h-1 bg-white rounded-full opacity-50 absolute bottom-1"></span>' : '';

                dayButtons.push(`
              <a href="${href}" ${targetAttr} class="relative px-3 md:px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 whitespace-nowrap flex flex-col items-center justify-center gap-0.5 ${activeClass}">
                  <span class="day-label" data-day-zh="${dayNameZh}" data-day-en="${dayNameEn}">${dayNameEn}</span>
                  ${indicator}
              </a>
                `);
              }
              return dayButtons.join('');
            })()}
        </div>
    </div>

    <!-- 右侧：城市排行榜面板 -->
    <div class="w-full md:w-[400px] h-[50vh] md:h-full z-20">
        <div class="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-slate-200 dark:border-gray-700 shadow-2xl relative transition-colors duration-300">
        <!-- 面板头部 -->
        <div class="p-6 border-b border-slate-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur z-10 sticky top-0 transition-colors duration-300">
            <div class="flex items-center justify-between mb-4">
                <div class="flex flex-col">
                    <h2 id="ranking-title" class="text-xl font-bold text-slate-900 dark:text-white tracking-tight">City Rankings</h2>
                    <div class="flex items-center gap-2 mt-1">
                        <span class="text-xs text-slate-500 dark:text-gray-500">${cityData.length} <span id="regions-label">Cities</span></span>
                    </div>
                </div>
            </div>

            <!-- 排序控制 -->
            <div class="flex p-1 bg-slate-100 dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700">
                <button onclick="sortList('desc')" id="btn-hot" class="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all bg-red-500/10 text-red-600 dark:text-red-400 shadow-sm ring-1 ring-red-500/50">
                    Hot
                </button>
                <button onclick="sortList('asc')" id="btn-cold" class="flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all text-slate-400 dark:text-gray-400 hover:text-slate-600 dark:hover:text-gray-200">
                    Cold
                </button>
            </div>
        </div>

        <!-- 列表内容区 -->
        <div id="ranking-list" class="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth">
            ${cityData.map((item, index) => {
              const forecast = cityForecastData[item.city] || [];

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
            <div class="ranking-item group flex flex-col p-3 rounded-xl transition-all duration-300 border cursor-pointer select-none border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-800 hover:bg-slate-50 dark:hover:bg-gray-750"
                 data-temp="${item.temperature}" onclick="toggleExpand(this)">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-4">
                        <span data-role="badge" class="flex justify-center items-center w-7 h-7 rounded-lg text-sm font-bold shadow-sm bg-slate-200 dark:bg-gray-700 text-slate-500 dark:text-gray-400">
                            ${index + 1}
                        </span>
                        <div>
                            <h3 data-role="title" class="font-semibold text-slate-700 dark:text-gray-300 text-sm md:text-base">${item.city}</h3>
                            <div class="text-xs text-slate-500 dark:text-gray-500 flex gap-2 items-center mt-0.5">
                                <span class="weather-desc" data-weather-zh="${item.weatherDesc || '未知'}" data-weather-en="${translateWeatherDesc(item.weatherDesc || '未知', 'en')}">${translateWeatherDesc(item.weatherDesc || '未知', 'en')}</span><span class="w-1 h-1 rounded-full bg-slate-400 dark:bg-gray-600"></span><span class="wind-label">Wind</span>: ${item.windSpeed || '0'} m/s</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="text-right">
                            <div data-role="temp-val" class="text-lg font-bold tabular-nums tracking-tight">
                                ${item.temperature !== null && item.temperature !== undefined && !isNaN(item.temperature) ? item.temperature + '°' : '-'}
                            </div>
                        </div>
                        <div class="arrow-icon p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-transform duration-300">
                            <svg class="w-4 h-4 text-slate-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>
                </div>

                <!-- 详情 (7天预报) -->
                <div class="details-container mt-3 pt-3 border-t border-slate-200 dark:border-gray-700/50">
                    <div class="grid grid-cols-7 gap-1">
                        ${forecast.map((day, idx) => {
                          const hasData = day.high !== null && day.low !== null;
                          const tempRange = hasData ? day.high - day.low : 10;
                          const bottomPos = hasData ? Math.max(0, Math.min(100, (day.low + 10) * 2)) : 50;
                          const barHeight = hasData ? Math.max(10, Math.min(100, tempRange * 2)) : 20;
                          const barColor = hasData ? getColorForTemp(day.high) : '#4b5563';

                          const daysZh = ['今天', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
                          const daysEn = ['Today', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                          const dayNameIndex = daysZh.indexOf(day.dayName);
                          const dayNameEn = dayNameIndex >= 0 ? daysEn[dayNameIndex] : day.dayName;

                          return `
                        <div class="flex flex-col items-center group/day">
                            <span class="forecast-day-label text-[9px] font-medium mb-1 ${idx === 0 ? 'text-blue-500' : 'text-slate-500 dark:text-gray-500'}" data-day-zh="${day.dayName}" data-day-en="${dayNameEn}">
                                ${dayNameEn}
                            </span>
                            <div class="w-full bg-slate-200 dark:bg-gray-800/50 rounded-full h-20 relative w-1.5 md:w-2 mx-auto ring-1 ring-black/5 dark:ring-white/5">
                                <div class="absolute w-full rounded-full opacity-80" style="bottom: ${bottomPos}%; height: ${barHeight}%; background-color: ${barColor};"></div>
                            </div>
                            <div class="flex flex-col items-center mt-1.5 gap-0.5">
                                <span class="text-[10px] font-bold text-slate-700 dark:text-gray-300 leading-none">${hasData ? day.high + '°' : '--'}</span>
                                <span class="text-[9px] text-slate-500 dark:text-gray-600 leading-none">${hasData ? day.low + '°' : '--'}</span>
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
    let currentTheme = 'dark';
    let currentLang = 'en';
    let tempMapData = {};

    function initLanguage() {
        const savedLang = localStorage.getItem('preferredLanguage') || 'en';
        currentLang = savedLang;
        updateLanguageUI(savedLang);
    }

    function switchLanguage(lang) {
        if (lang === currentLang) return;
        currentLang = lang;
        localStorage.setItem('preferredLanguage', lang);
        updateLanguageUI(lang);
    }

    function updateLanguageUI(lang) {
        const t = window.i18n[lang];
        document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

        const langEn = document.getElementById('lang-en');
        const langZh = document.getElementById('lang-zh');
        const activeClass = 'px-2 py-0.5 text-xs font-bold rounded bg-blue-600 text-white cursor-pointer';
        const inactiveClass = 'px-2 py-0.5 text-xs font-bold rounded text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer';

        if (lang === 'en') {
            langEn.className = activeClass;
            langZh.className = inactiveClass;
        } else {
            langEn.className = inactiveClass;
            langZh.className = activeClass;
        }

        document.getElementById('temp-scale-label').textContent = t.tempScale;
        document.getElementById('btn-hot').textContent = t.sortHot;
        document.getElementById('btn-cold').textContent = t.sortCold;

        document.querySelectorAll('.weather-desc').forEach(el => {
            el.textContent = lang === 'zh' ? el.dataset.weatherZh : el.dataset.weatherEn;
        });

        document.querySelectorAll('.wind-label').forEach(el => {
            el.textContent = t.wind;
        });

        document.querySelectorAll('.forecast-day-label').forEach(el => {
            el.textContent = lang === 'zh' ? el.dataset.dayZh : el.dataset.dayEn;
        });

        if (window.myMapChart) {
            updateMapOption(window.myMapChart);
        }
    }

    const RANK_STYLES = {
        1: {
            container: "border-yellow-500/50 bg-gradient-to-r from-yellow-500/10 to-transparent dark:from-yellow-900/20",
            badge: "bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.4)]",
            title: "text-yellow-700 dark:text-yellow-100"
        },
        2: {
            container: "border-slate-400/50 dark:border-gray-400/40 bg-gradient-to-r from-slate-500/10 to-transparent dark:from-gray-700/20",
            badge: "bg-slate-300 dark:bg-gray-300 text-black shadow-[0_0_10px_rgba(209,213,219,0.4)]",
            title: "text-slate-700 dark:text-gray-100"
        },
        3: {
            container: "border-orange-500/50 dark:border-orange-600/40 bg-gradient-to-r from-orange-500/10 to-transparent dark:from-orange-900/20",
            badge: "bg-orange-500 dark:bg-orange-600 text-white shadow-[0_0_10px_rgba(234,88,12,0.4)]",
            title: "text-orange-700 dark:text-orange-100"
        },
        default: {
            container: "border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-800 hover:bg-slate-50 dark:hover:bg-gray-750",
            badge: "bg-slate-200 dark:bg-gray-700 text-slate-500 dark:text-gray-400",
            title: "text-slate-700 dark:text-gray-300"
        }
    };

    function getColorForTemp(temp) {
        if (temp >= 35) return '#ef4444';
        if (temp >= 28) return '#f97316';
        if (temp >= 20) return '#eab308';
        if (temp >= 10) return '#10b981';
        if (temp >= 0) return '#06b6d4';
        if (temp >= -10) return '#3b82f6';
        return '#6366f1';
    }

    function toggleTheme() {
        const html = document.documentElement;
        const sunIcon = document.getElementById('icon-sun');
        const moonIcon = document.getElementById('icon-moon');

        if (html.classList.contains('dark')) {
            html.classList.remove('dark');
            currentTheme = 'light';
            sunIcon.classList.add('hidden');
            moonIcon.classList.remove('hidden');
        } else {
            html.classList.add('dark');
            currentTheme = 'dark';
            sunIcon.classList.remove('hidden');
            moonIcon.classList.add('hidden');
        }

        if(window.myMapChart) {
            updateMapOption(window.myMapChart);
        }
    }

    function applyRankStyle(element, rank) {
        const badgeEl = element.querySelector('[data-role="badge"]');
        const titleEl = element.querySelector('[data-role="title"]');
        const tempEl = element.querySelector('[data-role="temp-val"]');

        if (!badgeEl || !titleEl || !tempEl) return;

        const style = RANK_STYLES[rank] || RANK_STYLES.default;
        element.className = \`ranking-item group flex flex-col p-3 rounded-xl transition-all duration-300 border cursor-pointer select-none \${style.container}\`;
        badgeEl.className = \`flex justify-center items-center w-7 h-7 rounded-lg text-sm font-bold shadow-sm \${style.badge}\`;
        badgeEl.textContent = rank;
        titleEl.className = \`font-semibold text-sm md:text-base \${style.title}\`;

        const tempVal = parseFloat(element.dataset.temp);
        tempEl.style.color = getColorForTemp(tempVal);
    }

    function updateMapOption(chart) {
        const isDark = document.documentElement.classList.contains('dark');
        const borderColor = isDark ? '#111' : '#cbd5e1';
        const hoverColor = isDark ? '#4b5563' : '#94a3b8';
        const labelColor = isDark ? '#e5e7eb' : '#334155';
        const emphasisLabelColor = isDark ? '#fff' : '#0f172a';
        const shadowColor = isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)';
        const tooltipBg = isDark ? 'rgba(23, 23, 26, 0.95)' : 'rgba(255, 255, 255, 0.95)';
        const tooltipText = isDark ? '#e5e7eb' : '#1e293b';
        const tooltipBorder = isDark ? '#374151' : '#e2e8f0';

        chart.setOption({
            tooltip: {
                backgroundColor: tooltipBg,
                borderColor: tooltipBorder,
                textStyle: { color: tooltipText },
                formatter: (p) => {
                    // 从tempMapData获取温度值，支持多种后缀格式
                    let temp = tempMapData[p.name];
                    if (temp === undefined) {
                        temp = p.value;
                    }
                    const tempLabel = currentLang === 'zh' ? '温度' : 'Temperature';
                    if (temp === undefined || temp === null || isNaN(temp)) {
                        return \`<div class="font-bold text-sm mb-1">\${p.name}</div><div class="text-xs">\${tempLabel}: <span class="font-bold">-</span></div>\`;
                    }
                    const color = getColorForTemp(temp);
                    return \`<div class="font-bold text-sm mb-1">\${p.name}</div><div class="text-xs">\${tempLabel}: <span class="font-bold" style="color: \${color}">\${temp}°C</span></div>\`;
                }
            },
            series: [{
                itemStyle: {
                    borderColor: borderColor
                },
                label: {
                    color: labelColor,
                    textBorderColor: isDark ? '#111827' : '#f8fafc'
                },
                emphasis: {
                    label: {
                        color: emphasisLabelColor
                    },
                    itemStyle: {
                        areaColor: hoverColor,
                        shadowColor: shadowColor,
                        shadowBlur: 10
                    }
                }
            }]
        });
    }

    const initMap = async () => {
        const chartDom = document.getElementById('main-map');
        window.myMapChart = echarts.init(chartDom);

        const data = ${JSON.stringify(cityData.map(item => ({
          name: item.fullName || item.city,
          shortName: item.city,
          value: item.temperature,
          itemStyle: {
            areaColor: getColorForTemp(item.temperature)
          }
        })))};

        try {
            // 加载省份地图
            const res = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json');
            const geoJson = await res.json();
            echarts.registerMap('province', geoJson);
        } catch(e) {
            console.error('Map Load Error', e);
            return;
        }

        data.forEach(item => {
            tempMapData[item.name] = item.value;
            tempMapData[item.shortName] = item.value;
        });

        window.myMapChart.setOption({
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'item',
                borderWidth: 1,
                textStyle: { fontSize: 12 }
            },
            visualMap: {
                show: false,
                min: -15,
                max: 40,
                inRange: {
                    color: ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#eab308', '#f97316', '#ef4444']
                },
                calculable: false
            },
            series: [{
                type: 'map',
                map: 'province',
                roam: true,
                top: '18%',
                zoom: 1.2,
                label: {
                    show: true,
                    fontSize: 10,
                    color: '#e5e7eb',
                    textBorderColor: '#111827',
                    textBorderWidth: 2,
                    formatter: (params) => {
                        const temp = tempMapData[params.name];
                        if (temp !== undefined && temp !== null && !isNaN(temp)) {
                            return \`\${params.name}\\n\${temp}°\`;
                        }
                        return \`\${params.name}\\n-\`;
                    }
                },
                itemStyle: {
                    borderWidth: 1,
                    borderColor: '#111'
                },
                emphasis: {
                    label: {
                        show: true,
                        color: '#fff',
                        fontSize: 12,
                        formatter: (params) => {
                            const temp = tempMapData[params.name];
                            if (temp !== undefined && temp !== null && !isNaN(temp)) {
                                return \`\${params.name}\\n\${temp}°C\`;
                            }
                            return \`\${params.name}\\n-\`;
                        }
                    },
                    itemStyle: {
                        areaColor: '#4b5563',
                        shadowColor: 'rgba(0, 0, 0, 0.5)',
                        shadowBlur: 10
                    }
                },
                data: data
            }]
        });

        updateMapOption(window.myMapChart);
        window.addEventListener('resize', () => window.myMapChart.resize());
    };

    function toggleExpand(el) {
        const details = el.querySelector('.details-container');
        const arrow = el.querySelector('.arrow-icon');

        if (details.classList.contains('open')) {
            details.classList.remove('open', 'fade-in');
            arrow.classList.remove('rotate-180', 'bg-black/5', 'dark:bg-white/10');
            el.classList.remove('ring-1', 'ring-slate-400', 'dark:ring-gray-500');
        } else {
            details.classList.add('open', 'fade-in');
            arrow.classList.add('rotate-180', 'bg-black/5', 'dark:bg-white/10');
            el.classList.add('ring-1', 'ring-slate-400', 'dark:ring-gray-500');
        }
    }

    function sortList(order) {
        const list = document.getElementById('ranking-list');
        const items = Array.from(list.getElementsByClassName('ranking-item'));
        const btnHot = document.getElementById('btn-hot');
        const btnCold = document.getElementById('btn-cold');

        const activeClass = "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all bg-blue-500/10 text-blue-600 dark:text-blue-400 shadow-sm ring-1 ring-blue-500/50";
        const hotActiveClass = "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all bg-red-500/10 text-red-600 dark:text-red-400 shadow-sm ring-1 ring-red-500/50";
        const inactiveClass = "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all text-slate-400 dark:text-gray-400 hover:text-slate-600 dark:hover:text-gray-200";

        if(order === 'desc') {
            btnHot.className = hotActiveClass;
            btnCold.className = inactiveClass;
        } else {
            btnHot.className = inactiveClass;
            btnCold.className = activeClass;
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

    document.addEventListener('DOMContentLoaded', () => {
        initLanguage();

        if(!document.documentElement.classList.contains('dark')) {
            document.getElementById('icon-sun').classList.add('hidden');
            document.getElementById('icon-moon').classList.remove('hidden');
        } else {
            document.getElementById('icon-sun').classList.remove('hidden');
            document.getElementById('icon-moon').classList.add('hidden');
        }

        const items = document.querySelectorAll('.ranking-item');
        items.forEach((item, index) => {
            applyRankStyle(item, index + 1);
        });

        initMap();
    });
</script>
</body>
</html>`;

  // 使用英文名称小写作为文件名
  const enName = provinceConfig ? provinceConfig.en_name : provinceName;
  const fileName = enName.toLowerCase().replace(/\s+/g, '') + '.html';
  const fullPath = path.join(OUTPUT_DIR, fileName);

  fs.writeFileSync(fullPath, html, 'utf8');
  console.log(`  ✅ ${provinceName} 页面生成完成 (${fileName})`);
}

/**
 * 生成所有省份的详情页面
 */
async function generateAllProvincePages() {
  console.log('🏙️  生成所有省份详情页面...');

  for (const provinceConfig of PROVINCES_DATA) {
    await generateProvincePage(provinceConfig.full_name || provinceConfig.name, provinceConfig);
  }

  console.log('✅ 所有省份详情页面生成完成\n');
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('开始生成静态网站...\n');

    // 获取未来7天每一天的省份数据
    console.log('📊 获取7天省份温度数据...');
    const allForecastData = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const dayData = await getProvinceTemperaturesByDate(date);
      allForecastData.push(dayData);
      console.log(`  ✓ 第${i}天 (${date.toLocaleDateString('zh-CN')}): ${dayData.length} 个省份`);
    }
    console.log(`✅ 获取到7天数据\n`);

    // 获取所有省份的7天预报数据（用于排行榜的7天趋势图）
    console.log('📅 获取7天预报趋势数据...');
    const forecastData = await getAllProvincesForecast();
    console.log(`✅ 获取到 ${Object.keys(forecastData).length} 个省份的预报数据\n`);

    // 生成所有日期的主页
    await generateAllIndexPages(allForecastData, forecastData);

    // 生成所有省份的详情页面
    await generateAllProvincePages();

    console.log('\n✨ 所有页面生成完成！');
    console.log(`📁 输出目录: ${OUTPUT_DIR}`);
  } catch (error) {
    console.error('❌ 生成失败:', error);
    process.exit(1);
  }
}

main();
