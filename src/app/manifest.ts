import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Ledger — expense tracker",
    short_name: "Ledger",
    description: "Monthly category budgets, daily expense entry, and savings.",
    start_url: "/",
    display: "standalone",
    // Android builds its launch screen from these: background colour + icon + name.
    background_color: "#F3F1EA",
    theme_color: "#F3F1EA",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
