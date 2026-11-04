# Landing illustration

- File: `network-globe.webp`
- Generated using the built-in Image Gen tool, then compressed to WebP with Sharp (quality 88).
- Reference: user-supplied Cloudflare network screenshot, 2026-11-04 13:29:16.
- Illustration only; globe arcs do not represent live distribution coverage or routes.
- The animated globe uses [COBE 2.0.1](https://github.com/shuding/cobe), an MIT-licensed WebGL renderer, loaded only when the section is visible. White markers and arcs illustrate connections around Indonesia; they are not operational route data. Rotation is time-based, pausable, and disabled by default for reduced-motion preferences. The generated image remains the fallback when WebGL is unavailable.

## Other assets

- `dots.png`: unmodified 36 × 36 background tile extracted from the user's n8n screenshot (2026-11-04 13:30:28), rendered at half-size to match its display density.
- `operations.webp`, `donation.webp`: actual local Lumbung DEMO screenshots, captured on 2026-11-04 and cropped to 1280 × 770 for the landing preview. All data is synthetic. Images are rendered in grayscale by the landing stylesheet.
- `recommendation.webp`: actual populated recommendation captured on 2026-11-04 in an isolated TEST database using synthetic demo data. The browser created a 10-portion donation, validated it, calculated recommendations, switched to English, and captured the selected FLO card. Cropped to 650 × 296 to remove unused space. The displayed quantities use the app's exact localized quantity formatter; no screenshot text was fabricated or altered. The capture database was removed afterward; the development workspace's data was not changed.
- Existing Lumbung brand mark is retained; the wordmark, page typography, layout, and colors use the refreshed monochrome identity. UI icons use the project's installed Lucide library, matching the reference's thin outlined icons.

## Generation prompt

Use case: stylized-concept. Asset type: website network section illustration for Lumbung, 1600 by 1000 landscape proportions. The attached screenshot is only a visual style/composition reference, not an edit target. Generate an isolated graphic of a large dotted 3D globe on a perfectly solid #111111 background, with Asia, Southeast Asia and the Indonesian archipelago facing the viewer. Match the reference's high density geometric halftone dots and subtle latitude/longitude wireframe, but use ONLY neutral white, gray, and black. Globe centered horizontally and lower in frame, sphere occupies about 75% of image width, gently clipped at the bottom. Fine white/light gray dot landmasses with convincing sphere curvature, sparse delicate network connection arcs over Southeast Asia. Elegant restrained technical illustration, crisp sharp dots, darkest outer edges, brighter central landmass. No orange or colored light. No text, logos, labels, icon circles, cards, borders, UI, people, annotations or watermark. Fill outer background with exact flat dark gray #111111 so it blends seamlessly into the page.
