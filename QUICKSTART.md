# 快速启动指南

## ⚠️ 重要提示

在生成网站之前，需要先有数据！请按以下步骤操作：

## 步骤1：检查InfluxDB

确保InfluxDB正在运行：

```bash
# macOS
brew services list | grep influxdb

# 如果未运行，启动它
brew services start influxdb@1
```

## 步骤2：检查数据库状态

```bash
cd backend
node check-data.js
```

### 如果提示"数据库不存在"或"没有数据"

需要先运行爬虫获取数据：

```bash
node crawler.js
```

爬虫会：
- 自动创建数据库
- 爬取2400+个城市的天气数据
- 大约需要10-30分钟（取决于网络速度）

**等待爬虫完成后，再进行下一步！**

## 步骤3：生成静态网站

数据准备好后，生成HTML：

```bash
node generate-html.js
```

如果成功，你会看到：
```
✅ 主页生成完成
✅ 北京市 页面生成完成
✅ 上海市 页面生成完成
...
```

## 步骤4：启动服务器

```bash
npm start
```

然后访问：http://localhost:3123

## 常见问题

### Q1: "数据库连接失败"

**解决方案：**
```bash
# 确保InfluxDB正在运行
brew services start influxdb@1

# 检查端口
lsof -i :8086
```

### Q2: "省份数据为空"

**原因：** 数据库中没有数据

**解决方案：**
```bash
# 运行爬虫
node crawler.js

# 等待完成后再生成网站
node generate-html.js
```

### Q3: "爬虫太慢"

**原因：** 需要爬取2400+个城市

**建议：**
- 第一次运行耐心等待
- 后续会每小时自动更新
- 可以修改 `provinces.js` 减少城市数量

### Q4: 想只测试几个省份

编辑 `provinces.js`，只保留几个省份：

```javascript
module.exports = [
  {
    name: '北京市',
    cities: [{ name: '北京', stationId: '54511' }]
  },
  {
    name: '上海市',
    cities: [{ name: '上海', stationId: '58362' }]
  }
  // ... 其他省份可以删除
];
```

然后重新运行爬虫和生成器。

## 完整流程

```bash
# 1. 进入backend目录
cd backend

# 2. 检查数据（可选）
node check-data.js

# 3. 运行爬虫（首次必须）
node crawler.js

# 4. 生成网站
node generate-html.js

# 5. 启动服务器
npm start
```

## 自动化运行

启动服务器后，会自动：
- 每小时爬取新数据
- 每30分钟生成新网站
- 你只需要运行一次 `npm start`

---

如果遇到其他问题，请查看错误日志或联系技术支持。
