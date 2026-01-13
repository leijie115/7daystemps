#!/bin/bash

# InfluxDB 版本切换脚本
# 用途：卸载 InfluxDB 2.x 并安装 InfluxDB 1.8
# 系统：macOS

set -e  # 遇到错误立即退出

echo "========================================"
echo "InfluxDB 版本切换脚本"
echo "从 2.x 切换到 1.8"
echo "========================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. 检查当前安装的 InfluxDB 版本
echo "步骤 1/6: 检查当前 InfluxDB 版本..."
if brew list influxdb &>/dev/null; then
    CURRENT_VERSION=$(brew list --versions influxdb | awk '{print $2}')
    echo -e "${YELLOW}当前安装的版本: influxdb ${CURRENT_VERSION}${NC}"
else
    echo "未检测到通过 Homebrew 安装的 InfluxDB"
fi
echo ""

# 2. 停止 InfluxDB 2.x 服务
echo "步骤 2/6: 停止 InfluxDB 服务..."
if brew services list | grep -q "influxdb.*started"; then
    echo "正在停止 InfluxDB 服务..."
    brew services stop influxdb
    echo -e "${GREEN}✓ 服务已停止${NC}"
else
    echo "InfluxDB 服务未运行"
fi
echo ""

# 3. 备份 InfluxDB 2.x 数据（可选）
echo "步骤 3/6: 数据备份选项..."
read -p "是否备份 InfluxDB 2.x 数据？(y/n，默认n): " BACKUP_CHOICE
BACKUP_CHOICE=${BACKUP_CHOICE:-n}

if [[ "$BACKUP_CHOICE" == "y" || "$BACKUP_CHOICE" == "Y" ]]; then
    BACKUP_DIR="$HOME/influxdb2_backup_$(date +%Y%m%d_%H%M%S)"
    echo "备份目录: $BACKUP_DIR"

    if [ -d "$HOME/.influxdbv2" ]; then
        mkdir -p "$BACKUP_DIR"
        cp -r "$HOME/.influxdbv2" "$BACKUP_DIR/"
        echo -e "${GREEN}✓ 数据已备份到: $BACKUP_DIR${NC}"
    else
        echo -e "${YELLOW}未找到 InfluxDB 2.x 数据目录${NC}"
    fi
else
    echo "跳过备份"
fi
echo ""

# 4. 卸载 InfluxDB 2.x
echo "步骤 4/6: 卸载 InfluxDB 2.x..."
if brew list influxdb &>/dev/null; then
    echo "正在卸载 influxdb..."
    brew uninstall influxdb
    echo -e "${GREEN}✓ InfluxDB 2.x 已卸载${NC}"
else
    echo "InfluxDB 未安装或已卸载"
fi

# 询问是否删除数据目录
read -p "是否删除 InfluxDB 2.x 数据目录？(y/n，默认n): " DELETE_DATA
DELETE_DATA=${DELETE_DATA:-n}

if [[ "$DELETE_DATA" == "y" || "$DELETE_DATA" == "Y" ]]; then
    if [ -d "$HOME/.influxdbv2" ]; then
        rm -rf "$HOME/.influxdbv2"
        echo -e "${GREEN}✓ 数据目录已删除${NC}"
    fi
fi
echo ""

# 5. 安装 InfluxDB 1.8
echo "步骤 5/6: 安装 InfluxDB 1.8..."

# 检查是否已安装 influxdb@1
if brew list influxdb@1 &>/dev/null; then
    echo -e "${YELLOW}InfluxDB 1.8 已经安装${NC}"
else
    echo "正在安装 influxdb@1..."
    brew install influxdb@1
    echo -e "${GREEN}✓ InfluxDB 1.8 安装成功${NC}"
fi
echo ""

# 6. 启动 InfluxDB 1.8 服务
echo "步骤 6/6: 启动 InfluxDB 1.8 服务..."
brew services start influxdb@1
echo -e "${GREEN}✓ InfluxDB 1.8 服务已启动${NC}"
echo ""

# 等待服务启动
echo "等待服务启动..."
sleep 3

# 验证安装
echo "========================================"
echo "验证安装..."
echo "========================================"

# 检查服务状态
if brew services list | grep -q "influxdb@1.*started"; then
    echo -e "${GREEN}✓ InfluxDB 1.8 服务运行正常${NC}"
else
    echo -e "${RED}✗ InfluxDB 1.8 服务未运行${NC}"
fi

# 检查端口
if lsof -Pi :8086 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${GREEN}✓ InfluxDB 正在监听端口 8086${NC}"
else
    echo -e "${RED}✗ 端口 8086 未被监听${NC}"
fi

# 测试连接
echo ""
echo "测试 HTTP API 连接..."
if curl -s http://localhost:8086/ping > /dev/null 2>&1; then
    echo -e "${GREEN}✓ HTTP API 响应正常${NC}"
else
    echo -e "${RED}✗ HTTP API 无响应${NC}"
fi

echo ""
echo "========================================"
echo "安装完成！"
echo "========================================"
echo ""
echo "InfluxDB 1.8 信息："
echo "  - 版本: $(brew list --versions influxdb@1)"
echo "  - HTTP 端点: http://localhost:8086"
echo "  - 配置文件: /usr/local/etc/influxdb.conf"
echo "  - 数据目录: /usr/local/var/influxdb"
echo ""
echo "常用命令："
echo "  启动服务: brew services start influxdb@1"
echo "  停止服务: brew services stop influxdb@1"
echo "  重启服务: brew services restart influxdb@1"
echo "  进入 CLI: influx"
echo "  查看日志: brew services info influxdb@1"
echo ""
echo "下一步："
echo "  1. 进入项目目录: cd /Users/leos/Downloads/weather/backend"
echo "  2. 安装依赖: npm install"
echo "  3. 配置环境: cp .env.example .env"
echo "  4. 测试连接: npm test"
echo "  5. 运行爬虫: npm run crawler"
echo ""

# 可选：打开 InfluxDB CLI
read -p "是否打开 InfluxDB CLI？(y/n，默认n): " OPEN_CLI
OPEN_CLI=${OPEN_CLI:-n}

if [[ "$OPEN_CLI" == "y" || "$OPEN_CLI" == "Y" ]]; then
    echo ""
    echo "打开 InfluxDB CLI..."
    echo "提示：输入 'exit' 退出 CLI"
    echo ""
    influx
fi

echo -e "${GREEN}脚本执行完成！${NC}"
