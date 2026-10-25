# pi-voice

Voice dictation for [Pi](https://github.com/earendil-works/pi), using Groq Whisper for transcription.

Speak into Pi’s editor, stop recording, and insert the completed transcript at the cursor. Dictation does not submit your prompt.

## Requirements

- Pi running in interactive terminal mode.
- A Linux PulseAudio-compatible recording source. The primary target is WSL2 with WSLg.
- `parec` available on `PATH`. On Ubuntu/WSL, install it with:
  ```bash
  sudo apt update && sudo apt install pulseaudio-utils
  ```
- A Groq API key with access to the speech-to-text API.

The recorder uses the system’s default PulseAudio source. In WSLg, check it with `pactl get-default-source`.

## Install

```bash
pi install git:github.com/Jonathan0823/pi-voice
```

Restart Pi or run `/reload` after installing.

## Configure Groq

Create an API key in the [Groq Console](https://console.groq.com/keys). In the WSL shell that launches Pi, set it without echoing it to the terminal:

```bash
read -rsp "Groq API key: " GROQ_API_KEY
printf '\n'
export GROQ_API_KEY
```

For future shells, add `export GROQ_API_KEY="your-key"` to `~/.bashrc`, then run `source ~/.bashrc`. Keep that file private and out of source control.

## Use

- **Alt+M** — start recording; press again to stop and transcribe.
- **Alt+N** — cancel and discard the current dictation.

While recording, the status line shows a six-bar microphone-level meter. After stopping, Pi shows a transcription status and inserts the finished English transcript at the cursor. Audio is collected while you speak; partial text is not streamed into the editor.

If the original popup closes before transcription finishes, the transcript is kept in memory. Run `/voice-recover` to insert it into Pi’s main editor.

### Popup support

The package works with Pi’s main editor on its own. Popup editors need a cooperating host extension to expose their text field. In the pi-config setup, the `ask-user-question` integration supports its free-text popup and routes choice-popup dictation to the “Other” answer field. Other popup extensions are not automatically supported.

## Audio and privacy

The extension captures 16 kHz, mono, signed 16-bit audio through `parec`, keeps it in memory, and uploads it to Groq’s transcription API when you stop. It does not save audio files. Groq receives the audio to produce the transcript; do not use dictation for content you do not want sent to that service.

The selected model is `whisper-large-v3-turbo`, with English specified as the input language. The current implementation does not provide local transcription or live partial results.

## Troubleshooting

- **`GROQ_API_KEY` is not set:** Pi only sees environment variables inherited by the shell that launched it. Set the key in the WSL shell, then restart Pi.
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

The audio-meter test currently lives in the pi-config repository rather than this standalone package repository.
