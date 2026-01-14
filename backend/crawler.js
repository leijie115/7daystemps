/**
 * 天气数据爬虫
 * 从中国气象局网站抓取各城市天气数据
 * 支持 InfluxDB 1.8
 */

const axios = require('axios');
const cheerio = require('cheerio');
const Influx = require('influx');
const provinces = require('../provinces.js');
require('dotenv').config();

// InfluxDB 1.8 配置
const influx = new Influx.InfluxDB({
  host: process.env.INFLUX_HOST || 'localhost',
  port: parseInt(process.env.INFLUX_PORT) || 8086,
  database: process.env.INFLUX_DATABASE || 'weather',
  username: process.env.INFLUX_USERNAME || '',
  password: process.env.INFLUX_PASSWORD || '',
  schema: [
    {
      measurement: 'weather',
      fields: {
        temperature: Influx.FieldType.FLOAT,
        precipitation: Influx.FieldType.FLOAT,
        windSpeed: Influx.FieldType.FLOAT,
        windDirection: Influx.FieldType.STRING,
        pressure: Influx.FieldType.FLOAT,
        humidity: Influx.FieldType.STRING,
        cloudCover: Influx.FieldType.STRING,
        weatherCode: Influx.FieldType.STRING,
        weatherDesc: Influx.FieldType.STRING
      },
      tags: [
        'province',
        'city',
        'stationId'
      ]
    }
  ]
});

// 延迟函数
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 处理数据，去掉单位
 * 单位说明：
 * - temperature: ℃
 * - precipitation: mm (无降水时为0)
 * - windSpeed: m/s
 * - pressure: hPa
 * - humidity: %
 * - cloudCover: %
 */
function processWeatherValue(value, type) {
  if (!value || value === '') return null;

  const trimmed = value.trim();

  switch(type) {
    case 'pressure':
      // 845.1hPa -> 845.1
      return parseFloat(trimmed.replace('hPa', '')) || null;

    case 'precipitation':
      // "无降水" -> 0
      // "0.3mm" -> 0.3
      if (trimmed === '无降水' || trimmed === '无' || trimmed === '-') {
        return 0;
      }
      return parseFloat(trimmed.replace('mm', '')) || 0;

    case 'windSpeed':
      // "2.5m/s" -> 2.5
      return parseFloat(trimmed.replace('m/s', '')) || null;

    case 'humidity':
    case 'cloudCover':
      // "65%" -> 65
      return parseFloat(trimmed.replace('%', '')) || null;

    default:
      return trimmed;
  }
}

/**
 * 初始化数据库
 */
async function initDatabase() {
  try {
    const databases = await influx.getDatabaseNames();
    const dbName = process.env.INFLUX_DATABASE || 'weather';

    if (!databases.includes(dbName)) {
      console.log(`创建数据库: ${dbName}`);
      await influx.createDatabase(dbName);
    }
  } catch (error) {
    console.error('初始化数据库失败:', error.message);
    throw error;
  }
}

/**
 * 从HTML中提取基准日期和时间
 */
function extractBaseDateTime(html) {
  const $ = cheerio.load(html);

  // 从 "7天天气预报（2025/12/31 12:00发布）" 中提取
  const headerText = $('.hp .hd').text();
  const match = headerText.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);

  if (match) {
    const [, year, month, day, hour, minute] = match;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,  // 月份从0开始
      parseInt(day),
      parseInt(hour),
      parseInt(minute)
    );
  }

  // 如果没找到，返回当前时间
  return new Date();
}

/**
 * 提取每天的日期信息
 */
function extractDayDates(html, baseDate) {
  const $ = cheerio.load(html);
  const dayDates = [];

  // 从 day-item 中提取日期 (例如: 12/31, 01/01)
  $('#dayList .day').each((index, element) => {
    const dateText = $(element).find('.day-item').first().text();
    const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})/);

    if (dateMatch) {
      const [, month, day] = dateMatch;

      // 基于基准日期计算年份
      let year = baseDate.getFullYear();
      const baseMonth = baseDate.getMonth() + 1;

      // 如果月份跨年(12月->1月)，年份+1
      if (parseInt(month) < baseMonth && baseMonth === 12) {
        year += 1;
      }

      dayDates.push({
        year,
        month: parseInt(month),
        day: parseInt(day)
      });
    }
  });

  return dayDates;
}

/**
 * 从 dayList 提取天气代码和中文描述的映射关系
 */
function extractWeatherCodeMapping(html) {
  const $ = cheerio.load(html);
  const weatherCodeMap = {};

  // 遍历每一天的数据
  $('#dayList .day').each((_, element) => {
    const dayItems = $(element).find('.day-item');

    // 白天天气: 第2个是图标(weatherCode), 第3个是中文描述
    const dayIcon = dayItems.eq(1).find('img').attr('src');
    const dayDesc = dayItems.eq(2).text().trim();
    const dayCodeMatch = dayIcon && dayIcon.match(/w(\d+)\.png/);
    if (dayCodeMatch && dayDesc) {
      weatherCodeMap[dayCodeMatch[1]] = dayDesc;
    }

    // 夜间天气: 第7个是图标(weatherCode), 第8个是中文描述
    const nightIcon = dayItems.eq(6).find('img').attr('src');
    const nightDesc = dayItems.eq(7).text().trim();
    const nightCodeMatch = nightIcon && nightIcon.match(/w(\d+)\.png/);
    if (nightCodeMatch && nightDesc) {
      weatherCodeMap[nightCodeMatch[1]] = nightDesc;
    }
  });

  return weatherCodeMap;
}

/**
 * 解析HTML中的天气数据
 */
function parseWeatherData(html, stationId, cityName, provinceName) {
  const $ = cheerio.load(html);
  const weatherData = [];

  // 提取基准日期和时间
  const baseDate = extractBaseDateTime(html);
  console.log(`  基准时间: ${baseDate.toLocaleString('zh-CN')}`);

  // 提取每天的日期
  const dayDates = extractDayDates(html, baseDate);
  console.log(`  解析到 ${dayDates.length} 天的日期信息`);

  // 提取天气代码和中文描述的映射关系
  const weatherCodeMap = extractWeatherCodeMapping(html);
  console.log(`  天气代码映射: ${JSON.stringify(weatherCodeMap)}`);

  // 解析7天的逐小时天气数据
  for (let day = 0; day < 7; day++) {
    const tableId = `#hourTable_${day}`;
    const table = $(tableId);

    if (table.length === 0) continue;

    const rows = table.find('tr');

    // 获取时间行 (第1行)
    const times = [];
    rows.eq(0).find('td').each((i, el) => {
      if (i > 0) times.push($(el).text().trim());
    });

    // 获取天气图标行 (第2行)
    const weatherIcons = [];
    rows.eq(1).find('td img').each((i, el) => {
      const src = $(el).attr('src');
      const match = src && src.match(/w(\d+)\.png/);
      weatherIcons.push(match ? match[1] : '0');
    });

    // 获取气温行 (第3行)
    const temps = [];
    rows.eq(2).find('td').each((i, el) => {
      if (i > 0) {
        const tempText = $(el).text().trim();
        const temp = parseFloat(tempText.replace('℃', ''));
        temps.push(temp);
      }
    });

    // 获取降水行 (第4行)
    const precipitations = [];
    rows.eq(3).find('td').each((i, el) => {
      if (i > 0) precipitations.push($(el).text().trim());
    });

    // 获取风速行 (第5行)
    const windSpeeds = [];
    rows.eq(4).find('td').each((i, el) => {
      if (i > 0) windSpeeds.push($(el).text().trim());
    });

    // 获取风向行 (第6行)
    const windDirs = [];
    rows.eq(5).find('td').each((i, el) => {
      if (i > 0) windDirs.push($(el).text().trim());
    });

    // 获取气压行 (第7行)
    const pressures = [];
    rows.eq(6).find('td').each((i, el) => {
      if (i > 0) pressures.push($(el).text().trim());
    });

    // 获取湿度行 (第8行)
    const humidities = [];
    rows.eq(7).find('td').each((i, el) => {
      if (i > 0) humidities.push($(el).text().trim());
    });

    // 获取云量行 (第9行)
    const cloudCovers = [];
    rows.eq(8).find('td').each((i, el) => {
      if (i > 0) cloudCovers.push($(el).text().trim());
    });

    // 组合数据
    for (let i = 0; i < times.length; i++) {
      const weatherCode = weatherIcons[i] || '0';
      weatherData.push({
        day: day,
        dayDate: dayDates[day] || null,
        time: times[i],
        weatherCode: weatherCode,
        weatherDesc: weatherCodeMap[weatherCode] || '未知',
        temperature: temps[i] || 0,
        precipitation: precipitations[i] || '',
        windSpeed: windSpeeds[i] || '',
        windDirection: windDirs[i] || '',
        pressure: pressures[i] || '',
        humidity: humidities[i] || '',
        cloudCover: cloudCovers[i] || '',
        stationId,
        cityName,
        provinceName
      });
    }
  }

  return weatherData;
}

/**
 * 抓取单个城市的天气数据
 */
async function fetchCityWeather(stationId, cityName, provinceName) {
  const url = `https://weather.cma.cn/web/weather/${stationId}.html`;

  try {
    console.log(`  抓取: ${provinceName} - ${cityName} (${stationId})`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://weather.cma.cn/'
      },
      timeout: 15000
    });

    const weatherData = parseWeatherData(response.data, stationId, cityName, provinceName);

    // 写入 InfluxDB 1.8
    const points = [];

    for (const data of weatherData) {
      // 计算实际时间
      const [hour, minute] = data.time.split(':');

      let dataTime;
      if (data.dayDate) {
        // 使用解析的日期
        dataTime = new Date(
          data.dayDate.year,
          data.dayDate.month - 1,
          data.dayDate.day,
          parseInt(hour),
          parseInt(minute),
          0,
          0
        );
      } else {
        // 降级方案：使用当前时间 + day 偏移
        dataTime = new Date();
        dataTime.setDate(dataTime.getDate() + data.day);
        dataTime.setHours(parseInt(hour), parseInt(minute), 0, 0);
      }

      points.push({
        measurement: 'weather',
        tags: {
          province: provinceName,
          city: cityName,
          stationId: stationId
        },
        fields: {
          temperature: data.temperature,
          precipitation: processWeatherValue(data.precipitation, 'precipitation'),
          windSpeed: processWeatherValue(data.windSpeed, 'windSpeed'),
          windDirection: data.windDirection,
          pressure: processWeatherValue(data.pressure, 'pressure'),
          humidity: processWeatherValue(data.humidity, 'humidity'),
          cloudCover: processWeatherValue(data.cloudCover, 'cloudCover'),
          weatherCode: data.weatherCode,
          weatherDesc: data.weatherDesc
        },
        timestamp: dataTime
      });
    }

    await influx.writePoints(points);

    console.log(`  ✓ 成功: ${cityName} - ${weatherData.length} 条数据`);
    return { success: true, count: weatherData.length };

  } catch (error) {
    console.error(`  ✗ 失败: ${cityName} - ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 抓取所有城市的天气数据
 */
async function crawlAllCities() {
  console.log('开始抓取天气数据...\n');

  // 初始化数据库
  await initDatabase();

  const startTime = Date.now();

  let totalCities = 0;
  let successCount = 0;
  let failCount = 0;

  const requestDelay = parseInt(process.env.REQUEST_DELAY) || 2000;

  for (const province of provinces) {
    if (province.cities.length === 0) continue;

    console.log(`\n[${province.name}] 共 ${province.cities.length} 个城市`);

    for (const city of province.cities) {
      totalCities++;

      const result = await fetchCityWeather(
        city.stationId,
        city.name,
        province.name
      );

      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }

      // 延迟，避免请求过快
      await delay(requestDelay);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n==================== 抓取完成 ====================');
  console.log(`总城市数: ${totalCities}`);
  console.log(`成功: ${successCount}`);
  console.log(`失败: ${failCount}`);
  console.log(`耗时: ${duration} 秒`);
  console.log('================================================\n');
}

// 如果直接运行此文件
if (require.main === module) {
  crawlAllCities()
    .then(() => {
      console.log('爬虫任务完成');
      process.exit(0);
    })
    .catch(error => {
      console.error('爬虫任务失败:', error);
      process.exit(1);
    });
}

module.exports = { crawlAllCities };
