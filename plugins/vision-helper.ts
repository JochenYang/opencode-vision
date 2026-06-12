import type { Plugin } from "@opencode-ai/plugin"
import { createHash } from "crypto"
import { tmpdir } from "os"
import path from "path"
import { promises as fs } from "fs"

const TMP_DIR = path.join(tmpdir(), "opencode-vision")

// Map from content hash to global image sequence number, ensuring each unique image
// gets a stable seq across the session
const imageRegistry = new Map<string, number>()
let nextImageSeq = 1

// LRU eviction: when this many images are stored, oldest image* dir gets deleted
// Default 200 images (~200MB cap); adjustable via VISION_MAX_IMAGES env var
const MAX_IMAGES = Number(process.env["VISION_MAX_IMAGES"] || 200)
const LRU_QUEUE: string[] = []  // image{N} dir paths in access order
const LRU_SET = new Set<string>()  // fast membership check

function touchLRU(seqDir: string) {
  LRU_QUEUE.push(seqDir)
  LRU_SET.add(seqDir)
  // Evict oldest entries when over the cap (FIFO)
  while (LRU_QUEUE.length > MAX_IMAGES) {
    const oldest = LRU_QUEUE.shift()
    if (!oldest) break
    LRU_SET.delete(oldest)
    // Asynchronously delete the oldest image dir
    fs.rm(oldest, { recursive: true, force: true }).catch(() => {})
  }
}

// Regex matching models with native multimodal (image) support.
// Matched models → skip the transform, let OpenCode's native pipeline handle the image.
// Non-matched models → fall through to the vision tool.
const NATIVE_VISION = /gpt-|o[0-9]|claude-|gemini-|qwen3\.(5|6)|qwen-vl|qwen2-5-vl|qwen3-vl|qwen-omni|qvq-max|kimi-k2\.(5|6)|minimax-m3|minimax-vl|glm-[0-9.]+v|mimo-v2-omni|mimo-v2\.5$|yi-vl|deepseek-vl2/i

/**
 * Hook runs just before messages are sent to the model. Detects image attachments in
 * user messages and either:
 *  1. Skips the transform if the current model supports native multimodal
 *  2. Skips the transform during compaction (summary messages are already text)
 *  3. Otherwise:
 *     a. Saves images to a temp dir
 *     b. Replaces file parts with short text placeholders (avoids unsupportedParts ERROR)
 *     c. Pushes a path-hint text part for the model to call the vision tool
 *     d. Cleans up hints from a previous transform run (prevents accumulation)
 *     e. Tracks usage for LRU eviction
 *
 * Images are assigned global sequence numbers in paste order:
 *   1st image → image1/xxx.png
 *   2nd image → image2/yyy.png
 *   3rd image → image3/zzz.png
 *
 * Deduplication uses MD5 of the full base64 (not just the first 1024 chars) to avoid
 * hash collisions for visually similar images.
 */
export default (async () => {
  // Ensure the temp root dir exists at plugin startup
  await fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {})

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      for (const msg of output.messages) {
        if (msg.info.role !== "user") continue

        // P0-2: Skip compaction messages (they are already summarized text)
        // OpenCode's MessageInfo exposes a `summary` field for compacted msgs
        const info = msg.info as unknown as { role: string; summary?: boolean }
        if (info.summary) continue

        // Check whether the current model supports native vision
        const modelID = (msg.info.model?.modelID || "").toLowerCase()
        if (NATIVE_VISION.test(modelID)) continue

        // Clean up any hints injected by a previous transform run (prevents accumulation)
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

          // P1-1: MD5 over the FULL base64 (not just first 1024 chars) to avoid collisions
          // for visually similar images. First 8 hex chars used as a short filename id.
          const hash = createHash("md5").update(base64).digest("hex").slice(0, 8)

          let seq = imageRegistry.get(hash)
          if (!seq) {
            seq = nextImageSeq++
            imageRegistry.set(hash, seq)
          }

          const ext = part.mime.split("/")[1] || "png"
          const name = `${hash}.${ext}`

          const seqDir = path.join(TMP_DIR, `image${seq}`)
          const filePath = path.join(seqDir, name)
          // P1-3: write failures degrade to a skip (don't throw, don't break the turn)
          if (!(await Bun.file(filePath).exists())) {
            try {
              await Bun.write(filePath, Buffer.from(base64, "base64"))
            } catch (err) {
              console.error(`[vision-helper] Failed to write ${filePath}:`, err)
              continue
            }
          }

          // P0-5: record access for LRU eviction
          touchLRU(seqDir)

          saved.push({ index: i, name, seq })
        }

        if (saved.length === 0) continue

        // Replace image parts with short placeholders to avoid unsupportedParts ERROR
        for (const { index, name, seq } of saved.toReversed()) {
          msg.parts.splice(index, 1, {
            type: "text",
            text: `[vision: image${seq}/${name}]`,
          } as never)
        }

        // Build path hint(s) for the model to use the vision tool
        const hints = saved.length === 1
          ? `[Image #${saved[0].seq} auto-saved to ${path.join(TMP_DIR, `image${saved[0].seq}`, saved[0].name)} — use the vision tool to read it]`
          : `[Images auto-saved to:\n${saved.map((s) => `  ${path.join(TMP_DIR, `image${s.seq}`, s.name)}`).join("\n")}\n— use the vision tool with paths=[...] to read them all at once]`

        ;(msg.parts as unknown as Record<string, unknown>[]).push({
          type: "text" as const,
          text: hints,
        })
      }
    },
  }
}) satisfies Plugin
