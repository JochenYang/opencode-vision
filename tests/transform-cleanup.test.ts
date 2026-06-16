import { describe, expect, test } from "bun:test"

// Mirror the helper from the plugin so we can test the matching logic
// without importing the plugin module (which has side effects on load).
//
// isPluginInjectedText identifies text parts that THIS plugin injected into a
// user message's parts during a previous transform run. The transform hook
// re-runs for every message sent to the LLM (including after a /model switch),
// so we must clear these stale injections — otherwise native-vision models
// see "[vision: imageN/hash.ext]" placeholders and incorrectly
// call the vision tool to "read" them, instead of viewing the real image part.
function isPluginInjectedText(text: string): boolean {
  if (!text) return false
  return (
    /^\[Image #\d+ auto-saved to /.test(text) ||
    /^\[Images auto-saved to:/.test(text) ||
    /^\[vision: image\d+\/[\w-]+\.[\w]+]$/.test(text)
  )
}

describe("isPluginInjectedText (transform cleanup)", () => {
  // ── Should return true: text this plugin wrote ──────────────────────
  const yesCases: Array<[string, string]> = [
    [
      "[Image #1 auto-saved to /tmp/opencode-vision/image1/2e96adc9.png — use the vision tool to read it]",
      "single image hint, seq=1",
    ],
    [
      "[Image #12 auto-saved to C:\\Users\\x\\AppData\\Local\\Temp\\opencode-vision\\image12\\abc.png — use the vision tool to read it]",
      "single image hint, seq=12, Windows path",
    ],
    [
      "[Images auto-saved to:\n  /tmp/opencode-vision/image1/aaa.png\n  /tmp/opencode-vision/image2/bbb.png\n— use the vision tool with paths=[...] to read them all at once]",
      "multi-image hint with newlines",
    ],
    [
      "[vision: image1/2e96adc9.png]",
      "placeholder for image part, seq=1",
    ],
    [
      "[vision: image12/2e96adc9.jpg]",
      "placeholder, seq=12, jpg",
    ],
    [
      "[vision: image1/abc-def_123.png]",
      "placeholder, hash with - and _ chars",
    ],
    [
      "[vision: image999/short.jpeg]",
      "placeholder, seq=999",
    ],
  ]

  for (const [text, desc] of yesCases) {
    test(`returns true for plugin-injected: ${desc}`, () => {
      expect(isPluginInjectedText(text)).toBe(true)
    })
  }

  // ── Should return false: real user/model text (must NOT be cleared) ──
  const noCases: Array<[string, string]> = [
    ["", "empty string"],
    ["hello world", "plain user text"],
    ["I see you attached an image", "normal user prose"],
    ["[Image attached: photo.jpg]", "user referring to an image, not the hint"],
    ["[vision: image1/abc]", "placeholder missing file extension"],
    ["[vision: image1/abc.png] extra trailing text", "placeholder with trailing content breaks the closed bracket"],
    [" [vision: image1/abc.png]", "leading space breaks the regex anchor"],
    ["[Vision: image1/abc.png]", "wrong-case prefix (regex is case-sensitive)"],
    ["use [vision: image1/abc.png] in your reply", "placeholder embedded in prose (not at start)"],
    ["[Image 1 auto-saved to /tmp/x]", "missing # char after Image"],
    ["[Images #1 auto-saved to /tmp/x]", "uses # but wrong word (Image vs Images)"],
    ["[image #1 auto-saved to /tmp/x]", "wrong-case word"],
    ["[Image #-1 auto-saved to /tmp/x]", "negative seq (seq is always positive int)"],
    ["[vision: imageabc/hash.png]", "missing digits in image seq"],
    ["[vision: image1/hash]", "placeholder without file extension"],
    [
      "Let me read [vision: image1/abc.png] from disk",
      "placeholder inside a longer sentence",
    ],
  ]

  for (const [text, desc] of noCases) {
    test(`returns false for real text: ${desc}`, () => {
      expect(isPluginInjectedText(text)).toBe(false)
    })
  }

  // ── Sanity: mixed parts array (realistic transform input) ──────────
  test("cleaning logic removes only injected parts from a mixed parts array", () => {
    const parts: Array<{ type: string; text?: string }> = [
      { type: "text", text: "请看下面这张图：" },
      { type: "file", mime: "image/png" },
      { type: "text", text: "[vision: image1/2e96adc9.png]" },
      { type: "text", text: "[Image #1 auto-saved to /tmp/x/image1/2e96adc9.png — use the vision tool to read it]" },
      { type: "text", text: "下面是第二张：" },
      { type: "file", mime: "image/jpeg" },
      { type: "text", text: "[vision: image2/abc.jpg]" },
      { type: "text", text: "以上，谢谢" },
    ]

    // Simulate the cleanup loop (same logic as the plugin)
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      if (p.type === "text" && typeof p.text === "string" && isPluginInjectedText(p.text)) {
        parts.splice(i, 1)
      }
    }

    // Remaining: only real text + image parts
    expect(parts.map((p) => p.type + (p.text ? `:${p.text}` : ""))).toEqual([
      "text:请看下面这张图：",
      "file",
      "text:下面是第二张：",
      "file",
      "text:以上，谢谢",
    ])
  })
})
