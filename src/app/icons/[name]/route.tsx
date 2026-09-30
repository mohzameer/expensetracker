import { ImageResponse } from "next/og";
import { LogoMark } from "@/lib/brand";

// PNG app icons for the install manifest (Android uses them for the home screen and launch screen).
const ICONS = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  // Maskable: full-bleed background with the mark inside the 80% safe zone.
  maskable: { size: 512, maskable: true },
} as const;

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_req: Request, { params }: RouteContext<"/icons/[name]">) {
  const icon = ICONS[(await params).name as keyof typeof ICONS];
  if (!icon) return new Response("Not found", { status: 404 });
  const { size, maskable } = icon;
  return new ImageResponse(
    maskable ? (
      <div style={{ width: size, height: size, background: "#1F5F5B", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <LogoMark size={Math.round(size * 0.7)} rounded={false} />
      </div>
    ) : (
      <LogoMark size={size} rounded={false} />
    ),
    { width: size, height: size },
  );
}
