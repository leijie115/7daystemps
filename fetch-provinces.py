#!/usr/bin/env python3
"""
从中国气象局API获取省市数据
并保存到provinces.js文件
"""

import urllib.request
import json
import time
from datetime import datetime

def fetch_data(url):
    """获取数据的辅助函数"""
    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://weather.cma.cn/'
            }
        )
        with urllib.request.urlopen(req) as response:
            data = response.read().decode('utf-8')
            return json.loads(data)
    except Exception as e:
        print(f"请求失败: {e}")
        return None

def parse_province_data(data_str):
    """解析省份数据"""
    provinces = []
    items = data_str.split('|')

    for item in items:
        parts = item.split(',')
        if len(parts) == 2:
            code, name = parts
            provinces.append({'code': code, 'name': name})

    return provinces

def parse_city_data(data_str):
    """解析城市数据"""
    cities = []
    items = data_str.split('|')

    for item in items:
        parts = item.split(',')
        if len(parts) == 2:
            station_id, name = parts
            cities.append({'name': name, 'stationId': station_id})

    return cities

def main():
    """主函数"""
    try:
        print('开始获取省份数据...')

        # 1. 获取所有省份
        province_result = fetch_data('https://weather.cma.cn/api/dict/province')

        if not province_result or province_result.get('code') != 0:
            raise Exception('获取省份数据失败')

        provinces = parse_province_data(province_result['data'])
        print(f'成功获取 {len(provinces)} 个省份')

        # 2. 获取每个省份的城市数据
        result = []

        for i, province in enumerate(provinces):
            print(f"正在获取 {province['name']} 的城市数据... ({i + 1}/{len(provinces)})")

            try:
                city_result = fetch_data(f"https://weather.cma.cn/api/dict/province/{province['code']}")

                if city_result and city_result.get('code') == 0:
                    cities = parse_city_data(city_result['data'])
                    result.append({
                        'name': province['name'],
                        'code': province['code'],
                        'cities': cities
                    })
                    print(f"  成功获取 {len(cities)} 个城市")
                else:
                    print(f"  获取 {province['name']} 城市数据失败")
                    result.append({
                        'name': province['name'],
                        'code': province['code'],
                        'cities': []
                    })

                # 添加延迟避免请求过快
                time.sleep(0.2)

            except Exception as error:
                print(f"  获取 {province['name']} 城市数据出错: {error}")
                result.append({
                    'name': province['name'],
                    'code': province['code'],
                    'cities': []
                })

        # 3. 生成provinces.js文件
        print('\n开始生成provinces.js文件...')

        content = f"""/**
 * 中国省份和城市列表
 * 数据来源: 中国气象局API
 * 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
 */

module.exports = {json.dumps(result, ensure_ascii=False, indent=2)};
"""

        with open('provinces.js', 'w', encoding='utf-8') as f:
            f.write(content)

        print('provinces.js 文件生成成功!')

        # 4. 输出统计信息
        total_cities = sum(len(province['cities']) for province in result)
        print(f'\n统计信息:')
        print(f'  省份总数: {len(result)}')
        print(f'  城市总数: {total_cities}')

    except Exception as error:
        print(f'发生错误: {error}')
        exit(1)

if __name__ == '__main__':
    main()
