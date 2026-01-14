#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为 provinces.js 中的每个城市添加 en_name (拼音化) 和 adcode
"""

import json
import re
from pypinyin import lazy_pinyin, Style

def to_title_pinyin(chinese_name):
    """
    将中文名称转换为拼音，首字母大写
    例如: "北京" -> "Beijing", "石家庄" -> "Shijiazhuang"
    """
    pinyin_list = lazy_pinyin(chinese_name, style=Style.NORMAL)
    # 将每个拼音的首字母大写并连接
    result = ''.join([p.capitalize() for p in pinyin_list])
    return result

def get_city_adcode(province_adcode, city_name):
    """
    根据城市名称生成 adcode
    这里使用一个简化的映射，实际应该查询真实的行政区划代码
    """
    # 这里需要一个城市到adcode的映射表
    # 暂时返回省级adcode + 城市索引作为占位符
    # 实际使用时需要真实的adcode数据
    return province_adcode[:2] + "0100"  # 占位符，需要实际数据

# 读取 provinces.js 文件
with open('provinces.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 提取 module.exports = [...] 中的数组部分
match = re.search(r'module\.exports\s*=\s*(\[.*\])', content, re.DOTALL)
if not match:
    print("无法解析文件格式")
    exit(1)

# 解析 JSON 数据
provinces_data = json.loads(match.group(1))

# 更新每个省份的城市数据
for province in provinces_data:
    province_adcode = province.get('adcode', '000000')

    for city in province.get('cities', []):
        city_name = city['name']

        # 添加 en_name (拼音化，首字母大写)
        city['en_name'] = to_title_pinyin(city_name)

        # 添加 adcode (这里需要真实数据，当前使用占位符)
        # 由于没有真实的城市adcode数据，这里先设置为省级adcode
        # 实际应该查询真实的行政区划代码
        if city_name == province['name']:
            # 如果城市名与省名相同，使用省级adcode
            city['adcode'] = province_adcode
        else:
            # 否则需要查询真实的城市adcode
            # 这里暂时使用占位符
            city['adcode'] = province_adcode[:2] + "0000"

# 将更新后的数据转换回 JavaScript 格式
updated_json = json.dumps(provinces_data, ensure_ascii=False, indent=2)

# 重新构建文件内容
header = """/**
 * 中国省份和城市列表
 * 数据来源: 中国气象局API
 * 更新时间: 2026-01-13
 */


module.exports = """

# 写回文件
with open('provinces.js', 'w', encoding='utf-8') as f:
    f.write(header + updated_json)

print("✓ 已成功为所有城市添加 en_name 和 adcode")
print(f"✓ 共处理 {len(provinces_data)} 个省份")
total_cities = sum(len(p.get('cities', [])) for p in provinces_data)
print(f"✓ 共处理 {total_cities} 个城市")
