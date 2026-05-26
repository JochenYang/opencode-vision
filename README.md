<p align="center">
  <h1 align="center">🔍 opencode-vision</h1>
  <p align="center">
    让不支持多模态的 OpenCode 模型也能「看懂」图片
    <br />
    自动存图 → 引导模型调用 vision 工具 → 返回描述
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/@jochenyang/opencode-vision">
      <img src="https://img.shields.io/npm/v/@jochenyang/opencode-vision?style=flat-square" alt="npm version">
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="MIT License">
    </a>
    <a href="https://github.com/JochenYang/opencode-vision">
      <img src="https://img.shields.io/github/stars/JochenYang/opencode-vision?style=flat-square" alt="GitHub stars">
    </a>
  </p>
</p>

---

### ✨ 一行命令安装

```bash
npx @jochenyang/opencode-vision
```

卸载同样简单：

```bash
npx @jochenyang/opencode-vision --uninstall
```

---

## 原理

```
用户粘贴图片 + "这是什么？"
  ↓
vision-helper 插件 (experimental.chat.messages.transform)
  ├─ 解 base64 → 保存到临时目录
  ├─ 用简短占位替换原始图片部分（消除不支持的模型的 ERROR 噪音）
  └─ 路径提示注入到用户文本前
  ↓
模型看到路径提示 → 自动调用 vision 工具
  ↓
vision 工具调用视觉 API 返回图片描述
```

- **单图** → 模型调用 `vision(path)` 读取单张图片
- **多图** → 模型调用 `vision(paths=[...])` 一次 API 调用处理全部图片

## 前置要求

- [OpenCode](https://github.com/opencode-ai/opencode) 已安装
- 一个兼容 OpenAI 格式的视觉 API（如阿里云 DashScope 通义千问等）
- 环境变量（建议配置到系统级，避免每次启动重复输入）

## 环境变量

| 变量               | 说明                                   | 示例值                                                        |
| ------------------ | -------------------------------------- | ------------------------------------------------------------- |
| `VISION_API_KEY`   | 视觉 API 的密钥                        | `sk-your-api-key`                                              |
| `VISION_API_URL`   | 视觉 API 的基础地址<br>（工具自动补全 `/chat/completions`） | `https://your-api-endpoint/v1`                |
| `VISION_MODEL`     | 视觉模型名称                           | `your-vision-model`                                            |

### Windows 系统级配置

```powershell
[System.Environment]::SetEnvironmentVariable('VISION_API_KEY', 'sk-your-api-key', 'User')
[System.Environment]::SetEnvironmentVariable('VISION_API_URL', 'https://your-api-endpoint/v1', 'User')
[System.Environment]::SetEnvironmentVariable('VISION_MODEL', 'your-vision-model', 'User')
```

设置后**重启终端**生效。

### macOS / Linux

在 `~/.zshrc` 或 `~/.bashrc` 中添加：

```bash
export VISION_API_KEY="sk-your-api-key"
export VISION_API_URL="https://your-api-endpoint/v1"
export VISION_MODEL="your-vision-model"
```

## 安装

### 手动安装

将两个文件复制到 OpenCode 的全局配置目录：

```powershell
# 工具文件
copy tools\vision.ts $env:USERPROFILE\.config\opencode\tools\

# 插件文件
copy plugins\vision-helper.ts $env:USERPROFILE\.config\opencode\plugins\
```

OpenCode 会自动发现 `~/.config/opencode/tools/` 和 `~/.config/opencode/plugins/` 下的文件，**无需修改 `opencode.json`**。

> 如果对应目录不存在，手动创建即可。

### 通过 npx

```bash
# 安装
npx @jochenyang/opencode-vision

# 卸载
npx @jochenyang/opencode-vision --uninstall
```

## 验证

启动 OpenCode：

```powershell
opencode
```

粘贴一张图片并提问：

```
[图片] 这是什么？
```

预期行为：

1. 模型无法直接读取图片（当前模型不支持多模态）
2. 插件自动保存图片到临时目录并注入路径提示
3. 模型自动调用 `vision` 工具读取图片
4. 模型返回图片描述

## 项目结构

```
opencode-vision/
├── tools/
│   └── vision.ts          # vision 工具定义，调用视觉 API
├── plugins/
│   └── vision-helper.ts   # 插件：自动存图、注入提示、消除 ERROR 噪音
└── README.md
```

### 工具：`tools/vision.ts`

- 读取本地图片文件，通过视觉 API 识别内容
- 支持 `path`（单图）和 `paths`（多图数组）两个参数
- 兼容 OpenAI Chat Completions 格式的 API

### 插件：`plugins/vision-helper.ts`

- 钩子：`experimental.chat.messages.transform`
- 在消息发送给模型前一刻处理
- 将图片保存到 `os.tmpdir()/opencode-vision/`
- 路径提示注入到用户文本前（不会持久化到聊天记录）
- 用简短占位替换原始图片部分，消除 `unsupportedParts` 产生的 ERROR 噪音

## 注意事项

- 图片保存到系统临时目录 `os.tmpdir()/opencode-vision/`，重启系统后自动清理
- 临时文件以 `pasted-{timestamp}-{random}.{ext}` 命名
- 同一会话中多次粘贴同一张图会产生多个临时文件
- 视觉 API 调用使用 `max_tokens: 4096`，多图场景下足够返回详细描述

## 自定义视觉 API

本工具兼容任何 OpenAI Chat Completions 格式的视觉 API。只需更换环境变量即可：

```powershell
$env:VISION_API_KEY = 'sk-your-api-key'
$env:VISION_API_URL = 'https://your-api-endpoint/v1'
$env:VISION_MODEL = 'your-vision-model'
```

## 许可证

[MIT](LICENSE)
