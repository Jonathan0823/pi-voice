import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, Key, matchesKey } from "@earendil-works/pi-tui";
import { spawn, type ChildProcess } from "node:child_process";
import { METER_CELLS, rmsFromPcm16, rmsToBlock } from "./audio-meter.ts";

const CHANNEL = "pi-voice";
const SAMPLE_RATE = 16_000;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

type Phase = "idle" | "recording" | "transcribing";
type Target = { kind: "editor"; insert: (text: string) => boolean };

function wav(pcm: Buffer): Buffer {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(SAMPLE_RATE, 24);
	header.writeUInt32LE(SAMPLE_RATE * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

export default function (pi: ExtensionAPI) {
	let phase: Phase = "idle";
	let ctx: ExtensionContext | undefined;
	let recorder: ChildProcess | undefined;
	let chunks: Buffer[] = [];
	let bytes = 0;
	let target: Target | undefined;
	let latestTranscript: string | undefined;
	let stopped = false;
	let latestLevel = 0;
	let meter: NodeJS.Timeout | undefined;
	let timer: NodeJS.Timeout | undefined;
	let transcriptionAbort: AbortController | undefined;

	const status = (text: string | undefined) => ctx?.ui.setStatus("pi-voice", text);
	const cleanup = () => {
		if (meter) clearInterval(meter);
		if (timer) clearTimeout(timer);
		meter = undefined;
		timer = undefined;
		status(undefined);
		phase = "idle";
		recorder = undefined;
		chunks = [];
		bytes = 0;
		target = undefined;
		stopped = false;
	};

	const recover = () => {
		if (!latestTranscript || !ctx) {
			ctx?.ui.notify("No dictation to recover", "info");
			return;
		}
		ctx.ui.pasteToEditor(latestTranscript);
		latestTranscript = undefined;
		ctx.ui.notify("Recovered dictation into the main editor", "info");
	};

	const transcribe = async (audio: Buffer, originalTarget: Target | undefined) => {
		const apiKey = process.env.GROQ_API_KEY;
		if (!apiKey || !ctx) {
			ctx?.ui.notify("Set GROQ_API_KEY in the environment running Pi", "error");
			cleanup();
			return;
		}
		phase = "transcribing";
		status("⠋ transcribing…");
		transcriptionAbort = new AbortController();
		try {
			const body = new FormData();
			body.append("file", new Blob([audio], { type: "audio/wav" }), "dictation.wav");
			body.append("model", "whisper-large-v3-turbo");
			body.append("language", "en");
			body.append("response_format", "json");
			const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}` },
				body,
				signal: AbortSignal.any([transcriptionAbort.signal, AbortSignal.timeout(60_000)]),
			});
			if (!response.ok) throw new Error(`Groq returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
			const result: unknown = await response.json();
			const text = typeof result === "object" && result !== null && "text" in result && typeof result.text === "string" ? result.text.trim() : "";
			if (!text) throw new Error("Groq returned an empty transcript");
			if (originalTarget?.insert(text)) {
				latestTranscript = undefined;
			} else {
				latestTranscript = text;
				ctx.ui.notify("The original input closed. Run /voice-recover to insert the transcript into the main editor.", "warning");
			}
		} catch (error) {
			ctx.ui.notify(`Dictation failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		} finally {
			transcriptionAbort = undefined;
			cleanup();
		}
	};

	const stop = () => {
		if (phase !== "recording" || !recorder) return;
		phase = "transcribing";
		status("⠋ finalizing audio…");
		stopped = true;
		const proc = recorder;
		const chunksAtStop = chunks;
		const originalTarget = target;
		proc.once("close", () => {
			if (!ctx || phase !== "transcribing") return;
			if (bytes === 0) {
				ctx.ui.notify("No audio was captured", "warning");
				cleanup();
				return;
			}
			void transcribe(wav(Buffer.concat(chunksAtStop)), originalTarget);
		});
		proc.kill("SIGTERM");
	};

	const start = () => {
		if (!ctx || phase !== "idle") return;
		if (!process.env.GROQ_API_KEY) {
			ctx.ui.notify("Set GROQ_API_KEY in the environment running Pi", "error");
			return;
		}
		chunks = [];
		bytes = 0;
		latestLevel = 0;
		const meterValues = new Array<number>(METER_CELLS).fill(0);
		stopped = false;
		// Popup extensions publish a cursor-aware insertion callback while their editor is active.
		let popupTarget: Target | undefined;
		pi.events.emit(`${CHANNEL}:capture`, { setTarget: (insert: (text: string) => boolean) => { popupTarget = { kind: "editor", insert }; } });
		target = popupTarget ?? { kind: "editor", insert: (text) => {
			if (!ctx || !process.env.GROQ_API_KEY) return false;
			ctx.ui.pasteToEditor(text);
			return true;
		} };
		try {
			recorder = spawn("parec", ["--format=s16le", `--rate=${SAMPLE_RATE}`, "--channels=1", "--raw"], { stdio: ["ignore", "pipe", "pipe"] });
		} catch (error) {
			ctx.ui.notify(`Could not start WSLg microphone capture: ${String(error)}`, "error");
			cleanup();
			return;
		}
		phase = "recording";
		meter = setInterval(() => {
			meterValues.shift();
			meterValues.push(latestLevel);
			const dot = ctx?.ui.theme.fg("error", "●") ?? "●";
			status(`${dot} ${meterValues.map(rmsToBlock).join("")} listening…`);
		}, 60);
		recorder.stdout?.on("data", (chunk: Buffer) => {
			latestLevel = rmsFromPcm16(chunk);
			if (bytes + chunk.length > MAX_AUDIO_BYTES) {
				ctx?.ui.notify("Recording reached Groq’s 24 MiB upload limit; finishing now", "warning");
				stop();
				return;
			}
			chunks.push(Buffer.from(chunk));
			bytes += chunk.length;
		});
		recorder.once("error", (error) => {
			if (!stopped) ctx?.ui.notify(`Microphone capture failed: ${error.message}`, "error");
			cleanup();
		});
		recorder.stderr?.on("data", (chunk: Buffer) => {
			if (!stopped && chunk.toString().trim()) ctx?.ui.notify(`parec: ${chunk.toString().trim().slice(0, 200)}`, "error");
		});
	};

	pi.on("session_start", (_event, sessionCtx) => {
		ctx = sessionCtx;
		if (ctx.mode !== "tui") return;
		ctx.ui.onTerminalInput((data) => {
			if (isKeyRelease(data) || isKeyRepeat(data)) return;
			if (matchesKey(data, Key.alt("m"))) {
				if (phase === "idle") start(); else if (phase === "recording") stop();
				return { consume: true };
			}
			if (matchesKey(data, Key.alt("n"))) {
				if (phase === "recording" || phase === "transcribing") {
					stopped = true;
					transcriptionAbort?.abort();
					recorder?.kill("SIGTERM");
					cleanup();
				}
				return { consume: true };
			}
			return undefined;
		});
	});

	pi.registerCommand("voice-recover", {
		description: "Insert the most recent unrecovered voice transcript into the main editor",
		handler: async () => recover(),
	});
	pi.on("session_shutdown", () => {
		stopped = true;
		transcriptionAbort?.abort();
		recorder?.kill("SIGTERM");
		cleanup();
	});
}
