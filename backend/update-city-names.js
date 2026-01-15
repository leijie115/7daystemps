/**
 * 从阿里云DataV获取城市完整名称并更新provinces.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// 读取provinces.js
const provincesPath = path.join(__dirname, '../provinces.js');
const PROVINCES_DATA = require(provincesPath);

// 从URL获取JSON数据
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 处理单个省份
async function updateProvince(province) {
  if (!province.adcode) {
    console.log(`⚠️  跳过 ${province.name}（无adcode）`);
    return province;
  }

  console.log(`🔍 处理 ${province.full_name || province.name}...`);

  try {
    const url = `https://geo.datav.aliyun.com/areas_v3/bound/${province.adcode}_full.json`;
    const geoJson = await fetchJSON(url);

    if (!geoJson.features || geoJson.features.length === 0) {
      console.log(`  ⚠️  无地理数据`);
      return province;
    }

    // 创建名称映射
    const fullNameMap = {};
    geoJson.features.forEach(feature => {
      const fullName = feature.properties.name;
      // 移除后缀得到简称
      const shortName = fullName.replace(/(市|区|县|自治县|旗|自治旗)$/g, '');
      fullNameMap[shortName] = fullName;

      // 同时记录全称到全称的映射
      fullNameMap[fullName] = fullName;
    });

    console.log(`  📍 找到 ${Object.keys(fullNameMap).length / 2} 个区域`);

    // 更新cities的full_name
    if (province.cities && Array.isArray(province.cities)) {
      province.cities = province.cities.map(city => {
        const fullName = fullNameMap[city.name] || fullNameMap[city.name + '市'] || fullNameMap[city.name + '区'] || fullNameMap[city.name + '县'];

        if (fullName && fullName !== city.name) {
          console.log(`    ✓ ${city.name} → ${fullName}`);
          return {
            ...city,
            full_name: fullName
          };
        } else if (!city.full_name) {
          // 如果找不到，至少设置为当前名称
          return {
            ...city,
            full_name: city.name
          };
        }
        return city;
      });
    }

    console.log(`  ✅ ${province.full_name || province.name} 完成`);
    return province;

  } catch (error) {
    console.error(`  ❌ 错误: ${error.message}`);
    return province;
  }
}

// 主函数
async function main() {
  console.log('🚀 开始更新城市完整名称...\n');

  const updatedProvinces = [];

  for (const province of PROVINCES_DATA) {
    const updated = await updateProvince(province);
    updatedProvinces.push(updated);
    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // 写回文件
  const newContent = `/**
 * 中国省份和城市配置
 * 包含省份的adcode、英文名称、城市列表等信息
 */

module.exports = ${JSON.stringify(updatedProvinces, null, 2)};
`;

  fs.writeFileSync(provincesPath, newContent, 'utf8');

  console.log('\n✨ 更新完成！');
  console.log(`📁 文件已保存: ${provincesPath}`);
}

main().catch(console.error);
