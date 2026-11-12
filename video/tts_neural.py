"""Neural voice via Microsoft Edge online voices (edge-tts). Sends only the voiceover text."""
import asyncio, os, edge_tts

async def _go(text, voice, rate, pitch, out):
    await asyncio.wait_for(edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(out), timeout=25)

def synth(text, voice, rate, pitch, out, tries=8):
    last = None
    for i in range(tries):
        try:
            asyncio.run(_go(text, voice, rate, pitch, out))
            if os.path.getsize(out) < 1000: raise RuntimeError("empty audio")
            return
        except Exception as e:
            last = e; import time; time.sleep(2 + 2 * i)
    raise last

if __name__ == "__main__":
    import sys
    synth(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
