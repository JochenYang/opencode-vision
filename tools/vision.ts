import { tool } from "@opencode-ai/plugin"
import { tmpdir } from "os"
import path from "path"

const TMP_DIR = path.join(tmpdir(), "opencode-vision")
const TMP_DIR_RESOLVED = path.resolve(TMP_DIR)

// Cap each image to prevent malicious large files from exhausting memory.
const MAX_FILE_SIZE = 50 * 1024 * 1024

// Allowlist image extensions accepted by the external VLM path.
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"])

/**
 * Path sandbox: only read image files created under TMP_DIR.
 * This prevents prompt injection from exfiltrating sensitive local files by
 * base64-uploading them to the external VISION_API_URL backend.
 */
function sandboxPath(p: string): string | null {
  const resolved = path.resolve(p)

  if (!resolved.startsWith(TMP_DIR_RESOLVED + path.sep) && resolved !== TMP_DIR_RESOLVED) {
    return null
  }

  const ext = path.extname(resolved).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) {
    return null
  }

  return resolved
}

export default tool({
  description: `External vision API fallback for image analysis via a remote VLM.

USE ONLY when the active agent lacks native vision capabilities, or when the user
explicitly asks for a specific external model (OCR, document parsing, a custom
VLM different from the agent's default). For multimodal agents that already
support native image input (e.g. M3, GPT-4o, Claude 3+), prefer the agent's
built-in vision — calling this tool adds latency and cost without quality gain.

Inputs accept absolute image paths. Files are sandboxed to <tmp>/opencode-vision
to prevent data exfiltration via prompt injection.

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
    __nativeVisionBlocked: tool.schema
      .boolean()
      .describe("Internal guard set by vision-helper when the active model has native image input.")
      .optional(),
  },
  async execute(args) {
    if (args.__nativeVisionBlocked) {
      return "Error: vision is disabled for the current native-vision model. Analyze the attached image directly, or use the built-in read tool for local image files. The external vision API is only for text-only models."
    }

    const allPaths: string[] = []
    if (args.paths && args.paths.length > 0) {
      allPaths.push(...args.paths)
    } else if (args.path) {
      allPaths.push(args.path)
    }
    const validInputPaths = allPaths.filter((p): p is string => typeof p === "string" && p.length > 0)
    if (validInputPaths.length === 0) return "Error: no image path provided"

    // Resolve each path (try absolute, then TMP_DIR/{path}, then TMP_DIR/{basename})
    const resolved: string[] = []
    const rejected: string[] = []
    for (const p of validInputPaths) {
      const candidates = [
        p,
        path.join(TMP_DIR, p),
        path.join(TMP_DIR, path.basename(p)),
      ]
      let found: string | null = null
      for (const candidate of candidates) {
        const safe = sandboxPath(candidate)
        if (!safe) continue
        const file = Bun.file(safe)
        if (!(await file.exists())) continue
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

// P1-4: 60s default fetch timeout to prevent API hangs from freezing OpenCode
const FETCH_TIMEOUT_MS = Number(process.env["VISION_FETCH_TIMEOUT_MS"] || 60_000)

/**
 * Truncate long error response bodies so we don't dump a multi-MB HTML error page
 * into the LLM context.
 */
function truncate(s: string, max = 1024): string {
  return s.length > max ? s.slice(0, max) + `... [truncated, ${s.length} bytes total]` : s
}

async function callOpenAI(apiKey: string, baseUrl: string, resolved: string[], question?: string) {
  const model = process.env["VISION_MODEL"]
  if (!model) return "Error: VISION_MODEL not set (required for OpenAI-compatible backends)"

  // P2-2: allow VISION_MAX_TOKENS override; default 4096
  const maxTokens = Number(process.env["VISION_MAX_TOKENS"] || 4096)

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

  // P1-4: AbortController-based timeout
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    // H4 fix: catch-all for network errors (DNS, ECONNREFUSED, TLS, etc.)
    // instead of re-throwing and crashing the entire turn.
    const e = err as Error
    if (e.name === "AbortError") {
      return `Vision API error: request timed out after ${FETCH_TIMEOUT_MS}ms`
    }
    return `Vision API error: ${e.message || "network request failed"}`
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const text = truncate(await response.text())
    return `Vision API error (${response.status}): ${text}`
  }

  // L2 fix: safe JSON parse — guard against non-JSON error responses (e.g. HTML
  // error pages from load balancers) that would throw and crash the turn.
  let data: { choices?: { message?: { content?: string } }[] }
  try {
    data = await response.json()
  } catch {
    const text = truncate(await response.text().catch(() => "(unreadable body)"))
    return `Vision API error: response is not valid JSON — ${text}`
  }
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

    // P1-4: AbortController-based timeout (per-image)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ prompt, image_url: imageUrl }),
        signal: controller.signal,
      })
    } catch (err) {
      // H4 fix: catch-all for network errors; H3 fix: collect error and continue
      const e = err as Error
      if (e.name === "AbortError") {
        descriptions.push(`[Error for ${path.basename(filePath)}]: request timed out after ${FETCH_TIMEOUT_MS}ms`)
      } else {
        descriptions.push(`[Error for ${path.basename(filePath)}]: ${e.message || "network request failed"}`)
      }
      continue
    } finally {
      clearTimeout(timer)
    }

    // H3 fix: collect per-image errors instead of returning early
    if (!response.ok) {
      const text = truncate(await response.text())
      descriptions.push(`[Error for ${path.basename(filePath)}]: API ${response.status} — ${text}`)
      continue
    }

    // L2 fix: safe JSON parse for MiniMax responses
    let data: MiniMaxVlmResponse
    try {
      data = await response.json()
    } catch {
      descriptions.push(`[Error for ${path.basename(filePath)}]: response is not valid JSON`)
      continue
    }

    // MiniMax wraps errors in base_resp even on HTTP 200
    if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
      descriptions.push(`[Error for ${path.basename(filePath)}]: ${data.base_resp.status_msg || `status_code ${data.base_resp.status_code}`}`)
      continue
    }

    descriptions.push(data.content || "No description returned.")
  }

  if (descriptions.length === 0) return "Error: no images were processed."
  if (descriptions.length === 1) return descriptions[0]
  return descriptions.map((d, i) => `--- Image ${i + 1} ---\n${d}`).join("\n\n")
}
