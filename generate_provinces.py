#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成省份和城市配置文件
数据来源：
1. 省份列表来自 NMC 官网
2. 城市列表通过 API 获取
3. adcode 从阿里云地图数据匹配
"""

import requests
import json
import time
from pypinyin import lazy_pinyin, Style

# 第一级：省份数据
PROVINCES = [
    {'code': 'ABJ', 'name': '北京市', 'en_name': 'Beijing'},
    {'code': 'ATJ', 'name': '天津市', 'en_name': 'Tianjin'},
    {'code': 'AHE', 'name': '河北省', 'en_name': 'Hebei'},
    {'code': 'ASX', 'name': '山西省', 'en_name': 'Shanxi'},
    {'code': 'ANM', 'name': '内蒙古自治区', 'en_name': 'Neimenggu'},
    {'code': 'ALN', 'name': '辽宁省', 'en_name': 'Liaoning'},
    {'code': 'AJL', 'name': '吉林省', 'en_name': 'Jilin'},
    {'code': 'AHL', 'name': '黑龙江省', 'en_name': 'Heilongjiang'},
    {'code': 'ASH', 'name': '上海市', 'en_name': 'Shanghai'},
    {'code': 'AJS', 'name': '江苏省', 'en_name': 'Jiangsu'},
    {'code': 'AZJ', 'name': '浙江省', 'en_name': 'Zhejiang'},
    {'code': 'AAH', 'name': '安徽省', 'en_name': 'Anhui'},
    {'code': 'AFJ', 'name': '福建省', 'en_name': 'Fujian'},
    {'code': 'AJX', 'name': '江西省', 'en_name': 'Jiangxi'},
    {'code': 'ASD', 'name': '山东省', 'en_name': 'Shandong'},
    {'code': 'AHA', 'name': '河南省', 'en_name': 'Henan'},
    {'code': 'AHB', 'name': '湖北省', 'en_name': 'Hubei'},
    {'code': 'AHN', 'name': '湖南省', 'en_name': 'Hunan'},
    {'code': 'AGD', 'name': '广东省', 'en_name': 'Guangdong'},
    {'code': 'AGX', 'name': '广西壮族自治区', 'en_name': 'Guangxi'},
    {'code': 'AHI', 'name': '海南省', 'en_name': 'Hainan'},
    {'code': 'ACQ', 'name': '重庆市', 'en_name': 'Chongqing'},
    {'code': 'ASC', 'name': '四川省', 'en_name': 'Sichuan'},
    {'code': 'AGZ', 'name': '贵州省', 'en_name': 'Guizhou'},
    {'code': 'AYN', 'name': '云南省', 'en_name': 'Yunnan'},
    {'code': 'AXZ', 'name': '西藏自治区', 'en_name': 'Xizang'},
    {'code': 'ASN', 'name': '陕西省', 'en_name': 'Shaanxi'},
    {'code': 'AGS', 'name': '甘肃省', 'en_name': 'Gansu'},
    {'code': 'AQH', 'name': '青海省', 'en_name': 'Qinghai'},
    {'code': 'ANX', 'name': '宁夏回族自治区', 'en_name': 'Ningxia'},
    {'code': 'AXJ', 'name': '新疆维吾尔自治区', 'en_name': 'Xinjiang'},
    {'code': 'AXG', 'name': '香港特别行政区', 'en_name': 'Hongkong'},
    {'code': 'AAM', 'name': '澳门特别行政区', 'en_name': 'Aomen'},
    {'code': 'ATW', 'name': '台湾省', 'en_name': 'Taiwan'}
]


def to_pinyin(text):
    """
    将中文转为拼音，每个字首字母大写
    """
    pinyin_list = lazy_pinyin(text, style=Style.NORMAL)
    return ''.join([py.capitalize() for py in pinyin_list])


def get_cities(province_code):
    """
    获取省份的城市列表
    """
    timestamp = int(time.time() * 1000)
    url = f'https://www.nmc.cn/rest/province/{province_code}?_={timestamp}'

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        cities_data = response.json()

        cities = []
        for city in cities_data:
            cities.append({
                'name': city['city'],
                'full_name': city['city'],  # 默认和 name 一样，稍后从阿里云数据更新
                'en_name': to_pinyin(city['city']),
                'code': city['code'],
                'url': city['url'],
                'adcode': ''  # 稍后填充
            })

        return cities
    except Exception as e:
        print(f'  ✗ 获取城市列表失败: {e}')
        return []


def get_province_adcode_map():
    """
    从阿里云获取省级 adcode 映射（第一级）
    """
    url = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'

    try:
        print('正在获取省级 adcode 数据...')
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()

        adcode_map = {}

        # 解析省级数据
        if 'features' in data:
            for feature in data['features']:
                props = feature.get('properties', {})
                name = props.get('name')
                adcode = props.get('adcode')

                if name and adcode:
                    adcode_map[name] = {
                        'adcode': adcode,
                        'level': props.get('level', ''),
                        'parent': props.get('parent', {})
                    }

        print(f'✓ 已获取 {len(adcode_map)} 个省级 adcode')
        return adcode_map

    except Exception as e:
        print(f'✗ 获取省级 adcode 数据失败: {e}')
        return {}


def find_adcode(name, adcode_map, is_province=True):
    """
    查找匹配的 adcode
    """
    # 精确匹配
    if name in adcode_map:
        return adcode_map[name]['adcode']

    # 模糊匹配
    name_short = name.replace('省', '').replace('市', '').replace('自治区', '').replace('特别行政区', '')

    for key, value in adcode_map.items():
        key_short = key.replace('省', '').replace('市', '').replace('自治区', '').replace('特别行政区', '')
        if name_short == key_short or name_short in key or key_short in name_short:
            return value['adcode']

    return ''


def fetch_city_adcodes(province_adcode, cities):
    """
    获取城市级别的 adcode 和 full_name（第二级）
    从阿里云获取该省份下的所有城市数据
    返回过滤后的城市列表（只保留在阿里云数据中存在的城市）
    如果请求失败或无匹配城市，返回空列表
    """
    if not province_adcode:
        return []

    try:
        # 获取省份下的所有城市/区县数据
        url = f'https://geo.datav.aliyun.com/areas_v3/bound/{province_adcode}_full.json'
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()

        city_data_map = {}

        # 解析城市数据，保存 name 和 adcode
        if 'features' in data:
            for feature in data['features']:
                props = feature.get('properties', {})
                name = props.get('name')
                adcode = props.get('adcode')

                if name and adcode:
                    city_data_map[name] = {
                        'adcode': adcode,
                        'full_name': name
                    }

        # 过滤并匹配城市的 adcode 和 full_name
        filtered_cities = []

        for city in cities:
            city_name = city['name']
            matched = False

            # 精确匹配
            if city_name in city_data_map:
                city['adcode'] = city_data_map[city_name]['adcode']
                city['full_name'] = city_data_map[city_name]['full_name']
                matched = True

            # 添加"市"后缀匹配
            elif city_name + '市' in city_data_map:
                city['adcode'] = city_data_map[city_name + '市']['adcode']
                city['full_name'] = city_data_map[city_name + '市']['full_name']
                matched = True

            # 添加"区"后缀匹配
            elif city_name + '区' in city_data_map:
                city['adcode'] = city_data_map[city_name + '区']['adcode']
                city['full_name'] = city_data_map[city_name + '区']['full_name']
                matched = True

            # 添加"县"后缀匹配
            elif city_name + '县' in city_data_map:
                city['adcode'] = city_data_map[city_name + '县']['adcode']
                city['full_name'] = city_data_map[city_name + '县']['full_name']
                matched = True

            # 模糊匹配
            else:
                for key, data_item in city_data_map.items():
                    if city_name in key or key in city_name:
                        city['adcode'] = data_item['adcode']
                        city['full_name'] = data_item['full_name']
                        matched = True
                        break

            # 只保留匹配到的城市
            if matched:
                filtered_cities.append(city)

        return filtered_cities

    except Exception as e:
        print(f'    获取城市 adcode 失败: {e}')
        return []  # 如果请求失败，返回空列表


def main():
    """
    主函数
    """
    print('=' * 60)
    print('开始生成省份配置文件')
    print('保留所有省份，城市列表仅包含阿里云数据中存在的城市')
    print('=' * 60)

    # 第一步：获取省级 adcode 映射
    province_adcode_map = get_province_adcode_map()
    print()

    result = []
    original_province_count = len(PROVINCES)
    filtered_province_count = 0

    # 遍历每个省份
    for i, province in enumerate(PROVINCES, 1):
        print(f'[{i}/{len(PROVINCES)}] 处理省份: {province["name"]} ({province["code"]})')

        # 查找省份 adcode（第一级过滤：省份必须在阿里云数据中存在）
        province_adcode = find_adcode(province['name'], province_adcode_map, is_province=True)

        if not province_adcode:
            print(f'  ✗ 省份不在阿里云数据中，跳过')
            print()
            continue

        print(f'  ✓ 省份 adcode: {province_adcode}')

        # 获取城市列表
        cities = get_cities(province['code'])
        original_city_count = len(cities)
        print(f'  ✓ 从 NMC 获取到 {original_city_count} 个城市')

        # 第二步：获取该省份下所有城市的 adcode 和 full_name（第二级过滤）
        filtered_cities = []

        if cities:
            print(f'  正在从阿里云获取城市数据并过滤...')
            filtered_cities = fetch_city_adcodes(province_adcode, cities)
            filtered_city_count = len(filtered_cities)
            removed_count = original_city_count - filtered_city_count

            print(f'  ✓ 保留 {filtered_city_count} 个城市，移除 {removed_count} 个未匹配城市')

            if not filtered_cities:
                print(f'  ⚠ 该省份没有匹配的城市，cities 将设置为空数组')
        else:
            print(f'  ⚠ 未获取到城市数据，cities 将设置为空数组')

        # 无论是否有城市，都添加省份到结果中
        result.append({
            'name': province['name'],
            'en_name': province['en_name'],
            'code': province['code'],
            'adcode': province_adcode,
            'cities': filtered_cities  # 可能为空数组
        })
        filtered_province_count += 1

        # 添加延迟，避免请求过快
        if i < len(PROVINCES):
            time.sleep(1)

        print()

    # 生成 JavaScript 文件
    file_content = f"""/**
 * 中国省份和城市配置
 * 包含省份的adcode、英文名称、城市列表等信息
 * 保留所有在阿里云地图中存在的省份
 * 城市列表仅包含在阿里云地图数据中存在的城市（部分省份的cities可能为空数组）
 * 自动生成时间: {time.strftime('%Y-%m-%d %H:%M:%S')}
 */

module.exports = {json.dumps(result, ensure_ascii=False, indent=2)};
"""

    # 写入文件
    output_file = 'provinces.js'
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(file_content)

    print('=' * 60)
    print(f'✓ 配置文件已生成: {output_file}')
    print('=' * 60)

    # 统计信息
    total_cities = sum(len(p['cities']) for p in result)
    provinces_with_cities = sum(1 for p in result if len(p['cities']) > 0)
    provinces_without_cities = filtered_province_count - provinces_with_cities

    print(f'\n统计信息:')
    print(f'  原始省份数量: {original_province_count}')
    print(f'  保留省份数量: {filtered_province_count}')
    print(f'  有城市数据的省份: {provinces_with_cities}')
    print(f'  无城市数据的省份: {provinces_without_cities}')
    print(f'  城市总数: {total_cities}')
    print(f'  数据完整性: 所有城市都有 adcode ✓')


if __name__ == '__main__':
    main()
