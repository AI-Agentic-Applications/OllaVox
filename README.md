# 🎙️ OllaVox

Lightweight, single-page local LLM web client with voice.

The zero-build, single-file voice & text web UI for Ollama and LM Studio.
No Docker. No Node.js. No Python. Just double-click ollavox.html and talk to your local LLMs.


## ✨ Why OllaVox?

Most local LLM interfaces require heavy Docker containers, massive node_modules folders, or complex Python environments just to send a prompt. OllaVox puts a fast, conversational voice and text interface into one single HTML file using pure Vanilla JavaScript and native browser APIs.

## 🚀 Key Features

- 📄 Single-File & Zero-Build: Everything lives inside ollavox.html. Open it directly from your desktop (file://) or drop it onto any static host.
- 🗣️ Hands-Free Continuous Listening: Talk naturally across multiple turns without touching your keyboard. Includes an automatic timeout-recovery loop so the mic stays open during pauses.
- 🛑 Real-Time "Barge-In" Interruption: Interrupt the AI mid-sentence just like a real conversation. Speaking over the AI—or saying customizable stop words ("stop", "cancel", "hold on", "quiet")—immediately halts audio playback and aborts the in-flight LLM stream to save tokens.
- ⚡ Low-Latency Sentence Streaming: Don't wait for the entire response to generate. OllaVox streams tokens and speaks each sentence aloud the millisecond it finishes generating.
- 🔌 100% Offline Voice Option (Vosk-Browser): Works out-of-the-box with the native Web Speech API, or switch to Vosk-Browser with a local .zip model for air-gapped offline speech recognition and cross-browser support (including Firefox & Brave).
- 🧠 Smart Context & Persona Control: Configure custom Context Sizes (num_ctx) with automatic sliding-window trimming, edit your System Prompt, and customize themes/backgrounds—all saved automatically in localStorage.

## 📸 Preview

Tip: Replace this section with a 10-second GIF showing hands-free voice chat and barge-in interruption!

```text
+-------------------------------------------------------------------+

| 🎙️ OllaVox   [Ollama ▾]  [llama3.2:latest ▾]   ~420/4096   ⚙️ |
+-------------------------------------------------------------------+

|                                                                   |
|  You: Summarize quantum entanglement in two short sentences.      |
|                                                                   |
|  AI:  Quantum entanglement links two particles so that measuring  |
|       one instantly determines the state of the other, no matter  |
|       how far apart they are... [🔊 Speaking]                     |
|                                                                   |
+-------------------------------------------------------------------+

| [ 🎤 Continuous: ON ]  Type or speak...              [ ⏹ Stop ]  |
+-------------------------------------------------------------------+
```

## ⚡ Quick Start


1. Download

Download ollavox.html directly from the repository (or clone the repo):

```bash
git clone https://github.com
cd OllaVox
```

2. Enable CORS on Your Local Backend

Because ollavox.html runs locally in your browser and talks to localhost, you need to allow local browser origins once:
- For Ollama:
	-macOS / Linux:
  ```bash
OLLAMA_ORIGINS="*" ollama serve
```
	-Windows (PowerShell):
  ```powershell
$env:OLLAMA_ORIGINS="*"; ollama serve
```
- For LM Studio:
	1. Open the Local Server tab (<->).
	2. Toggle Enable CORS to ON and click Start Server.

3. Launch

Double-click ollavox.html to open it in Chrome, Edge, Safari, or Firefox. Select your provider, pick a model, and start talking!

## 🎙️ Using Hands-Free & Barge-In Mode

1. Put on headphones (Recommended during Continuous Mode so your microphone doesn't pick up the AI's speaker output and interrupt itself).
2. Click the Continuous Listening toggle in the bottom bar.
3. Speak naturally. Your words appear live in the input box and automatically send when you pause.
4. To interrupt the AI mid-response: Simply start speaking your next thought, or say a stop command ("stop", "cancel", "never mind", "quiet").

Using 100% Offline Speech-to-Text (Vosk)

Want zero cloud dependency or using a browser without native Web Speech support?
1. Download a lightweight model (e.g., vosk-model-small-en-us-0.15.zip, ~40MB) from alphacephei.com.
2. Open Settings (⚙️) in OllaVox, switch STT Engine to Offline Vosk-Browser, and select your local .zip model file.

## 🛠️ Tech Stack

- Core: Vanilla HTML5, CSS3 (Custom Properties + Glassmorphism), ES2022+ JavaScript
- LLM APIs: Ollama REST API (/api/chat, /api/tags) & OpenAI-compatible LM Studio API (/v1/chat/completions, /v1/models)
- Audio I/O: Web Speech API (SpeechRecognition & SpeechSynthesis), AbortController, and optional vosk-browser WebAssembly

## 🤝 Contributing

Contributions are welcome! To keep OllaVox true to its mission, please follow two rules when submitting PRs:
1. Keep it single-file: All code must remain inside ollavox.html.
2. Zero external UI/JS frameworks: Stick to clean, readable Vanilla JS and native browser APIs.

## 📄 License

Distributed under the MIT License. See LICENSE for more information.
Would you like me to generate the complete ollavox.html code next so you have the working app ready to commit alongside this README?
