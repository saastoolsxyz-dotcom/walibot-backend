import axios from "axios";
import { load } from "cheerio";

export async function scrapeUrl(url) {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    const { data } = await axios.get(u, {
      timeout: 15000,
      headers: { "User-Agent": "WaliBot/1.0" },
    });
    const $ = load(data);
    $("script, style, nav, footer").remove();
    const text = $("body").text().replace(/\s+/g, " ").trim();
    return text.slice(0, 4000);
  } catch (e) {
    console.error("Scraper error:", e.message);
    return "";
  }
}
