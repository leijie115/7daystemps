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

  return results.map(row => ({
    province: row.province,
    temperature: parseFloat(row.latest_temp.toFixed(1))
  })).sort((a, b) => b.temperature - a.temperature);
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
 * 生成主页HTML
 */
async function generateIndex(provinceData) {
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
    <meta name="description" content="中国气温排行榜 - 实时展示全国各省市气温数据，支持省份详情查看">
    <meta name="keywords" content="中国气温,温度排行,天气,气温地图,实时温度">
    <title>中国气温排行榜 - 全国实时气温数据</title>
    <link rel="stylesheet" href="assets/css/style.css">
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
</head>
<body>
    <header class="header">
        <div class="container">
            <h1>🌡️ 中国气温排行榜</h1>
            <p class="subtitle">实时全国各省市气温数据</p>
        </div>
    </header>

    <main class="main">
        <div class="container">
            <!-- 更新时间 -->
            <div class="update-time">
                最后更新: ${lastUpdate}
            </div>

            <!-- 温度统计 -->
            <div class="stats-cards">
                <div class="stat-card hot">
                    <div class="stat-icon">🔥</div>
                    <div class="stat-value">${maxTemp}°C</div>
                    <div class="stat-label">最高温</div>
                    <div class="stat-location">${provinceData[0].province}</div>
                </div>
                <div class="stat-card cold">
                    <div class="stat-icon">❄️</div>
                    <div class="stat-value">${minTemp}°C</div>
                    <div class="stat-label">最低温</div>
                    <div class="stat-location">${provinceData[provinceData.length - 1].province}</div>
                </div>
                <div class="stat-card avg">
                    <div class="stat-icon">📊</div>
                    <div class="stat-value">${(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)}°C</div>
                    <div class="stat-label">平均温度</div>
                    <div class="stat-location">全国</div>
                </div>
            </div>

            <!-- 地图容器 -->
            <div class="map-section">
                <h2>全国气温分布图</h2>
                <div id="china-map" class="map-container"></div>
                <div class="map-legend">
                    <div class="legend-title">温度范围</div>
                    <div class="legend-gradient"></div>
                    <div class="legend-labels">
                        <span>${minTemp}°C</span>
                        <span>${maxTemp}°C</span>
                    </div>
                </div>
            </div>

            <!-- 排行榜 -->
            <div class="ranking-section">
                <div class="ranking-tabs">
                    <button class="tab-btn active" data-type="hot">🔥 最热排行</button>
                    <button class="tab-btn" data-type="cold">❄️ 最冷排行</button>
                </div>

                <div class="ranking-list" id="hot-ranking">
                    ${provinceData.map((item, index) => `
                    <a href="provinces/${encodeURIComponent(item.province)}.html" class="ranking-item">
                        <div class="ranking-number ${index < 3 ? 'top-three' : ''}">${index + 1}</div>
                        <div class="ranking-province">${item.province}</div>
                        <div class="ranking-temp hot-temp">${item.temperature}°C</div>
                    </a>
                    `).join('')}
                </div>

                <div class="ranking-list hidden" id="cold-ranking">
                    ${[...provinceData].reverse().map((item, index) => `
                    <a href="provinces/${encodeURIComponent(item.province)}.html" class="ranking-item">
                        <div class="ranking-number ${index < 3 ? 'top-three' : ''}">${index + 1}</div>
                        <div class="ranking-province">${item.province}</div>
                        <div class="ranking-temp cold-temp">${item.temperature}°C</div>
                    </a>
                    `).join('')}
                </div>
            </div>

            <!-- Google AdSense 广告位 -->
            <div class="ad-container">
                <!-- 在这里插入 Google AdSense 代码 -->
                <div class="ad-placeholder">广告位</div>
            </div>
        </div>
    </main>

    <footer class="footer">
        <div class="container">
            <p>数据来源: 中国气象局</p>
            <p>© 2024 中国气温排行榜 - 每小时自动更新</p>
        </div>
    </footer>

    <script src="assets/js/main.js"></script>
    <script>
        // 地图数据
        const mapData = ${JSON.stringify(provinceData.map(item => ({
          name: item.province,
          value: item.temperature
        })))};
        const minTemp = ${minTemp};
        const maxTemp = ${maxTemp};

        initChinaMap(mapData, minTemp, maxTemp);
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
    <link rel="stylesheet" href="../assets/css/style.css">
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
</head>
<body>
    <header class="header">
        <div class="container">
            <a href="../index.html" class="back-link">← 返回全国</a>
            <h1>🌡️ ${province.province}气温详情</h1>
        </div>
    </header>

    <main class="main">
        <div class="container">
            <!-- 省份统计 -->
            <div class="stats-cards">
                <div class="stat-card hot">
                    <div class="stat-icon">🔥</div>
                    <div class="stat-value">${maxTemp}°C</div>
                    <div class="stat-label">最高温</div>
                    <div class="stat-location">${cities[0].city}</div>
                </div>
                <div class="stat-card cold">
                    <div class="stat-icon">❄️</div>
                    <div class="stat-value">${minTemp}°C</div>
                    <div class="stat-label">最低温</div>
                    <div class="stat-location">${cities[cities.length - 1].city}</div>
                </div>
                <div class="stat-card avg">
                    <div class="stat-icon">📊</div>
                    <div class="stat-value">${(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)}°C</div>
                    <div class="stat-label">平均温度</div>
                    <div class="stat-location">省内</div>
                </div>
            </div>

            <!-- 城市列表 -->
            <div class="city-section">
                <h2>城市气温排行</h2>
                <div class="city-grid">
                    ${cities.map((city, index) => `
                    <div class="city-card">
                        <div class="city-rank">#${index + 1}</div>
                        <div class="city-name">${city.city}</div>
                        <div class="city-temp ${city.temperature > 25 ? 'hot-temp' : city.temperature < 10 ? 'cold-temp' : ''}">${city.temperature}°C</div>
                    </div>
                    `).join('')}
                </div>
            </div>

            <!-- Google AdSense 广告位 -->
            <div class="ad-container">
                <div class="ad-placeholder">广告位</div>
            </div>
        </div>
    </main>

    <footer class="footer">
        <div class="container">
            <p>数据来源: 中国气象局</p>
            <p>© 2024 中国气温排行榜</p>
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

    // 生成主页
    console.log('🏠 生成主页...');
    await generateIndex(provinceData);

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
