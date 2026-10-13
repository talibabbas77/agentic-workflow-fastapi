import { ImageResponse } from "next/og";
import { BUBBLE, RIBBON, WORDMARK } from "@/components/brand/logo";

export const alt = "Docent: support answers from your docs, not guesses";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand colors from brand/README.md. Flat paper, ink logo, rust ribbon.
const PAPER = "#F5F0E6";
const INK = "#1B1916";
const INK_MUTED = "#5E574F";
const RUST = "#B5431F";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: PAPER,
          color: INK,
        }}
      >
        <svg width="372" height="86" viewBox="0 -84.81 443.12 102.56">
          <g transform="translate(-27.61 -94.67) scale(1.97)">
            <path d={BUBBLE} fill={INK} />
            <path d={RIBBON} fill={RUST} />
          </g>
          <path transform="translate(100.82 0)" d={WORDMARK} fill={INK} />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 960 }}>
            Support answers from your docs, not guesses
          </div>
          <div style={{ fontSize: 30, color: INK_MUTED, maxWidth: 1040 }}>
            Every answer cites the page it came from. Everything else goes to your team.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
