import { WeatherData, ForecastDay } from '../types';

// Helper to generate random weather data
const getRandomTemp = (base: number, variance: number) => {
  return parseFloat((base + (Math.random() * variance * 2 - variance)).toFixed(1));
};

const conditionsMap: Record<string, string> = {
  '晴': 'Sunny',
  '多云': 'Cloudy',
  '小雨': 'Light Rain',
  '阴': 'Overcast',
  '雪': 'Snow',
  '雾': 'Fog',
  '雷阵雨': 'Thunderstorm'
};

const conditions = Object.keys(conditionsMap);

const getConditionData = (temp: number) => {
  let cond = '';
  if (temp < 0) cond = Math.random() > 0.5 ? '雪' : '阴';
  else if (temp > 25) cond = Math.random() > 0.7 ? '小雨' : '晴';
  else cond = conditions[Math.floor(Math.random() * conditions.length)];
  
  return {
    zh: cond,
    en: conditionsMap[cond]
  };
};

const getNext7Days = () => {
  const today = new Date();
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dayNamesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({
        zh: dayNames[d.getDay()],
        en: dayNamesEn[d.getDay()]
    });
  }
  return days;
};

const generateForecast = (baseTemp: number): ForecastDay[] => {
  const days = getNext7Days();
  return days.map((dayObj, index) => {
    const dailyBase = baseTemp + (Math.random() * 6 - 3); 
    const high = Math.round(dailyBase + Math.random() * 3 + 2);
    const low = Math.round(dailyBase - Math.random() * 3 - 2);
    const cond = getConditionData(high);
    
    return {
      date: new Date(new Date().setDate(new Date().getDate() + index)).toISOString().split('T')[0],
      dayName: index === 0 ? '今天' : dayObj.zh,
      dayNameEn: index === 0 ? 'Today' : dayObj.en,
      high,
      low,
      condition: cond.zh,
      conditionEn: cond.en
    };
  });
};

// Map of Province Name to Adcode and Base Temp
const provinceConfig: Record<string, { adcode: number, baseTemp: number, enName: string }> = {
  '北京市': { adcode: 110000, baseTemp: 15, enName: 'Beijing' },
  '天津市': { adcode: 120000, baseTemp: 16, enName: 'Tianjin' },
  '河北省': { adcode: 130000, baseTemp: 14, enName: 'Hebei' },
  '山西省': { adcode: 140000, baseTemp: 12, enName: 'Shanxi' },
  '内蒙古自治区': { adcode: 150000, baseTemp: 5, enName: 'Inner Mongolia' },
  '辽宁省': { adcode: 210000, baseTemp: 10, enName: 'Liaoning' },
  '吉林省': { adcode: 220000, baseTemp: 5, enName: 'Jilin' },
  '黑龙江省': { adcode: 230000, baseTemp: 0, enName: 'Heilongjiang' },
  '上海市': { adcode: 310000, baseTemp: 20, enName: 'Shanghai' },
  '江苏省': { adcode: 320000, baseTemp: 19, enName: 'Jiangsu' },
  '浙江省': { adcode: 330000, baseTemp: 21, enName: 'Zhejiang' },
  '安徽省': { adcode: 340000, baseTemp: 18, enName: 'Anhui' },
  '福建省': { adcode: 350000, baseTemp: 24, enName: 'Fujian' },
  '江西省': { adcode: 360000, baseTemp: 20, enName: 'Jiangxi' },
  '山东省': { adcode: 370000, baseTemp: 17, enName: 'Shandong' },
  '河南省': { adcode: 410000, baseTemp: 16, enName: 'Henan' },
  '湖北省': { adcode: 420000, baseTemp: 19, enName: 'Hubei' },
  '湖南省': { adcode: 430000, baseTemp: 20, enName: 'Hunan' },
  '广东省': { adcode: 440000, baseTemp: 28, enName: 'Guangdong' },
  '广西壮族自治区': { adcode: 450000, baseTemp: 26, enName: 'Guangxi' },
  '海南省': { adcode: 460000, baseTemp: 30, enName: 'Hainan' },
  '重庆市': { adcode: 500000, baseTemp: 22, enName: 'Chongqing' },
  '四川省': { adcode: 510000, baseTemp: 18, enName: 'Sichuan' },
  '贵州省': { adcode: 520000, baseTemp: 15, enName: 'Guizhou' },
  '云南省': { adcode: 530000, baseTemp: 20, enName: 'Yunnan' },
  '西藏自治区': { adcode: 540000, baseTemp: 5, enName: 'Tibet' },
  '陕西省': { adcode: 610000, baseTemp: 14, enName: 'Shaanxi' },
  '甘肃省': { adcode: 620000, baseTemp: 10, enName: 'Gansu' },
  '青海省': { adcode: 630000, baseTemp: 2, enName: 'Qinghai' },
  '宁夏回族自治区': { adcode: 640000, baseTemp: 11, enName: 'Ningxia' },
  '新疆维吾尔自治区': { adcode: 650000, baseTemp: 10, enName: 'Xinjiang' },
  '香港特别行政区': { adcode: 810000, baseTemp: 28, enName: 'Hong Kong' },
  '澳门特别行政区': { adcode: 820000, baseTemp: 28, enName: 'Macau' },
  '台湾省': { adcode: 710000, baseTemp: 26, enName: 'Taiwan' }
};

// Generate city data for a province
export const generateCityData = (provinceName: string, provinceAdcode: number): WeatherData[] => {
  const config = provinceConfig[provinceName] || { baseTemp: 15, enName: provinceName };
  const baseTemp = config.baseTemp;
  const cityCount = 5 + Math.floor(Math.random() * 8);
  const cities: WeatherData[] = [];

  for (let i = 1; i <= cityCount; i++) {
    const temp = getRandomTemp(baseTemp, 5);
    const cond = getConditionData(temp);
    const cityNameEn = `${config.enName} City ${i}`;
    
    cities.push({
      regionName: `${provinceName.replace('省', '').replace('市', '')}市区-${i}`,
      regionNameEn: cityNameEn,
      temperature: temp,
      condition: cond.zh,
      conditionEn: cond.en,
      humidity: Math.floor(Math.random() * 60) + 20,
      windSpeed: Math.floor(Math.random() * 20),
      isProvince: false,
      forecast: generateForecast(temp)
    });
  }
  return cities.sort((a, b) => b.temperature - a.temperature);
};

// Generate initial national data
export const generateNationalData = (): WeatherData[] => {
  const data: WeatherData[] = Object.keys(provinceConfig).map(name => {
    const config = provinceConfig[name];
    const temp = getRandomTemp(config.baseTemp, 3);
    const cond = getConditionData(temp);
    
    return {
      regionName: name,
      regionNameEn: config.enName,
      adcode: config.adcode,
      temperature: temp,
      condition: cond.zh,
      conditionEn: cond.en,
      humidity: Math.floor(Math.random() * 50) + 30,
      windSpeed: Math.floor(Math.random() * 15),
      isProvince: true,
      children: generateCityData(name, config.adcode),
      forecast: generateForecast(temp)
    };
  });
  return data.sort((a, b) => b.temperature - a.temperature);
};
