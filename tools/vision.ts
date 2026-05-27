/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { tmpdir } from "os"
import path from "path"

const TMP_DIR = path.join(tmpdir(), "opencode-vision")

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
    if (allPaths.length === 0) return "Error: no image path provided"

    // Resolve each path (try absolute, then TMP_DIR/{path}, then TMP_DIR/{basename})
    const resolved: string[] = []
    for (const p of allPaths) {
      let file = Bun.file(p)
      if (await file.exists()) {
        resolved.push(p)
        continue
      }
      // Try TMP_DIR/image{N}/filename (from sequential paste prefix)
      const withPrefix = path.join(TMP_DIR, p)
      file = Bun.file(withPrefix)
      if (await file.exists()) {
        resolved.push(withPrefix)
        continue
      }
      // Try TMP_DIR/filename (backward compat)
      const fallback = path.join(TMP_DIR, path.basename(p))
      file = Bun.file(fallback)
      if (await file.exists()) {
        resolved.push(fallback)
      }
    }

    if (resolved.length === 0) {
      return `Error: none of the specified images were found (looked in: ${allPaths.join(", ")})`
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
