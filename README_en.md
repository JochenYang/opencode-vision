<p align="center">
  🌐 <strong>English</strong> · <a href="README.md">中文</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg">
    <img src="assets/logo.svg" width="64" alt="opencode-vision logo">
  </picture>
</p>
<h1 align="center">opencode-vision</h1>
<p align="center">
  🌐 <strong>English</strong> · <a href="README.md">中文</a>
</p>
<p align="center">
  Let non-vision OpenCode models "see" pasted images
  <br />
  Auto-saves images → guides model to call vision tool → returns description
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

### ✨ One-line install

```bash
npx @jochenyang/opencode-vision
```

Uninstall:

```bash
npx @jochenyang/opencode-vision --uninstall
```

---

## How It Works

```
User pastes image + "What is this?"
  ↓
vision-helper plugin (experimental.chat.messages.transform)
  ├─ Decode base64 → save to temp directory
  ├─ Replace original image part with a short placeholder (remove ERROR noise from unsupportedParts)
  └─ Inject path hint before user's text
  ↓
Model sees the path hint → automatically calls the vision tool
  ↓
vision tool calls the vision API → returns image description
```

- **Single image** → model calls `vision(path)` to read one image
- **Multiple images** → model calls `vision(paths=[...])` to process all at once

## Prerequisites

- [OpenCode](https://github.com/opencode-ai/opencode) installed
- A vision-capable API (OpenAI Chat Completions format or MiniMax VLM)
- Environment variables configured (recommended system-wide)

## Environment Variables

| Variable          | Description                                                        | Example                         |
| ----------------- | ------------------------------------------------------------------ | ------------------------------- |
| `VISION_API_KEY`  | Vision API key                                                     | `sk-your-api-key`               |
| `VISION_API_URL`  | Vision API base URL                                                | `https://your-api-endpoint/v1`  |
| `VISION_MODEL`    | Vision model name<br>(not needed for MiniMax)                      | `your-vision-model`             |
| `VISION_API_TYPE` | Optional, force API type<br>`openai` / `minimax`                   | `minimax`                       |

> `VISION_API_URL`: OpenAI-compatible backends auto-append `/chat/completions`; MiniMax auto-detects and uses `/v1/coding_plan/vlm`.
>
> `VISION_API_TYPE`: Auto-detected by default (URL containing `minimax` triggers MiniMax mode). Can be explicitly set.

### Example 1: OpenAI-compatible (e.g., Aliyun DashScope)

**Windows:**
```powershell
[System.Environment]::SetEnvironmentVariable('VISION_API_KEY', 'sk-your-api-key', 'User')
[System.Environment]::SetEnvironmentVariable('VISION_API_URL', 'https://your-api-endpoint/v1', 'User')
[System.Environment]::SetEnvironmentVariable('VISION_MODEL', 'your-vision-model', 'User')
```

**macOS / Linux:**
```bash
export VISION_API_KEY="sk-your-api-key"
export VISION_API_URL="https://your-api-endpoint/v1"
export VISION_MODEL="your-vision-model"
```

### Example 2: MiniMax VLM

MiniMax's VLM endpoint is part of the **Token Plan** service and requires a Group API Key with Token Plan access — a regular Chat API Key won't work.

> How to get one: Login to [MiniMax platform](https://platform.minimaxi.com) → Token Plan → Create/view Group API Key.

**Windows:**
```powershell
[System.Environment]::SetEnvironmentVariable('VISION_API_KEY', 'your-minimax-group-api-key', 'User')
[System.Environment]::SetEnvironmentVariable('VISION_API_URL', 'https://api.minimax.chat', 'User')
REM VISION_MODEL is not needed — MiniMax auto-detected
```

**macOS / Linux:**
```bash
export VISION_API_KEY="your-minimax-group-api-key"
export VISION_API_URL="https://api.minimax.chat"
# VISION_MODEL is not needed — MiniMax auto-detected
```

> Note: The MiniMax VLM endpoint uses a different base URL from the Chat API. Use `https://api.minimax.chat`.

**Restart your terminal** after setting.

## Installation

### Manual

Copy the two files to OpenCode's global config directory:

```bash
# Tool
cp tools/vision.ts ~/.config/opencode/tools/

# Plugin
cp plugins/vision-helper.ts ~/.config/opencode/plugins/
```

OpenCode auto-discovers files under `~/.config/opencode/tools/` and `~/.config/opencode/plugins/` — **no need to modify `opencode.json`**.

> Create the directories if they don't exist.

### Via npx

```bash
# Install
npx @jochenyang/opencode-vision

# Uninstall
npx @jochenyang/opencode-vision --uninstall
```

## Verification

Start OpenCode:

```bash
opencode
```

Paste an image and ask:

```
[Image] What is this?
```

Expected behavior:

1. The model cannot read the image directly (doesn't support multimodal)
2. The plugin saves the image to temp and injects a path hint
3. The model automatically calls the `vision` tool
4. The model returns an image description

## Project Structure

```
opencode-vision/
├── tools/
│   └── vision.ts          # Vision tool — calls the vision API
├── plugins/
│   └── vision-helper.ts   # Plugin — saves images, injects hints, removes ERROR noise
├── bin/
│   └── install.js         # CLI install/uninstall script
├── package.json
├── README.md
├── README_en.md
└── LICENSE
```

### Tool: `tools/vision.ts`

- Reads local image files and describes them via a vision API
- Supports `path` (single) and `paths` (multiple) parameters
- Supports two backends: OpenAI Chat Completions / MiniMax VLM (auto-detected)

### Plugin: `plugins/vision-helper.ts`

- Hook: `experimental.chat.messages.transform`
- Processes right before the message is sent to the model
- Saves images to `os.tmpdir()/opencode-vision/`
- Injects path hints before user text (not persisted to chat history)
- Replaces original image parts to prevent ERROR noise from `unsupportedParts`

## Notes

- Images are saved to the system temp directory `os.tmpdir()/opencode-vision/` — automatically cleaned on reboot
- Temp files are named `pasted-{timestamp}-{random}.{ext}`
- Same image pasted multiple times in one session creates separate temp files
- Vision API calls use `max_tokens: 4096`, sufficient for detailed multi-image descriptions

## Custom Vision API

The tool supports two backends with auto-detection or explicit override.

### OpenAI Chat Completions Format

Works with any OpenAI Chat Completions vision API:

```bash
export VISION_API_KEY="sk-your-api-key"
export VISION_API_URL="https://your-api-endpoint/v1"
export VISION_MODEL="your-vision-model"
```

### MiniMax VLM

Auto-detected when the URL contains `minimax`/`minimaxi`. Can also be forced with `VISION_API_TYPE=minimax`.

> ⚠️ Requires a **Group API Key** with Token Plan access. Regular Chat API Keys won't work.

```bash
export VISION_API_KEY="your-minimax-group-api-key"
export VISION_API_URL="https://api.minimax.chat"
# VISION_MODEL is not needed
```

## License

[MIT](LICENSE)
