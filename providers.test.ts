import assert from "node:assert/strict";
import { test } from "bun:test";
import { DEFAULT_CONFIG, parseConfig } from "./config.ts";
import { parseDeepgramModels, parseGroqModels, parseTranscript } from "./providers.ts";

test("Groq model discovery keeps unique Whisper transcription models", () => {
	assert.deepEqual(parseGroqModels({ data: [
		{ id: "whisper-large-v3-turbo" }, { id: "llama-3.1" }, { id: "whisper-large-v3" }, { id: "whisper-large-v3" },
	] }), ["whisper-large-v3-turbo", "whisper-large-v3"]);
	assert.deepEqual(parseGroqModels({ data: [] }), []);
});

test("Deepgram model discovery keeps English batch STT models", () => {
	assert.deepEqual(parseDeepgramModels({ stt: [
		{ canonical_name: "nova-3", batch: true, languages: ["en", "es"] },
		{ name: "nova-2", batch: true, languages: ["en-US"] },
		{ name: "stream-only", batch: false, languages: ["en"] },
		{ name: "spanish", batch: true, languages: ["es"] },
	] }), ["nova-3", "nova-2"]);
});

test("transcript parsers handle Groq and Deepgram response shapes", () => {
	assert.equal(parseTranscript("groq", { text: "  hello  " }), "hello");
	assert.equal(parseTranscript("deepgram", { results: { channels: [{ alternatives: [{ transcript: "  hello  " }] }] } }), "hello");
	assert.equal(parseTranscript("deepgram", {}), "");
});

test("voice config rejects invalid settings and preserves valid provider models", () => {
	assert.deepEqual(parseConfig({ provider: "unknown", models: { groq: 4 } }), DEFAULT_CONFIG);
	assert.deepEqual(parseConfig({ provider: "deepgram", models: { groq: "whisper-large-v3", deepgram: "nova-2" } }), {
		provider: "deepgram", models: { groq: "whisper-large-v3", deepgram: "nova-2" },
	});
});
