const Influx = require('influx');
require('dotenv').config();

const influx = new Influx.InfluxDB({
  host: process.env.INFLUX_HOST || 'localhost',
  port: parseInt(process.env.INFLUX_PORT) || 8086,
  database: process.env.INFLUX_DATABASE || 'weather',
  username: process.env.INFLUX_USERNAME || '',
  password: process.env.INFLUX_PASSWORD || ''
});

async function checkData() {
  try {
    console.log('检查数据库连接...');

    // 检查数据库是否存在
    const databases = await influx.getDatabaseNames();
    console.log('数据库列表:', databases);

    if (!databases.includes(process.env.INFLUX_DATABASE || 'weather')) {
      console.error('❌ 数据库不存在！');
      console.log('请先运行爬虫： node crawler.js');
      return;
    }

    // 查询总记录数
    const countQuery = 'SELECT COUNT(temperature) FROM weather';
    const countResult = await influx.query(countQuery);
    console.log('总记录数:', countResult.length > 0 ? countResult[0].count : 0);

    // 查询最新的10条数据
    const latestQuery = 'SELECT * FROM weather ORDER BY time DESC LIMIT 10';
    const latestData = await influx.query(latestQuery);

    console.log('\n最新10条数据:');
    latestData.forEach((row, index) => {
      console.log(`${index + 1}. ${row.province} - ${row.city}: ${row.temperature}°C (${new Date(row.time).toLocaleString('zh-CN')})`);
    });

    // 查询省份统计
    const provinceQuery = 'SHOW TAG VALUES FROM weather WITH KEY = province';
    const provinces = await influx.query(provinceQuery);
    console.log(`\n省份总数: ${provinces.length}`);

    // 查询城市统计
    const cityQuery = 'SHOW TAG VALUES FROM weather WITH KEY = city';
    const cities = await influx.query(cityQuery);
    console.log(`城市总数: ${cities.length}`);

    if (latestData.length === 0) {
      console.log('\n❌ 数据库中没有数据！');
      console.log('请先运行爬虫： node crawler.js');
    } else {
      console.log('\n✅ 数据库正常，可以生成网站');
    }

  } catch (error) {
    console.error('错误:', error.message);
    console.log('\n请检查:');
    console.log('1. InfluxDB是否运行');
    console.log('2. .env配置是否正确');
    console.log('3. 数据库是否已创建');
  }
}

checkData();
