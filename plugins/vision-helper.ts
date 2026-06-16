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

// Identifies text parts that THIS plugin injected into a user message during a
// previous transform run. The transform hook re-runs for every message sent to
// the LLM (including after a /model switch), so we must clear these stale
// injections on every pass — otherwise native-vision models would see the
// "[vision: imageN/hash.ext]" placeholder text and incorrectly call the vision
// tool to "read" it, instead of viewing the original image part natively.
//
// Mirrored in tests/transform-cleanup.test.ts — keep in sync.
function isPluginInjectedText(text: string): boolean {
  if (!text) return false
  return (
    /^\[Image #\d+ auto-saved to /.test(text) ||
    /^\[Images auto-saved to:/.test(text) ||
    /^\[vision: image\d+\/[\w-]+\.[\w]+]$/.test(text)
  )
}

/**
 * Hook runs just before messages are sent to the model. For every user message
 * with attached images:
 *  1. Skips compaction messages (summary messages are already text)
 *  2. Cleans up any text parts this plugin injected in a previous transform
 *     run (prevents hint/placeholder accumulation across model switches)
 *  3. Saves each image to a temp dir so the vision tool can read it
 *  4. Pushes a path-hint text part telling the LLM where the image was saved
 *
 * We deliberately do NOT replace the original file parts and do NOT decide
 * whether the current model is multimodal — OpenCode already handles both via
 * ProviderTransform.unsupportedParts (checks model.capabilities.input). For
 * native-vision models, the original image part reaches the LLM and it views
 * the image directly; for non-vision models, OpenCode replaces the image part
 * with an ERROR text and the LLM uses the hint to call the vision tool. This
 * plugin stays out of OpenCode's capability decision and only manages the
 * side-channel (temp file + hint), so the plugin's behavior stays consistent
 * with OpenCode's internal mechanism regardless of modelID.
 *
 * To steer native-vision LLMs away from the lossy vision tool (which returns
 * a textual description instead of the image itself), the plugin also
 * registers a tool.definition hook that overrides the vision tool's
 * description, recommending the built-in read tool as the primary path.
 *
 * Images are assigned global sequence numbers in paste order:
 *   1st image → image1/xxx.png
 *   2nd image → image2/yyy.png
 *   3rd image → image3/zzz.png
 *
 * Deduplication uses MD5 of the full base64 (not just the first 1024 chars) to
 * avoid hash collisions for visually similar images.
 */
export default (async () => {
  // Ensure the temp root dir exists at plugin startup
  await fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {})

  return {
    "tool.definition": async (input, output) => {
      if (input.toolID === "vision") {
        output.description = [
          "Reads one or more image files via an external VLM API and returns a textual description.",
          "**Native-vision models should NEVER call this tool — use the built-in `read` tool instead, which returns the actual image attachment directly. This tool exists for text-only models that cannot parse image bytes returned by `read`.**",
        ].join("\n")
      }
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      for (const msg of output.messages) {
        if (msg.info.role !== "user") continue

        // P0-2: Skip compaction messages (they are already summarized text)
        // OpenCode's MessageInfo exposes a `summary` field for compacted msgs
        const info = msg.info as unknown as { role: string; summary?: boolean }
        if (info.summary) continue

        // Clean up any text parts this plugin injected in a previous transform
        // run. Covers both image hints AND [vision: imageN/hash.ext] placeholders
        // so re-processing a user message (e.g. after a /model switch) does
        // not leak stale injections into the prompt.
        for (let i = msg.parts.length - 1; i >= 0; i--) {
          const p = msg.parts[i] as unknown as { type?: string; text?: string }
          if (p.type === "text" && typeof p.text === "string" && isPluginInjectedText(p.text)) {
            msg.parts.splice(i, 1)
          }
        }
        const saved: { name: string; seq: number }[] = []

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

          saved.push({ name, seq })
        }

        if (saved.length === 0) continue

        // Build path hint(s). Intentionally does NOT guide the LLM to the
        // vision tool — the tool.definition hook above steers native-vision
        // models toward the built-in read tool, and the vision tool's own
        // description recommends read for native-vision models. The hint
        // just records where the temp copy is, so any model that needs it
        // can find it.
        const hints = saved.length === 1
          ? `[Image #${saved[0].seq} auto-saved to ${path.join(TMP_DIR, `image${saved[0].seq}`, saved[0].name)}]`
          : `[Images auto-saved to:\n${saved.map((s) => `  ${path.join(TMP_DIR, `image${s.seq}`, s.name)}`).join("\n")}]`

        msg.parts.push({
          type: "text",
          text: hints,
        })
      }
    },
  }
}) satisfies Plugin
