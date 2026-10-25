import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export type Provider = "groq" | "deepgram";
export type VoiceConfig = { provider: Provider; models: Record<Provider, string> };

export const DEFAULT_CONFIG: VoiceConfig = {
	provider: "groq",
	models: { groq: "whisper-large-v3-turbo", deepgram: "nova-3" },
};

export function parseConfig(value: unknown): VoiceConfig {
	if (typeof value !== "object" || value === null) return structuredClone(DEFAULT_CONFIG);
	const input = value as Partial<VoiceConfig>;
	return {
		provider: input.provider === "deepgram" ? "deepgram" : "groq",
		models: {
			groq: typeof input.models?.groq === "string" ? input.models.groq : DEFAULT_CONFIG.models.groq,
			deepgram: typeof input.models?.deepgram === "string" ? input.models.deepgram : DEFAULT_CONFIG.models.deepgram,
		},
	};
}

const configDir = join(homedir(), ".config", "pi-voice");
const configPath = join(configDir, "config.json");

export async function loadConfig(): Promise<VoiceConfig> {
	try {
		return parseConfig(JSON.parse(await readFile(configPath, "utf8")));
	} catch {
		return structuredClone(DEFAULT_CONFIG);
	}
}

export async function saveConfig(config: VoiceConfig): Promise<void> {
	await mkdir(configDir, { recursive: true, mode: 0o700 });
	const tempPath = join(configDir, `.config-${randomUUID()}.tmp`);
	try {
		await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		await rename(tempPath, configPath);
	} catch (error) {
		await rm(tempPath, { force: true });
		throw error;
	}
}
