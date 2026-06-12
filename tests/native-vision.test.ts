import { describe, expect, test } from "bun:test"

// Mirror the NATIVE_VISION regex from the plugin so we can test the matching logic
// without importing the plugin module (which has side effects on load).
const NATIVE_VISION = /gpt-|o[0-9]|claude-|gemini-|pixtral|llama-3\.2.*vision|nova-.*vision|qwen3\.[56](?!-max)|qwen(?:-vl|2[._-]?5?[._-]?vl)|qwen2-vl|qwen3-vl|qwen-omni|qvq-max|kimi-k2\.(5|6)|minimax-m3|minimax-vl|glm-[0-9.]+v|mimo-v2-omni|mimo-v2\.5$|yi-vl|deepseek-vl2|doubao-.*vision|seed-.*vision|internvl/i

describe("NATIVE_VISION regex", () => {
  // Should match (native multimodal)
  const yesCases: Array<[string, string]> = [
    ["gpt-5.4", "OpenAI latest"],
    ["gpt-4o", "OpenAI 4o"],
    ["gpt-4o-mini", "OpenAI 4o mini"],
    ["gpt-5-codex", "OpenAI codex"],
    ["o4-mini", "OpenAI o-series"],
    ["o1", "OpenAI o1"],
    ["claude-sonnet-4-6", "Anthropic sonnet"],
    ["claude-3-5-sonnet", "Anthropic 3.5"],
    ["claude-opus-4-6", "Anthropic opus"],
    ["gemini-2.5-pro", "Google gemini"],
    ["gemini-3-pro", "Google gemini 3"],
    ["pixtral-12b", "Mistral pixtral"],
    ["llama-3.2-90b-vision", "Meta llama 3.2 vision"],
    ["llama-3.2-11b-vision", "Meta llama 3.2 vision"],
    ["nova-pro-vision", "AWS nova vision"],
    ["qwen3.5-plus", "Qwen 3.5 plus"],
    ["qwen3.6-flash", "Qwen 3.6 flash"],
    ["qwen-vl-max", "Qwen VL max"],
    ["qwen2-5-vl-72b-instruct", "Qwen 2.5 VL"],
    ["qwen2-vl-7b", "Qwen 2 VL"],
    ["qwen3-vl-30b", "Qwen 3 VL"],
    ["qwen-omni-turbo", "Qwen omni"],
    ["qvq-max", "Qwen QVQ"],
    ["kimi-k2.5", "Kimi 2.5"],
    ["kimi-k2.6", "Kimi 2.6"],
    ["moonshotai/Kimi-K2.5", "Kimi prefixed"],
    ["MiniMax-M3", "MiniMax M3 (case-insensitive)"],
    ["minimax-m3", "MiniMax M3 lower"],
    ["minimax-vl-01", "MiniMax VL"],
    ["glm-4.5v", "GLM 4.5 vision"],
    ["glm-4.6v", "GLM 4.6 vision"],
    ["glm-5v-turbo", "GLM 5 vision turbo"],
    ["mimo-v2-omni", "Xiaomi MiMo omni"],
    ["mimo-v2.5", "Xiaomi MiMo 2.5"],
    ["yi-vl-6b", "Yi VL"],
    ["deepseek-vl2", "DeepSeek VL2"],
    ["Qwen/Qwen2.5-VL-72B-Instruct", "Qwen with org prefix"],
    ["doubao-1-5-vision-pro", "Doubao vision"],
    ["seed-1-6-vision", "Seed vision"],
    ["internvl2.5", "InternVL"],
  ]

  for (const [id, desc] of yesCases) {
    test(`matches native vision: ${id} (${desc})`, () => {
      expect(NATIVE_VISION.test(id.toLowerCase())).toBe(true)
    })
  }

  // Should NOT match (text-only, fall back to vision tool)
  const noCases: Array<[string, string]> = [
    ["deepseek-v4-flash", "DeepSeek V4 Flash"],
    ["deepseek-v4-pro", "DeepSeek V4 Pro"],
    ["deepseek-r1", "DeepSeek R1"],
    ["deepseek-chat", "DeepSeek chat"],
    ["MiniMax-M2.7", "MiniMax M2.7"],
    ["MiniMax-M2.5", "MiniMax M2.5"],
    ["MiniMax-M2", "MiniMax M2"],
    ["qwen3-max", "Qwen 3 max"],
    ["qwen3.7-max", "Qwen 3.7 max"],
    ["qwen3.6-max-preview", "Qwen 3.6 max preview"],
    ["qwen-plus", "Qwen plus"],
    ["qwen-flash", "Qwen flash"],
    ["qwen-turbo", "Qwen turbo"],
    ["qwen3-32b", "Qwen 3 32B"],
    ["qwen3-235b-a22b", "Qwen 3 235B"],
    ["qwen3-coder-plus", "Qwen coder"],
    ["glm-4.5", "GLM 4.5"],
    ["glm-4.6", "GLM 4.6"],
    ["glm-4.7", "GLM 4.7"],
    ["glm-5", "GLM 5"],
    ["glm-5.1", "GLM 5.1"],
    ["mimo-v2-flash", "MiMo 2 flash"],
    ["mimo-v2-pro", "MiMo 2 pro"],
    ["mimo-v2.5-pro", "MiMo 2.5 pro"],
    ["kimi-k2-thinking", "Kimi thinking"],
    ["kimi-k2-turbo", "Kimi turbo"],
    ["step-1-32k", "Step 1"],
    ["step-3.5-flash", "Step 3.5"],
  ]

  for (const [id, desc] of noCases) {
    test(`does NOT match (text-only): ${id} (${desc})`, () => {
      expect(NATIVE_VISION.test(id.toLowerCase())).toBe(false)
    })
  }
})
