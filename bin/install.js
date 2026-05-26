#!/usr/bin/env node
const fs = require("fs")
const path = require("path")
const os = require("os")

const SRC = path.join(__dirname, "..")
const DST = path.join(os.homedir(), ".config", "opencode")

const FILES = [
  ["tools/vision.ts", "tools/vision.ts"],
  ["plugins/vision-helper.ts", "plugins/vision-helper.ts"],
]

function log(msg, ok = true) {
  const prefix = ok ? "\x1b[32m ✓\x1b[0m" : "\x1b[31m ✗\x1b[0m"
  console.log(`${prefix} ${msg}`)
}

function title(msg) {
  console.log(`\n\x1b[36m═══ ${msg} \x1b[0m\n`)
}

async function doInstall() {
  title("opencode-vision 安装")

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

  title("环境变量检查")
  const vars = {
    VISION_API_KEY: process.env.VISION_API_KEY,
    VISION_API_URL: process.env.VISION_API_URL,
    VISION_MODEL: process.env.VISION_MODEL,
  }

  for (const [name, val] of Object.entries(vars)) {
    if (val) {
      const masked = name === "VISION_API_KEY" ? val.slice(0, 6) + "****" : val
      log(`${name} = ${masked}`)
    } else {
      log(`${name} 未设置 — 请配置后再使用`, false)
    }
  }

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
  console.log("  重启 OpenCode 后即可使用。")
  console.log("  粘贴一张图片试试看：")
  console.log('    [图片] "这是什么？"')
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

    // 如果目录空了就一并清理
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
