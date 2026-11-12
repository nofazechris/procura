"""Writes docs/video-script.md from script.json so the script and the video never drift apart."""
import json, os
H = os.path.dirname(os.path.abspath(__file__))
s = json.load(open(os.path.join(H, "script.json"), encoding="utf8"))
t = 0.0
out = ["# Demo video script (3:00)", "",
       "One idea: **the agent does the work, but it can only spend what you approved.** Generated from `video/script.json`; edit that file, not this one.", "",
       "Honesty rules for this cut: the payment scenes are labelled practice mode; the phone call and seller checks are shown as the flow, not as a recorded real purchase. Swap in a funded run later if you record one.", ""]
def mmss(x): return f"{int(x//60)}:{int(x%60):02d}"
for i, sc in enumerate(s["scenes"], 1):
    out += [f"## {i}. {sc['title']} ({mmss(t)} to {mmss(t+sc['dur'])})", "", f"**On screen.** {sc['motion']}", "", "**Voiceover.**"]
    for ln in sc["vo"]:
        out.append(f"- `{mmss(t+ln['at'])}` {ln['text']}")
    out += ["", "**Sound.** " + ", ".join(sorted({e['kind'] for e in sc['sfx']})) + ".", ""]
    t += sc["dur"]
out += ["## Build", "", "```", "python video/capture_rack.py   # real landing footage (dev server on :3010)", "python video/build_audio.py    # voice, music, effects, mix", "python video/render.py frames  # all frames", "python video/render.py encode  # video/out/procura-demo.mp4", "```", "",
        "The voice is Windows text to speech. To use a recorded or neural voice, put one WAV per line in a folder named `<scene>_<n>.wav` and run `python video/build_audio.py --ext-vo <folder>`."]
open(os.path.join(H, "..", "docs", "video-script.md"), "w", encoding="utf8").write("\n".join(out) + "\n")
