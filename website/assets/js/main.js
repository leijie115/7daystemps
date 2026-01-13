/**
 * 主JS文件
 */

// 初始化中国地图
function initChinaMap(mapData, minTemp, maxTemp) {
    const chartDom = document.getElementById('china-map');
    if (!chartDom) return;

    const myChart = echarts.init(chartDom);

    // 加载中国地图GeoJSON
    fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json')
        .then(response => response.json())
        .then(geoJson => {
            echarts.registerMap('china', geoJson);

            const option = {
                tooltip: {
                    trigger: 'item',
                    formatter: function(params) {
                        if (params.data) {
                            return `${params.name}<br/>温度: ${params.value}°C`;
                        }
                        return params.name;
                    }
                },
                visualMap: {
                    min: minTemp,
                    max: maxTemp,
                    text: ['高', '低'],
                    realtime: false,
                    calculable: true,
                    inRange: {
                        color: [
                            '#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8',
                            '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'
                        ]
                    },
                    textStyle: {
                        color: '#333'
                    },
                    left: 'left',
                    top: 'bottom'
                },
                series: [
                    {
                        name: '温度',
                        type: 'map',
                        map: 'china',
                        roam: true,
                        scaleLimit: {
                            min: 0.8,
                            max: 3
                        },
                        emphasis: {
                            label: {
                                show: true,
                                color: '#fff',
                                fontSize: 14,
                                fontWeight: 'bold'
                            },
                            itemStyle: {
                                areaColor: '#ffd700',
                                borderWidth: 2,
                                borderColor: '#fff'
                            }
                        },
                        select: {
                            label: {
                                show: true,
                                color: '#fff'
                            },
                            itemStyle: {
                                areaColor: '#ffd700'
                            }
                        },
                        itemStyle: {
                            borderColor: '#fff',
                            borderWidth: 1,
                            areaColor: '#e0e0e0'
                        },
                        label: {
                            show: false
                        },
                        data: mapData
                    }
                ]
            };

            myChart.setOption(option);

            // 点击省份跳转到详情页
            myChart.on('click', function(params) {
                if (params.data && params.data.name) {
                    window.location.href = `provinces/${encodeURIComponent(params.data.name)}.html`;
                }
            });

            // 响应式
            window.addEventListener('resize', function() {
                myChart.resize();
            });
        })
        .catch(error => {
            console.error('加载地图数据失败:', error);
            chartDom.innerHTML = '<div style="text-align:center;padding:100px;color:#999;">地图加载失败</div>';
        });
}

// 排行榜切换
document.addEventListener('DOMContentLoaded', function() {
    const tabs = document.querySelectorAll('.tab-btn');
    const rankings = document.querySelectorAll('.ranking-list');

    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const type = this.dataset.type;

            // 更新标签状态
            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            // 显示对应排行榜
            rankings.forEach(r => {
                if (r.id === `${type}-ranking`) {
                    r.classList.remove('hidden');
                } else {
                    r.classList.add('hidden');
                }
            });
        });
    });
});
