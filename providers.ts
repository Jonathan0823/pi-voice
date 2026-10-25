import type { Provider } from "./config.ts";

export const PROVIDERS: Record<Provider, { label: string; keyEnv: string; fallback: string[] }> = {
	groq: { label: "Groq", keyEnv: "GROQ_API_KEY", fallback: ["whisper-large-v3-turbo", "whisper-large-v3"] },
	deepgram: { label: "Deepgram", keyEnv: "DEEPGRAM_API_KEY", fallback: ["nova-3", "nova-2"] },
};

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

// shortcut: Groq's models endpoint lacks STT capability metadata; update this filter if transcription IDs stop using the documented Whisper prefix.
export function parseGroqModels(value: unknown): string[] {
	if (typeof value !== "object" || value === null || !("data" in value) || !Array.isArray(value.data)) return [];
	return unique(value.data.flatMap((model) =>
		typeof model === "object" && model !== null && "id" in model && typeof model.id === "string" && model.id.startsWith("whisper-")
			? [model.id]
			: [],
	));
}

export function parseDeepgramModels(value: unknown): string[] {
	if (typeof value !== "object" || value === null || !("stt" in value) || !Array.isArray(value.stt)) return [];
	return unique(value.stt.flatMap((model) => {
		if (typeof model !== "object" || model === null || !("batch" in model) || model.batch !== true) return [];
		const languages = "languages" in model && Array.isArray(model.languages) ? model.languages : [];
		if (!languages.some((language) => typeof language === "string" && /^en(?:-|$)/i.test(language))) return [];
		const name = "canonical_name" in model && typeof model.canonical_name === "string"
			? model.canonical_name
			: "name" in model && typeof model.name === "string" ? model.name : undefined;
		return name ? [name] : [];
	}));
}

export function parseTranscript(provider: Provider, result: unknown): string {
	if (provider === "groq") {
		return typeof result === "object" && result !== null && "text" in result && typeof result.text === "string" ? result.text.trim() : "";
	}
	if (typeof result !== "object" || result === null || !("results" in result) || typeof result.results !== "object" || result.results === null || !("channels" in result.results) || !Array.isArray(result.results.channels)) return "";
	return result.results.channels.flatMap((channel) => typeof channel === "object" && channel !== null && "alternatives" in channel && Array.isArray(channel.alternatives) ? channel.alternatives : [])
		.map((alternative) => typeof alternative === "object" && alternative !== null && "transcript" in alternative && typeof alternative.transcript === "string" ? alternative.transcript.trim() : "").find(Boolean) ?? "";
}

export async function fetchModels(provider: Provider, apiKey: string): Promise<string[]> {
	const groq = provider === "groq";
	const response = await fetch(groq ? "https://api.groq.com/openai/v1/models" : "https://api.deepgram.com/v1/models", {
		headers: { Authorization: `${groq ? "Bearer" : "Token"} ${apiKey}` },
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) throw new Error(`${PROVIDERS[provider].label} returned HTTP ${response.status}`);
	const result: unknown = await response.json();
	const models = groq ? parseGroqModels(result) : parseDeepgramModels(result);
	if (!models.length) throw new Error("No compatible speech-to-text models were returned");
	return models.sort((a, b) => a.localeCompare(b));
}

export async function transcribe(provider: Provider, apiKey: string, model: string, audio: Buffer, signal: AbortSignal): Promise<string> {
	let response: Response;
	if (provider === "groq") {
		const body = new FormData();
		body.append("file", new Blob([audio], { type: "audio/wav" }), "dictation.wav");
		body.append("model", model);
		body.append("language", "en");
		body.append("response_format", "json");
		response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
			method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body, signal,
		});
	} else {
		const url = new URL("https://api.deepgram.com/v1/listen");
		url.searchParams.set("model", model);
		url.searchParams.set("language", "en");
		response = await fetch(url, {
			method: "POST", headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" }, body: audio, signal,
		});
	}
	if (!response.ok) throw new Error(`${PROVIDERS[provider].label} returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
	const result: unknown = await response.json();
	const text = parseTranscript(provider, result);
	if (!text) throw new Error(`${PROVIDERS[provider].label} returned an empty transcript`);
	return text;
}
