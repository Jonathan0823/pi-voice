export const METER_CELLS = 6;
const PEAK_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const FLOOR_DB = -50;
const CEILING_DB = -10;

export function rmsFromPcm16(pcm: Buffer): number {
	const samples = Math.floor(pcm.length / 2);
	if (samples === 0) return 0;
	let squares = 0;
	for (let i = 0; i < samples * 2; i += 2) {
		const sample = pcm.readInt16LE(i);
		squares += sample * sample;
	}
	return Math.sqrt(squares / samples) / 32768;
}

export function rmsToBlock(rms: number): string {
	if (rms <= 0) return PEAK_BLOCKS[0];
	const db = 20 * Math.log10(rms);
	const t = Math.max(0, Math.min(1, (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)));
	return PEAK_BLOCKS[Math.floor(t * (PEAK_BLOCKS.length - 1))];
}
