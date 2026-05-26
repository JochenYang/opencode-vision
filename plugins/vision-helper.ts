import type { Plugin } from "@opencode-ai/plugin"
import { tmpdir } from "os"
import path from "path"

const TMP_DIR = path.join(tmpdir(), "opencode-vision")

/**
 * 在消息发送给模型前一刻，检测用户消息中的图片附件：
 * 1. 保存图片到临时目录
 * 2. 用简短占位替换原始图片部分（消除 unsupportedParts 的 ERROR 噪音）
 * 3. 注入路径提示（新 push 的 part，不持久化，UI 不可见）
 */
export default (async () => {
  await Bun.write(path.join(TMP_DIR, ".check"), "").catch(() => {})

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      for (const msg of output.messages) {
        if (msg.info.role !== "user") continue

        // 找出所有图片，保存到磁盘
        const saved: { index: number; filePath: string }[] = []

        for (let i = 0; i < msg.parts.length; i++) {
          const part = msg.parts[i]
          if (part.type !== "file" || typeof part.mime !== "string" || !part.mime.startsWith("image/")) continue

          const colon = part.url.indexOf(";base64,")
          if (colon === -1) continue
          const base64 = part.url.slice(colon + ";base64,".length)
          if (!base64) continue

          const ext = part.mime.split("/")[1] || "png"
          const name = `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
          const filePath = path.join(TMP_DIR, name)

          await Bun.write(filePath, Buffer.from(base64, "base64"))
          saved.push({ index: i, filePath })
        }

        if (saved.length === 0) continue

        // 用简短占位替换原始图片 part，防止 unsupportedParts 产生噪音 ERROR
        for (const { index, filePath } of saved.toReversed()) {
          msg.parts.splice(index, 1, {
            type: "text",
            text: `[vision: ${path.basename(filePath)}]`,
          } as never)
        }

        // 构造路径提示（新 push 的 part，不持久化，UI 不可见）
        const hints = saved.length === 1
          ? `[Image auto-saved to ${saved[0].filePath} — use the vision tool to read it]`
          : `[Images auto-saved to:\n${saved.map((s) => `  ${s.filePath}`).join("\n")}\n— use the vision tool with paths=[...] to read them all at once]`

        // push 新的 part 而非修改现有 part，避免影响 UI 渲染
        ;(msg.parts as unknown as Record<string, unknown>[]).push({
          type: "text" as const,
          text: hints,
        })
      }
    },
  }
}) satisfies Plugin
