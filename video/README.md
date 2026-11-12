# Demo video

A 3 minute motion-design demo, built from code so every scene can be tweaked and re-rendered.

- `script.json` is the single source: scenes, voiceover lines, on-screen cues, sound cues. The readable version is `docs/video-script.md` (run `python gen_script_doc.py`).
- `stage.html` draws every scene as a pure function of time. `render.py` seeks it frame by frame in Chromium (Playwright), so the render is deterministic.
- `build_audio.py` makes the voice (Microsoft neural voice via `edge-tts`, with per-scene tone, pauses and soft breaths; `--engine sapi` falls back to Windows speech, `--nvoice en-US-AvaNeural` picks another voice), the music and effects (synthesized with numpy) and mixes them, ducking the music under the voice.
- `capture_rack.py` records real footage of the landing page's 3D rack from a running dev server (port 3010).

```bash
python capture_rack.py     # needs: pnpm dev on :3010
python build_audio.py      # build/mix.wav and build/timeline.js
python render.py frames    # about 20 minutes on 8 cores
python render.py encode    # out/procura-demo.mp4
```

Payment scenes are labelled practice mode and the other product scenes are labelled illustrative, because no funded purchase had been recorded when this cut was made. Swap in real screen recordings of a funded run if you make one.
