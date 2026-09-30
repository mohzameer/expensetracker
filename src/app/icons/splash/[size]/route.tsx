import { ImageResponse } from "next/og";
import { BRAND, IOS_SCREENS, LogoMark, splashName } from "@/lib/brand";

// iPhone launch screens: the logo centred on the app's background, one per screen size.
export function generateStaticParams() {
  return [...new Set(IOS_SCREENS.map(splashName))].map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: RouteContext<"/icons/splash/[size]">) {
  const { size } = await params;
  const screen = IOS_SCREENS.find((s) => splashName(s) === size);
  if (!screen) return new Response("Not found", { status: 404 });
  const width = screen.w * screen.dpr;
  const height = screen.h * screen.dpr;
  const mark = Math.round(width * 0.26);
  return new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          background: BRAND.paper,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: mark * 0.22,
        }}
      >
        <LogoMark size={mark} />
        <div style={{ fontSize: mark * 0.3, fontWeight: 700, color: BRAND.ink, letterSpacing: -1 }}>Ledger</div>
      </div>
    ),
    { width, height },
  );
}
