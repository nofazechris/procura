"""Builds the voiceover, music, sound effects and the final mix from script.json.

Outputs (in build/): vo/*.wav, mix.wav, timeline.js (consumed by the renderer).
Run: python build_audio.py [--voice Mark] [--rate 0.95]
"""
import argparse, hashlib, json, os, subprocess, sys
import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
os.makedirs(os.path.join(BUILD, "vo"), exist_ok=True)
rng = np.random.default_rng(7)

ap = argparse.ArgumentParser()
ap.add_argument("--voice", default="Mark")
ap.add_argument("--rate", type=float, default=0.95)
ap.add_argument("--engine", default="neural", choices=["neural", "sapi"])
ap.add_argument("--nvoice", default="en-US-AndrewNeural")
ap.add_argument("--ext-vo", default=None, help="folder of pre-made VO wavs named <scene>_<n>.wav (replaces TTS)")
args = ap.parse_args()

script = json.load(open(os.path.join(HERE, "script.json"), encoding="utf8"))

# ---------------------------------------------------------------- voice
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(" ".join(cmd) + "\n" + r.stderr[-800:])
    return r.stdout

def read_pcm(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)

SCENE_TONE = {  # (rate %, pitch Hz) per scene: the voice follows the story's mood
    "hook": (-10, -4), "problem": (-4, -1), "limits": (-2, 0), "research": (0, 1), "prove": (-4, -2),
    "confirm": (-5, -2), "pay": (-3, -1), "call": (2, 2), "close": (-8, -2)}
LINE_TONE = {  # (scene, line index) -> extra (rate %, pitch Hz) on top of the scene tone
    ("hook", 1): (-5, -2), ("problem", 0): (-6, -2), ("problem", 1): (-8, -1), ("problem", 2): (0, 0),
    ("pay", 3): (-4, -2), ("pay", 2): (-2, 0), ("prove", 4): (-2, -1), ("close", 3): (-5, -1), ("close", 2): (-2, -1),
    ("confirm", 3): (-6, -1), ("confirm", 4): (-4, -2), ("call", 0): (0, 1), ("limits", 5): (-4, -1)}

def split_sentences(text):
    import re
    return [p.strip() for p in re.split(r"(?<=[.!?])\s+", text) if p.strip()]

def silence(sec): return np.zeros(int(sec * SR))

def synth_line(scene_id, i, text):
    key = hashlib.sha1(f"{args.engine}|{args.nvoice}|{args.voice}|{args.rate}|{text}|{SCENE_TONE.get(scene_id)}|{LINE_TONE.get((scene_id, i))}|v3".encode()).hexdigest()[:10]
    raw = os.path.join(BUILD, "vo", f"{scene_id}_{i}_{key}.raw.wav")
    fin = os.path.join(BUILD, "vo", f"{scene_id}_{i}_{key}.wav")
    if os.path.exists(fin):
        return fin
    if args.ext_vo:
        src = os.path.join(args.ext_vo, f"{scene_id}_{i}.wav")
        run(["ffmpeg", "-y", "-v", "error", "-i", src, "-ar", str(SR), "-ac", "1", raw])
    elif args.engine == "neural":
        import tts_neural
        r0, p0 = SCENE_TONE.get(scene_id, (0, 0)); lr, lp_ = LINE_TONE.get((scene_id, i), (0, 0))
        sents = split_sentences(text); parts = []
        for k, sn in enumerate(sents):
            words = len(sn.split()); last = k == len(sents) - 1
            r, p = r0 + lr, p0 + lp_
            if words <= 3: r -= 8; p -= 2            # short statements land slowly and low
            if last and len(sents) > 1: r -= 3; p -= 1  # sentences settle at the end of a thought
            mp3 = os.path.join(BUILD, "vo", f"{scene_id}_{i}_{k}_{key}.mp3")
            if not (os.path.exists(mp3) and os.path.getsize(mp3) > 1000):
                tts_neural.synth(sn, args.nvoice, f"{r:+d}%", f"{p:+d}Hz", mp3)
            x = read_pcm(mp3)
            # trim the engine's lead and tail silence so pauses are fully ours
            idx = np.where(np.abs(x) > 0.004)[0]
            if len(idx): x = x[max(idx[0] - int(0.02 * SR), 0): idx[-1] + int(0.04 * SR)]
            parts.append(x)
            if not last: parts.append(silence(0.46 if words <= 3 else 0.30))
        wavx = np.concatenate(parts)
        import wave
        with wave.open(raw, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(wavx, -1, 1) * 32767).astype(np.int16).tobytes())
    else:
        run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", os.path.join(HERE, "tts.ps1"),
             "-Text", text, "-Out", raw, "-Voice", args.voice, "-Rate", str(args.rate)])
    run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-af",
         "highpass=f=70,equalizer=f=180:t=q:w=1:g=1.5,equalizer=f=3500:t=q:w=1.2:g=1.5,acompressor=threshold=-22dB:ratio=2.2:attack=15:release=160:makeup=2,"
         f"aresample={SR}", fin])
    return fin

t0 = 0.0
timeline = {"fps": script["fps"], "width": script["width"], "height": script["height"], "scenes": []}
vo_events = []   # (abs_start, samples)
breaths = []
sfx_events = []  # (abs_start, kind, vol, len)
problems = []

for sc in script["scenes"]:
    cues_abs = {k: t0 + v for k, v in sc["cues"].items()}
    lines = []
    for i, ln in enumerate(sc["vo"]):
        wav = synth_line(sc["id"], i, ln["text"])
        x = read_pcm(wav)
        dur = len(x) / SR
        lines.append({"at": ln["at"], "dur": round(dur, 3), "text": ln["text"]})
        vo_events.append((t0 + ln["at"], x))
        if dur > 2.6 and ln["at"] > 0.35: breaths.append(t0 + ln["at"] - 0.30)
        if ln["at"] + dur > sc["dur"] - 0.15:
            problems.append(f"{sc['id']} line {i} ends at {ln['at']+dur:.2f}s past scene end {sc['dur']}s")
        if i + 1 < len(sc["vo"]) and ln["at"] + dur > sc["vo"][i + 1]["at"] - 0.05:
            problems.append(f"{sc['id']} line {i} ({ln['at']+dur:.2f}s) overlaps next line at {sc['vo'][i+1]['at']}s")
    for e in sc["sfx"]:
        at = e["at"]
        base = sc["cues"][at] if isinstance(at, str) else at
        sfx_events.append((t0 + base + e.get("dt", 0.0), e["kind"], e.get("vol", 1.0), e.get("len", 1.0)))
    timeline["scenes"].append({"id": sc["id"], "start": round(t0, 3), "dur": sc["dur"], "cues": sc["cues"], "vo": lines, "title": sc["title"]})
    t0 += sc["dur"]

TOTAL = t0
timeline["total"] = TOTAL
N = int(TOTAL * SR)
print(f"total {TOTAL:.1f}s")
for p in problems:
    print("WARN", p)

# ---------------------------------------------------------------- dsp helpers
def tt(n): return np.arange(n) / SR
def env_ad(n, a, d, curve=3.0):
    t = tt(n); e = np.minimum(t / max(a, 1e-4), 1.0) * np.exp(-t * curve / max(d, 1e-4)); return e
def sine(f, n, ph=0.0): return np.sin(2 * np.pi * f * tt(n) + ph)
def sweep(f0, f1, n):
    t = tt(n); d = n / SR
    return np.sin(2 * np.pi * (f0 * t + (f1 - f0) * t * t / (2 * d)))
def noise(n): return rng.standard_normal(n)
def lp(x, fc):
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    klen = int(min(len(x), max(SR * 0.05, 7.0 / a)))
    k = a * (1 - a) ** np.arange(klen)
    n = len(x) + klen; nf = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(k, nf), nf)[:len(x)]
def hp(x, fc): return x - lp(x, fc)
def bp(x, f1, f2): return lp(hp(x, f1), f2)
def norm(x, peak=1.0):
    m = np.max(np.abs(x)) or 1.0; return x * (peak / m)
def fadeio(x, a=0.004, b=0.01):
    n = len(x); fa = min(int(a * SR), n); fb = min(int(b * SR), n)
    x = x.copy(); x[:fa] *= np.linspace(0, 1, fa); x[n - fb:] *= np.linspace(1, 0, fb); return x

# ---------------------------------------------------------------- sfx library (each returns mono float array, peak ~1)
def k_typing(L):
    n = int(L * SR); out = np.zeros(n); t = 0.05
    while t < L - 0.05:
        m = int(0.03 * SR)
        click = bp(noise(m), 1500, 7000) * np.exp(-tt(m) * 140) + 0.5 * sine(rng.uniform(1700, 2500), m) * np.exp(-tt(m) * 180)
        i = int(t * SR); out[i:i + m] += click * rng.uniform(0.5, 1.0)
        t += rng.uniform(0.045, 0.1)
    return norm(out) * 0.55
def k_riser(L):
    n = int(L * SR); e = (tt(n) / L) ** 2.2
    return norm(bp(noise(n), 300, 5000) * e * 0.8 + sweep(70, 520, n) * e * 0.5) * 0.45
def k_thud(L=0.8):
    n = int(0.9 * SR); t = tt(n)
    return norm(sine(52, n) * np.exp(-t * 7) + 0.4 * sweep(110, 45, n) * np.exp(-t * 11) + 0.2 * lp(noise(n), 200) * np.exp(-t * 20)) * 0.9
def k_chip(L=0.3):
    n = int(0.35 * SR); t = tt(n)
    return norm(sine(2100, n) * np.exp(-t * 22) + 0.6 * sine(3150, n) * np.exp(-t * 28) + 0.4 * hp(noise(n), 4000) * np.exp(-t * 90)) * 0.5
def k_shatter(L=1.4):
    n = int(1.4 * SR); t = tt(n)
    x = hp(noise(n), 3000) * np.exp(-t * 5) * 0.9
    for _ in range(26):
        i = int(rng.uniform(0, 0.5) * SR); m = n - i
        x[i:] += sine(rng.uniform(2500, 7000), m) * np.exp(-tt(m) * rng.uniform(14, 40)) * rng.uniform(0.1, 0.35)
    x[:int(0.06 * SR)] += 0.9 * lp(noise(int(0.06 * SR)), 900)
    return norm(x) * 0.8
def k_whoosh(L=1.3):
    n = int(1.3 * SR); t = tt(n); w = np.sin(np.pi * t / 1.3) ** 2
    x = lp(noise(n), 400) * (1 - t / 1.3) + bp(noise(n), 600, 3000) * w + hp(noise(n), 3500) * (t / 1.3) ** 2 * 0.6
    return norm(x * w) * 0.7
def k_boom(L=1.8):
    n = int(2.0 * SR); t = tt(n)
    x = sweep(95, 34, n) * np.exp(-t * 2.6) + 0.3 * lp(noise(n), 160) * np.exp(-t * 5) + 0.18 * sine(34, n) * np.exp(-t * 1.4)
    return norm(x) * 0.95
def k_ping(L=1.0):
    n = int(1.2 * SR); t = tt(n)
    return norm(sine(880, n) * np.exp(-t * 4) + 0.6 * sine(1320, n) * np.exp(-t * 5) + 0.25 * sine(1760, n) * np.exp(-t * 7)) * 0.55
def k_count(L):
    n = int((L + 0.1) * SR); out = np.zeros(n); k = int(L * 26)
    for j in range(k):
        f = 520 + 900 * (j / max(k - 1, 1)); m = int(0.035 * SR); i = int(j / 26 * SR)
        out[i:i + m] += sine(f, m) * np.exp(-tt(m) * 90)
    return norm(out) * 0.4
def k_lock(L=0.8):
    n = int(0.8 * SR); t = tt(n); x = np.zeros(n)
    x += sine(150, n) * np.exp(-t * 28) + 0.5 * lp(noise(n), 1800) * np.exp(-t * 60)
    i = int(0.16 * SR); m = n - i
    x[i:] += 0.9 * (sine(420, m) * np.exp(-tt(m) * 40) + 0.5 * sine(1800, m) * np.exp(-tt(m) * 70) + 0.6 * bp(noise(m), 1500, 6000) * np.exp(-tt(m) * 90))
    return norm(x) * 0.8
def k_sonar(L):
    n = int((L + 1.2) * SR); out = np.zeros(n); p = sine(1000, int(0.9 * SR)) * np.exp(-tt(int(0.9 * SR)) * 6)
    j = 0; t = 0.0
    while t < L:
        g = 0.55 ** j; i = int(t * SR); out[i:i + len(p)] += p[:max(0, n - i)][:len(p)] * 1.0 if i + len(p) <= n else 0
        t += 1.1; j += 1
    return norm(out) * 0.35
def k_card(L=0.5):
    n = int(0.5 * SR); t = tt(n)
    x = lp(noise(n), 2600) * np.exp(-t * 16) * 0.8 + sine(310, n) * np.exp(-t * 22) + 0.3 * sine(620, n) * np.exp(-t * 28)
    return norm(x) * 0.5
def k_buzz(L=0.6):
    n = int(0.6 * SR); t = tt(n); g = ((t % 0.28) < 0.17).astype(float) * (t < 0.56)
    sq = np.sign(sine(118, n)) * 0.6 + np.sign(sine(124, n)) * 0.4
    return norm(lp(sq, 900) * g) * 0.55
def k_check(L=0.4):
    n = int(0.5 * SR); t = tt(n); x = sine(1318, n) * np.exp(-t * 14)
    i = int(0.07 * SR); x[i:] += sine(1760, n - i) * np.exp(-tt(n - i) * 12) * 0.9
    return norm(x) * 0.5
def k_warn(L=0.6):
    n = int(0.6 * SR); t = tt(n)
    x = (2 * np.abs(2 * ((sweep(440, 392, n) / (2 * np.pi)) % 1) - 1) - 1) * 0.0
    ph = 2 * np.pi * np.cumsum(np.linspace(440, 380, n)) / SR
    x = np.sin(ph) + 0.3 * np.sin(2 * ph); x *= np.exp(-t * 4.5)
    return norm(x) * 0.5
def k_stamp(L=0.5):
    n = int(0.6 * SR); t = tt(n)
    return norm(sine(85, n) * np.exp(-t * 14) + 0.8 * lp(noise(n), 3000) * np.exp(-t * 55) + 0.2 * sine(240, n) * np.exp(-t * 24)) * 0.85
def k_approve(L=1.2):
    n = int(1.5 * SR); out = np.zeros(n)
    for j, f in enumerate([880, 1108.7, 1318.5, 1760]):
        i = int(j * 0.075 * SR); m = n - i
        out[i:] += (sine(f, m) + 0.3 * sine(f * 2, m)) * np.exp(-tt(m) * 3.2) * 0.8
    out += 0.12 * hp(noise(n), 6000) * np.exp(-tt(n) * 5)
    return norm(out) * 0.55
def k_glitch(L=0.5):
    n = int(0.45 * SR); x = np.zeros(n); t = 0.0
    while t < 0.4:
        m = int(rng.uniform(0.02, 0.06) * SR); i = int(t * SR); seg = noise(m) * 0.8 + sine(rng.uniform(200, 3000), m) * 0.4
        q = rng.choice([8, 16, 32]); seg = np.round(seg * q) / q; x[i:i + m] += seg[:max(0, n - i)][:m] if i + m <= n else 0
        t += rng.uniform(0.03, 0.08)
    return norm(x) * 0.5
def k_slam(L=1.8):
    n = int(1.8 * SR); t = tt(n)
    x = k_boom()[:n] * 0.9 if len(k_boom()) >= n else np.pad(k_boom(), (0, n - len(k_boom())))
    x = x + 0.8 * lp(noise(n), 4000) * np.exp(-t * 28) + 0.5 * sine(62, n) * np.exp(-t * 3)
    x[:int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))
    return norm(x) * 1.0
def k_ring(L=0.9):
    n = int(0.9 * SR); t = tt(n); am = 0.5 + 0.5 * np.sign(sine(20, n))
    x = (sine(440, n) + sine(480, n)) * am * np.minimum(t / 0.01, 1) * (t < 0.8) * 0.5
    return fadeio(norm(x) * 0.4, 0.005, 0.05)
def k_tick(L=0.1):
    n = int(0.12 * SR); t = tt(n)
    return norm(sine(1500, n) * np.exp(-t * 90) + 0.4 * hp(noise(n), 3000) * np.exp(-t * 200)) * 0.45

KINDS = {k[2:]: v for k, v in globals().items() if k.startswith("k_")}

# ---------------------------------------------------------------- build stems
sfx_bus = np.zeros(N)
for at, kind, vol, ln in sfx_events:
    fn = KINDS[kind]
    try: x = fn(ln)
    except TypeError: x = fn()
    i = int(at * SR)
    if i >= N: continue
    x = x[:N - i]
    sfx_bus[i:i + len(x)] += fadeio(x * vol, 0.002, 0.02)

vo_bus = np.zeros(N)
for at, x in vo_events:
    i = int(at * SR); x = x[:N - i]
    vo_bus[i:i + len(x)] += x
# a soft breath before long lines, so the voice sounds like it is breathing
for tb in breaths:
    m = int(0.26 * SR); b = bp(noise(m), 350, 3800) * np.sin(np.pi * tt(m) / 0.26) ** 2
    i = int(tb * SR); 
    if i > 0 and i + m < N: vo_bus[i:i + m] += b * 0.022 / (np.max(np.abs(b)) or 1)
# loudness-match voice at ~ -3.5 dBFS peak-ish
vo_bus *= 0.85 / (np.max(np.abs(vo_bus)) or 1)

# ---------------------------------------------------------------- music
def mix_pad(freqs, n, amp=1.0):
    t = tt(n); out = np.zeros(n)
    for f in freqs:
        for det, g in ((-0.12, 0.5), (0.0, 0.7), (0.15, 0.5)):
            ff = f * (1 + det * 0.01)
            for h, hg in ((1, 1.0), (2, 0.4), (3, 0.22), (4, 0.1)):
                out += g * hg * np.sin(2 * np.pi * ff * h * t + rng.uniform(0, 6.28))
    return out * amp / (len(freqs) * 2.0)

BPM = 96; BEAT = 60 / BPM; BAR = BEAT * 4
CHORDS = [  # Am  F  C  G  (root, tones)
    (55.0, [220.0, 261.63, 329.63]),
    (43.65, [174.61, 220.0, 261.63]),
    (65.41, [196.0, 261.63, 329.63]),
    (49.0, [196.0, 246.94, 293.66]),
]
PENT = {0: [440.0, 523.25, 659.25, 783.99], 1: [349.23, 440.0, 523.25, 698.46], 2: [392.0, 523.25, 659.25, 784.0], 3: [392.0, 493.88, 587.33, 783.99]}

def S(id_):
    return next(s for s in timeline["scenes"] if s["id"] == id_)
def abs_cue(id_, cue): return S(id_)["start"] + S(id_)["cues"][cue]
def curve(points):
    xs, ys = zip(*points); return np.interp(tt(N), xs, ys)

t_logo = abs_cue("problem", "logo")
t_blocked = abs_cue("pay", "blocked")
t_close = abs_cue("close", "close")
t_key = abs_cue("close", "key")
t_call = S("call")["start"]; t_close_s = S("close")["start"]; t_pay = S("pay")["start"]
t_research = S("research")["start"]; t_confirm = S("confirm")["start"]; t_prove = S("prove")["start"]

g_pad = curve([(0, 0.0), (4, 0.18), (t_logo - 0.2, 0.3), (t_logo, 0.9), (t_call, 0.85), (t_call + 1, 0.55), (t_close_s, 0.5), (t_close, 0.95), (TOTAL - 4, 0.9), (TOTAL, 0)])
g_bass = curve([(0, 0), (t_logo - 0.01, 0), (t_logo, 1.0), (t_blocked - 3, 1.0), (t_blocked - 0.4, 0.2), (t_blocked, 0.0), (t_blocked + 0.5, 1.0), (t_call, 1.0), (t_call + 1, 0.0), (t_close_s, 0.0), (t_close, 1.0), (TOTAL - 2, 1.0), (TOTAL, 0)])
g_arp = curve([(0, 0), (S("limits")["start"] - 1, 0), (S("limits")["start"], 0.55), (t_pay + 11, 0.7), (t_blocked - 0.5, 0.7), (t_blocked, 0), (t_blocked + 0.8, 0.8), (t_call, 0.9), (t_close_s, 0.45), (t_close, 0.85), (TOTAL - 3, 0.7), (TOTAL, 0)])
g_kick = curve([(0, 0), (t_research - 0.01, 0), (t_research, 1.0), (t_blocked - 3, 1.0), (t_blocked, 0), (t_blocked + 0.6, 1.0), (t_call - 0.01, 1.0), (t_call, 0.0), (t_close - 0.01, 0), (t_close, 1.0), (t_key + 1, 0.0), (TOTAL, 0)])
g_hat = curve([(0, 0), (t_prove - 0.01, 0), (t_prove, 1.0), (t_call - 0.01, 1.0), (t_call, 0), (t_close, 0), (t_close + 0.01, 1.0), (t_key, 0.8), (t_key + 1, 0)])

music = np.zeros((2, N))
# drone under the hook
drone = (sine(55, N) * 0.5 + sine(110.2, N) * 0.35 + sine(82.4, N) * 0.25) * (1 + 0.15 * sine(0.17, N))
drone *= curve([(0, 0.0), (2, 0.5), (8, 0.9), (t_logo - 0.01, 0.9), (t_logo + 2, 0.12), (TOTAL, 0.12)])
music[0] += drone * 0.35; music[1] += drone * 0.35

nbars = int(np.ceil(TOTAL / BAR)) + 1
pad = np.zeros((2, N)); bass = np.zeros(N); arp = np.zeros(N); kick = np.zeros(N); hat = np.zeros(N)
for b in range(nbars):
    ci = b % 4; root, tones = CHORDS[ci]
    i0 = int(b * BAR * SR)
    if i0 >= N: break
    ln = int((BAR + 0.9) * SR)
    ln_c = min(ln, N - i0)
    # pad per bar with soft in/out
    for ch in range(2):
        seg = mix_pad([f * (0.5 if ch else 1.0) * (1.003 if ch else 1.0) for f in tones], ln, 0.6)
        e = np.minimum(tt(ln) / 0.9, 1) * np.minimum((ln / SR - tt(ln)) / 0.9, 1)
        pad[ch, i0:i0 + ln_c] += (seg * e)[:ln_c]
    # bass: root with octave-lift on beat 3
    for j, (off, fm) in enumerate(((0, 1), (BEAT * 2, 1), (BEAT * 3.5, 2))):
        i = i0 + int(off * SR); m = int(BEAT * 1.6 * SR)
        if i >= N: continue
        note = (sine(root * fm, m) + 0.35 * sine(root * fm * 2, m)) * env_ad(m, 0.01, BEAT * 1.1, 2.2)
        bass[i:i + m] += note[:max(0, N - i)][:m] if i + m <= N else note[:N - i]
    # arpeggio 8ths
    notes = PENT[ci]; pat = [0, 1, 2, 3, 2, 1, 2, 1]
    for k, p in enumerate(pat):
        i = i0 + int(k * BEAT / 2 * SR); m = int(0.55 * SR)
        if i >= N: continue
        f = notes[p]
        pl = (sine(f, m) + 0.4 * sine(f * 2, m) * np.exp(-tt(m) * 8) + 0.15 * sine(f * 3, m)) * env_ad(m, 0.004, 0.3, 4.5)
        pl = pl[:N - i]; arp[i:i + len(pl)] += pl
    # kick on 1 and 3 (and a late pickup), hats on offbeats
    for off in (0, BEAT * 2, BEAT * 3.5):
        i = i0 + int(off * SR); m = int(0.35 * SR)
        if i >= N: continue
        kk = (sweep(120, 42, m) * np.exp(-tt(m) * 11)); kk = kk[:N - i]; kick[i:i + len(kk)] += kk * (0.55 if off == BEAT * 3.5 else 1.0)
    for off in (BEAT * 0.5, BEAT * 1.5, BEAT * 2.5, BEAT * 3.5):
        i = i0 + int(off * SR); m = int(0.07 * SR)
        if i >= N: continue
        hh = hp(noise(m), 7000) * np.exp(-tt(m) * 55); hh = hh[:N - i]; hat[i:i + len(hh)] += hh

music[0] += pad[0] * g_pad * 0.5; music[1] += pad[1] * g_pad * 0.5
for ch in range(2):
    music[ch] += bass * g_bass * 0.55 + arp * g_arp * 0.2 * (0.9 if ch else 1.0) + kick * g_kick * 0.5 + hat * g_hat * 0.1
# arp slight ping-pong delay for width
d = int(BEAT * 0.75 * SR)
music[1, d:] += arp[:-d] * g_arp[:-d] * 0.09
music[0, d * 2:] += arp[:-d * 2] * g_arp[:-d * 2] * 0.05

# final resolution chord, long and bright
res_start = int(t_key * SR); res_n = N - res_start
for ch in range(2):
    res = mix_pad([110.0, 164.81, 220.0, 329.63, 493.88], res_n, 0.7)
    res *= np.minimum(tt(res_n) / 1.2, 1) * np.minimum((res_n / SR - tt(res_n)) / 3.0, 1)
    music[ch, res_start:] += res * 0.5
# swell into the logo and into the close
for tw, ln_s in ((t_logo, 1.2), (t_close, 1.2)):
    i = int((tw - ln_s) * SR); m = int(ln_s * SR)
    sw = bp(noise(m), 500, 6000) * (tt(m) / ln_s) ** 2.5 * 0.35
    music[0, i:i + m] += sw; music[1, i:i + m] += sw

# simple reverb (synthetic exponential-noise IR) applied to music and a touch to vo
def reverb(x, secs, wet, seed=3):
    r = np.random.default_rng(seed); m = int(secs * SR)
    ir = r.standard_normal(m) * np.exp(-tt(m) * (6.9 / secs)); ir = lp(ir, 6000); ir /= np.sqrt(np.sum(ir ** 2))
    n = len(x) + m; nf = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(ir, nf), nf)[:len(x)]
    return x * (1 - wet) + y * wet * 0.9 + x * wet * 0.1

music = np.stack([reverb(music[0], 2.4, 0.22, 3), reverb(music[1], 2.4, 0.22, 4)])
vo_wet = reverb(vo_bus, 0.45, 0.10, 5)
sfx_st = np.stack([sfx_bus, sfx_bus])
sfx_st = np.stack([reverb(sfx_bus, 1.2, 0.18, 6), reverb(sfx_bus, 1.2, 0.18, 7)])

# ducking: music follows -9 dB while the voice speaks
env = np.abs(vo_bus)
win = int(0.12 * SR)
cs = np.cumsum(np.concatenate([[0.0], env])); env = (cs[win:] - cs[:-win]) / win; env = np.concatenate([env, np.zeros(len(vo_bus) - len(env))]); env = np.roll(env, win // 2)
env = np.minimum(env / 0.05, 1.0)
env = lp(env, 3.0)
duck = 1.0 - 0.62 * np.clip(env, 0, 1)
music *= duck

# levels
music *= 0.42 / (np.max(np.abs(music)) or 1)
sfx_st *= 0.8
mix = np.stack([vo_wet, vo_wet]) * 1.0 + music + sfx_st * 0.8
# soft-clip safety
mix = np.tanh(mix * 0.95) / np.tanh(0.95)
out = (mix.T * 32767 * 0.9).astype(np.int16)
raw = os.path.join(BUILD, "mix_raw.wav")
import wave
with wave.open(raw, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=9", "-ar", "48000", os.path.join(BUILD, "mix.wav")])

with open(os.path.join(BUILD, "timeline.js"), "w", encoding="utf8") as f:
    f.write("window.TL = " + json.dumps(timeline) + ";")
print("audio done ->", os.path.join(BUILD, "mix.wav"))
