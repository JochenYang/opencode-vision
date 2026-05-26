/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { tmpdir } from "os"
import path from "path"

const TMP_DIR = path.join(tmpdir(), "opencode-vision")

export default tool({
  description: `Reads one or more image files and returns a description of their contents.
Use this when the user pastes images but the current model cannot view images directly.
The image(s) will have been auto-saved with a path hint like "[Image auto-saved to ...]" in the conversation.
For multiple images, use the "paths" parameter.

Requires VISION_API_KEY, VISION_API_URL and VISION_MODEL environment variables.`,
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

    // Resolve each path (try absolute first, then fallback to TMP_DIR)
    const resolved: string[] = []
    for (const p of allPaths) {
      let file = Bun.file(p)
      if (await file.exists()) {
        resolved.push(p)
        continue
      }
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
    const model = process.env["VISION_MODEL"]
    if (!apiKey) return "Error: VISION_API_KEY not set"
    if (!baseUrl) return "Error: VISION_API_URL not set"
    if (!model) return "Error: VISION_MODEL not set"

    const apiUrl = `${baseUrl.replace(/\/+$/, "")}/chat/completions`

    const content: Record<string, unknown>[] = []
    if (args.question) {
      content.push({ type: "text", text: args.question })
    } else if (resolved.length > 1) {
      content.push({ type: "text", text: `Describe each of these ${resolved.length} images in detail, labeling which description corresponds to which file.` })
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
  },
})
