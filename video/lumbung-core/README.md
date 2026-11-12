# Lumbung product film

A 60-second, text-led explanation of Lumbung's core workflow. Black-and-white motion graphics, real demo app captures, and no voiceover.

## Watch

- `Lumbung-Core-Features-60s.mp4` — 1080p, 30 fps, H.264 with an original instrumental score.
- `Lumbung-Core-Features-60s-Silent.mp4` — identical picture, no audio track.
- `preview.html` — local browser player and download links.
- `Lumbung-Preview.png` — poster image.

The on-screen text carries the explanation. `on-screen-text.srt` is an authored scene-summary sidecar, not a transcript of speech. It is not needed during playback because the text is composed into the picture.

## Edit and render

Requires Python with `requirements.txt`, plus FFmpeg and FFprobe on PATH. Source assets and fonts are included; no online generation service is needed.

From the repository root:

```sh
python3 -m venv .data/video-venv
.data/video-venv/bin/pip install -r video/lumbung-core/requirements.txt
.data/video-venv/bin/python video/lumbung-core/render.py --stills
.data/video-venv/bin/python video/lumbung-core/render.py
ffmpeg -y -i video/lumbung-core/Lumbung-Core-Features-60s.mp4 -map 0:v:0 -c copy -an -movflags +faststart video/lumbung-core/Lumbung-Core-Features-60s-Silent.mp4
.data/video-venv/bin/python video/lumbung-core/review.py video/lumbung-core/Lumbung-Core-Features-60s.mp4
node video/lumbung-core/verify-player.mjs
```

For a quick 720p/15 fps proof, use `render.py --preview`. The render recreates the instrumental score deterministically and does not modify the application or database.

`timeline.json` contains timing and copy summaries. `render.py` contains exact displayed labels, layouts, animation, and score. `style.json` documents the visual specification; it is not a runtime configuration. `brief.md` records the story and product evidence. `QA.md` records validation and review limits.

## Assets and provenance

Actual demo interface captures are used for intake, recommendations, and reporting. The three-recipient example and routing lattice are explanatory graphics. Demo labels distinguish them from live operational claims. Captures show separate demo records; they do not assert that one specific donation generated every displayed report.

`asset-manifest.json` records sources and hashes. Geist and Lucide license notices are included in `assets/`. Music is synthesized by this project's source code with no samples or voice. `capture-app.mjs` and `prepare-icons.mjs` are optional repository-based preparation tools; the included assets suffice to render a standalone copy.

No publishing or external messages are performed by this project.
