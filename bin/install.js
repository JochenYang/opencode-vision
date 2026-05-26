#!/usr/bin/env node
const fs = require("fs")
const path = require("path")
const os = require("os")

const SRC = path.join(__dirname, "..")
const DST = path.join(os.homedir(), ".config", "opencode")
const isWin = process.platform === "win32"

const FILES = [
  ["tools/vision.ts", "tools/vision.ts"],
  ["plugins/vision-helper.ts", "plugins/vision-helper.ts"],
]

const ENV_VARS = [
  { name: "VISION_API_KEY", desc: "视觉 API 密钥 / Vision API key", example: "sk-your-api-key" },
  { name: "VISION_API_URL", desc: "视觉 API 地址 / Vision API base URL", example: "https://your-api-endpoint/v1" },
  { name: "VISION_MODEL", desc: "视觉模型名称 / Vision model name", example: "your-vision-model" },
]

function log(msg, ok = true) {
  const prefix = ok ? "\x1b[32m ✓\x1b[0m" : "\x1b[31m ✗\x1b[0m"
  console.log(`${prefix} ${msg}`)
}

function title(msg) {
  console.log(`\n\x1b[36m═══ ${msg} \x1b[0m\n`)
}

function printEnvGuide() {
  console.log("\n  你需要设置以下环境变量才能使用视觉识别功能：")
  console.log()

  for (const v of ENV_VARS) {
    console.log(`    \x1b[33m${v.name}\x1b[0m`)
    console.log(`    → ${v.desc}`)
    console.log(`    → 示例: ${v.example}`)
    console.log()
  }

  if (isWin) {
    console.log("  \x1b[36mWindows 系统级配置（管理员 PowerShell）：\x1b[0m")
    console.log()
    for (const v of ENV_VARS) {
      console.log(`    [System.Environment]::SetEnvironmentVariable('${v.name}', '${v.example}', 'User')`)
    }
    console.log()
    console.log("  设置后重启终端生效。")
  } else {
    console.log("  \x1b[36mmacOS / Linux 配置（添加到 ~/.zshrc 或 ~/.bashrc）：\x1b[0m")
    console.log()
    for (const v of ENV_VARS) {
      console.log(`    export ${v.name}="${v.example}"`)
    }
    console.log()
    console.log("  然后执行 source ~/.zshrc 或重启终端。")
  }
}

async function checkVars() {
  let missing = 0
  for (const v of ENV_VARS) {
    const val = process.env[v.name]
    if (val) {
      const masked = v.name === "VISION_API_KEY" ? val.slice(0, 6) + "****" : val
      log(`${v.name} = ${masked}`)
    } else {
      log(`${v.name} 未设置`, false)
      missing++
    }
  }
  return missing
}

async function doInstall() {
  title("opencode-vision 安装")

  // ── 文件复制 ──
  for (const [, rel] of FILES) {
    const dir = path.join(DST, path.dirname(rel))
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
  for (const [srcRel, dstRel] of FILES) {
    const src = path.join(SRC, srcRel)
    const dst = path.join(DST, dstRel)
    if (!fs.existsSync(src)) {
      log(`源文件不存在: ${srcRel}`, false)
      continue
    }
    fs.copyFileSync(src, dst)
    log(`安装 ${dstRel}`)
  }

  // ── 环境变量检查 ──
  title("环境变量检查")
  const missing = await checkVars()

  if (missing > 0) {
    console.log(`\n  \x1b[33m⚠ 有 ${missing} 个环境变量未设置。\x1b[0m`)
    printEnvGuide()
  }

  // ── OpenCode 检测 ──
  title("OpenCode 检测")
  try {
    const { execSync } = require("child_process")
    const ver = execSync("opencode --version 2>nul || opencode version 2>/dev/null", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim()
    log(`OpenCode ${ver || "已安装"}`)
  } catch {
    log("未检测到 OpenCode — 请先安装 https://github.com/opencode-ai/opencode", false)
  }

  title("安装完成")
  console.log("  ✅ 文件已就位，重启 OpenCode 后即可使用。")
  if (missing > 0) {
    console.log("  ⚠ 环境变量未配置完整，视觉识别功能无法正常工作。")
    console.log("     请按上面指引设置后再重启 OpenCode。")
  }
  console.log("  📝 使用方式：粘贴一张图片并提问")
  console.log('     "[图片] 这是什么？"')
}

async function doUninstall() {
  title("opencode-vision 卸载")

  let removed = 0
  for (const [, rel] of FILES) {
    const dst = path.join(DST, rel)
    if (!fs.existsSync(dst)) {
      log(`未安装: ${rel}`)
      continue
    }
    fs.unlinkSync(dst)
    log(`已删除 ${rel}`)
    removed++

    const dir = path.dirname(dst)
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir)
      log(`已清理空目录 ${path.relative(os.homedir(), dir)}`)
    }
  }

  title("卸载完成")
  if (removed > 0) {
    console.log("  已删除 opencode-vision 相关文件。")
    console.log("  重启 OpenCode 即可生效。")
  } else {
    console.log("  没有找到已安装的文件。")
  }
}

async function main() {
  const isUninstall = process.argv.includes("--uninstall") || process.argv.includes("uninstall")
  if (isUninstall) {
    await doUninstall()
  } else {
    await doInstall()
  }
  console.log()
}

main().catch((err) => {
  console.error("\x1b[31m操作失败:\x1b[0m", err.message)
  process.exit(1)
})
