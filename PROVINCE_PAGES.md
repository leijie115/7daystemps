# 省份详情页面功能

## 功能概述

已成功实现省份详情页面功能！现在用户可以：

1. 在首页地图上点击任意省份
2. 自动跳转到该省份的详细页面
3. 查看该省份下所有城市的温度排行榜
4. 查看省份地图（显示各个城市的温度分布）
5. 查看每个城市的7天温度预报
6. 使用底部日期选择器切换不同日期

## 页面布局

省份详情页面的布局与首页完全一致：

- **左侧**：省份地图（显示该省各城市的温度分布）
- **右侧**：城市排行榜（显示该省所有城市的温度排名）
- **顶部**：返回按钮、主题切换、语言切换、温度图例
- **底部**：日期选择器（今天 + 未来6天）
- **每个城市**：点击可展开查看7天温度预报

## 文件结构

```
website/
├── index.html                 # 首页（全国省份排行）
├── 20260115/index.html       # 未来某日的全国页面
├── 20260116/index.html       # 未来某日的全国页面
├── ...
├── beijing.html              # 北京市省份详情页
├── shanghai.html             # 上海市省份详情页
├── guangdong.html            # 广东省省份详情页
├── sichuan.html              # 四川省省份详情页
└── ...                       # 其他34个省份页面
```

**命名规则**：使用 `provinces.js` 中的 `en_name` 字段小写，去除空格
- 北京市 → `beijing.html`
- 上海市 → `shanghai.html`
- 内蒙古自治区 → `innermongolia.html`（Inner Mongolia → innermongolia）

## 使用方法

### 生成所有页面

```bash
cd backend
node generate-html.js
```

这将生成：
- 首页和未来7天的全国页面
- 所有34个省份的详情页面

### 访问省份页面

1. **从首页跳转**：点击地图上的任意省份，自动跳转到对应的省份页面
2. **直接访问**：在浏览器中打开 `website/{省份英文名小写}.html`

例如：
- 北京市：`website/beijing.html`
- 上海市：`website/shanghai.html`
- 广东省：`website/guangdong.html`
- 四川省：`website/sichuan.html`

## 功能特性

### 1. 响应式设计
- 移动端和桌面端完美适配
- 地图和排行榜自动调整布局

### 2. 主题支持
- 支持深色/浅色主题切换
- 主题选择自动保存到 localStorage

### 3. 多语言
- 支持中英文切换
- 城市名称、天气描述、界面文字全部支持双语

### 4. 交互功能
- 点击城市展开/折叠7天预报
- 高温/低温排序切换
- 地图悬停显示温度详情
- 返回首页按钮
- 底部日期选择器（切换到全国页面的不同日期）

### 5. 数据可视化
- 温度颜色映射（-10°C以下到35°C以上的渐变）
- 7天温度趋势柱状图
- 地图区域颜色根据温度动态变化

## 技术实现

### 1. 数据库查询

新增了以下数据查询函数：

- `getCityTemperaturesByDate()` - 获取指定省份在指定日期的所有城市温度数据
- `getCityForecast()` - 获取指定省份所有城市的7天预报数据

### 2. 页面生成

- `generateProvincePage()` - 生成单个省份的详情页面
- `generateAllProvincePages()` - 生成所有省份的详情页面

### 3. 地图加载

使用高德地图的 GeoJSON 数据：
- 首页：`https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json` (全国地图)
- 省份页：`https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json` (省份地图)

每个省份的 `adcode` 从 `provinces.js` 中获取。

### 4. 地图点击事件

首页地图点击事件实现：

```javascript
window.myMapChart.on('click', function(params) {
    const provinceName = params.name;

    // 查找对应的英文名称
    let enName = provinceName;
    for (const [key, value] of Object.entries(window.provinceNameMap)) {
        if (value.fullName === provinceName || value.zh === provinceName) {
            enName = value.en;
            break;
        }
    }

    // 跳转到省份页面
    const fileName = enName.toLowerCase().replace(/\s+/g, '') + '.html';
    window.location.href = fileName;
});
```

### 5. 日期选择器

省份页面底部的日期选择器：
- **今天**按钮处于激活状态（蓝色高亮）
- 点击其他日期会跳转到全国页面对应的日期
- 链接格式：`index.html`（今天）或 `{YYYYMMDD}/index.html`（未来日期）

## 数据要求

省份详情页面需要以下数据：
- **城市温度数据**：来自 InfluxDB `weather` 表
- **省份配置**：来自 `provinces.js`，包含：
  - `name`：省份简称（用于数据库查询，如"北京"）
  - `full_name`：省份全称（如"北京市"）
  - `en_name`：英文名称（如"Beijing"，用于文件命名）
  - `adcode`：高德地图省份代码（用于加载省份地图）

⚠️ **重要**：数据库中的 `province` 字段必须使用简称（如"北京"而非"北京市"），才能正确匹配数据。

## 已生成的省份页面

共34个省份页面：

| 省份 | 文件名 | 省份 | 文件名 |
|------|--------|------|--------|
| 北京市 | beijing.html | 天津市 | tianjin.html |
| 河北省 | hebei.html | 山西省 | shanxi.html |
| 内蒙古自治区 | innermongolia.html | 辽宁省 | liaoning.html |
| 吉林省 | jilin.html | 黑龙江省 | heilongjiang.html |
| 上海市 | shanghai.html | 江苏省 | jiangsu.html |
| 浙江省 | zhejiang.html | 安徽省 | anhui.html |
| 福建省 | fujian.html | 江西省 | jiangxi.html |
| 山东省 | shandong.html | 河南省 | henan.html |
| 湖北省 | hubei.html | 湖南省 | hunan.html |
| 广东省 | guangdong.html | 广西壮族自治区 | guangxi.html |
| 海南省 | hainan.html | 重庆市 | chongqing.html |
| 四川省 | sichuan.html | 贵州省 | guizhou.html |
| 云南省 | yunnan.html | 西藏自治区 | tibet.html |
| 陕西省 | shaanxi.html | 甘肃省 | gansu.html |
| 青海省 | qinghai.html | 宁夏回族自治区 | ningxia.html |
| 新疆维吾尔自治区 | xinjiang.html | 香港特别行政区 | hongkong.html |
| 澳门特别行政区 | macau.html | 台湾省 | taiwan.html |

## 修改的文件

主要修改文件：`backend/generate-html.js`

### 新增函数
1. `getCityTemperaturesByDate()` - 按日期查询城市温度（带风速和天气）
2. `getCityForecast()` - 查询城市7天预报
3. `generateProvincePage()` - 生成省份详情页面
4. `generateAllProvincePages()` - 批量生成所有省份页面

### 修改的函数
1. `getCityTemperatures()` - 增加风速和天气描述字段
2. `main()` - 添加省份页面生成调用

## 下一步优化建议

1. ✅ ~~添加省份页面的日期切换功能~~ （已完成）
2. 支持城市详情页面（第三级页面）
3. 添加数据缓存，提高加载速度
4. 添加面包屑导航（首页 > 省份 > 城市）
5. 支持省份页面的未来日期版本（如 `beijing-20260115.html`）
6. 添加省份之间的快速切换功能
