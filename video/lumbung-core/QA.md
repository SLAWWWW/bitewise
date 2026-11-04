# Export review

Completed 2026-11-04. No narration is present in either export.

| Check | Result |
| --- | --- |
| Runtime | Exactly 60.000 seconds in both MP4s |
| Picture | 1920 × 1080, 30 fps, 1,800 frames, H.264, yuv420p |
| Full decoding | Both finished exports decode without errors |
| Silent edition | Zero audio streams; encoded picture matches the scored edition |
| Browser playback | Native Chromium video playback and eight seeks passed; no browser errors |
| Motion | Sampled changes verified in the routing lattice, eligibility, approval gates, delivery, and final journey |
| Text bounds | All composed text in ten representative source frames lies inside the picture |
| Visual review | 60 preview samples reviewed across three contact sheets; full-size scene stills and final browser playback captures inspected |
| Blank-frame scan | 60 samples from the final MP4 passed the luminance check |
| Scored edition | AAC stereo, 48 kHz; measured −17.93 LUFS integrated, −7.08 dBTP true peak |

The visual review checked text hierarchy, demo qualifiers, source-screen framing, approval ordering, and the distinct direct/warehouse routes. Browser review used muted playback. The score received numerical level and decoding checks; **an audible listening review was not performed**. The silent version provides the complete explanation without audio.

The actual app captures contain demo records. The three-recipient scenario is an illustrative explanation, not a claim about actual recipients or measured impact. The scenes show implemented workflow features, without claiming live messaging or AI integrations.

Machine-readable evidence is in `previews/Lumbung-Core-Features-60s/technical-review.json`, `previews/player-review.json`, `previews/silent-review.json`, and `previews/text-bounds.json`. Contact sheets and browser frames are retained in `previews/`.

This task added a standalone video project. Application tests were not rerun for these media-only changes; the checks above validate the deliverables.
