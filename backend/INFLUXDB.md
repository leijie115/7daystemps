# InfluxDB 1.8 使用说明

本项目使用 InfluxDB 1.8 时序数据库存储天气数据。

## 数据库结构

### Measurement: weather

**Tags** (索引字段):
- `province` - 省份名称
- `city` - 城市名称
- `stationId` - 气象站ID
- `weatherCode` - 天气代码 (0-9)

**Fields** (数据字段):
- `temperature` - 温度 (float)
- `windDirection` - 风向 (string)
- `windSpeed` - 风速 (string)

**Timestamp**: 预报时间

## 常用 InfluxQL 查询

### 1. 查看所有数据库

```sql
SHOW DATABASES
```

### 2. 使用数据库

```sql
USE weather
```

### 3. 查看所有 measurements

```sql
SHOW MEASUREMENTS
```

### 4. 查看某个 measurement 的 tag keys

```sql
SHOW TAG KEYS FROM weather
```

### 5. 查看某个 tag 的所有值

```sql
SHOW TAG VALUES FROM weather WITH KEY = "province"
SHOW TAG VALUES FROM weather WITH KEY = "city"
```

### 6. 查询最近的数据

```sql
-- 查询最近10条数据
SELECT * FROM weather ORDER BY time DESC LIMIT 10

-- 查询最近1小时的数据
SELECT * FROM weather WHERE time > now() - 1h

-- 查询最近24小时的数据
SELECT * FROM weather WHERE time > now() - 24h
```

### 7. 查询特定城市的数据

```sql
-- 查询成都的数据
SELECT * FROM weather WHERE city = '成都'

-- 查询成都最近1天的数据
SELECT * FROM weather
WHERE city = '成都' AND time > now() - 1d
ORDER BY time DESC

-- 查询特定气象站的数据
SELECT * FROM weather WHERE stationId = 'S1003'
```

### 8. 聚合查询

```sql
-- 计算每个城市的平均温度
SELECT MEAN(temperature) as avg_temp
FROM weather
WHERE time > now() - 1h
GROUP BY city, province

-- 获取最高温度的城市（TOP 10）
SELECT MEAN(temperature) as avg_temp
FROM weather
WHERE time > now() - 1h
GROUP BY city, province
ORDER BY avg_temp DESC
LIMIT 10

-- 获取最低温度的城市（TOP 10）
SELECT MEAN(temperature) as avg_temp
FROM weather
WHERE time > now() - 1h
GROUP BY city, province
ORDER BY avg_temp ASC
LIMIT 10
```

### 9. 统计查询

```sql
-- 统计数据总数
SELECT COUNT(temperature) FROM weather

-- 统计各省数据量
SELECT COUNT(temperature) FROM weather GROUP BY province

-- 统计某城市的温度范围
SELECT
  MIN(temperature) as min_temp,
  MAX(temperature) as max_temp,
  MEAN(temperature) as avg_temp
FROM weather
WHERE city = '成都' AND time > now() - 7d
```

### 10. 时间范围查询

```sql
-- 查询特定时间范围
SELECT * FROM weather
WHERE time >= '2025-12-01' AND time <= '2025-12-31'

-- 查询今天的数据
SELECT * FROM weather
WHERE time >= now() - 1d

-- 按小时分组统计
SELECT MEAN(temperature) as avg_temp
FROM weather
WHERE time > now() - 7d
GROUP BY time(1h), city
```

## 数据保留策略 (Retention Policy)

### 查看当前保留策略

```sql
SHOW RETENTION POLICIES ON weather
```

### 创建保留策略

```sql
-- 创建一个保留30天数据的策略
CREATE RETENTION POLICY "30_days" ON "weather"
DURATION 30d
REPLICATION 1
DEFAULT

-- 创建一个保留90天数据的策略
CREATE RETENTION POLICY "90_days" ON "weather"
DURATION 90d
REPLICATION 1
```

### 修改保留策略

```sql
-- 修改默认保留策略为90天
ALTER RETENTION POLICY "autogen" ON "weather"
DURATION 90d
DEFAULT
```

## 性能优化

### 1. 使用 TAG 而非 FIELD

在查询中经常用作过滤条件的字段应该设为 TAG，例如：
- `province`, `city`, `stationId` 都是 TAG

### 2. 避免高基数 TAG

不要将唯一值过多的字段设为 TAG，例如不应该把温度值设为 TAG。

### 3. 使用 GROUP BY time()

对大量数据进行降采样：

```sql
-- 按小时分组
SELECT MEAN(temperature)
FROM weather
WHERE time > now() - 7d
GROUP BY time(1h), city

-- 按天分组
SELECT MEAN(temperature), MIN(temperature), MAX(temperature)
FROM weather
WHERE time > now() - 30d
GROUP BY time(1d), city
```

## 数据备份与恢复

### 备份数据

```bash
# 备份整个数据库
influxd backup -portable -database weather /path/to/backup

# 备份特定时间范围的数据
influxd backup -portable -database weather \
  -start 2025-12-01T00:00:00Z \
  -end 2025-12-31T23:59:59Z \
  /path/to/backup
```

### 恢复数据

```bash
# 恢复数据库
influxd restore -portable -db weather /path/to/backup
```

## 监控和管理

### 查看数据库统计

```sql
-- 查看数据量
SELECT COUNT(*) FROM weather

-- 查看每个城市的数据量
SELECT COUNT(*) FROM weather GROUP BY city

-- 查看数据时间范围
SELECT FIRST(temperature), LAST(temperature) FROM weather
```

### 删除数据

```sql
-- 删除某个城市的所有数据
DELETE FROM weather WHERE city = '成都'

-- 删除某个时间范围的数据
DELETE FROM weather WHERE time < '2025-01-01'

-- 删除整个 measurement（慎用）
DROP MEASUREMENT weather
```

## 常见问题

### Q: 如何查看数据库占用空间？

A: 在命令行中执行：
```bash
du -sh /var/lib/influxdb/data/weather
```

### Q: 数据写入速度慢怎么办？

A:
1. 批量写入数据点（已在代码中实现）
2. 调整 InfluxDB 配置文件中的缓存大小
3. 考虑使用 SSD

### Q: 查询速度慢怎么办？

A:
1. 确保查询条件中包含时间范围
2. 使用 TAG 作为过滤条件
3. 对历史数据进行降采样
4. 创建连续查询 (Continuous Query) 预先聚合数据

## 推荐配置

在 InfluxDB 配置文件 `/etc/influxdb/influxdb.conf` 中：

```toml
[data]
  # 数据目录
  dir = "/var/lib/influxdb/data"

  # WAL 目录
  wal-dir = "/var/lib/influxdb/wal"

  # 查询超时时间
  query-timeout = "0s"

  # 最大并发查询数
  max-concurrent-queries = 0

[http]
  # 启用 HTTP 服务
  enabled = true

  # 绑定地址
  bind-address = ":8086"

  # 启用认证（生产环境推荐）
  auth-enabled = false

  # 最大连接数
  max-connection-limit = 0
```

重启服务使配置生效：
```bash
sudo systemctl restart influxdb
```
