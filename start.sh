#!/bin/bash

# 获取今天的日期（格式：YYYYMMDD）
TODAY=$(date +%Y%m%d)


# 运行生成脚本
echo "🚀 开始生成静态页面..."
/usr/local/bin/node backend/generate-html.js

if [ $? -ne 0 ]; then
    echo "❌ 生成失败，退出"
    exit 1
fi

echo ""
echo "📦 提交到 Git..."

git add --all

# 检查是否有需要提交的内容
if git diff --cached --quiet; then
    echo "ℹ️  没有需要提交的更改"
else
    git commit -m "Update weather data for $(date +%Y-%m-%d)"
    git push origin
    echo "✅ 已推送到远程仓库"
fi

echo ""
echo "✨ 全部完成！"
