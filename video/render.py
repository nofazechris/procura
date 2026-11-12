"""Renders stage.html to frames deterministically (seek per frame) and encodes the final mp4.

  python render.py stills 3.5 20 60        # PNG stills at those absolute seconds -> build/stills
  python render.py frames [start end]      # all frames (parallel) -> build/frames
  python render.py encode                  # frames + build/mix.wav -> out/procura-demo.mp4
"""
import asyncio, json, os, subprocess, sys
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "file:///" + os.path.join(HERE, "stage.html").replace("\\", "/")
BUILD = os.path.join(HERE, "build")
FRAMES = os.path.join(BUILD, "frames")
WORKERS = 6

def load_tl():
    s = open(os.path.join(BUILD, "timeline.js"), encoding="utf8").read()
    return json.loads(s[s.index("{"): s.rindex("}") + 1])

async def open_page(b):
    pg = await b.new_page(viewport={"width": 1920, "height": 1080})
    pg.on("pageerror", lambda e: print("PAGEERROR", e, flush=True))
    await pg.goto(URL)
    await pg.wait_for_function("window.__ready===true")
    return pg

async def shot(pg, T, path, png=False):
    await pg.evaluate(f"window.seek({T})")
    await pg.evaluate("Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r})))")
    if png: await pg.screenshot(path=path, type="png")
    else: await pg.screenshot(path=path, type="jpeg", quality=93)

async def stills(times):
    os.makedirs(os.path.join(BUILD, "stills"), exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await open_page(b)
        for T in times:
            out = os.path.join(BUILD, "stills", f"t{T:06.2f}.png")
            await shot(pg, T, out, png=False if False else True)
            print(out, flush=True)
        await b.close()

async def worker(idx, frames, fps, total):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await open_page(b)
        for n, f in enumerate(frames):
            path = os.path.join(FRAMES, f"{f:05d}.jpg")
            if os.path.exists(path) and os.path.getsize(path) > 2000: continue
            await shot(pg, f / fps, path)
            if idx == 0 and n % 100 == 0: print(f"worker0 {n}/{len(frames)}", flush=True)
        await b.close()

async def frames(start=None, end=None):
    tl = load_tl(); fps = tl["fps"]; total = int(round(tl["total"] * fps))
    a = int(start) if start is not None else 0; z = int(end) if end is not None else total
    os.makedirs(FRAMES, exist_ok=True)
    allf = list(range(a, z))
    chunks = [allf[i::WORKERS] for i in range(WORKERS)]
    await asyncio.gather(*[worker(i, c, fps, total) for i, c in enumerate(chunks)])

def encode():
    tl = load_tl(); fps = tl["fps"]
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    out = os.path.join(HERE, "out", "procura-demo.mp4")
    cmd = ["ffmpeg", "-y", "-v", "error", "-stats", "-framerate", str(fps), "-i", os.path.join(FRAMES, "%05d.jpg"),
           "-i", os.path.join(BUILD, "mix.wav"),
           "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-maxrate", "10M", "-bufsize", "20M", "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart",
           "-vf", "fade=t=in:st=0:d=0.5,fade=t=out:st=%.2f:d=1.2" % (tl["total"] - 1.2),
           "-c:a", "aac", "-b:a", "224k", "-af", "afade=t=out:st=%.2f:d=1.5" % (tl["total"] - 1.5), "-shortest", out]
    subprocess.run(cmd, check=True)
    print("wrote", out, os.path.getsize(out) // 1024, "KB")

if __name__ == "__main__":
    m = sys.argv[1]
    if m == "stills": asyncio.run(stills([float(x) for x in sys.argv[2:]]))
    elif m == "frames": asyncio.run(frames(*sys.argv[2:4]))
    elif m == "encode": encode()
