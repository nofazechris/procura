"""Captures a scroll sequence of the real landing page (3D rack) as footage for the video."""
import asyncio, os
from playwright.async_api import async_playwright

N = 200
os.makedirs("assets/rack", exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width": 1920, "height": 1080})
        await pg.goto("http://localhost:3010/", wait_until="networkidle")
        await pg.add_style_tag(content="nextjs-portal,[data-nextjs-toast],#__next-build-watcher{display:none!important}")
        await pg.wait_for_timeout(2500)
        total = await pg.evaluate("document.documentElement.scrollHeight - innerHeight")
        # the story section is 900vh; sample across it
        story = await pg.evaluate("(()=>{const s=document.querySelector('.lx-story');return s?s.offsetHeight-innerHeight:0})()")
        span = story or total
        for i in range(N):
            y = int(span * i / (N - 1))
            await pg.evaluate(f"window.scrollTo(0,{y})")
            await pg.wait_for_timeout(420)
            await pg.screenshot(path=f"assets/rack/f{i:03d}.jpg", type="jpeg", quality=88)
            if i % 20 == 0: print(i, y, flush=True)
        await b.close()
asyncio.run(main())
