# opencode-vision

[![npm version](https://img.shields.io/npm/v/@jochenyang/opencode-vision)](https://www.npmjs.com/package/@jochenyang/opencode-vision)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A plugin + tool for [OpenCode](https://github.com/opencode-ai/opencode) that adds vision capabilities.

When the current model does not support multimodal input, it automatically saves pasted images to a temporary directory and guides the model to call the vision tool for recognition. Supports single and multiple images.

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
- An OpenAI-compatible vision API (e.g., Aliyun DashScope, OpenAI, etc.)
- Environment variables configured (recommended system-wide)

## Environment Variables

| Variable          | Description                                            | Example                         |
| ----------------- | ------------------------------------------------------ | ------------------------------- |
| `VISION_API_KEY`  | Vision API key                                         | `sk-your-api-key`               |
| `VISION_API_URL`  | Vision API base URL<br>(tool auto-appends `/chat/completions`) | `https://your-api-endpoint/v1`  |
| `VISION_MODEL`    | Vision model name                                      | `your-vision-model`             |

### Windows (System-wide)

```powershell
[System.Environment]::SetEnvironmentVariable('VISION_API_KEY', 'sk-your-api-key', 'User')
[System.Environment]::SetEnvironmentVariable('VISION_API_URL', 'https://your-api-endpoint/v1', 'User')
[System.Environment]::SetEnvironmentVariable('VISION_MODEL', 'your-vision-model', 'User')
```

**Restart your terminal** after setting.

### macOS / Linux

Add to `~/.zshrc` or `~/.bashrc`:

```bash
export VISION_API_KEY="sk-your-api-key"
export VISION_API_URL="https://your-api-endpoint/v1"
export VISION_MODEL="your-vision-model"
```

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
- Compatible with any OpenAI Chat Completions API

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

Compatible with any OpenAI Chat Completions vision API. Just change the environment variables:

```bash
export VISION_API_KEY="sk-your-api-key"
export VISION_API_URL="https://your-api-endpoint/v1"
export VISION_MODEL="your-vision-model"
```

## License

[MIT](LICENSE)
