#!/bin/bash

# 获取今天的日期（格式：YYYYMMDD）
TODAY=$(date +%Y%m%d)

echo "🗑️  清理旧的日期文件夹..."

# 删除 website 下今天以前的日期文件夹
for dir in website/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]; do
    if [ -d "$dir" ]; then
        dirname=$(basename "$dir")
        if [ "$dirname" -lt "$TODAY" ]; then
            echo "  删除: $dir"
            rm -rf "$dir"
        fi
    fi
done

# 删除 website/zh-cn 下今天以前的日期文件夹
for dir in website/zh-cn/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]; do
    if [ -d "$dir" ]; then
        dirname=$(basename "$dir")
        if [ "$dirname" -lt "$TODAY" ]; then
            echo "  删除: $dir"
            rm -rf "$dir"
        fi
    fi
done

echo "✅ 清理完成"
echo ""

# 运行生成脚本
echo "🚀 开始生成静态页面..."
node backend/generate-html.js

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
