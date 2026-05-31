# Egern Widgets

个人 Egern 小组件 & 模块集合。

## 红宝书随机单词

考研英语红宝书随机单词小组件，每次刷新展示下一个单词及有道词典释义。

### 功能

- 📖 自动拉取 2026 考研英语红宝书词表（6700+ 词）
- 📝 有道词典标准释义，带词性标注
- 🔄 每 30 分钟自动刷新
- 🎨 适配所有小组件尺寸（含锁屏）

### 安装

在 Egern 中导入以下模块链接：

```
https://raw.githubusercontent.com/Tiomehsh/egern/main/widget/random-word.yaml
```

添加 Egern 小组件到主屏幕，选择 **红宝书随机单词**。

---

## 机场订阅流量监控 (左右版)

自动拉取多个机场的订阅数据，适配系统深色/浅色模式，采用左右信息对照的排版布局。

### 功能

- 📊 直观展示已用流量、总流量、剩余比例饼图及进度条
- 🗓 自动计算到期日或流量重置剩余天数，并用颜色区分紧急程度（如红色代表到期）
- 🌗 完全原生适配 Egern iOS 的深色模式色彩库
- 🏷 支持最多同时挂载 5 个订阅节点环境
- 左右布局让机场名、进度条信息不挤成一堆

### 安装

在 Egern 中导入以下模块链接：

```
https://raw.githubusercontent.com/Tiomehsh/egern/main/widget/sub-widget.yaml
```

**配置环境变量（必填）：**
进入 Egern 的环境变量配置（注意变量名需大写）：
- `NAME1` = 分组名称（可选，如：节点 1）
- `URL1` = 包含 token 的订阅地址链接（必填！）
- `RESET1` = 重置日（可选，1~28数字）
如果你有更多的订阅链接，顺延添加 `NAME2`/`URL2`/`RESET2`。

---
## Sub2API 额度用量

在 Egern 小组件中显示 Sub2API 今日用量、本周用量和月度用量，数据来自 Sub2API active subscription 的日/周/月美元额度字段。

### 功能

- 📊 用三条进度条显示今日、本周、月度已用额度 / 总额度
- 🧮 显示已用百分比和剩余额度
- 🔐 通过 Sub2API 邮箱 + 密码登录获取管理端 access token
- 🌗 适配深色/浅色模式

### 安装

在 Egern 中导入以下模块链接：

```
https://raw.githubusercontent.com/Tiomehsh/egern/main/widget/sub2api-usage.yaml
```

**配置环境变量（必填）：**
- `BASE_URL` = Sub2API 站点根地址，例如 `https://example.com`
- `EMAIL` = Sub2API 登录邮箱
- `PASSWORD` = Sub2API 登录密码
- `SUBSCRIPTION_INDEX` = 订阅序号，可选，默认 `1`

---
