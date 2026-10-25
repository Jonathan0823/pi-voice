# pi-voice

Voice dictation for [Pi](https://github.com/earendil-works/pi), using Groq Whisper or Deepgram for transcription.

Speak into Pi, stop recording, and insert the completed transcript at the cursor. Dictation does not submit your prompt.

## Requirements

- Pi running in interactive terminal mode.
- A Linux PulseAudio-compatible recording source. The primary target is WSL2 with WSLg.
- `parec` available on `PATH`. On Ubuntu/WSL, install it with:
  ```bash
  sudo apt update && sudo apt install pulseaudio-utils
  ```
- An API key for the selected provider: `GROQ_API_KEY` or `DEEPGRAM_API_KEY`.

The recorder uses the system’s default PulseAudio source. In WSLg, check it with `pactl get-default-source`.

## Install

```bash
pi install git:github.com/Jonathan0823/pi-voice
```

Restart Pi or run `/reload` after installing.

## Configure providers

Set the API key in the WSL shell that launches Pi. The key is read from the process environment and is never written to the voice config file.

```bash
read -rsp "Groq API key: " GROQ_API_KEY
printf '\n'
export GROQ_API_KEY
```

Or set `DEEPGRAM_API_KEY` instead (or set both to switch between providers). For future shells, add the desired `export ...` line to `~/.bashrc`, then run `source ~/.bashrc`. Keep that file private and out of source control.

Run `/voice-provider` to choose Groq or Deepgram, then choose a model. The picker requests current models from the selected provider and filters to speech-to-text models usable for English batch transcription. If the key is missing or the request fails, it shows built-in choices: Groq `whisper-large-v3-turbo` / `whisper-large-v3`, or Deepgram `nova-3` / `nova-2`.

The selected provider and a separate model choice for each provider are stored globally in `~/.config/pi-voice/config.json`. Defaults are Groq with `whisper-large-v3-turbo` and Deepgram with `nova-3`. The config contains preferences only, never API keys.

## Use

- **Alt+M** — start recording; press again to stop and transcribe.
- **Alt+N** — cancel and discard the current dictation.
- **`/voice-provider`** — choose the provider and its model.
- **`/voice-recover`** — insert the most recent unrecovered transcript into the main editor.

While recording, the status line shows a six-bar microphone-level meter. After stopping, Pi shows a transcription status and inserts the finished English transcript at the cursor. Audio is collected while you speak; partial text is not streamed into the editor.

If the original popup closes before transcription finishes, the transcript is kept in memory. Run `/voice-recover` to insert it into Pi’s main editor.

### Popup support

The package works with Pi’s main editor on its own. Popup editors need a cooperating host extension to expose their text field. In the pi-config setup, the `ask-user-question` integration supports its free-text popup and routes choice-popup dictation to the “Other” answer field. Other popup extensions are not automatically supported.

## Audio and privacy

The extension captures 16 kHz, mono, signed 16-bit audio through `parec`, keeps it in memory, and uploads it to the selected provider when you stop. It does not save audio files. The provider receives the audio to produce the transcript; do not use dictation for content you do not want sent to that service.

Groq transcription uses `whisper-large-v3-turbo` by default; Deepgram uses `nova-3`. The current implementation does not provide local transcription or live partial results.

## Troubleshooting

- **API key is not set:** Pi only sees environment variables inherited by the shell that launched it. Set the selected provider’s key in that shell, then restart Pi.
- **Model list cannot be fetched:** the picker falls back to its built-in models. Check the key and network connection if you expected newer models.
- **`parec` is missing:** install `pulseaudio-utils` in Ubuntu/WSL.
- **`parec: Stream error: No such entity`:** the extension uses the default PulseAudio source automatically. Check `pactl get-default-source` and `pactl list short sources`; do not pass the literal name `default` as a source device.
- **No microphone level while speaking:** verify WSLg audio is available and that the default source is the intended microphone. `pactl info` shows the PulseAudio server connection.
- **Alt shortcuts do not fire:** check that your terminal and tmux configuration pass Alt+M and Alt+N to Pi.

## Development

Clone the repository, then load the local package for a Pi run:

```bash
git clone https://github.com/Jonathan0823/pi-voice.git
cd pi-voice
pi -e .
```

A Bun build smoke check is:

```bash
bun build index.ts --target=bun \
  --external @earendil-works/pi-coding-agent \
  --external @earendil-works/pi-tui \
  --outdir /tmp/pi-voice-build
```

Run extension unit tests with `bun test` from this directory. The audio-meter test currently lives in the pi-config repository rather than this standalone package repository.
