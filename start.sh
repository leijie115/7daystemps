#!/bin/bash

# 获取10天前的日期（格式：YYYYMMDD）
CUTOFF=$(date -v-10d +%Y%m%d 2>/dev/null || date -d '10 days ago' +%Y%m%d)

echo "🗑️  清理10天前的日期文件夹..."

# 删除 website 下10天前的日期文件夹
for dir in website/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]; do
    if [ -d "$dir" ]; then
        dirname=$(basename "$dir")
        if [ "$dirname" -lt "$CUTOFF" ]; then
            echo "  删除: $dir"
            rm -rf "$dir"
        fi
    fi
done

# 删除 website/zh-cn 下10天前的日期文件夹
for dir in website/zh-cn/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]; do
    if [ -d "$dir" ]; then
        dirname=$(basename "$dir")
        if [ "$dirname" -lt "$CUTOFF" ]; then
            echo "  删除: $dir"
            rm -rf "$dir"
        fi
    fi
done

echo "✅ 清理完成"
echo ""

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
