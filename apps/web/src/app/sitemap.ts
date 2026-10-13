import type { MetadataRoute } from "next";
import { legalNav, marketingNav, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", ...new Set([...marketingNav, ...legalNav].map((item) => item.href))];
  return paths.map((path) => ({ url: `${SITE_URL}${path === "/" ? "" : path}` }));
}
