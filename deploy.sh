#!/bin/bash
# 部署脚本 - 将website目录推送到deploy分支

echo "📦 准备部署到Cloudflare Pages..."

# 创建临时目录
TEMP_DIR=$(mktemp -d)
echo "临时目录: $TEMP_DIR"

# 复制website内容
cp -r website/* $TEMP_DIR/

# 切换到临时目录
cd $TEMP_DIR

# 初始化git
git init
git add .
git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')"

# 推送到deploy分支
git remote add origin $(git -C /Users/leos/Downloads/weather remote get-url origin)
git push -f origin HEAD:deploy

echo "✅ 部署完成！"
echo "请在Cloudflare Pages中将分支设置为 'deploy'"

# 清理
cd -
rm -rf $TEMP_DIR
