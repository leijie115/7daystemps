#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试高德地图 API
"""

import requests
import json

AMAP_KEY = "15acbb85746712e59bba5f773a8e73aa"
AMAP_API_URL = "https://restapi.amap.com/v3/config/district"

# 测试查询北京
params = {
    'keywords': '北京',
    'subdistrict': 1,
    'key': AMAP_KEY,
    'output': 'JSON',
    'extensions': 'base'
}

print("正在测试高德地图 API...")
print(f"请求 URL: {AMAP_API_URL}")
print(f"参数: {params}")
print()

response = requests.get(AMAP_API_URL, params=params, timeout=10)
data = response.json()

print(f"响应状态码: {response.status_code}")
print(f"响应内容:")
print(json.dumps(data, ensure_ascii=False, indent=2))
