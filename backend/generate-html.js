/**
 * 静态HTML生成器
 * 定期从InfluxDB读取数据并生成静态HTML页面
 */

const fs = require('fs');
const path = require('path');
const Influx = require('influx');
const https = require('https');
require('dotenv').config();

const GEO_DIR = path.join(__dirname, '../website/geo');

const FOOTER_HTML = `
  <footer class="mt-4 py-4 border-t border-slate-200 dark:border-gray-700/50">
      <div class="px-4">
          <div class="flex flex-col md:flex-row justify-between items-center gap-2">
              <div class="text-xs text-slate-400 dark:text-gray-500">
                  &copy; ${new Date().getFullYear()} China Temp Rankings.
              </div>
              <div class="flex gap-4 text-xs font-medium">
                  <a href="/about" class="text-slate-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">About</a>
                  <a href="/privacy" class="text-slate-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">Privacy</a>
                  <a href="/terms" class="text-slate-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">Terms</a>
                  <a href="/sitemap.xml" class="text-slate-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">Sitemap</a>
              </div>
          </div>
          <div class="mt-2 text-[10px] text-slate-300 dark:text-gray-700 text-center md:text-left leading-relaxed max-w-full hidden md:block">
              Real-time temperature rankings and 7-day forecasts. Data sourced from public weather APIs for reference only.
          </div>
      </div>
  </footer>
  `;

/**
 * 下载阿里云地理数据到本地
 * @param {number} adcode - 地区代码，如 100000（全国）或 110000（北京）
 * @returns {Promise<string>} 本地文件路径
 */
async function downloadGeoData(adcode) {
  const fileName = `${adcode}_full.json`;
  const localPath = path.join(GEO_DIR, fileName);

  // 如果文件已存在，直接返回
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // 确保 geo 目录存在
  if (!fs.existsSync(GEO_DIR)) {
    fs.mkdirSync(GEO_DIR, { recursive: true });
  }

  const url = `https://geo.datav.aliyun.com/areas_v3/bound/${fileName}`;
  console.log(`📥 下载地理数据: ${url}`);

  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败: HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        fs.writeFileSync(localPath, data);
        console.log(`✅ 已保存: ${localPath}`);
        resolve(localPath);
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 确保指定的地理数据文件存在，如不存在则下载
 * @param {number} adcode - 地区代码
 */
async function ensureGeoData(adcode) {
  try {
    await downloadGeoData(adcode);
  } catch (error) {
    console.error(`⚠️ 无法下载地理数据 ${adcode}:`, error.message);
  }
}

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
      temperature: row.max_temp !== null && row.max_temp !== undefined ? parseFloat(row.max_temp.toFixed(1)) : null,
      maxTemp: row.max_temp !== null && row.max_temp !== undefined ? parseFloat(row.max_temp.toFixed(1)) : null,
      minTemp: row.min_temp !== null && row.min_temp !== undefined ? parseFloat(row.min_temp.toFixed(1)) : null,
      windSpeed: getWindSpeed(row.max_wind),
      weatherDesc: row.weather_desc || '未知',
      adcode: config ? config.adcode : null,
      enName: config ? config.en_name : row.province,
      fullName: config ? config.name : row.province, // 使用 name 作为 fullName
      code: row.province, // code 就是 row.province
      cities: config ? config.cities : [],
      no_aliyun_data: config ? config.no_aliyun_data : false // 添加 no_aliyun_data 标记
    };
  }).sort((a, b) => {
    const tempA = a.temperature !== null && a.temperature !== undefined ? a.temperature : -999;
    const tempB = b.temperature !== null && b.temperature !== undefined ? b.temperature : -999;
    return tempB - tempA;
  });
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
      temperature: row.max_temp !== null && row.max_temp !== undefined ? parseFloat(row.max_temp.toFixed(1)) : null,
      maxTemp: row.max_temp !== null && row.max_temp !== undefined ? parseFloat(row.max_temp.toFixed(1)) : null,
      minTemp: row.min_temp !== null && row.min_temp !== undefined ? parseFloat(row.min_temp.toFixed(1)) : null,
      windSpeed: getWindSpeed(row.max_wind),
      weatherDesc: row.weather_desc || '未知'
    };
  }).sort((a, b) => {
    const tempA = a.temperature !== null && a.temperature !== undefined ? a.temperature : -999;
    const tempB = b.temperature !== null && b.temperature !== undefined ? b.temperature : -999;
    return tempB - tempA;
  });
}

/**
 * 获取指定省份所有城市未来7天的预报数据
 * @param {string} provinceCode - 省份code (如 "ABJ")
 * @param {number} dayIndex - [已弃用] 用于保持兼容性，内部始终从今天开始
 */
async function getCityForecast(provinceCode, dayIndex = 0) {
  const weekdaysZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const forecastByCity = {};

  // 从今天开始，获取未来7天的数据
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    const dayData = await getCityTemperaturesByDate(provinceCode, date);

    dayData.forEach(cityData => {
      if (!forecastByCity[cityData.city]) {
        forecastByCity[cityData.city] = [];
      }

      forecastByCity[cityData.city].push({
        dayName: i === 0 ? '今天' : weekdaysZh[date.getDay()],
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
 * 始终从今天开始查询7天，保持所有页面显示相同的时间窗口
 */
async function getAllProvincesForecast() {
  // 周日=0, 周一=1, ... 周六=6
  const weekdaysZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const forecastByProvince = {};

  // 从今天开始，获取未来7天的数据
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
        dayName: i === 0 ? '今天' : weekdaysZh[date.getDay()],
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
 * 生成全国天气摘要
 * @param {Array} provincesData - 所有省份的今日数据
 * @param {Date} date - 日期
 */
function generateNationalSummary(provincesData, date) {
  if (!provincesData || provincesData.length === 0) return { zh: '暂无数据', en: 'No data available' };

  // 按温度排序查找最值
  const sortedByMax = [...provincesData].sort((a, b) => (b.maxTemp || -999) - (a.maxTemp || -999));
  const sortedByMin = [...provincesData].sort((a, b) => (a.minTemp || 999) - (b.minTemp || 999));

  // 过滤有效数据
  const hottest = sortedByMax[0];
  const coldest = sortedByMin[0];

  // 计算平均气温
  const validTemps = provincesData.map(p => p.temperature).filter(t => t !== null && t !== undefined);
  const avgTemp = validTemps.length > 0 ? (validTemps.reduce((a, b) => a + b, 0) / validTemps.length).toFixed(1) : 0;

  const dateStrZh = date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  const dateStrEn = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return {
    zh: `<p class="mb-4">
               ${dateStrZh}，中国各地气温差异显著。全国平均气温约为 <strong>${avgTemp}°C</strong>。
               今日最热的地区是 <strong>${hottest.province}</strong>，全省最高气温达到 <span class="text-orange-500 font-bold">${hottest.maxTemp}°C</span>。
               与此同时，<strong>${coldest.province}</strong> 迎来了最冷的天气，部分地区夜间最低气温降至 <span class="text-blue-500 font-bold">${coldest.minTemp}°C</span>。
             </p>
             <p>
               由于地理跨度巨大，从寒冷的北方到温暖的南方，通过我们的实时排行榜，您可以直观地感受到这种其后多样性。
               无论是为了出行规划，还是单纯对气象数据感兴趣，这里的实时数据都能为您提供详尽的参考。
             </p>`,
    en: `<p class="mb-4">
               On ${dateStrEn}, the weather across China shows a remarkable range of temperatures, reflecting the country's vast geography. The national average temperature is approximately <strong>${avgTemp}°C</strong>.
             </p>
             <p class="mb-4">
               The hottest region today is <strong>${hottest.enName}</strong>, reaching a top temperature of <span class="text-orange-500 font-bold">${hottest.maxTemp}°C</span>.
               On the other end of the spectrum, <strong>${coldest.enName}</strong> is experiencing the coldest conditions, with nighttime lows dropping to <span class="text-blue-500 font-bold">${coldest.minTemp}°C</span>.
             </p>
             <p>
               From the freezing north to the tropical south, our real-time rankings provide a comprehensive snapshot of these extremes. Stay updated with the latest weather trends and plan your activities accordingly.
             </p>`
  };
}

/**
 * 生成省份天气摘要
 * @param {string} provinceName - 省份名称
 * @param {Array} citiesData - 该省份城市数据
 * @param {Date} date - 日期
 */
function generateProvinceSummary(provinceName, citiesData, date) {
  if (!citiesData || citiesData.length === 0) return { zh: '暂无数据', en: 'No data available' };

  const sortedByTemp = [...citiesData].sort((a, b) => (b.temperature || -999) - (a.temperature || -999));
  const hottestCity = sortedByTemp[0];
  const coldestCity = sortedByTemp[sortedByTemp.length - 1];

  // 计算平均气温
  const validTemps = citiesData.map(c => c.temperature).filter(t => t !== null && t !== undefined);
  const avgTemp = validTemps.length > 0 ? (validTemps.reduce((a, b) => a + b, 0) / validTemps.length).toFixed(1) : 0;

  // 获取天气状况分布 (例如: 5个晴天, 3个多云)
  const weatherCounts = {};
  citiesData.forEach(c => {
    const desc = c.weatherDesc || 'Unknown';
    weatherCounts[desc] = (weatherCounts[desc] || 0) + 1;
  });
  // 找出最多的天气
  const mainWeather = Object.entries(weatherCounts).sort((a, b) => b[1] - a[1])[0][0];

  // 省份各个不同名字
  const provinceConfig = PROVINCES_DATA.find(p => p.name === provinceName || p.full_name === provinceName);
  const provinceEn = provinceConfig ? provinceConfig.en_name : provinceName;

  // 城市英文名
  const hottestEn = getCityConfig(provinceConfig ? provinceConfig.code : '', hottestCity.cityCode)?.en_name || hottestCity.city;
  const coldestEn = getCityConfig(provinceConfig ? provinceConfig.code : '', coldestCity.cityCode)?.en_name || coldestCity.city;

  const dateStrZh = date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  const dateStrEn = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const mainWeatherEn = translateWeatherDesc(mainWeather, 'en');

  return {
    zh: `<p class="mb-4">
               ${dateStrZh}，<strong>${provinceName}</strong>各城市天气状况以<strong>${mainWeather}</strong>为主。全省平均气温为 <strong>${avgTemp}°C</strong>。
             </p>
             <p>
               在省内各主要城市中，<strong>${hottestCity.city}</strong> 今日气温最高，达到了 <span class="text-orange-500 font-bold">${hottestCity.temperature}°C</span>。
               相比之下，<strong>${coldestCity.city}</strong> 则相对较冷，气温低至 <span class="text-blue-500 font-bold">${coldestCity.temperature}°C</span>。
             </p>
             <p>
               请根据所在城市的具体天气情况适时增减衣物。我们将持续为您更新${provinceName}各地的实时气象数据。
             </p>`,
    en: `<p class="mb-4">
               This is the detailed temperature report for <strong>${provinceEn}</strong> on ${dateStrEn}. The dominant weather pattern across the province today is <strong>${mainWeatherEn}</strong>, with an average temperature of <strong>${avgTemp}°C</strong>.
             </p>
             <p class="mb-4">
               Among the key cities, <strong>${hottestEn}</strong> stands out as the warmest location today, recording a temperature of <span class="text-orange-500 font-bold">${hottestCity.temperature}°C</span>.
               Conversely, <strong>${coldestEn}</strong> is the coolest spot in the region, with temperatures sitting at <span class="text-blue-500 font-bold">${coldestCity.temperature}°C</span>.
             </p>
             <p>
               Whether you are in ${hottestEn}, ${coldestEn}, or anywhere else in ${provinceEn}, stay prepared for the local conditions. Our data is updated regularly to provide you with the most accurate temperature rankings.
             </p>`
  };
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
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4059058909472641"
     crossorigin="anonymous"></script>
    <script async custom-element="amp-auto-ads"
        src="https://cdn.ampproject.org/v0/amp-auto-ads-0.1.js">
    </script>
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ZW66C8K27S"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());

      gtag('config', 'G-ZW66C8K27S');
    </script>
    <meta name="description" content="China Temperature Rankings - ${descriptionDate} Temperature data across China">
    <meta name="keywords" content="China temperature,temperature rankings,weather,temperature map,real-time temperature,${dateFormatted}">
    <title>China Temperature Rankings - Real-time Temperature Data${titleSuffix}</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <script src="${dayIndex === 0 ? "search_index.js" : "../search_index.js"}"></script>
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
          fullName: p.full_name,
          no_aliyun_data: p.no_aliyun_data || false
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
        fullName: '南海诸岛',
        no_aliyun_data: false
      };

      // 然后用当前数据覆盖（如果有的话）
      provinceData.forEach(item => {
        const fullName = item.fullName || item.province;
        const entry = {
          zh: item.province,
          en: item.enName || item.province,
          fullName: fullName,
          no_aliyun_data: item.no_aliyun_data || false
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
    <script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.4.3/echarts.min.js"></script>
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
<body class="bg-slate-50 dark:bg-[#0d1117] text-slate-900 dark:text-white font-sans transition-colors duration-300 min-h-screen overflow-x-hidden overflow-y-auto">
    <amp-auto-ads type="adsense"
        data-ad-client="ca-pub-4059058909472641">
    </amp-auto-ads>

    <!-- Dashboard Container -->
    <div class="flex flex-col md:flex-row h-screen w-full relative">

    <!-- 左侧：地图可视化区域 -->
    <div class="relative flex-1 h-[35vh] md:h-full flex flex-col">
            <!-- 顶部覆盖层：标题 & 图例 -->
            <div class="absolute top-0 left-0 w-full p-3 md:p-6 z-10 pointer-events-none">
                <div class="flex justify-between items-start">
                    <div>
                        <h1 id="main-heading" class="text-xl md:text-3xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-emerald-500 drop-shadow-sm font-sans">
                            China Temp Rankings
                        </h1>
                    </div>

                    <div class="pointer-events-auto flex flex-col items-end gap-2">
                        <div class="flex items-center gap-2">
                            <!-- Search Component -->
                            <div class="relative flex items-center">
                                <div id="search-container" class="flex items-center bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-lg border border-slate-200 dark:border-gray-700 transition-all duration-300 w-8 overflow-hidden focus-within:w-48 md:focus-within:w-64">
                                    <button id="search-btn" class="p-1.5 text-slate-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 cursor-pointer shrink-0">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                    </button>
                                    <input type="text" id="search-input" placeholder="Search city/province..." class="w-full bg-transparent border-none outline-none text-xs px-2 py-1.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 opacity-0 focus:opacity-100 transition-opacity duration-200" autocomplete="off">
                                </div>

                                <!-- Search Results Dropdown -->
                                <div id="search-results" class="absolute top-full right-0 mt-2 w-64 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700 shadow-xl hidden z-50">
                                    <!-- Results will be injected here -->
                                </div>
                            </div>
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
                        <div class="flex flex-col gap-1 items-end p-2 rounded-lg bg-white/80 dark:bg-gray-900/60 backdrop-blur-md border border-slate-200 dark:border-gray-700/50 shadow-xl transition-colors duration-300 scale-75 md:scale-100 origin-top-right">
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
                ${Array.from({ length: 7 }, (_, i) => {
      const daysZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
        href = dayIndex === 0 ? './' : '../';
      } else {
        // 链接到其他日期页面
        href = dayIndex === 0 ? dateStr + '/' : '../' + dateStr + '/';
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
        <div class="w-full md:w-[400px] h-[65vh] md:h-full z-20">
            <div class="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-slate-200 dark:border-gray-700 shadow-2xl relative transition-colors duration-300">
            <!-- 面板头部 -->
            <div class="p-2 md:p-6 border-b border-slate-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur z-10 sticky top-0 transition-colors duration-300">
                <div class="flex items-center justify-between mb-2 md:mb-4">
                    <div class="flex flex-col">
                        <h2 id="ranking-title" class="text-base md:text-xl font-bold text-slate-900 dark:text-white tracking-tight">National Rankings</h2>
                        <div class="flex items-center gap-2 mt-1">
                            <span class="text-xs text-slate-500 dark:text-gray-500">${provinceData.length} <span id="regions-label">Regions</span></span>
                        </div>
                    </div>
                </div>

                <!-- 排序控制 -->
                <div class="flex p-1 bg-slate-100 dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700">
                    <button onclick="sortList('desc')" id="btn-hot" class="flex-1 flex items-center justify-center gap-2 py-1 md:py-1.5 text-xs font-medium rounded-md transition-all bg-red-500/10 text-red-600 dark:text-red-400 shadow-sm ring-1 ring-red-500/50">
                        Hot
                    </button>
                    <button onclick="sortList('asc')" id="btn-cold" class="flex-1 flex items-center justify-center gap-2 py-1 md:py-1.5 text-xs font-medium rounded-md transition-all text-slate-400 dark:text-gray-400 hover:text-slate-600 dark:hover:text-gray-200">
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

      // 获取省份英文名称用于链接
      const provinceEnName = item.enName || item.province;
      const provinceFileName = provinceEnName.toLowerCase().replace(/\\s+/g, '');

      return `
                    <div class="ranking-item group flex flex-col p-3 rounded-xl transition-all duration-300 border select-none border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-800 hover:bg-slate-50 dark:hover:bg-gray-750"
                         data-temp="${item.temperature}" data-province-file="${provinceFileName}" data-no-aliyun="${item.no_aliyun_data || false}">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-4">
                                <span data-role="badge" class="flex justify-center items-center w-7 h-7 rounded-lg text-sm font-bold shadow-sm bg-slate-200 dark:bg-gray-700 text-slate-500 dark:text-gray-400">
                                    ${index + 1}
                                </span>
                                <div>
                                    <a href="${item.no_aliyun_data ? '#' : provinceFileName}" data-role="title" data-province-zh="${item.province}" data-province-en="${item.enName || item.province}" class="font-semibold text-slate-700 dark:text-gray-300 text-sm md:text-base hover:text-blue-500 dark:hover:text-blue-400 transition-colors ${item.no_aliyun_data ? 'pointer-events-none' : ''}" ${item.no_aliyun_data ? '' : ''}>${item.enName || item.province}</a>
                                    <div class="text-xs text-slate-500 dark:text-gray-500 flex gap-2 items-center mt-0.5">
                                        <span class="weather-desc" data-weather-zh="${item.weatherDesc || '未知'}" data-weather-en="${translateWeatherDesc(item.weatherDesc || '未知', 'en')}">${translateWeatherDesc(item.weatherDesc || '未知', 'en')}</span><span class="w-1 h-1 rounded-full bg-slate-400 dark:bg-gray-600"></span><span class="wind-label">Wind</span>: ${item.windSpeed || '0'} m/s</span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="text-right">
                                    <div data-role="temp-val" class="text-lg font-bold tabular-nums tracking-tight" style="color: ${item.temperature !== null && item.temperature !== undefined && !isNaN(item.temperature) ? getColorForTemp(item.temperature) : 'inherit'}">
                                        ${item.temperature !== null && item.temperature !== undefined && !isNaN(item.temperature) ? item.temperature + '°' : '-'}
                                    </div>
                                </div>
                                <!-- 箭头 -->
                                <div class="arrow-icon p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-transform duration-300 cursor-pointer" onclick="toggleExpand(this.closest('.ranking-item'))">
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
        const daysZh = ['今天', '周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const daysEn = ['Today', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayNameIndex = daysZh.indexOf(day.dayName);
        const dayNameEn = dayNameIndex >= 0 ? daysEn[dayNameIndex] : day.dayName;

        // 计算目标日期的字符串 (用于链接)
        // 注意：data中的dayName已经是固定窗口的（从今天开始），所以idx直接对应从今天开始的偏移
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + idx);
        const targetDateStr = targetDate.toISOString().slice(0, 10).replace(/-/g, '');

        // 构建链接路径
        // 如果是当前页面的日期，不高亮/不可点或指向自己
        // 如果是其他日期，根据当前页面位置(dayIndex)决定是 ./ 还是 ../
        // dayIndex=0: 在根目录. idx=0->#, idx>0->YYYYMMDD/
        // dayIndex>0: 在子目录. idx=0->../, idx>0->../YYYYMMDD/ (除非同目录? 不，每天一个目录)

        let targetUrl;
        if (idx === dayIndex) {
          targetUrl = '#'; // 当前页面
        } else if (idx === 0) {
          // 目标是今天(第一天)
          targetUrl = dayIndex === 0 ? '#' : `../${provinceFileName}`;
        } else {
          // 目标是未来某天
          targetUrl = dayIndex === 0
            ? `${targetDateStr}/${provinceFileName}`
            : `../${targetDateStr}/${provinceFileName}`;
        }

        const isSelected = idx === dayIndex;
        // 如果是当前选中的日期，使用不同的cursor样式
        const cursorClass = isSelected ? 'cursor-default' : 'cursor-pointer hover:opacity-80 transition-opacity';

        // 使用a标签而非onclick，提升SEO和体验
        // 如果是选中状态，使用div；如果是链接，使用a
        const TagName = isSelected ? 'div' : 'a';
        const hrefAttr = isSelected ? '' : `href="${targetUrl}"`;

        return `
                                <${TagName} ${hrefAttr} class="flex flex-col items-center group/day ${cursorClass}">
                                    <span class="forecast-day-label text-[9px] font-medium mb-1 ${isSelected ? 'text-blue-500' : 'text-slate-500 dark:text-gray-500'}" data-day-zh="${day.dayName}" data-day-en="${dayNameEn}">
                                        ${dayNameEn}
                                    </span>
                                    <div class="bg-slate-200 dark:bg-gray-800/50 rounded-full h-20 relative w-1.5 md:w-2 mx-auto ring-1 ring-black/5 dark:ring-white/5">
                                        <div class="absolute w-full rounded-full opacity-80" style="bottom: ${bottomPos}%; height: ${barHeight}%; background-color: ${barColor};"></div>
                                    </div>
                                    <div class="flex flex-col items-center mt-1.5 gap-0.5">
                                        <span class="text-[10px] font-bold text-slate-700 dark:text-gray-300 leading-none">${hasData ? day.high + '°' : '--'}</span>
                                        <span class="text-[9px] text-slate-500 dark:text-gray-600 leading-none">${hasData ? day.low + '°' : '--'}</span>
                                    </div>
                                </${TagName}>
                                `;
      }).join('')}
                            </div>
                        </div>
                    </div>
                      `;
    }).join('')}
            </div >
            
            </div>
        </div >
    </div > <!-- End Dashboard Container -->

    <!-- Content Section (Below the Fold) -->
    <div class="w-full bg-white dark:bg-gray-900 border-t border-slate-200 dark:border-gray-800">
        <div class="max-w-4xl mx-auto px-6 py-12 prose dark:prose-invert">
            ${(() => {
      const summary = generateNationalSummary(provinceData, targetDate);
      return `
                <div class="mb-8 p-6 rounded-2xl bg-slate-50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700">
                    <h2 class="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2 not-prose">
                        <svg class="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span data-lang="zh" class="hidden">今日气象摘要</span>
                        <span data-lang="en">Daily Weather Summary</span>
                    </h2>
                    <div class="text-base text-slate-600 dark:text-gray-300 leading-relaxed">
                        <div data-lang="zh" class="hidden">${summary.zh}</div>
                        <div data-lang="en">${summary.en}</div>
                    </div>
                </div>`;
    })()}
        </div>
        ${FOOTER_HTML}
    </div>


  <script>
    let currentTheme = 'dark'; // 'light' | 'dark'
    let currentLang = 'en'; // 'en' | 'zh' - 默认英文
    let tempMapData = { }; // 全局温度映射

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

            // Generic language toggle for elements with data-lang attribute
            document.querySelectorAll('[data-lang]').forEach(el => {
                if (el.dataset.lang === lang) {
                    el.classList.remove('hidden');
                } else {
                    el.classList.add('hidden');
                }
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
    textStyle: {color: tooltipText },
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
    itemStyle: {areaColor: areaColor, borderColor: borderColor },
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
    itemStyle: {areaColor: hoverColor, shadowColor: shadowColor, shadowBlur: 10 }
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
                const res = await fetch('/geo/100000_full.json');
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
    textStyle: {fontSize: 12 }
                },
    visualMap: {
      show: false,
    type: 'piecewise',
    seriesIndex: 0,
    pieces: [
    {gte: 35, color: '#ef4444' },           // >= 35°C 红色
    {gte: 28, lt: 35, color: '#f97316' },   // 28-34.9°C 橙色
    {gte: 20, lt: 28, color: '#eab308' },   // 20-27.9°C 黄色
    {gte: 10, lt: 20, color: '#10b981' },   // 10-19.9°C 绿色
    {gte: 0, lt: 10, color: '#06b6d4' },    // 0-9.9°C 青色
    {gte: -10, lt: 0, color: '#3b82f6' },   // -10--0.1°C 蓝色
    {lt: -10, color: '#6366f1' }            // < -10°C 紫色
    ]
                },
    geo: {
      map: 'china',
    roam: true,
    top: '18%',
    zoom: 1.2,
    itemStyle: {borderWidth: 1 }
                },
    series: [{type: 'map', geoIndex: 0, data: data }]
            });

    // 应用正确的主题颜色
    updateMapOption(window.myMapChart);

    window.myMapChart.on('click', function(params) {
                // 跳转到省份详情页
                const provinceName = params.name;

    // 查找对应的英文名称和no_aliyun_data标记
    let enName = provinceName;
    let noAliyunData = false;
    for (const [key, value] of Object.entries(window.provinceNameMap)) {
                    if (value.fullName === provinceName || value.zh === provinceName) {
      enName = value.en;
    noAliyunData = value.no_aliyun_data || false;
    break;
                    }
                }

    // 如果有no_aliyun_data标记，不跳转
    if (noAliyunData) {
      console.log('Province has no aliyun data:', provinceName);
    return;
                }

    // 使用英文名称小写作为文件名
    const fileName = enName.toLowerCase().replace(/\\s+/g, '');
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

    // 展开指定元素（不切换，只展开）
    function expandItem(el) {
            const details = el.querySelector('.details-container');
    const arrow = el.querySelector('.arrow-icon');

    if (!details.classList.contains('open')) {
      details.classList.add('open', 'fade-in');
    arrow.classList.add('rotate-180', 'bg-black/5', 'dark:bg-white/10');
    el.classList.add('ring-1', 'ring-slate-400', 'dark:ring-gray-500');
            }
        }

    // 收起指定元素
    function collapseItem(el) {
            const details = el.querySelector('.details-container');
    const arrow = el.querySelector('.arrow-icon');

    if (details.classList.contains('open')) {
      details.classList.remove('open', 'fade-in');
    arrow.classList.remove('rotate-180', 'bg-black/5', 'dark:bg-white/10');
    el.classList.remove('ring-1', 'ring-slate-400', 'dark:ring-gray-500');
            }
        }

    // 收起所有展开的项
    function collapseAll() {
      document.querySelectorAll('.ranking-item').forEach(item => {
        collapseItem(item);
      });
        }

    // 导航到省份页面
    function navigateToProvince(event, provinceFileName, noAliyunData) {
      event.stopPropagation();
    if (noAliyunData) {
      console.log('Province has no aliyun data:', provinceFileName);
    return;
            }
    window.location.href = provinceFileName;
        }

    // 导航到省份页面的特定日期
    function navigateToProvinceDate(event, provinceFileName, dayIndex, dateStr, noAliyunData) {
      event.stopPropagation();
    if (noAliyunData) {
      console.log('Province has no aliyun data:', provinceFileName);
    return;
            }
    // 如果是今天（dayIndex === 0），跳转到省份主页
    if (dayIndex === 0) {
      window.location.href = provinceFileName;
            } else {
      // 其他日期，跳转到 YYYYMMDD/provincename
      window.location.href = dateStr + '/' + provinceFileName;
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

    // 先收起所有展开的项
    collapseAll();

            items.sort((a, b) => {
                const tA = parseFloat(a.dataset.temp);
    const tB = parseFloat(b.dataset.temp);
    return order === 'desc' ? tB - tA : tA - tB;
            });
            items.forEach((item, index) => {
      list.appendChild(item);
    applyRankStyle(item, index + 1);
            });

    // 展开排序后的第一个项
    const firstItem = list.querySelector('.ranking-item');
    if (firstItem) {
      expandItem(firstItem);
            }
        }

        // 页面加载完成后初始化
        document.addEventListener('DOMContentLoaded', () => {
            // Search Functionality
            const searchInput = document.getElementById('search-input');
            const searchResults = document.getElementById('search-results');
            const searchContainer = document.getElementById('search-container');
            
            let searchIndex = [];
            
            // Load search index
            // Load search index
            if (typeof SEARCH_INDEX !== 'undefined') {
                searchIndex = SEARCH_INDEX;
            } else {
                console.error('SEARCH_INDEX not found');
            }
                
            // Toggle input visibility on focus
            searchInput.addEventListener('focus', () => {
                searchInput.style.opacity = '1';
            });
            
            searchInput.addEventListener('blur', () => {
                if (searchInput.value === '') {
                    searchInput.style.opacity = '0';
                }
                // Delay hiding results to allow click
                setTimeout(() => {
                    searchResults.classList.add('hidden');
                }, 200);
            });
            
            // Handle input
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                
                if (query.length < 1) {
                    searchResults.classList.add('hidden');
                    return;
                }
                
                const results = searchIndex.filter(item => {
                    return item.name.toLowerCase().includes(query) || 
                           item.en_name.toLowerCase().includes(query) ||
                           (item.full_name && item.full_name.includes(query));
                }).slice(0, 10); // Limit to 10 results
                
                renderResults(results);
            });
            
            function renderResults(results) {
                const searchI18n = { en: { noResults: 'No results found', province: 'province', city: 'city' }, zh: { noResults: '未找到结果', province: '省份', city: '城市' } };
                const sl = searchI18n[currentLang] || searchI18n.en;
                if (results.length === 0) {
                    searchResults.innerHTML = '<div class="p-2 text-xs text-slate-500 dark:text-gray-400 text-center">' + sl.noResults + '</div>';
                } else {
                    searchResults.innerHTML = results.map(item => {
                        const displayName = currentLang === 'zh' ? item.display_zh : item.display_en;
                        const typeLabel = sl[item.type] || item.type;
                        return \`
                      <a href="\${item.url}" class="block p-2 hover:bg-slate-100 dark:hover:bg-gray-700 border-b border-slate-100 dark:border-gray-700 last:border-0 transition-colors">
                          <div class="flex items-center justify-between">
                              <div>
                                  <div class="text-xs font-bold text-slate-700 dark:text-gray-200">\${displayName}</div>
                              </div>
                              <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-gray-600 text-slate-500 dark:text-gray-300 uppercase">\${typeLabel}</span>
                          </div>
                      </a>
                  \`;
                    }).join('');
                }
                searchResults.classList.remove('hidden');
            }
            
            document.getElementById('search-btn').addEventListener('click', () => {
                searchInput.focus();
            });
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

    // 自动展开第一个项（Hot模式下的第一个）
    const firstItem = document.querySelector('.ranking-item');
    if (firstItem) {
      expandItem(firstItem);
            }

    // 初始化地图
    initMap();
        });
  </script>
</body >
</html > `;

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
async function generateAllIndexPages(allForecastData) {
  console.log('🏠 生成所有日期页面...');

  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 获取所有省份的7天预报数据（从今天开始的固定窗口）
  const forecastData = await getAllProvincesForecast();

  for (let i = 0; i < 7; i++) {
    await generateDayPage(i, allForecastData, forecastData);
  }

  console.log('✅ 所有日期页面生成完成');
}


/**
 * 生成单个省份的详情页面
 * @param {string} provinceName - 省份名称（用于显示）
 * @param {Object} provinceConfig - 省份配置信息（来自provinces.js）
 * @param {number} dayIndex - 天数索引 (0=今天, 1=明天, ...)
 */
async function generateProvincePage(provinceName, provinceConfig, dayIndex = 0) {
  // 计算目标日期
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + dayIndex);
  const dateStr = targetDate.toISOString().slice(0, 10).replace(/-/g, '');
  const dateFormatted = targetDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  console.log(`  🏙️  生成省份页面: ${provinceName} (${dateFormatted})`);

  if (!provinceConfig) {
    console.warn(`  ⚠️  ${provinceName} 未找到配置信息，跳过`);
    return;
  }

  // 使用省份code查询（数据库中存储的是code，如"ABJ"）
  const provinceCode = provinceConfig.code;

  // 获取指定日期的城市数据
  const cityData = await getCityTemperaturesByDate(provinceCode, targetDate);

  if (!cityData || cityData.length === 0) {
    console.warn(`  ⚠️  ${provinceName} 暂无城市数据，跳过`);
    return;
  }

  // 为每个城市添加full_name和en_name（从provinceConfig.cities中查找，已在getCityTemperaturesByDate中处理）
  // cityData中已经包含了city（中文名）和cityCode
  if (provinceConfig && provinceConfig.cities) {
    cityData.forEach(city => {
      const cityConfig = provinceConfig.cities.find(c => c.code === city.cityCode);
      if (cityConfig) {
        city.fullName = cityConfig.full_name || city.city;
        city.en_name = cityConfig.en_name || city.city;
      } else {
        city.fullName = city.city;
        city.en_name = city.city;
      }
    });
  }

  // 获取该省份所有城市的7天预报数据
  const cityForecastData = await getCityForecast(provinceCode, dayIndex);

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

  // 提前计算文件名,供HTML中使用
  const enName = provinceConfig ? provinceConfig.en_name : provinceName;
  const fileName = enName.toLowerCase().replace(/\s+/g, '') + '.html';

  const html = `<!DOCTYPE html>
  <html lang="en" class="dark">
    <head>
      <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4059058909472641"
           crossorigin="anonymous"></script>
          <script async custom-element="amp-auto-ads"
            src="https://cdn.ampproject.org/v0/amp-auto-ads-0.1.js">
          </script>
          <!-- Google tag (gtag.js) -->
          <script async src="https://www.googletagmanager.com/gtag/js?id=G-ZW66C8K27S"></script>
          <script>
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());

            gtag('config', 'G-ZW66C8K27S');
          </script>
            <meta name="description" content="${enName} Temperature Rankings - City temperature data">
              <meta name="keywords" content="${enName},${provinceName},temperature,weather,cities">
                <title>${enName} Temperature Rankings</title>
                <link rel="icon" type="image/x-icon" href="/favicon.ico">
                  <script>
      // 多语言配置
                    window.i18n = ${JSON.stringify(i18n)};

                    // 天气描述中英文对照表
                    window.weatherDescMap = ${JSON.stringify(weatherDescMap)};

                    // 城市名称中英文对照表
                    window.cityNameMap = ${JSON.stringify(
    cityData.reduce((map, city) => {
      const cityName = city.city || city.name;
      const fullName = city.fullName || cityName;
      const enName = city.cityEn || city.en_name || cityName;

      // 添加多个键以匹配不同的名称格式
      map[cityName] = { zh: fullName, en: enName };
      map[fullName] = { zh: fullName, en: enName };

      // 去掉"市"、"区"、"县"等后缀的版本
      const shortName = fullName.replace(/[市区县]/g, '');
      if (shortName !== fullName) {
        map[shortName] = { zh: fullName, en: enName };
      }

      return map;
    }, {})
  )};

                    // 翻译天气描述
                    window.translateWeatherDesc = function(weatherDesc, lang) {
        if (lang === 'zh') {
          return weatherDesc;
        }
                    return window.weatherDescMap[weatherDesc] || weatherDesc;
      };

                    // 获取城市名称（支持中英文）
                    window.getCityName = function(cityName, lang) {
        if (!cityName) return '';

                    // 直接匹配
                    if (window.cityNameMap[cityName]) {
          return window.cityNameMap[cityName][lang];
        }

                    // 尝试去掉常见后缀再匹配
                    const suffixes = ['市', '区', '县', '自治州', '地区', '盟'];
                    for (const suffix of suffixes) {
          if (cityName.endsWith(suffix)) {
            const baseName = cityName.slice(0, -suffix.length);
                    if (window.cityNameMap[baseName]) {
              return window.cityNameMap[baseName][lang];
            }
          }
        }

                    // 如果没有匹配，返回原名称
                    return cityName;
      };
                  </script>
                  <script src="https://cdn.tailwindcss.com"></script>
                  <script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.4.3/echarts.min.js"></script>
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
                      -ms - overflow - style: none;
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
                <body class="bg-slate-50 dark:bg-[#0d1117] text-slate-900 dark:text-white font-sans transition-colors duration-300 min-h-screen overflow-x-hidden overflow-y-auto">
                  <amp-auto-ads type="adsense"
                      data-ad-client="ca-pub-4059058909472641">
                  </amp-auto-ads>
                  
                  <!-- Dashboard Container -->
                  <div class="flex flex-col md:flex-row h-screen w-full relative">
                  
                  <!-- 左侧：地图可视化区域 -->
                  <div class="relative flex-1 h-[35vh] md:h-full flex flex-col">
                    <!-- 顶部覆盖层：标题 & 图例 & 返回按钮 -->
                    <div class="absolute top-0 left-0 w-full p-3 md:p-6 z-10 pointer-events-none">
                      <div class="flex justify-between items-start">
                        <div class="flex items-center gap-3">
                          <!-- 返回按钮 -->
                          <a href="./" class="pointer-events-auto p-2 rounded-lg bg-white/80 dark:bg-gray-800/80 backdrop-blur border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 transition-colors shadow-sm">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                          </a>
                          <div>
                            <h1 id="main-heading" class="text-xl md:text-3xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-emerald-500 drop-shadow-sm font-sans" data-province-zh="${provinceName}" data-province-en="${enName}">
                              ${enName}
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
                          <div class="flex flex-col gap-1 items-end p-2 rounded-lg bg-white/80 dark:bg-gray-900/60 backdrop-blur-md border border-slate-200 dark:border-gray-700/50 shadow-xl transition-colors duration-300 scale-75 md:scale-100 origin-top-right">
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
        // 星期几的中英文名称 (0=周日, 1=周一, ..., 6=周六)
        const weekdaysZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const weekdaysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const date = new Date();
        date.setDate(date.getDate() + i);
        const dayNameZh = i === 0 ? '今天' : weekdaysZh[date.getDay()];
        const dayNameEn = i === 0 ? 'Today' : weekdaysEn[date.getDay()];

        const isActive = i === dayIndex;
        let href = '#';
        if (!isActive) {
          if (i === 0) {
            // 链接到今天的省份页面
            href = dayIndex === 0 ? fileName : '../' + fileName;
          } else {
            const targetDateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
            // 链接到对应日期的省份页面
            if (dayIndex === 0) {
              // 当前在今天的页面，链接到未来日期
              href = targetDateStr + '/' + fileName;
            } else {
              // 当前在未来日期的页面，链接到其他日期
              href = '../' + targetDateStr + '/' + fileName;
            }
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
                  <div class="w-full md:w-[400px] h-[65vh] md:h-full z-20">
                    <div class="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-slate-200 dark:border-gray-700 shadow-2xl relative transition-colors duration-300">
                      <!-- 面板头部 -->
                      <div class="p-2 md:p-6 border-b border-slate-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur z-10 sticky top-0 transition-colors duration-300">
                        <div class="flex items-center justify-between mb-2 md:mb-4">
                          <div class="flex flex-col">
                            <h2 id="ranking-title" class="text-base md:text-xl font-bold text-slate-900 dark:text-white tracking-tight">City Rankings</h2>
                            <div class="flex items-center gap-2 mt-1">
                              <span class="text-xs text-slate-500 dark:text-gray-500">${cityData.length} <span id="regions-label">Cities</span></span>
                            </div>
                          </div>
                        </div>

                        <!-- 排序控制 -->
                        <div class="flex p-1 bg-slate-100 dark:bg-gray-800 rounded-lg border border-slate-200 dark:border-gray-700">
                          <button onclick="sortList('desc')" id="btn-hot" class="flex-1 flex items-center justify-center gap-2 py-1 md:py-1.5 text-xs font-medium rounded-md transition-all bg-red-500/10 text-red-600 dark:text-red-400 shadow-sm ring-1 ring-red-500/50">
                            Hot
                          </button>
                          <button onclick="sortList('asc')" id="btn-cold" class="flex-1 flex items-center justify-center gap-2 py-1 md:py-1.5 text-xs font-medium rounded-md transition-all text-slate-400 dark:text-gray-400 hover:text-slate-600 dark:hover:text-gray-200">
                            Cold
                          </button>
                        </div>
                      </div>

                      <!-- 列表内容区 -->
                      <div id="ranking-list" class="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth">
                        ${cityData.map((item, index) => {
      const forecast = cityForecastData[item.city] || [];

      while (forecast.length < 7) {
        const weekdaysZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const date = new Date();
        date.setDate(date.getDate() + forecast.length);
        forecast.push({
          dayName: forecast.length === dayIndex ? '今天' : weekdaysZh[date.getDay()],
          high: null,
          low: null
        });
      }

      return `
            <div class="ranking-item group flex flex-col p-3 rounded-xl transition-all duration-300 border select-none border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-800 hover:bg-slate-50 dark:hover:bg-gray-750"
                 data-temp="${item.temperature}">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-4">
                        <span data-role="badge" class="flex justify-center items-center w-7 h-7 rounded-lg text-sm font-bold shadow-sm bg-slate-200 dark:bg-gray-700 text-slate-500 dark:text-gray-400">
                            ${index + 1}
                        </span>
                        <div>
                            <h3 data-role="title" data-city-zh="${item.fullName || item.city}" data-city-en="${item.en_name || item.city}" class="font-semibold text-slate-700 dark:text-gray-300 text-sm md:text-base">${item.en_name || item.city}</h3>
                            <div class="text-xs text-slate-500 dark:text-gray-500 flex gap-2 items-center mt-0.5">
                                <span class="weather-desc" data-weather-zh="${item.weatherDesc || '未知'}" data-weather-en="${translateWeatherDesc(item.weatherDesc || '未知', 'en')}">${translateWeatherDesc(item.weatherDesc || '未知', 'en')}</span><span class="w-1 h-1 rounded-full bg-slate-400 dark:bg-gray-600"></span><span class="wind-label">Wind</span>: ${item.windSpeed || '0'} m/s</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="text-right">
                            <div data-role="temp-val" class="text-lg font-bold tabular-nums tracking-tight" style="color: ${item.temperature !== null && item.temperature !== undefined && !isNaN(item.temperature) ? getColorForTemp(item.temperature) : 'inherit'}">
                                ${item.temperature !== null && item.temperature !== undefined && !isNaN(item.temperature) ? item.temperature + '°' : '-'}
                            </div>
                        </div>
                        <div class="arrow-icon p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-transform duration-300 cursor-pointer" onclick="toggleExpand(this.closest('.ranking-item'))">
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


        const daysZh = ['今天', '周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const daysEn = ['Today', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayNameIndex = daysZh.indexOf(day.dayName);
        const dayNameEn = dayNameIndex >= 0 ? daysEn[dayNameIndex] : day.dayName;

        // 计算目标日期的字符串 (用于链接)
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + idx);
        const targetDateStr = targetDate.toISOString().slice(0, 10).replace(/-/g, '');

        let targetUrl;
        if (idx === dayIndex) {
          targetUrl = '#'; // 当前页面
        } else if (idx === 0) {
          targetUrl = dayIndex === 0 ? '#' : `../${fileName}`;
        } else {
          targetUrl = dayIndex === 0
            ? `${targetDateStr}/${fileName}`
            : `../${targetDateStr}/${fileName}`;
        }

        const isSelected = idx === dayIndex;
        const cursorClass = isSelected ? 'cursor-default' : 'cursor-pointer hover:opacity-80 transition-opacity';

        // 使用a标签而非onclick
        const TagName = isSelected ? 'div' : 'a';
        const hrefAttr = isSelected ? '' : `href="${targetUrl}"`;

        return `
                        <${TagName} ${hrefAttr} class="flex flex-col items-center group/day ${cursorClass}">
                            <span class="forecast-day-label text-[9px] font-medium mb-1 ${isSelected ? 'text-blue-500' : 'text-slate-500 dark:text-gray-500'}" data-day-zh="${day.dayName}" data-day-en="${dayNameEn}">
                                ${dayNameEn}
                            </span>
                            <div class="bg-slate-200 dark:bg-gray-800/50 rounded-full h-20 relative w-1.5 md:w-2 mx-auto ring-1 ring-black/5 dark:ring-white/5">
                                <div class="absolute w-full rounded-full opacity-80" style="bottom: ${bottomPos}%; height: ${barHeight}%; background-color: ${barColor};"></div>
                            </div>
                            <div class="flex flex-col items-center mt-1.5 gap-0.5">
                                <span class="text-[10px] font-bold text-slate-700 dark:text-gray-300 leading-none">${hasData ? day.high + '°' : '--'}</span>
                                <span class="text-[9px] text-slate-500 dark:text-gray-600 leading-none">${hasData ? day.low + '°' : '--'}</span>
                            </div>
                        </${TagName}>
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
                </div> <!-- End Dashboard Container -->

                <!-- Content Section (Below the Fold) -->
                <div class="w-full bg-white dark:bg-gray-900 border-t border-slate-200 dark:border-gray-800">
                    <div class="max-w-4xl mx-auto px-6 py-12 prose dark:prose-invert">
                      ${(() => {
      const summary = generateProvinceSummary(provinceName, cityData, targetDate);
      return `
                        <div class="mb-8 p-6 rounded-2xl bg-slate-50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700">
                            <h2 class="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2 not-prose">
                                <svg class="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span data-lang="zh" class="hidden">今日气象摘要</span>
                                <span data-lang="en">Daily Weather Summary</span>
                            </h2>
                            <div class="text-base text-slate-600 dark:text-gray-300 leading-relaxed">
                                <div data-lang="zh" class="hidden">${summary.zh}</div>
                                <div data-lang="en">${summary.en}</div>
                            </div>
                        </div>`;
    })()}
                    </div>
                    ${FOOTER_HTML}
                </div>

                <script>
                  let currentTheme = 'dark';
                  let currentLang = 'en';
                  let tempMapData = { };

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

                  // 更新省份标题
                  const mainHeading = document.getElementById('main-heading');
                  if (mainHeading && mainHeading.dataset.provinceZh && mainHeading.dataset.provinceEn) {
            const provinceName = lang === 'zh' ? mainHeading.dataset.provinceZh : mainHeading.dataset.provinceEn;
                  mainHeading.textContent = provinceName;
                  // 更新页面标题
                  document.title = provinceName + (lang === 'zh' ? ' 气温排行' : ' Temperature Rankings');
        }

        document.querySelectorAll('.weather-desc').forEach(el => {
                    el.textContent = lang === 'zh' ? el.dataset.weatherZh : el.dataset.weatherEn;
        });

            // 更新风速标签
            document.querySelectorAll('.wind-label').forEach(el => {
      el.textContent = t.wind;
            });

            // Generic language toggle for elements with data-lang attribute
            document.querySelectorAll('[data-lang]').forEach(el => {
                if (el.dataset.lang === lang) {
                    el.classList.remove('hidden');
                } else {
                    el.classList.add('hidden');
                }
            });

            document.querySelectorAll('.forecast-day-label').forEach(el => {
      el.textContent = lang === 'zh' ? el.dataset.dayZh : el.dataset.dayEn;
            });

        // 更新日期选择器
        document.querySelectorAll('.day-label').forEach(el => {
                    el.textContent = lang === 'zh' ? el.dataset.dayZh : el.dataset.dayEn;
        });

        // 更新城市标题
        document.querySelectorAll('[data-role="title"]').forEach(el => {
            if (el.dataset.cityZh && el.dataset.cityEn) {
                    el.textContent = lang === 'zh' ? el.dataset.cityZh : el.dataset.cityEn;
            }
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
                  textStyle: {color: tooltipText },
                formatter: (p) => {
                    // 从tempMapData获取温度值，支持多种后缀格式
                    let temp = tempMapData[p.name];
                  if (temp === undefined) {
                    temp = p.value;
                    }
                  const displayName = window.getCityName(p.name, currentLang);
                  const tempLabel = currentLang === 'zh' ? '温度' : 'Temperature';
                  if (temp === undefined || temp === null || isNaN(temp)) {
                        return \`<div class="font-bold text-sm mb-1">\${displayName}</div><div class="text-xs">\${tempLabel}: <span class="font-bold">-</span></div>\`;
                    }
                  const color = getColorForTemp(temp);
                  return \`<div class="font-bold text-sm mb-1">\${displayName}</div><div class="text-xs">\${tempLabel}: <span class="font-bold" style="color: \${color}">\${temp}°C</span></div>\`;
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

                  // 去重：如果有多个城市的fullName相同，只保留温度最高的一个
                  const uniqueDataMap = new Map();
                  ${JSON.stringify(cityData)}.forEach(item => {
          const name = item.fullName || item.city;
          if (!uniqueDataMap.has(name) || item.temperature > uniqueDataMap.get(name).value) {
                    uniqueDataMap.set(name, {
                      name: name,
                      shortName: item.city,
                      value: item.temperature
                    });
          }
        });
                  const data = Array.from(uniqueDataMap.values());

                  try {
            // 加载省份地图
            const res = await fetch('/geo/${adcode}_full.json');
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
                  textStyle: {fontSize: 12 }
            },
                  visualMap: {
                    show: false,
                  type: 'piecewise',
                  seriesIndex: 0,
                  pieces: [
                  {gte: 35, color: '#ef4444' },           // >= 35°C 红色
                  {gte: 28, lt: 35, color: '#f97316' },   // 28-34.9°C 橙色
                  {gte: 20, lt: 28, color: '#eab308' },   // 20-27.9°C 黄色
                  {gte: 10, lt: 20, color: '#10b981' },   // 10-19.9°C 绿色
                  {gte: 0, lt: 10, color: '#06b6d4' },    // 0-9.9°C 青色
                  {gte: -10, lt: 0, color: '#3b82f6' },   // -10--0.1°C 蓝色
                  {lt: -10, color: '#6366f1' }            // < -10°C 紫色
                  ],
                  calculable: false
            },
                  series: [{
                    type: 'map',
                  map: 'province',
                  roam: true,
                  top: '6%',
                  zoom: 0.9,
                  label: {
                    show: true,
                  fontSize: 10,
                  color: '#e5e7eb',
                  textBorderColor: '#111827',
                  textBorderWidth: 2,
                    formatter: (params) => {
                        const displayName = window.getCityName(params.name, currentLang);
                  const temp = tempMapData[params.name];
                  if (temp !== undefined && temp !== null && !isNaN(temp)) {
                            return \`\${displayName}\\n\${temp}°\`;
                        }
                  return \`\${displayName}\\n-\`;
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
                            const displayName = window.getCityName(params.name, currentLang);
                  const temp = tempMapData[params.name];
                  if (temp !== undefined && temp !== null && !isNaN(temp)) {
                                return \`\${displayName}\\n\${temp}°C\`;
                            }
                  return \`\${displayName}\\n-\`;
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

                  // 展开指定元素（不切换，只展开）
                  function expandItem(el) {
        const details = el.querySelector('.details-container');
                  const arrow = el.querySelector('.arrow-icon');

                  if (!details.classList.contains('open')) {
                    details.classList.add('open', 'fade-in');
                  arrow.classList.add('rotate-180', 'bg-black/5', 'dark:bg-white/10');
                  el.classList.add('ring-1', 'ring-slate-400', 'dark:ring-gray-500');
        }
    }

                  // 收起指定元素
                  function collapseItem(el) {
        const details = el.querySelector('.details-container');
                  const arrow = el.querySelector('.arrow-icon');

                  if (details.classList.contains('open')) {
                    details.classList.remove('open', 'fade-in');
                  arrow.classList.remove('rotate-180', 'bg-black/5', 'dark:bg-white/10');
                  el.classList.remove('ring-1', 'ring-slate-400', 'dark:ring-gray-500');
        }
    }

                  // 收起所有展开的项
                  function collapseAll() {
                    document.querySelectorAll('.ranking-item').forEach(item => {
                      collapseItem(item);
                    });
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

                  // 先收起所有展开的项
                  collapseAll();

        items.sort((a, b) => {
            const tA = parseFloat(a.dataset.temp);
                  const tB = parseFloat(b.dataset.temp);
                  return order === 'desc' ? tB - tA : tA - tB;
        });
        items.forEach((item, index) => {
                    list.appendChild(item);
                  applyRankStyle(item, index + 1);
        });

                  // 展开排序后的第一个项
                  const firstItem = list.querySelector('.ranking-item');
                  if (firstItem) {
                    expandItem(firstItem);
        }
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

                  // 自动展开第一个项
                  const firstItem = document.querySelector('.ranking-item');
                  if (firstItem) {
                    expandItem(firstItem);
        }

                  initMap();
    });
                </script>
                <script>
                  var _hmt = _hmt || [];
                  (function() {
                    var hm = document.createElement("script");
                    hm.src = "https://hm.baidu.com/hm.js?3df16935562e608a288f9c848d4bfd33";
                    var s = document.getElementsByTagName("script")[0]; 
                    s.parentNode.insertBefore(hm, s);
                  })();
                </script>
              </body>
            </html>`;

  // 文件路径: 今天是 website/anhui.html, 其他天是 website/YYYYMMDD/anhui.html
  let fullPath;
  if (dayIndex === 0) {
    fullPath = path.join(OUTPUT_DIR, fileName);
  } else {
    const dayDir = path.join(OUTPUT_DIR, dateStr);
    if (!fs.existsSync(dayDir)) {
      fs.mkdirSync(dayDir, { recursive: true });
    }
    fullPath = path.join(dayDir, fileName);
  }

  fs.writeFileSync(fullPath, html, 'utf8');
  console.log(`  ✅ ${provinceName} 页面生成完成 (${dayIndex === 0 ? fileName : dateStr + '/' + fileName})`);
}

/**
 * 生成所有省份的详情页面（为未来7天都生成）
 */
async function generateAllProvincePages() {
  console.log('🏙️  生成所有省份详情页面（未来7天）...');

  // 为未来7天的每一天生成所有省份的页面
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const date = new Date();
    date.setDate(date.getDate() + dayIndex);
    const dateStr = date.toLocaleDateString('zh-CN');

    console.log(`\n📅 生成第${dayIndex}天的省份页面 (${dateStr}):`);

    for (const provinceConfig of PROVINCES_DATA) {
      await generateProvincePage(provinceConfig.full_name || provinceConfig.name, provinceConfig, dayIndex);
    }
  }

  console.log('\n✅ 所有省份详情页面生成完成\n');
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('开始生成静态网站...\n');

    // 下载地理数据
    console.log('🗺️  检查并下载地理数据...');
    // 下载全国地图
    await ensureGeoData(100000);
    // 下载各省份地图
    for (const provinceConfig of PROVINCES_DATA) {
      if (provinceConfig.adcode && !provinceConfig.no_aliyun_data) {
        await ensureGeoData(provinceConfig.adcode);
      }
    }
    console.log('✅ 地理数据准备完成\n');

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

    // 生成所有日期的主页（预报数据在函数内部生成）
    await generateAllIndexPages(allForecastData);

    // 生成所有省份的详情页面
    await generateAllProvincePages();

    // 创建中文版本
    await createChineseVersions();

    // 生成搜索索引
    generateSearchIndex();

    // 生成 sitemap.xml
    await generateSitemap();

    console.log('\n✨ 所有页面生成完成！');
    console.log(`📁 输出目录: ${OUTPUT_DIR}`);
  } catch (error) {
    console.error('❌ 生成失败:', error);
    process.exit(1);
  }
}

/**
 * 生成搜索索引 (search_index.js)
 */
function generateSearchIndex() {
  const searchIndex = [];

  PROVINCES_DATA.forEach(province => {
    searchIndex.push({
      name: province.name,
      en_name: province.en_name,
      type: 'province',
      url: `${province.en_name.toLowerCase()}`,
      display_zh: province.name,
      display_en: province.en_name
    });

    if (province.cities) {
      province.cities.forEach(city => {
        searchIndex.push({
          name: city.name,
          full_name: city.full_name,
          en_name: city.en_name,
          type: 'city',
          url: `${province.en_name.toLowerCase()}`,
          parent_province: province.name,
          display_zh: `${city.name}, ${province.name}`,
          display_en: `${city.en_name}, ${province.en_name}`
        });
      });
    }
  });

  const jsContent = `window.SEARCH_INDEX = ${JSON.stringify(searchIndex, null, 2)};`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'search_index.js'), jsContent);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'zh-cn', 'search_index.js'), jsContent);
  console.log(`\n🔍 搜索索引已生成，包含 ${searchIndex.length} 条记录`);
}

/**
 * 生成 sitemap.xml
 */
async function generateSitemap() {
  console.log('\n🗺️  生成 sitemap.xml...');

  const baseUrl = 'https://www.7daystemps.com';
  const today = new Date().toISOString().split('T')[0];

  const urls = [];

  // 主页
  if (fs.existsSync(path.join(OUTPUT_DIR, 'index.html'))) {
    urls.push({ loc: baseUrl + '/', priority: '1.0', changefreq: 'daily' });
  }

  // 省份页面（根目录下的）
  const rootFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.html') && f !== 'index.html');
  rootFiles.forEach(f => {
    urls.push({ loc: `${baseUrl}/${f.replace('.html', '')}`, priority: '0.8', changefreq: 'daily' });
  });

  // 日期文件夹中的文件
  const dateFolders = fs.readdirSync(OUTPUT_DIR)
    .filter(f => {
      const fullPath = path.join(OUTPUT_DIR, f);
      return fs.statSync(fullPath).isDirectory() && /^\d{8}$/.test(f);
    });

  dateFolders.forEach(folder => {
    // 日期主页
    if (fs.existsSync(path.join(OUTPUT_DIR, folder, 'index.html'))) {
      urls.push({ loc: `${baseUrl}/${folder}/`, priority: '0.7', changefreq: 'daily' });
    }

    // 日期下的省份页面
    const filesInFolder = fs.readdirSync(path.join(OUTPUT_DIR, folder))
      .filter(f => f.endsWith('.html') && f !== 'index.html');
    filesInFolder.forEach(f => {
      urls.push({ loc: `${baseUrl}/${folder}/${f.replace('.html', '')}`, priority: '0.6', changefreq: 'daily' });
    });
  });

  // 中文版本
  const zhCnDir = path.join(OUTPUT_DIR, 'zh-cn');
  if (fs.existsSync(zhCnDir)) {
    // zh-cn 主页
    if (fs.existsSync(path.join(zhCnDir, 'index.html'))) {
      urls.push({ loc: `${baseUrl}/zh-cn/`, priority: '0.9', changefreq: 'daily' });
    }

    // zh-cn 下的省份页面
    const zhRootFiles = fs.readdirSync(zhCnDir)
      .filter(f => f.endsWith('.html') && f !== 'index.html');
    zhRootFiles.forEach(f => {
      urls.push({ loc: `${baseUrl}/zh-cn/${f.replace('.html', '')}`, priority: '0.7', changefreq: 'daily' });
    });

    // zh-cn 下的日期文件夹
    const zhDateFolders = fs.readdirSync(zhCnDir)
      .filter(f => {
        const fullPath = path.join(zhCnDir, f);
        return fs.statSync(fullPath).isDirectory() && /^\d{8}$/.test(f);
      });

    zhDateFolders.forEach(folder => {
      if (fs.existsSync(path.join(zhCnDir, folder, 'index.html'))) {
        urls.push({ loc: `${baseUrl}/zh-cn/${folder}/`, priority: '0.6', changefreq: 'daily' });
      }

      const filesInFolder = fs.readdirSync(path.join(zhCnDir, folder))
        .filter(f => f.endsWith('.html') && f !== 'index.html');
      filesInFolder.forEach(f => {
        urls.push({ loc: `${baseUrl}/zh-cn/${folder}/${f.replace('.html', '')}`, priority: '0.5', changefreq: 'daily' });
      });
    });
  }

  // 生成 XML
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              ${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
            </urlset>`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap.xml'), xml);
  console.log(`✅ sitemap.xml 已生成，包含 ${urls.length} 个 URL`);
}

/**
 * 后处理：为所有生成的HTML创建中文版本
 */
async function createChineseVersions() {
  console.log('\n🌏 生成中文版本...');

  const ZH_CN_DIR = path.join(OUTPUT_DIR, 'zh-cn');

  // 确保zh-cn目录存在
  if (!fs.existsSync(ZH_CN_DIR)) {
    fs.mkdirSync(ZH_CN_DIR, { recursive: true });
  }

  /**
   * 修改HTML以适应特定语言
   */
  function adaptHTML(htmlContent, lang, relativePath) {
    let html = htmlContent;

    // 计算语言切换链接
    const depth = (relativePath.match(/\//g) || []).length;
    // 将文件路径转为URL路径：去掉.html，index变为目录路径
    const urlPath = relativePath.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1');
    let enUrl, zhUrl;

    if (lang === 'zh') {
      // 在zh-cn目录下，回到英文版
      enUrl = '../'.repeat(depth + 1) + urlPath;
      zhUrl = '#';
    } else {
      // 在根目录，进入zh-cn目录
      enUrl = '#';
      // 如果在子目录中（如20260121/sichuan），需要先回到根目录
      if (depth > 0) {
        zhUrl = '../'.repeat(depth) + 'zh-cn/' + urlPath;
      } else {
        zhUrl = 'zh-cn/' + urlPath;
      }
    }

    // 1. 移除i18n配置（因为每个页面只有一种语言）
    html = html.replace(
      /\/\/ 多语言配置\s*window\.i18n = \{[\s\S]*?\};/,
      `// Language: ${lang}`
    );

    // 2. 移除provinceNameMap（getProvinceName已被简化，不再需要此映射）
    html = html.replace(
      /\/\/ 省份名称映射（fullName -> 中英文）\s*\/\/ 使用完整的provinces\.js数据,确保覆盖所有省份\s*window\.provinceNameMap = \{[^;]*\};/,
      `// Province names are pre-rendered in ${lang}`
    );

    // 3. 移除weatherDescMap（天气描述已经在生成时确定）
    html = html.replace(
      /\/\/ 天气描述中英文对照表\s*window\.weatherDescMap = \{[\s\S]*?\};/,
      '// Weather descriptions are pre-rendered in the correct language'
    );

    // 4. 移除cityNameMap（城市名称已经在生成时确定）
    html = html.replace(
      /\/\/ 城市名称映射[\s\S]*?window\.cityNameMap = \{[\s\S]*?\}\);?\};/,
      '// City names are pre-rendered in the correct language'
    );
    // 省份页面使用不同的注释
    html = html.replace(
      /\/\/ 城市名称中英文对照表\s*window\.cityNameMap = \{[^;]*\};/,
      '// City names are pre-rendered in the correct language'
    );

    // 5. 移除翻译函数（不再需要）
    // 这些函数可能跨越多行，需要更精确的匹配
    html = html.replace(
      /\/\/ 翻译天气描述\s*window\.translateWeatherDesc = function\(weatherDesc, lang\) \{[\s\S]*?\};/,
      ''
    );

    // getProvinceName函数 - 为不同语言版本创建不同的实现
    const provinceNameMap = lang === 'en' ? `{
              '北京市': 'Beijing', '天津市': 'Tianjin', '河北省': 'Hebei', '山西省': 'Shanxi',
            '内蒙古自治区': 'Inner Mongolia', '辽宁省': 'Liaoning', '吉林省': 'Jilin', '黑龙江省': 'Heilongjiang',
            '上海市': 'Shanghai', '江苏省': 'Jiangsu', '浙江省': 'Zhejiang', '安徽省': 'Anhui',
            '福建省': 'Fujian', '江西省': 'Jiangxi', '山东省': 'Shandong', '河南省': 'Henan',
            '湖北省': 'Hubei', '湖南省': 'Hunan', '广东省': 'Guangdong', '广西壮族自治区': 'Guangxi',
            '海南省': 'Hainan', '重庆市': 'Chongqing', '四川省': 'Sichuan', '贵州省': 'Guizhou',
            '云南省': 'Yunnan', '西藏自治区': 'Tibet', '陕西省': 'Shaanxi', '甘肃省': 'Gansu',
            '青海省': 'Qinghai', '宁夏回族自治区': 'Ningxia', '新疆维吾尔自治区': 'Xinjiang',
            '香港特别行政区': 'Hong Kong', '澳门特别行政区': 'Macau', '台湾省': 'Taiwan',
            '南海诸岛': 'Nanhai Islands'
    }` : `{ }`;

    html = html.replace(
      /\/\/ 获取省份显示名称（支持模糊匹配）\s*window\.getProvinceName = function\(geoName, lang\) \{[\s\S]*?return geoName;\s*\};/,
      `// Province name translation for ${lang} version
            const provinceNames = ${provinceNameMap};
            window.getProvinceName = function(geoName, lang) {
        return provinceNames[geoName] || geoName;
      };`
    );

    // getCityName函数可能有复杂的逻辑
    html = html.replace(
      /\/\/ 获取城市名称（支持中英文）\s*window\.getCityName = function\(cityName, lang\) \{[\s\S]*?return cityName;\s*\};/,
      `// City names are already in the correct language\n      window.getCityName = function(cityName, lang) {\n        return cityName;\n      };`
    );
    html = html.replace(
      /\/\/ 获取城市显示名称[\s\S]*?window\.getCityName = function[^}]*\};/,
      ''
    );

    // 6. 固定语言
    html = html.replace(/let currentLang = 'en';/, `let currentLang = '${lang}';`);

    // 7. 简化初始化函数（不再需要从localStorage读取）
    // 主页版本
    html = html.replace(
      /\/\/ 初始化语言设置\s*function initLanguage\(\) \{[\s\S]*?\}/,
      `// Language is fixed for this version\n        function initLanguage() {\n            currentLang = '${lang}';\n        }`
    );
    // 省份页面版本（没有注释）
    html = html.replace(
      /function initLanguage\(\) \{\s*const savedLang = localStorage\.getItem\('preferredLanguage'\)[\s\S]*?updateLanguageUI\(savedLang\);\s*\}/,
      `function initLanguage() {\n        currentLang = '${lang}';\n    }`
    );

    // 8. 移除switchLanguage函数（不再需要）
    html = html.replace(
      /\/\/ 切换语言\s*function switchLanguage\(lang\) \{[\s\S]*?\}/,
      '// Language switching is done via navigation'
    );
    // 省份页面版本
    html = html.replace(
      /function switchLanguage\(lang\) \{\s*if[\s\S]*?updateLanguageUI\(lang\);\s*\}/,
      '// Language switching is done via navigation'
    );

    // 9. 移除updateLanguageUI函数（所有文本已经是正确语言）
    // 主页版本：有"// 更新UI语言"注释
    html = html.replace(
      /\/\/ 更新UI语言\s*function updateLanguageUI\(lang\) \{[\s\S]*?\/\/ 重绘地图（更新省份名称和主题）[\s\S]*?updateMapOption\(window\.myMapChart\);\s*\}\s*\}/,
      '// UI language is pre-rendered (all text is already in the correct language)'
    );
    // 省份页面版本：没有注释，直接是function定义
    html = html.replace(
      /function updateLanguageUI\(lang\) \{\s*const t = window\.i18n\[lang\];[\s\S]*?updateMapOption\(window\.myMapChart\);\s*\}\s*\}/,
      '// UI language is pre-rendered (all text is already in the correct language)'
    );

    // 10. 替换语言切换按钮为链接
    const langSwitcher = `<div class="flex bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-lg border border-slate-200 dark:border-gray-700 p-1">
              <a href="${enUrl}" class="px-2 py-0.5 text-xs font-bold rounded ${lang === 'en' ? 'bg-blue-600 text-white' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors'} cursor-pointer">EN</a>
              <a href="${zhUrl}" class="px-2 py-0.5 text-xs font-bold rounded ${lang === 'zh' ? 'bg-blue-600 text-white' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors'} cursor-pointer">CN</a>
            </div>`;

    html = html.replace(
      /<div class="flex bg-white\/80 dark:bg-gray-800\/80 backdrop-blur rounded-lg border border-slate-200 dark:border-gray-700 p-1">\s*<button onclick="switchLanguage\('en'\)"[^>]*>EN<\/button>\s*<button onclick="switchLanguage\('zh'\)"[^>]*>CN<\/button>\s*<\/div>/,
      langSwitcher
    );

    // 11. 更新html lang属性
    html = html.replace(/lang="en"/, lang === 'zh' ? 'lang="zh-CN"' : 'lang="en"');

    // 12. 替换HTML中硬编码的英文文本为对应语言
    if (lang === 'en') {
      // 英文版本：省份详情页面需要添加城市名称映射表（类似index.html的做法）
      // 提取城市数据，构建映射表
      const cityDataMatch = html.match(/const uniqueDataMap = new Map\(\);\s*(\[.*?\])\.forEach/s);
      if (cityDataMatch) {
        try {
          const cityDataStr = cityDataMatch[1];
          const cityData = JSON.parse(cityDataStr);

          // 构建城市名称映射表
          const cityNameMap = {};
          cityData.forEach(city => {
            const zhName = city.fullName || city.city;
            const enName = city.en_name || city.city;
            cityNameMap[zhName] = enName;
          });

          // 在getCityName函数之前插入城市名称映射表
          const cityMapStr = `// City name mapping for en version
              const cityNameMap = ${JSON.stringify(cityNameMap)};
              `;

          html = html.replace(
            /\/\/ City names are already in the correct language\s*window\.getCityName/,
            `${cityMapStr}window.getCityName`
          );

          // 修改getCityName函数使其使用映射表
          html = html.replace(
            /window\.getCityName = function\(cityName, lang\) \{\s*return cityName;\s*\};/,
            `window.getCityName = function(cityName, lang) {
        return cityNameMap[cityName] || cityName;
      };`
          );
        } catch (e) {
          console.error('解析城市数据失败:', e);
        }
      }
    }

    if (lang === 'zh') {
      // 首先提取并替换省份页面中的省份名称（从data-province-zh属性中获取）
      const provinceMatch = html.match(/data-province-zh="([^"]*)"/);
      if (provinceMatch) {
        const provinceChinese = provinceMatch[1];
        const provinceEnglishMatch = html.match(/data-province-en="([^"]*)"/);
        if (provinceEnglishMatch) {
          const provinceEnglish = provinceEnglishMatch[1];
          // 替换meta和title中的英文省份名称
          html = html.replace(new RegExp(provinceEnglish, 'g'), provinceChinese);
        }
      }

      // 替换搜索框placeholder
      html = html.replace(/placeholder="Search city\/province\.\.\."/g, 'placeholder="搜索城市/省份..."');

      // 替换标题和描述
      html = html.replace(/China Temperature Rankings/g, '中国气温排行榜');
      html = html.replace(/Real-time Temperature Data/g, '实时气温数据');
      html = html.replace(/China Temp Rankings/g, '中国气温排行');
      html = html.replace(/National Rankings/g, '全国排行');
      html = html.replace(/Regions/g, '地区');
      html = html.replace(/Temperature data across China/g, '全国各地气温数据');
      html = html.replace(/data across China/g, '全国数据');

      // 替换按钮文本（需要匹配整个词，包括前后的空白）
      html = html.replace(/>\s*Hot\s*</g, '>高温<');
      html = html.replace(/>\s*Cold\s*</g, '>低温<');
      html = html.replace(/>\s*Wind\s*</g, '>风速<');

      // 替换日期标签（匹配整个词，包括前后空白）
      html = html.replace(/>\s*Today\s*</g, '>今天<');
      html = html.replace(/>\s*Mon\s*</g, '>周一<');
      html = html.replace(/>\s*Tue\s*</g, '>周二<');
      html = html.replace(/>\s*Wed\s*</g, '>周三<');
      html = html.replace(/>\s*Thu\s*</g, '>周四<');
      html = html.replace(/>\s*Fri\s*</g, '>周五<');
      html = html.replace(/>\s*Sat\s*</g, '>周六<');
      html = html.replace(/>\s*Sun\s*</g, '>周日<');

      // 替换温度标签
      html = html.replace(/Temp Scale/g, '温度标尺');
      html = html.replace(/Temperature/g, '温度');

      // 替换排行榜中的省份名称（使用data-province-zh属性）
      // 替换排行榜中的省份名称（使用data-province-zh属性）
      // 匹配 h3, a, div 等标签
      html = html.replace(
        /(<(?:h3|a|div)[^>]*data-province-zh="([^"]*)"[^>]*data-province-en="[^"]*"[^>]*>)\s*[^<]*\s*(<\/(?:h3|a|div)>)/g,
        '$1$2$3'
      );

      // 替换排行榜中的天气描述（使用data-weather-zh属性）
      html = html.replace(
        /(<span[^>]*class="weather-desc"[^>]*data-weather-zh="([^"]*)"[^>]*data-weather-en="[^"]*"[^>]*>)[^<]*(.*?<\/span>)/g,
        '$1$2$3'
      );

      // 省份详情页面：替换页面标题和meta描述中的英文
      html = html.replace(/Temperature Rankings/g, '温度排行榜');
      html = html.replace(/City temperature data/g, '城市气温数据');
      html = html.replace(/temperature,weather,cities/g, '温度,天气,城市');

      // 省份详情页面：替换主标题（使用data-province-zh属性）
      html = html.replace(
        /(<h1[^>]*data-province-zh="([^"]*)"[^>]*data-province-en="[^"]*"[^>]*>)[^<]*(.*?<\/h1>)/g,
        '$1$2$3'
      );

      // 省份详情页面：替换城市名称（使用data-city-zh属性）
      html = html.replace(
        /(<[^>]*data-city-zh="([^"]*)"[^>]*data-city-en="[^"]*"[^>]*>)[^<]*(.*?<\/[^>]+>)/g,
        '$1$2$3'
      );

      // 替换其他常见文本
      html = html.replace(/Rankings/g, '排行榜');
      html = html.replace(/Wind/g, '风速');

      // 切换气象摘要的显示 (data-lang属性)
      // 1. 显示中文内容 (移除hidden类)
      html = html.replace(/(<[^>]*data-lang="zh"[^>]*)\bclass="[^"]*hidden[^"]*"([^>]*>)/g, '$1$2');
      html = html.replace(/(<[^>]*data-lang="zh"[^>]*)\bhidden\b([^>]*>)/g, '$1$2');

      // 2. 隐藏英文内容 (添加hidden类)
      html = html.replace(/(<[^>]*data-lang="en"[^>]*)(>)/g, '$1 class="hidden"$2');
    }

    // 13. 移除initLanguage()调用中的updateLanguageUI
    html = html.replace(
      /\/\/ 初始化语言\s*initLanguage\(\);/,
      '// Language is pre-rendered'
    );

    // 13. 移除地图点击事件中对provinceNameMap的循环查找，并修复点击处理逻辑
    // 需要匹配整个点击处理逻辑，包括后续使用enName和noAliyunData的代码
    html = html.replace(
      /\/\/ 查找对应的英文名称和no_aliyun_data标记[\s\S]*?for \(const \[key, value\] of Object\.entries\(window\.provinceNameMap\)\)[\s\S]*?\}\s*\/\/ 如果有no_aliyun_data标记，不跳转[\s\S]*?\/\/ 使用英文名称小写作为文件名\s*const fileName = enName\.toLowerCase[\s\S]*?window\.location\.href = fileName;/,
      `// Province click - use province name mapping
                const provinceFileNames = {
                    '北京': 'beijing', '北京市': 'beijing',
                    '天津': 'tianjin', '天津市': 'tianjin',
                    '河北': 'hebei', '河北省': 'hebei',
                    '山西': 'shanxi', '山西省': 'shanxi',
                    '内蒙古': 'neimenggu', '内蒙古自治区': 'neimenggu',
                    '辽宁': 'liaoning', '辽宁省': 'liaoning',
                    '吉林': 'jilin', '吉林省': 'jilin',
                    '黑龙江': 'heilongjiang', '黑龙江省': 'heilongjiang',
                    '上海': 'shanghai', '上海市': 'shanghai',
                    '江苏': 'jiangsu', '江苏省': 'jiangsu',
                    '浙江': 'zhejiang', '浙江省': 'zhejiang',
                    '安徽': 'anhui', '安徽省': 'anhui',
                    '福建': 'fujian', '福建省': 'fujian',
                    '江西': 'jiangxi', '江西省': 'jiangxi',
                    '山东': 'shandong', '山东省': 'shandong',
                    '河南': 'henan', '河南省': 'henan',
                    '湖北': 'hubei', '湖北省': 'hubei',
                    '湖南': 'hunan', '湖南省': 'hunan',
                    '广东': 'guangdong', '广东省': 'guangdong',
                    '广西': 'guangxi', '广西壮族自治区': 'guangxi',
                    '海南': 'hainan', '海南省': 'hainan',
                    '重庆': 'chongqing', '重庆市': 'chongqing',
                    '四川': 'sichuan', '四川省': 'sichuan',
                    '贵州': 'guizhou', '贵州省': 'guizhou',
                    '云南': 'yunnan', '云南省': 'yunnan',
                    '西藏': 'xizang', '西藏自治区': 'xizang',
                    '陕西': 'shaanxi', '陕西省': 'shaanxi',
                    '甘肃': 'gansu', '甘肃省': 'gansu',
                    '青海': 'qinghai', '青海省': 'qinghai',
                    '宁夏': 'ningxia', '宁夏回族自治区': 'ningxia',
                    '新疆': 'xinjiang', '新疆维吾尔自治区': 'xinjiang',
                    '香港': 'hongkong', '香港特别行政区': 'hongkong',
                    '澳门': 'aomen', '澳门特别行政区': 'aomen',
                    '台湾': 'taiwan', '台湾省': 'taiwan'
                };

                const fileNameBase = provinceFileNames[provinceName] || provinceName.toLowerCase();
                window.location.href = fileNameBase;`
    );

    return html;
  }

  /**
   * 处理单个HTML文件
   */
  function processFile(relativePath) {
    const sourcePath = path.join(OUTPUT_DIR, relativePath);

    if (!fs.existsSync(sourcePath)) {
      return;
    }

    const htmlContent = fs.readFileSync(sourcePath, 'utf8');

    // 更新英文版本（原地）
    const enContent = adaptHTML(htmlContent, 'en', relativePath);
    fs.writeFileSync(sourcePath, enContent, 'utf8');

    // 创建中文版本
    const zhPath = path.join(ZH_CN_DIR, relativePath);
    const zhDir = path.dirname(zhPath);

    if (!fs.existsSync(zhDir)) {
      fs.mkdirSync(zhDir, { recursive: true });
    }

    const zhContent = adaptHTML(htmlContent, 'zh', relativePath);
    fs.writeFileSync(zhPath, zhContent, 'utf8');

    console.log(`  ✅ ${relativePath}`);
  }

  // 收集所有HTML文件
  const files = [];

  // 主页
  if (fs.existsSync(path.join(OUTPUT_DIR, 'index.html'))) {
    files.push('index.html');
  }

  // 省份页面（根目录下的）
  const rootFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.html') && f !== 'index.html');
  files.push(...rootFiles);

  // 日期文件夹中的文件
  const dateFolders = fs.readdirSync(OUTPUT_DIR)
    .filter(f => {
      const fullPath = path.join(OUTPUT_DIR, f);
      return fs.statSync(fullPath).isDirectory() && /^\d{8}$/.test(f);
    });

  dateFolders.forEach(folder => {
    const folderPath = path.join(OUTPUT_DIR, folder);
    const filesInFolder = fs.readdirSync(folderPath)
      .filter(f => f.endsWith('.html'));

    filesInFolder.forEach(f => {
      files.push(`${folder}/${f}`);
    });
  });

  // 处理每个文件
  files.forEach(file => processFile(file));

  console.log(`✅ 完成！共处理 ${files.length} 个文件`);
}

async function generateStaticPages() {
  const HEADER = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4059058909472641"
     crossorigin="anonymous"></script>
    <script async custom-element="amp-auto-ads"
        src="https://cdn.ampproject.org/v0/amp-auto-ads-0.1.js">
    </script>
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ZW66C8K27S"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());

      gtag('config', 'G-ZW66C8K27S');
    </script>
    <title>Policy - China Temp Rankings</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = { darkMode: 'class' };
        if (localStorage.getItem('theme') === 'light') {
            document.documentElement.classList.remove('dark');
        } else {
            document.documentElement.classList.add('dark');
        }
    </script>
</head>
<body class="bg-slate-50 dark:bg-[#0d1117] text-slate-900 dark:text-white font-sans min-h-screen flex flex-col">
    <amp-auto-ads type="adsense"
        data-ad-client="ca-pub-4059058909472641">
    </amp-auto-ads>
    <nav class="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-slate-200 dark:border-gray-800 sticky top-0 z-50">
        <div class="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
            <a href="/" class="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-emerald-500">China Temp Rankings</a>
            <a href="/" class="text-sm font-medium text-slate-500 dark:text-gray-400 hover:text-blue-500">Back to Home</a>
        </div>
    </nav>
    <main class="flex-1 max-w-4xl mx-auto px-6 py-12 w-full prose dark:prose-invert">
`;

  const END = `
    </main>
    ${FOOTER_HTML}
    <script>
      var _hmt = _hmt || [];
      (function() {
        var hm = document.createElement("script");
        hm.src = "https://hm.baidu.com/hm.js?3df16935562e608a288f9c848d4bfd33";
        var s = document.getElementsByTagName("script")[0]; 
        s.parentNode.insertBefore(hm, s);
      })();
    </script>
</body>
</html>`;

  // 1. Privacy Policy
  const privacyContent = `
    <h1>Privacy Policy</h1>
    <p>Last updated: ${new Date().toLocaleDateString()}</p>
    <p>At China Temp Rankings, we prioritize the privacy of our visitors. This Privacy Policy document contains types of information that is collected and recorded by China Temp Rankings and how we use it.</p>
    
    <h2>Log Files</h2>
    <p>We use standard log files. These files log visitors when they visit websites. The information collected includes internet protocol (IP) addresses, browser type, Internet Service Provider (ISP), date and time stamp, referring/exit pages, and possibly the number of clicks.</p>
    
    <h2>Cookies and Web Beacons</h2>
    <p>Like any other website, we use "cookies". These cookies are used to store information including visitors' preferences, and the pages on the website that the visitor accessed or visited.</p>
    
    <h2>Google DoubleClick DART Cookie</h2>
    <p>Google is one of a third-party vendor on our site. It also uses cookies, known as DART cookies, to serve ads to our site visitors based upon their visit to www.website.com and other sites on the internet.</p>
  `;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'privacy.html'), HEADER + privacyContent + END);

  // 2. Terms of Service
  const termsContent = `
    <h1>Terms of Service</h1>
    <p>By accessing this website, you agree to be bound by these website Terms and Conditions of Use.</p>
    <h2>Disclaimer</h2>
    <p>The materials on China Temp Rankings's website are provided "as is". We make no warranties, expressed or implied, and hereby disclaim and negate all other warranties. Further, we do not warrant or make any representations concerning the accuracy, likely results, or reliability of the use of the materials on our Internet web site or otherwise relating to such materials or on any sites linked to this site.</p>
    <h2>Accuracy of Data</h2>
    <p>The weather data presented on this site is sourced from third-party APIs and is for informational purposes only. Do not rely on this data for safety-critical decisions.</p>
  `;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'terms.html'), HEADER + termsContent + END);

  // 3. About Us
  const aboutContent = `
    <h1>About Us</h1>
    <p>China Temp Rankings is a data visualization project dedicated to showing real-time temperature extremes across China.</p>
    <h2>Our Data</h2>
    <p>We aggregate temperature data from hundreds of cities to create a real-time ranking of the hottest and coldest places. Our system updates hourly to provide the most current snapshot of weather patterns.</p>
    <h2>Contact</h2>
    <p>For any inquiries, please contact us via email (if applicable).</p>
  `;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'about.html'), HEADER + aboutContent + END);

  console.log('✅ Static pages generated (Privacy, Terms, About)');
}

function generateRobotsTxt() {
  const content = `User-agent: *
Allow: /

Sitemap: https://7daystemps.com/sitemap.xml
`;
  // 注意：需替换域名为实际域名
  fs.writeFileSync(path.join(OUTPUT_DIR, 'robots.txt'), content);
  console.log('✅ robots.txt generated');
}


(async () => {
  await main();
  await generateStaticPages();
  generateRobotsTxt();
})();
