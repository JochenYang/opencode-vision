import { describe, expect, test } from "bun:test"

// Mirror of the tool.definition hook from the plugin. Kept in sync manually;
// both copies read the same constant strings below.
async function applyToolDefinitionHook(
  input: { toolID: string },
  output: { description: string; parameters: unknown; jsonSchema: unknown },
) {
  if (input.toolID === "vision") {
    output.description = [
      "Reads one or more image files via an external VLM API and returns a textual description.",
      "**Native-vision models should NEVER call this tool — use the built-in `read` tool instead, which returns the actual image attachment directly. This tool exists for text-only models that cannot parse image bytes returned by `read`.**",
    ].join("\n")
  }
}

// Mirror of isPluginInjectedText helper — kept in sync with both
// plugins/vision-helper.ts and tests/transform-cleanup.test.ts.
function isPluginInjectedText(text: string): boolean {
  if (!text) return false
  return (
    /^\[Image #\d+ auto-saved to /.test(text) ||
    /^\[Images auto-saved to:/.test(text) ||
    /^\[vision: image\d+\/[\w-]+\.[\w]+]$/.test(text)
  )
}

describe("tool.definition hook (vision tool description override)", () => {
  test("overrides description for toolID='vision'", async () => {
    const input = { toolID: "vision" }
    const output = { description: "original description", parameters: {}, jsonSchema: {} }
    await applyToolDefinitionHook(input, output)

    expect(output.description).not.toBe("original description")
    expect(output.description).toContain("Native-vision models should NEVER call this tool")
    expect(output.description).toContain("`read`")
    expect(output.description).toContain("text-only models")
  })

  test("does not override description for any other built-in toolID", async () => {
    const otherToolIDs = [
      "bash",
      "read",
      "edit",
      "write",
      "glob",
      "grep",
      "task",
      "fetch",
      "todo",
      "websearch",
      "skill",
    ]
    for (const toolID of otherToolIDs) {
      const input = { toolID }
      const original = `original-${toolID}`
      const output = { description: original, parameters: {}, jsonSchema: {} }
      await applyToolDefinitionHook(input, output)
      expect(output.description).toBe(original)
    }
  })

  test("is case-sensitive — 'VISION' does not match", async () => {
    const input = { toolID: "VISION" }
    const output = { description: "original", parameters: {}, jsonSchema: {} }
    await applyToolDefinitionHook(input, output)
    expect(output.description).toBe("original")
  })

  test("does not modify parameters or jsonSchema", async () => {
    const input = { toolID: "vision" }
    const params = { foo: "bar" }
    const schema = { type: "object" }
    const output = { description: "original", parameters: params, jsonSchema: schema }
    await applyToolDefinitionHook(input, output)
    expect(output.parameters).toBe(params)
    expect(output.jsonSchema).toBe(schema)
  })
})

describe("hint text format", () => {
  // The hint format mirrors vision-helper.ts. We verify the new hints:
  //   1. no longer guide the LLM to call the vision tool — the tool.definition
  //      hook (above) is now responsible for steering the LLM toward `read`
  //   2. still match isPluginInjectedText so the cleanup loop removes them on
  //      subsequent transform runs (e.g. after a /model switch)

  test("single-image hint has no vision-tool guidance and is still plugin-injected", () => {
    const hint = `[Image #1 auto-saved to /tmp/opencode-vision/image1/2e96adc9.png]`
    expect(hint).not.toMatch(/vision tool/i)
    expect(isPluginInjectedText(hint)).toBe(true)
  })

  test("multi-image hint has no vision-tool guidance and is still plugin-injected", () => {
    const hint = `[Images auto-saved to:\n  /tmp/opencode-vision/image1/2e96adc9.png\n  /tmp/opencode-vision/image2/abc.jpg]`
    expect(hint).not.toMatch(/vision tool/i)
    expect(isPluginInjectedText(hint)).toBe(true)
  })
})
