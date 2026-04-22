# 译文格式批量校对 - 使用说明

## 系统要求
- Windows 操作系统
- Node.js (LTS 版本推荐)
  - 下载地址: https://nodejs.org/

## 安装 Node.js
1. 访问 https://nodejs.org/ 下载 Windows 安装包
2. 运行安装程序，按提示完成安装
3. 打开命令提示符，输入以下命令验证安装:
   ```
   node --version
   ```

## 运行工具
1. 解压本压缩包到任意文件夹
2. 双击运行 `start.bat`
3. 等待窗口显示 "Please open your browser and go to: http://127.0.0.1:3001"
4. 打开浏览器，访问 http://127.0.0.1:3001

## 停止工具
在运行窗口中按 Ctrl+C，然后输入 Y 确认退出。

## 功能说明
- 上传 CSV 或 XLSX 文件
- 自动识别译文列
- 批量检查格式问题（破折号、引号省略号、空格等）
- 导出修正后的文件
