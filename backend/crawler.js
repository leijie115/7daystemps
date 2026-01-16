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
        temperature: Influx.FieldType.FLOAT, // 单位: ℃
        precipitation: Influx.FieldType.FLOAT, // 单位: mm
        windSpeed: Influx.FieldType.FLOAT, // 单位: m/s
        windDirection: Influx.FieldType.STRING,
        pressure: Influx.FieldType.FLOAT, // 单位: hPa
        humidity: Influx.FieldType.FLOAT, // 单位: %
        cloudCover: Influx.FieldType.FLOAT, // 单位: % (云量)
        weatherCode: Influx.FieldType.STRING, // 天气代码 (图片文件名中的数字)
        weatherDesc: Influx.FieldType.STRING, // 天气描述 (中文)
        updateTime: Influx.FieldType.STRING // 数据更新时间 (HH:mm 格式)
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
 * 从 HTML 中提取数据更新时间
 * 格式: <span id="realPublishTime">08:50更新</span>
 * 返回格式: "08:50"
 */
function extractUpdateTime(html) {
  const $ = cheerio.load(html);
  const updateText = $('#realPublishTime').text().trim();
  const match = updateText.match(/(\d{1,2}:\d{2})/);
  return match ? match[1] : null;
}

/**
 * 从 7days 区域提取天气代码和中文描述的映射关系
 * 在 class="7days day7" 中，每个 class="weather pull-left" 包含天气信息
 * weathericon 中的图片对应 desc 中的描述
 */
function extractWeatherCodeMapping(html) {
  const $ = cheerio.load(html);
  const weatherCodeMap = {};

  // 查找 7days 区域
  $('.7days.day7 .weather.pull-left').each((_, weatherEl) => {
    $(weatherEl).find('.weathericon img').each((index, imgEl) => {
      const src = $(imgEl).attr('src');
      const match = src && src.match(/\/(\d+)\.png$/);

      if (match) {
        const code = match[1];
        // 找到对应的描述 (在 weathericon 之后的 desc)
        const desc = $(imgEl).closest('.weathericon').next('.desc').text().trim();
        if (desc && !weatherCodeMap[code]) {
          weatherCodeMap[code] = desc;
        }
      }
    });
  });

  return weatherCodeMap;
}

/**
 * 解析 HTML 中的天气数据
 * 从 day0 和 day1 的 hour3 元素中提取逐小时数据
 */
function parseWeatherData(html, stationId, cityName, provinceName) {
  const $ = cheerio.load(html);
  const weatherData = [];

  // 提取数据更新时间
  const updateTime = extractUpdateTime(html);
  console.log(`  数据更新时间: ${updateTime || '未知'}`);

  // 提取天气代码和中文描述的映射关系
  const weatherCodeMap = extractWeatherCodeMapping(html);
  console.log(`  天气代码映射: ${JSON.stringify(weatherCodeMap)}`);

  // 获取当前时间作为基准
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 解析 day0 (今天) 和 day1 (明天) 的数据
  ['day0', 'day1'].forEach((dayId, dayOffset) => {
    const dayContainer = $(`#${dayId}`);
    if (dayContainer.length === 0) return;

    // 计算当前日期
    const currentDate = new Date(today);
    currentDate.setDate(currentDate.getDate() + dayOffset);

    // 遍历每个 hour3 元素
    dayContainer.find('.hour3').each((_, hourEl) => {
      const divs = $(hourEl).find('div');

      // 第1个div: 时间 (例如: "11:00" 或 "18日02:00")
      const timeText = divs.eq(0).text().trim();

      // 解析时间
      let hour, minute;
      const crossDayMatch = timeText.match(/\d+日(\d{1,2}):(\d{2})/);
      if (crossDayMatch) {
        // 跨天时间，例如 "18日02:00"
        hour = parseInt(crossDayMatch[1]);
        minute = parseInt(crossDayMatch[2]);
        // 时间跨到了第二天
        currentDate.setDate(currentDate.getDate() + 1);
      } else {
        const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          hour = parseInt(timeMatch[1]);
          minute = parseInt(timeMatch[2]);
        } else {
          return; // 无法解析时间，跳过
        }
      }

      // 第2个div: 天气图标 (提取图片文件名中的数字作为 weatherCode)
      const imgSrc = divs.eq(1).find('img').attr('src') || '';
      const weatherCodeMatch = imgSrc.match(/\/(\d+)\.png$/);
      const weatherCode = weatherCodeMatch ? weatherCodeMatch[1] : '0';

      // 第3个div: 降水量 (如果是 "-" 则为 0)
      const precipText = divs.eq(2).text().trim();
      const precipitation = precipText === '-' ? 0 : parseFloat(precipText) || 0;

      // 第4个div: 气温 (去掉 ℃)
      const tempText = divs.eq(3).text().trim();
      const temperature = parseFloat(tempText.replace('℃', '')) || 0;

      // 第5个div: 风速 (去掉 m/s)
      const windSpeedText = divs.eq(4).text().trim();
      const windSpeed = parseFloat(windSpeedText.replace('m/s', '')) || 0;

      // 第6个div: 风向
      const windDirection = divs.eq(5).text().trim();

      // 第7个div: 气压 (去掉 hPa, class=hide)
      const pressureText = divs.eq(6).text().trim();
      const pressure = parseFloat(pressureText.replace('hPa', '')) || null;

      // 第8个div: 湿度 (去掉 %)
      const humidityText = divs.eq(7).text().trim();
      const humidity = parseFloat(humidityText.replace('%', '')) || null;

      // 第9个div: 云量 (去掉 %, class=hide)
      const cloudCoverText = divs.eq(8).text().trim();
      const cloudCover = parseFloat(cloudCoverText.replace('%', '')) || null;

      // 构建数据时间戳
      const dataTime = new Date(currentDate);
      dataTime.setHours(hour, minute, 0, 0);

      weatherData.push({
        time: dataTime,
        weatherCode,
        weatherDesc: weatherCodeMap[weatherCode] || '未知',
        temperature,
        precipitation,
        windSpeed,
        windDirection,
        pressure,
        humidity,
        cloudCover,
        updateTime,
        stationId,
        cityName,
        provinceName
      });
    });
  });

  return weatherData;
}

/**
 * 抓取单个城市的天气数据
 * 使用新的 API: https://www.nmc.cn/rest/weather?stationid={code}
 */
async function fetchCityWeather(code, cityName, provinceName, lastUpdateTime = null) {
  const timestamp = Date.now();
  const url = `https://www.nmc.cn/rest/weather?stationid=${code}&_=${timestamp}`;

  try {
    console.log(`  抓取: ${provinceName} - ${cityName} (${code})`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.nmc.cn/'
      },
      timeout: 15000
    });

    const html = response.data;
    const weatherData = parseWeatherData(html, code, cityName, provinceName);

    if (weatherData.length === 0) {
      console.log(`  ⊘ 跳过: ${cityName} - 没有解析到数据`);
      return { success: true, count: 0, skipped: true };
    }

    // 检查更新时间，实现增量更新
    const currentUpdateTime = weatherData[0].updateTime;
    if (lastUpdateTime && currentUpdateTime === lastUpdateTime) {
      console.log(`  ⊘ 跳过: ${cityName} - 数据未更新 (${currentUpdateTime})`);
      return { success: true, count: 0, skipped: true, updateTime: currentUpdateTime };
    }

    // 写入 InfluxDB 1.8
    const points = weatherData.map(data => ({
      measurement: 'weather',
      tags: {
        province: provinceName,
        city: cityName,
        stationId: code
      },
      fields: {
        temperature: data.temperature,
        precipitation: data.precipitation,
        windSpeed: data.windSpeed,
        windDirection: data.windDirection,
        pressure: data.pressure,
        humidity: data.humidity,
        cloudCover: data.cloudCover,
        weatherCode: data.weatherCode,
        weatherDesc: data.weatherDesc,
        updateTime: data.updateTime || ''
      },
      timestamp: data.time
    }));

    await influx.writePoints(points);

    console.log(`  ✓ 成功: ${cityName} - ${weatherData.length} 条数据 (更新时间: ${currentUpdateTime})`);
    return { success: true, count: weatherData.length, updateTime: currentUpdateTime };

  } catch (error) {
    console.error(`  ✗ 失败: ${cityName} - ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 抓取所有城市的天气数据
 * 从 provinces 的第二级 (cities) 开始遍历
 * 支持增量更新：检查更新时间，如果数据未变化则跳过后续请求
 */
async function crawlAllCities() {
  console.log('开始抓取天气数据...\n');

  // 初始化数据库
  await initDatabase();

  const startTime = Date.now();

  let totalCities = 0;
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  const requestDelay = parseInt(process.env.REQUEST_DELAY) || 2000;

  // 用于存储第一个城市的更新时间，用于增量更新判断
  let firstUpdateTime = null;
  let shouldSkipRemaining = false;

  for (const province of provinces) {
    if (!province.cities || province.cities.length === 0) continue;

    console.log(`\n[${province.name}] 共 ${province.cities.length} 个城市`);

    for (let i = 0; i < province.cities.length; i++) {
      const city = province.cities[i];
      totalCities++;

      // 如果已经检测到数据未更新，跳过剩余城市
      if (shouldSkipRemaining) {
        console.log(`  ⊘ 跳过: ${city.name} - 批量跳过（数据未更新）`);
        skippedCount++;
        continue;
      }

      const result = await fetchCityWeather(
        city.code,
        city.name,
        province.name,
        i === 0 ? null : firstUpdateTime // 第一个城市不传 lastUpdateTime
      );

      if (result.success) {
        successCount++;

        // 记录第一个城市的更新时间
        if (i === 0 && result.updateTime) {
          firstUpdateTime = result.updateTime;
        }

        // 如果第一个城市之后的城市数据未更新，则跳过后续所有城市
        if (i === 0 && result.skipped) {
          console.log(`  → 检测到数据未更新，将跳过本省剩余城市`);
          shouldSkipRemaining = true;
        }

        if (result.skipped) {
          skippedCount++;
        }
      } else {
        failCount++;
      }

      // 延迟，避免请求过快
      if (!shouldSkipRemaining) {
        await delay(requestDelay);
      }
    }

    // 重置跳过标志，为下一个省份做准备
    shouldSkipRemaining = false;
    firstUpdateTime = null;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n==================== 抓取完成 ====================');
  console.log(`总城市数: ${totalCities}`);
  console.log(`成功: ${successCount}`);
  console.log(`跳过: ${skippedCount}`);
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
