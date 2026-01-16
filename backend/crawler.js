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
        weatherDesc: Influx.FieldType.STRING // 天气描述 (中文)
      },
      tags: [
        'province',
        'city'
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
 * 从 day0 到 day6 的 hour3 元素中提取逐小时数据
 */
function parseWeatherData(html, cityCode, provinceCode) {
  const $ = cheerio.load(html);
  const weatherData = [];

  // 提取天气代码和中文描述的映射关系
  const weatherCodeMap = extractWeatherCodeMapping(html);
  console.log(`  天气代码映射: ${JSON.stringify(weatherCodeMap)}`);

  // 获取当前时间作为基准
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 解析 day0 到 day6 (7天) 的数据
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dayId = `day${dayOffset}`;
    const dayContainer = $(`#${dayId}`);
    if (dayContainer.length === 0) {
      console.log(`  警告: 未找到 #${dayId} 元素`);
      continue;
    }
    console.log(`  找到 #${dayId}, 包含 ${dayContainer.find('.hour3').length} 个 hour3 元素`);

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
        cityCode,
        provinceCode
      });
    });
  }

  return weatherData;
}

/**
 * 抓取单个城市的天气数据
 * 从城市的 URL 获取完整的 HTML 页面
 */
async function fetchCityWeather(cityUrl, cityCode, cityName, provinceCode, provinceName) {
  const url = `https://www.nmc.cn${cityUrl}`;

  try {
    console.log(`  抓取: ${provinceName} - ${cityName} (${provinceCode}/${cityCode})`);
    console.log(`  请求URL: ${url}`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.nmc.cn/'
      },
      timeout: 15000
    });

    console.log(`  响应状态: ${response.status}`);
    console.log(`  响应内容类型: ${response.headers['content-type']}`);
    console.log(`  响应内容长度: ${response.data.length} 字符`);

    const html = response.data;
    const weatherData = parseWeatherData(html, cityCode, provinceCode);

    if (weatherData.length === 0) {
      console.log(`  ⊘ 跳过: ${cityName} - 没有解析到数据`);
      return { success: true, count: 0 };
    }

    // 获取数据的时间范围
    const times = weatherData.map(d => d.time.getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    // 删除这个城市在该时间范围内的旧数据
    try {
      await influx.query(`
        DELETE FROM weather
        WHERE province = '${provinceCode}'
        AND city = '${cityCode}'
        AND time >= ${minTime}000000
        AND time <= ${maxTime}000000
      `);
      console.log(`  已删除旧数据: ${new Date(minTime).toLocaleString('zh-CN')} 到 ${new Date(maxTime).toLocaleString('zh-CN')}`);
    } catch (deleteError) {
      // 删除失败可能是因为没有数据,继续执行
      console.log(`  删除旧数据时出现提示: ${deleteError.message}`);
    }

    // 写入 InfluxDB 1.8
    const points = weatherData.map(data => ({
      measurement: 'weather',
      tags: {
        province: data.provinceCode,
        city: data.cityCode
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
        weatherDesc: data.weatherDesc
      },
      timestamp: data.time
    }));

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
 * 从 provinces 的第二级 (cities) 开始遍历
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
    if (!province.cities || province.cities.length === 0) continue;

    console.log(`\n[${province.name}] 共 ${province.cities.length} 个城市`);

    for (const city of province.cities) {
      totalCities++;

      const result = await fetchCityWeather(
        city.url,
        city.code,
        city.name,
        province.code,
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
