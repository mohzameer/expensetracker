import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ledger — expense tracker",
    short_name: "Ledger",
    description: "Monthly category budgets, daily expense entry, and savings.",
    start_url: "/",
    display: "standalone",
    background_color: "#F3F1EA",
    theme_color: "#F3F1EA",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
