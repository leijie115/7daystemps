#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通过高德地图 API 获取城市的准确 adcode
"""

import json
import re
import requests
import time
from pypinyin import lazy_pinyin, Style

# 高德地图 API 配置
AMAP_KEY = "15acbb85746712e59bba5f773a8e73aa"
AMAP_API_URL = "https://restapi.amap.com/v3/config/district"

def to_title_pinyin(chinese_name):
    """
    将中文名称转换为拼音，首字母大写
    """
    pinyin_list = lazy_pinyin(chinese_name, style=Style.NORMAL)
    result = ''.join([p.capitalize() for p in pinyin_list])
    return result

def get_districts_from_amap(province_name):
    """
    通过高德地图 API 获取省份下所有城市/区县的信息
    """
    try:
        params = {
            'keywords': province_name,
            'subdistrict': 2,  # 返回下两级行政区
            'key': AMAP_KEY,
            'output': 'JSON',
            'extensions': 'base'
        }

        response = requests.get(AMAP_API_URL, params=params, timeout=10)
        data = response.json()

        if data.get('status') == '1' and data.get('districts'):
            province_info = data['districts'][0]

            # 收集所有的区县级行政区
            all_districts = []

            # 第一级：市级
            for city in province_info.get('districts', []):
                all_districts.append(city)
                # 第二级：区县级
                for district in city.get('districts', []):
                    all_districts.append(district)

            return all_districts

        return []

    except Exception as e:
        print(f"  ⚠ 获取 {province_name} 的行政区信息时出错: {e}")
        return []

def find_matching_adcode(city_name, districts):
    """
    在返回的行政区列表中查找匹配的 adcode
    """
    # 完全匹配
    for district in districts:
        district_name = district['name']
        # 去除"市"、"区"、"县"等后缀进行匹配
        clean_district = district_name.replace('市', '').replace('区', '').replace('县', '').replace('自治州', '').replace('地区', '').replace('盟', '')
        clean_city = city_name.replace('市', '').replace('区', '').replace('县', '')

        if clean_city == clean_district or city_name in district_name or district_name in city_name:
            return district['adcode']

    # 模糊匹配
    for district in districts:
        district_name = district['name']
        if city_name in district_name:
            return district['adcode']

    return None

def main():
    print("开始从高德地图 API 获取城市 adcode...")

    # 读取 provinces.js 文件
    with open('provinces.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 提取 module.exports = [...] 中的数组部分
    match = re.search(r'module\.exports\s*=\s*(\[.*\])', content, re.DOTALL)
    if not match:
        print("无法解析文件格式")
        return

    # 解析 JSON 数据
    provinces_data = json.loads(match.group(1))

    total_provinces = len(provinces_data)
    total_cities = 0
    updated_cities = 0
    failed_cities = []

    # 更新每个省份的城市数据
    for idx, province in enumerate(provinces_data, 1):
        province_name = province['name']
        cities = province.get('cities', [])

        print(f"\n[{idx}/{total_provinces}] 处理 {province_name} ({len(cities)} 个城市)")

        # 从高德地图获取该省份下的所有行政区
        print(f"  正在从高德地图获取 {province_name} 的行政区信息...")
        districts = get_districts_from_amap(province_name)

        if districts:
            print(f"  ✓ 获取到 {len(districts)} 个下级行政区")
        else:
            print(f"  ✗ 未能获取到行政区信息，将使用默认值")

        # 为每个城市匹配 adcode
        for city in cities:
            total_cities += 1
            city_name = city['name']

            # 添加 en_name (拼音化，首字母大写)
            city['en_name'] = to_title_pinyin(city_name)

            # 在获取的行政区列表中查找匹配的 adcode
            if districts:
                adcode = find_matching_adcode(city_name, districts)

                if adcode:
                    city['adcode'] = adcode
                    updated_cities += 1
                    print(f"    ✓ {city_name} -> {adcode}")
                else:
                    # 如果找不到匹配，使用省级 adcode
                    city['adcode'] = province.get('adcode', '000000')
                    failed_cities.append(f"{province_name}-{city_name}")
                    print(f"    ✗ {city_name} -> 未找到匹配，使用 {city['adcode']}")
            else:
                # 如果没有获取到行政区信息，使用省级 adcode
                city['adcode'] = province.get('adcode', '000000')
                failed_cities.append(f"{province_name}-{city_name}")

        # 添加延迟，避免 API 限流
        time.sleep(0.2)

    # 将更新后的数据转换回 JavaScript 格式
    updated_json = json.dumps(provinces_data, ensure_ascii=False, indent=2)

    # 重新构建文件内容
    header = """/**
 * 中国省份和城市列表
 * 数据来源: 中国气象局API
 * 更新时间: 2026-01-14
 */


module.exports = """

    # 写回文件
    with open('provinces.js', 'w', encoding='utf-8') as f:
        f.write(header + updated_json)

    print("\n" + "="*60)
    print("✓ 处理完成！")
    print(f"✓ 共处理 {total_provinces} 个省份")
    print(f"✓ 共处理 {total_cities} 个城市")
    print(f"✓ 成功匹配 {updated_cities} 个城市的 adcode ({updated_cities/total_cities*100:.1f}%)")

    if failed_cities:
        print(f"\n⚠ 以下 {len(failed_cities)} 个城市未找到匹配（使用省级 adcode）：")
        for city in failed_cities[:20]:
            print(f"  - {city}")
        if len(failed_cities) > 20:
            print(f"  ... 还有 {len(failed_cities) - 20} 个")

if __name__ == '__main__':
    main()
