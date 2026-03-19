# Invoice Reader — Optimum Group
AI 发票读取 + 自动换算马币 + 导出 Claim Master Sheet

---

## 🚀 直接运行（无需打包）

### 第一次使用：
```
pip install -r requirements.txt
```

### 启动软件：
```
python main.py
```
软件会自动打开浏览器 → http://localhost:7788

---

## 📦 打包成桌面软件（.exe / .app）

### Windows → .exe
```
build_windows.bat
```
生成路径：`dist\Invoice Reader.exe`
双击即可运行，无需安装 Python。

### Mac → .app
```
chmod +x build_mac.sh
./build_mac.sh
```
生成路径：`dist/Invoice Reader`

---

## ⚙️ 设置 API Key

1. 打开软件，点击右上角 **⚙️ API Key**
2. 输入你的 Anthropic API Key（sk-ant-api03-...）
3. 获取 Key：https://console.anthropic.com/account/keys
4. Key 只存在本机，不会上传

---

## 📋 功能说明

| 功能 | 说明 |
|---|---|
| 上传发票 | 拖拽或点击，支持 JPG/PNG/PDF |
| AI 识别 | 自动提取供应商、发票号、日期、金额、货币 |
| 汇率换算 | USD/CNY/SGD/EUR/GBP 实时换算成 RM |
| 原价备注 | Description 自动加注原始货币和金额 |
| 表格编辑 | Branch/Category/Description 均有下拉选项 |
| 导出 Excel | 格式完全匹配 Claim Master Sheet |

---

## 📊 Excel 导出列（与 Claim Master Sheet 完全一致）

BRANCH | SUPPLIERS NAME | INVOICE NO. | INVOICE DATE | CATEGORY | DESCRIPTION | AMOUNT (RM) | CLAIM DATE

---

## 🔧 技术架构

- **Python Flask** — 后端服务（本机运行，端口 7788）
- **Anthropic API** — AI 发票识别（Claude claude-opus-4-6）
- **openpyxl** — Excel 生成
- **exchangerate-api.com** — 实时汇率
- **HTML/CSS/JS** — 前端界面（内嵌在 Python 里）
