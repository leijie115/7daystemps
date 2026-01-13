#!/bin/bash

# InfluxDB 1.8 认证配置脚本
# 创建用户并启用认证

set -e

echo "========================================"
echo "InfluxDB 1.8 认证配置"
echo "========================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 配置参数
USERNAME="leos"
PASSWORD="leos12051519"
CONFIG_FILE="/usr/local/etc/influxdb.conf"

# 1. 检查 InfluxDB 服务状态
echo "步骤 1/5: 检查 InfluxDB 服务..."
if ! brew services list | grep -q "influxdb@1.*started"; then
    echo -e "${YELLOW}InfluxDB 服务未运行，正在启动...${NC}"
    brew services start influxdb@1
    sleep 3
fi
echo -e "${GREEN}✓ InfluxDB 服务运行中${NC}"
echo ""

# 2. 创建管理员账号
echo "步骤 2/5: 创建管理员账号..."
echo "用户名: $USERNAME"
echo "密码: ********"

# 使用 influx CLI 创建用户
influx -execute "CREATE USER $USERNAME WITH PASSWORD '$PASSWORD' WITH ALL PRIVILEGES" || {
    echo -e "${YELLOW}注意: 用户可能已存在，尝试更新密码...${NC}"
    influx -execute "SET PASSWORD FOR $USERNAME = '$PASSWORD'"
}

echo -e "${GREEN}✓ 管理员账号创建/更新成功${NC}"
echo ""

# 3. 验证用户创建
echo "步骤 3/5: 验证用户..."
USER_EXISTS=$(influx -execute "SHOW USERS" | grep -c "$USERNAME" || true)
if [ "$USER_EXISTS" -gt 0 ]; then
    echo -e "${GREEN}✓ 用户 $USERNAME 已存在${NC}"
    influx -execute "SHOW USERS"
else
    echo -e "${RED}✗ 用户创建失败${NC}"
    exit 1
fi
echo ""

# 4. 备份配置文件
echo "步骤 4/5: 备份配置文件..."
if [ -f "$CONFIG_FILE" ]; then
    BACKUP_FILE="${CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    sudo cp "$CONFIG_FILE" "$BACKUP_FILE"
    echo -e "${GREEN}✓ 配置已备份到: $BACKUP_FILE${NC}"
else
    echo -e "${RED}✗ 配置文件不存在: $CONFIG_FILE${NC}"
    exit 1
fi
echo ""

# 5. 启用认证
echo "步骤 5/5: 启用认证..."

# 检查认证是否已启用
if grep -q "auth-enabled = true" "$CONFIG_FILE"; then
    echo -e "${YELLOW}认证已经启用${NC}"
else
    # 修改配置文件启用认证
    echo "修改配置文件..."
    sudo sed -i '' 's/# auth-enabled = false/auth-enabled = true/' "$CONFIG_FILE"
    sudo sed -i '' 's/auth-enabled = false/auth-enabled = true/' "$CONFIG_FILE"

    echo -e "${GREEN}✓ 认证已启用${NC}"

    # 重启服务使配置生效
    echo ""
    echo "重启 InfluxDB 服务..."
    brew services restart influxdb@1
    sleep 3
    echo -e "${GREEN}✓ 服务已重启${NC}"
fi
echo ""

# 验证认证
echo "========================================"
echo "验证认证配置..."
echo "========================================"
echo ""

# 测试认证登录
if influx -username "$USERNAME" -password "$PASSWORD" -execute "SHOW DATABASES" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ 认证登录成功${NC}"
    echo ""
    echo "数据库列表:"
    influx -username "$USERNAME" -password "$PASSWORD" -execute "SHOW DATABASES"
else
    echo -e "${RED}✗ 认证登录失败${NC}"
fi

echo ""
echo "========================================"
echo "配置完成！"
echo "========================================"
echo ""
echo "认证信息："
echo "  用户名: $USERNAME"
echo "  密码: $PASSWORD"
echo ""
echo "连接示例："
echo "  CLI 连接: influx -username $USERNAME -password $PASSWORD"
echo "  HTTP 连接: curl -u $USERNAME:$PASSWORD http://localhost:8086/query?q=SHOW+DATABASES"
echo ""
echo "下一步："
echo "  请更新项目的 .env 文件，添加认证信息："
echo "  INFLUX_USERNAME=$USERNAME"
echo "  INFLUX_PASSWORD=$PASSWORD"
echo ""

echo -e "${GREEN}脚本执行完成！${NC}"
