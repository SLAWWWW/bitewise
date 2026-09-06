/**
 * The Lumbung mark — a stylised raised granary: the peaked roof, the storage
 * body, and the stilts that lift it clear of the ground. Drawn as geometry
 * rather than shipped as a raster so it stays crisp at every size and can
 * take `currentColor` from whatever surface it sits on.
 */
export function LumbungMark({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Roof — the wide overhanging peak a lumbung is recognised by */}
      <path d="M2.5 9.5 12 3l9.5 6.5" />
      {/* Granary body */}
      <path d="M5.5 9.5v6h13v-6" />
      {/* Stored grain, abstracted to a single band */}
      <path d="M8.5 12.5h7" />
      {/* Stilts that raise it off the ground */}
      <path d="M7.5 15.5V21M16.5 15.5V21" />
    </svg>
  );
}
