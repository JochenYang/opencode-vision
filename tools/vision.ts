/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { tmpdir } from "os"
import path from "path"

const TMP_DIR = path.join(tmpdir(), "opencode-vision")
const TMP_DIR_RESOLVED = path.resolve(TMP_DIR)

// 单图最大 50MB，防止恶意大文件 OOM
const MAX_FILE_SIZE = 50 * 1024 * 1024

// 合法的图片扩展名（白名单）
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"])

/**
 * 路径沙箱：只允许读取 TMP_DIR 下的图片文件
 * 防止 vision 工具被 prompt injection 诱导读取 /etc/passwd 等敏感文件
 * 并 base64 发给外部 VISION_API_URL 服务端造成数据外泄
 */
function sandboxPath(p: string): string | null {
  // 1. 解析并规范化路径
  const resolved = path.resolve(p)

  // 2. 必须位于 TMP_DIR 之下（防止任意路径读取）
  if (!resolved.startsWith(TMP_DIR_RESOLVED + path.sep) && resolved !== TMP_DIR_RESOLVED) {
    return null
  }

  // 3. 必须有合法图片扩展名
  const ext = path.extname(resolved).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) {
    return null
  }

  return resolved
}

export default tool({
  description: `Reads one or more image files and returns a description of their contents.
Use this when the user pastes images but the current model cannot view images directly.
The image(s) will have been auto-saved with a path hint like "[Image #N auto-saved to ...]" in the conversation.
Each paste batch gets a sequential "image{N}/" prefix in the filename for disambiguation.
For multiple images, use the "paths" parameter.

Requires VISION_API_KEY and VISION_API_URL.
VISION_MODEL is required for OpenAI-compatible backends.
MiniMax is auto-detected — set VISION_API_URL to your MiniMax base URL and VISION_MODEL is optional.
Override with VISION_API_TYPE=openai|minimax.`,
  args: {
    paths: tool.schema
      .array(tool.schema.string())
      .describe("Absolute path(s) to the image file(s). Use this for one or multiple images.")
      .optional(),
    path: tool.schema
      .string()
      .describe("Deprecated: use 'paths' instead. Absolute path to a single image file.")
      .optional(),
    question: tool.schema
      .string()
      .describe("Optional specific question about the image(s)")
      .optional(),
  },
  async execute(args) {
    const allPaths: string[] = []
    if (args.paths && args.paths.length > 0) {
      allPaths.push(...args.paths)
    } else if (args.path) {
      allPaths.push(args.path)
    }
    // 过滤空字符串 / null / 非字符串
    const validInputPaths = allPaths.filter((p): p is string => typeof p === "string" && p.length > 0)
    if (validInputPaths.length === 0) return "Error: no image path provided"

    // Resolve each path (try absolute, then TMP_DIR/{path}, then TMP_DIR/{basename})
    const resolved: string[] = []
    const rejected: string[] = []
    for (const p of validInputPaths) {
      // 三层路径尝试，每层都过沙箱
      const candidates = [
        p,                                       // 1. 绝对路径直传
        path.join(TMP_DIR, p),                   // 2. TMP_DIR/{path}
        path.join(TMP_DIR, path.basename(p)),    // 3. TMP_DIR/{basename} (向后兼容)
      ]
      let found: string | null = null
      for (const candidate of candidates) {
        const safe = sandboxPath(candidate)
        if (!safe) continue
        const file = Bun.file(safe)
        if (!(await file.exists())) continue
        // 大小限制
        if (file.size > MAX_FILE_SIZE) {
          rejected.push(`${safe} (too large: ${(file.size / 1024 / 1024).toFixed(1)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB)`)
          found = null
          break
        }
        found = safe
        break
      }
      if (found) {
        resolved.push(found)
      } else {
        rejected.push(p)
      }
    }

    if (resolved.length === 0) {
      const reasons = rejected.length > 0
        ? `\nRejected paths (not in TMP_DIR, not an image, or too large):\n  ${rejected.join("\n  ")}`
        : ""
      return `Error: none of the specified images could be read.${reasons}\nTip: paths must point to images in ${TMP_DIR_RESOLVED} (e.g. ${TMP_DIR_RESOLVED}/image1/abc123.png).`
    }

    const apiKey = process.env["VISION_API_KEY"]
    const baseUrl = process.env["VISION_API_URL"]
    if (!apiKey) return "Error: VISION_API_KEY not set"
    if (!baseUrl) return "Error: VISION_API_URL not set"

    // Determine API type: explicit override or auto-detect from URL
    const apiType = (process.env["VISION_API_TYPE"] || "").toLowerCase()
    const isMiniMax = apiType === "minimax" || (!apiType && /minimax/i.test(baseUrl))

    if (isMiniMax) {
      return await callMiniMax(apiKey, baseUrl, resolved, args.question)
    }
    return await callOpenAI(apiKey, baseUrl, resolved, args.question)
  },
})

// ── OpenAI-compatible backend ──

async function callOpenAI(apiKey: string, baseUrl: string, resolved: string[], question?: string) {
  const model = process.env["VISION_MODEL"]
  if (!model) return "Error: VISION_MODEL not set (required for OpenAI-compatible backends)"

  const apiUrl = `${baseUrl.replace(/\/+$/, "")}/chat/completions`

  const content: Record<string, unknown>[] = []
  if (question) {
    content.push({ type: "text", text: question })
  } else if (resolved.length > 1) {
    content.push({
      type: "text",
      text: `Describe each of these ${resolved.length} images in detail, labeling which description corresponds to which file.`,
    })
  } else {
    content.push({ type: "text", text: "Please describe this image in detail" })
  }

  for (const filePath of resolved) {
    const file = Bun.file(filePath)
    const mime = file.type || "image/png"
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")
    content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } })
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      max_tokens: 4096,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    return `Vision API error (${response.status}): ${text}`
  }

  const data = (await response.json()) as { choices: { message: { content: string } }[] }
  return data.choices?.[0]?.message?.content ?? "No description returned."
}

// ── MiniMax VLM backend ──

interface MiniMaxBaseResp {
  status_code?: number
  status_msg?: string
}

interface MiniMaxVlmResponse {
  base_resp?: MiniMaxBaseResp
  content?: string
}

async function callMiniMax(apiKey: string, baseUrl: string, resolved: string[], question?: string) {
  const apiUrl = `${baseUrl.replace(/\/+$/, "")}/v1/coding_plan/vlm`

  const descriptions: string[] = []
  for (const filePath of resolved) {
    const file = Bun.file(filePath)
    const mime = file.type || "image/png"
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")
    const imageUrl = `data:${mime};base64,${base64}`

    const prompt = question || "Please describe this image in detail"

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ prompt, image_url: imageUrl }),
    })

    if (!response.ok) {
      const text = await response.text()
      return `MiniMax Vision API error (${response.status}): ${text}`
    }

    const data = (await response.json()) as MiniMaxVlmResponse

    // MiniMax wraps errors in base_resp even on HTTP 200
    if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
      return `MiniMax Vision API error: ${data.base_resp.status_msg || `status_code ${data.base_resp.status_code}`}`
    }

    descriptions.push(data.content || "No description returned.")
  }

  if (descriptions.length === 1) return descriptions[0]
  return descriptions.map((d, i) => `--- Image ${i + 1} ---\n${d}`).join("\n\n")
}
