import type { Plugin } from "@opencode-ai/plugin"
import { createHash } from "crypto"
import { tmpdir } from "os"
import path from "path"

const TMP_DIR = path.join(tmpdir(), "opencode-vision")

// 图片内容哈希 → 全局序号，确保同一张图不重复计数
const imageRegistry = new Map<string, number>()
let nextImageSeq = 1

// 原生支持多模态（可直接识别图片）的模型匹配规则
// 匹配的模型 → 跳过 transform，让 OpenCode 原生管道处理图片
// 不匹配的模型 → 走 vision 工具 fallback
const NATIVE_VISION = /gpt-|o[0-9]|claude-|gemini-|qwen3\.(5|6)|qwen-vl|qwen2-5-vl|qwen3-vl|qwen-omni|qvq-max|kimi-k2\.(5|6)|minimax-m3|minimax-vl|glm-[0-9.]+v|mimo-v2-omni|mimo-v2\.5$|yi-vl|deepseek-vl2/i

/**
 * 在消息发送给模型前一刻，检测用户消息中的图片附件：
 * 1. 如果当前模型支持原生多模态 → 跳过，让 OpenCode 原生处理
 * 2. 否则：
 *    a. 保存图片到临时目录
 *    b. 用简短占位替换原始图片部分（消除 unsupportedParts 的 ERROR 噪音）
 *    c. 注入路径提示（新 push 的 part，不持久化，UI 不可见）
 *
 * 按图片在会话中的出现顺序分配全局序号：
 *   第 1 张图 → image1/xxx.png
 *   第 2 张图 → image2/yyy.png
 *   第 3 张图 → image3/zzz.png
 *
 * 通过图片内容哈希去重，不受 transform 重复执行或消息状态影响。
 */
export default (async () => {
  // 启动时确保 tmp 根目录存在（Bun.write 在 parent dir 不存在时也会 mkdirp，
  // 但显式 mkdir 一次更清晰，也方便后续 hook 启动失败时定位问题）
  await import("fs").then((fs) => fs.promises.mkdir(TMP_DIR, { recursive: true }).catch(() => {}))

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      for (const msg of output.messages) {
        if (msg.info.role !== "user") continue

        // 检测当前模型是否支持原生多模态
        const modelID = (msg.info.model?.modelID || "").toLowerCase()
        if (NATIVE_VISION.test(modelID)) continue

        // 先清理上一次 transform 注入的 hint（防累积）
        // hints 由本插件注入，匹配特定前缀以便识别
        for (let i = msg.parts.length - 1; i >= 0; i--) {
          const p = msg.parts[i] as unknown as { type?: string; text?: string }
          if (p.type === "text" && typeof p.text === "string" &&
              (p.text.startsWith("[Image #") || p.text.startsWith("[Images auto-saved to:"))) {
            msg.parts.splice(i, 1)
          }
        }

        const saved: { index: number; name: string; seq: number }[] = []

        for (let i = 0; i < msg.parts.length; i++) {
          const part = msg.parts[i]
          if (part.type !== "file" || typeof part.mime !== "string" || !part.mime.startsWith("image/")) continue

          const colon = part.url.indexOf(";base64,")
          if (colon === -1) continue
          const base64 = part.url.slice(colon + ";base64,".length)
          if (!base64) continue

          // 用 base64 前 32 字符的 MD5 作为内容指纹去重
          const hash = createHash("md5").update(base64.slice(0, 1024)).digest("hex").slice(0, 8)

          let seq = imageRegistry.get(hash)
          if (!seq) {
            seq = nextImageSeq++
            imageRegistry.set(hash, seq)
          }

          const ext = part.mime.split("/")[1] || "png"
          const name = `${hash}.${ext}`

          const filePath = path.join(TMP_DIR, `image${seq}`, name)
          // 如果已存在（同 hash 的图已存过）则跳过写盘
          if (!(await Bun.file(filePath).exists())) {
            await Bun.write(filePath, Buffer.from(base64, "base64"))
          }

          saved.push({ index: i, name, seq })
        }

        if (saved.length === 0) continue

        // 用简短占位替换原始图片 part，防止 unsupportedParts 产生噪音 ERROR
        for (const { index, name, seq } of saved.toReversed()) {
          msg.parts.splice(index, 1, {
            type: "text",
            text: `[vision: image${seq}/${name}]`,
          } as never)
        }

        // 构造路径提示（新 push 的 part，不持久化，UI 不可见）
        const hints = saved.length === 1
          ? `[Image #${saved[0].seq} auto-saved to ${path.join(TMP_DIR, `image${saved[0].seq}`, saved[0].name)} — use the vision tool to read it]`
          : `[Images auto-saved to:\n${saved.map((s) => `  ${path.join(TMP_DIR, `image${s.seq}`, s.name)}`).join("\n")}\n— use the vision tool with paths=[...] to read them all at once]`

        // push 新的 part 而非修改现有 part，避免影响 UI 渲染
        ;(msg.parts as unknown as Record<string, unknown>[]).push({
          type: "text" as const,
          text: hints,
        })
      }
    },
  }
}) satisfies Plugin
