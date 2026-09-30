// The Ledger mark, for generated images (app icons, launch screens).

export const BRAND = { paper: "#F3F1EA", teal: "#1F5F5B", orange: "#E2682F", ink: "#1B1A17" };

/** The "L" mark on a teal rounded square; `size` in px. */
export function LogoMark({ size, rounded = true }: { size: number; rounded?: boolean }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: BRAND.teal,
        borderRadius: rounded ? size * 0.22 : 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 64 64">
        <path d="M22 16v32h22" fill="none" stroke={BRAND.paper} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="44" cy="22" r="5" fill={BRAND.orange} />
      </svg>
    </div>
  );
}

/**
 * iPhone launch screens (portrait): CSS size and pixel ratio. iOS shows the image
 * whose media query matches the device, so each common screen size gets one.
 */
export const IOS_SCREENS = [
  { w: 440, h: 956, dpr: 3 }, // 16/17 Pro Max
  { w: 430, h: 932, dpr: 3 }, // 14/15 Pro Max, 15/16 Plus
  { w: 428, h: 926, dpr: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 420, h: 912, dpr: 3 }, // Air
  { w: 414, h: 896, dpr: 3 }, // XS Max, 11 Pro Max
  { w: 414, h: 896, dpr: 2 }, // XR, 11
  { w: 402, h: 874, dpr: 3 }, // 16/17 Pro, 17
  { w: 393, h: 852, dpr: 3 }, // 14 Pro, 15, 15 Pro, 16
  { w: 390, h: 844, dpr: 3 }, // 12, 13, 14
  { w: 375, h: 812, dpr: 3 }, // X, XS, 11 Pro, 12/13 mini
  { w: 375, h: 667, dpr: 2 }, // SE, 8
] as const;

export const splashName = (s: { w: number; h: number; dpr: number }) => `${s.w * s.dpr}x${s.h * s.dpr}`;
