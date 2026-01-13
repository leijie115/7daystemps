/**
 * API 服务器
 * 提供气温排行榜数据接口
 * 支持 InfluxDB 1.8
 */

const express = require('express');
const Influx = require('influx');
const cron = require('node-cron');
const { crawlAllCities } = require('./crawler');
const { exec } = require('child_process');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3123;

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
        precipitation: Influx.FieldType.STRING,
        windSpeed: Influx.FieldType.STRING,
        windDirection: Influx.FieldType.STRING,
        pressure: Influx.FieldType.STRING,
        humidity: Influx.FieldType.STRING,
        cloudCover: Influx.FieldType.STRING,
        weatherCode: Influx.FieldType.STRING
      },
      tags: [
        'province',
        'city',
        'stationId'
      ]
    }
  ]
});

// 中间件
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// 静态文件服务
app.use(express.static(path.join(__dirname, '../website')));

/**
 * 获取最新气温排行榜（分页）
 * GET /api/temperature/ranking
 * 查询参数:
 *   - page: 页码，从1开始，默认1
 *   - pageSize: 每页数量，默认20，最大100
 *   - order: 排序方式，'high' 最高温 或 'low' 最低温，默认 'high'
 */
app.get('/api/temperature/ranking', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    const orderType = req.query.order === 'low' ? 'low' : 'high';

    // InfluxQL 查询：获取每个城市最新的温度数据
    // 注意：InfluxDB 1.8 的 GROUP BY 查询不支持 ORDER BY 非时间字段
    const query = `
      SELECT LAST(temperature) as latest_temp
      FROM weather
      WHERE time > now() - 24h
      GROUP BY city, province
    `;

    const results = await influx.query(query);

    // 在应用层进行排序
    const allRankings = results
      .map(row => ({
        province: row.province,
        city: row.city,
        temperature: parseFloat(row.latest_temp.toFixed(1))
      }))
      .sort((a, b) => {
        // 最热排行：从高到低
        // 最冷排行：从低到高
        return orderType === 'high'
          ? b.temperature - a.temperature
          : a.temperature - b.temperature;
      });

    // 计算分页
    const total = allRankings.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const rankings = allRankings.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: rankings,
      pagination: {
        page: page,
        pageSize: pageSize,
        total: total,
        totalPages: totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      order: orderType
    });

  } catch (error) {
    console.error('查询排行榜失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取按省份聚合的温度数据（用于地图显示）
 * GET /api/temperature/by-province
 * 查询参数:
 *   - order: 排序方式，'high' 最高温 或 'low' 最低温，默认 'high'
 */
app.get('/api/temperature/by-province', async (req, res) => {
  try {
    const orderType = req.query.order === 'low' ? 'low' : 'high';

    // 获取每个省份最新的温度数据
    const query = `
      SELECT LAST(temperature) as latest_temp
      FROM weather
      WHERE time > now() - 24h
      GROUP BY province
    `;

    const results = await influx.query(query);

    // 处理数据
    const provinceData = results.map(row => ({
      province: row.province,
      temperature: parseFloat(row.latest_temp.toFixed(1))
    }));

    res.json({
      success: true,
      data: provinceData,
      order: orderType
    });

  } catch (error) {
    console.error('查询省份温度失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取指定城市的天气数据
 * GET /api/weather/:stationId
 */
app.get('/api/weather/:stationId', async (req, res) => {
  try {
    const { stationId } = req.params;

    // InfluxQL 查询：获取7天内的数据
    const query = `
      SELECT *
      FROM weather
      WHERE stationId = '${stationId}' AND time > now() - 7d
      ORDER BY time ASC
    `;

    const results = await influx.query(query);

    const weatherData = results.map(row => ({
      time: row.time.toISOString(),
      province: row.province,
      city: row.city,
      temperature: row.temperature,
      weatherCode: row.weatherCode,
      windDirection: row.windDirection,
      windSpeed: row.windSpeed
    }));

    res.json({
      success: true,
      data: weatherData,
      count: weatherData.length
    });

  } catch (error) {
    console.error('查询天气数据失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取省份列表
 * GET /api/provinces
 */
app.get('/api/provinces', (req, res) => {
  const provinces = require('../provinces.js');
  res.json({
    success: true,
    data: provinces
  });
});

/**
 * 手动触发爬虫
 * POST /api/crawler/start
 */
app.post('/api/crawler/start', async (req, res) => {
  res.json({
    success: true,
    message: '爬虫任务已启动，请查看服务器日志'
  });

  // 异步执行爬虫任务
  crawlAllCities().catch(console.error);
});

/**
 * 健康检查
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * 获取数据库统计信息
 * GET /api/stats
 */
app.get('/api/stats', async (req, res) => {
  try {
    const query = `
      SELECT COUNT(temperature) as total_records
      FROM weather
    `;

    const results = await influx.query(query);

    const citiesQuery = `
      SHOW TAG VALUES FROM weather WITH KEY = city
    `;

    const cities = await influx.query(citiesQuery);

    res.json({
      success: true,
      stats: {
        totalRecords: results.length > 0 ? results[0].total_records : 0,
        totalCities: cities.length,
        database: process.env.INFLUX_DATABASE || 'weather'
      }
    });

  } catch (error) {
    console.error('查询统计信息失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`API 服务器运行在端口 ${PORT}`);
  console.log(`访问 http://localhost:${PORT}/api/temperature/ranking 查看排行榜`);
  console.log(`InfluxDB: ${process.env.INFLUX_HOST || 'localhost'}:${process.env.INFLUX_PORT || 8086}`);
  console.log(`数据库: ${process.env.INFLUX_DATABASE || 'weather'}`);
});

// 生成静态HTML
function generateHTML() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'generate-html.js');
    exec(`node "${scriptPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('HTML生成失败:', error);
        reject(error);
      } else {
        console.log(stdout);
        if (stderr) console.error(stderr);
        resolve();
      }
    });
  });
}

// 定时任务：每小时执行一次爬虫
const crawlerInterval = process.env.CRAWLER_INTERVAL || '0 * * * *'; // 默认每小时整点执行
cron.schedule(crawlerInterval, async () => {
  console.log('\n[定时任务] 开始执行爬虫任务...');
  await crawlAllCities().catch(console.error);

  console.log('\n[定时任务] 开始生成静态网站...');
  await generateHTML().catch(console.error);
});

console.log(`爬虫定时任务已设置: ${crawlerInterval}`);

// 定时任务：每30分钟生成一次静态HTML
cron.schedule('*/30 * * * *', async () => {
  console.log('\n[定时任务] 生成静态网站...');
  await generateHTML().catch(console.error);
});

console.log('HTML生成定时任务已设置: 每30分钟');

// 启动时生成一次
setTimeout(() => {
  console.log('\n[启动] 首次生成静态网站...');
  generateHTML().catch(console.error);
}, 5000);
