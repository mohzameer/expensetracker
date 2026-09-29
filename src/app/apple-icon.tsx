import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#1F5F5B", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="120" height="120" viewBox="0 0 64 64">
          <path d="M22 16v32h22" fill="none" stroke="#F3F1EA" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="44" cy="22" r="5" fill="#E2682F" />
        </svg>
      </div>
    ),
    size,
  );
}
