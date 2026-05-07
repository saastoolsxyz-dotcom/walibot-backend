import axios from "axios";
import { state } from "./state.js";

const CLOSING_PATTERN = /^(ok|okay|thanks|thank you|shukriya|thik hai|theek hai|done|👍|🙏)\.?$/i;

function buildSystemPrompt(userName = "") {
  const b = state.business || {
    businessName: "WaliBot",
    tone: "friendly",
    style: "short",
    category: "General",
    services: "AI Assistance",
    pricing: "Custom",
    faq: "N/A",
    scraped: "",
    fallbackContact: "Support team",
  };

  const nameContext = userName
    ? `The customer's name is "${userName}". Address them by name when natural (e.g., "Hi ${userName}!").`
    : "The customer's name is not known yet.";

  let toneText = "You are a warm, friendly, casual WhatsApp assistant.";
  if (b.tone === "sales") toneText = "You are a high-converting WhatsApp sales assistant. Push for the sale.";
  if (b.tone === "formal") toneText = "You are a polite, professional support agent.";

  let styleText = "Keep replies very short — 1 to 2 sentences max.";
  if (b.style === "detailed") styleText = "Replies can be a bit longer but stay clear and concise.";

  return `You are the Official AI Sales Executive for "${b.businessName}".

=== CUSTOMER CONTEXT ===
- ${nameContext}

=== COMMUNICATION STYLE ===
- TONE: ${toneText}
- STYLE: ${styleText}
- LANGUAGE: Reply in Roman Urdu / English mixed (whatever the customer uses).
- EMOJIS: Use sparingly for warmth.
- FORMATTING: Plain text only. Use *bold* and _italic_ (WhatsApp style). NEVER use HTML.
- LINKS: Send as plain text URLs.
- PRICING: Always mention price next to any item/service.

=== BUSINESS KNOWLEDGE BASE ===
- CATEGORY: ${b.category}
- SERVICES/PRODUCTS: ${b.services}
- PRICING: ${b.pricing}
- FAQ: ${b.faq}
- WEBSITE DATA:
${b.scraped || "Refer to our official website."}
- ESCALATION CONTACT: ${b.fallbackContact}

=== OPERATIONAL RULES ===
1. Sales & Orders: If customer wants to buy, collect: Full Name, Phone, Delivery Address, Payment Method.
2. Unknown questions: If a question is NOT in the knowledge base, DO NOT make up an answer. Reply: "Maaf kijiye, is barey mein mujhe abhi confirm maloomat nahi hai. Main ne team ko request forward kar di hai." and append exactly "[UNKNOWN]" at the very end.
3. Order Capture: Once Name + Phone + Address + Payment are collected, confirm details and append exactly "[ORDER]" at the very end.
4. Be concise, mobile-friendly, and professional.`;
}

async function groqChat(messages) {
  const keys = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_FALLBACK].filter(
    (k) => k && k.startsWith("gsk_") && !k.includes("YOUR_")
  );
  if (keys.length === 0) throw new Error("No valid GROQ_API_KEY configured");

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const groqMessages = messages.map((m) => ({
    role: m.role === "model" ? "assistant" : m.role,
    content: m.content,
  }));

  let lastErr = null;
  for (const key of keys) {
    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model, messages: groqMessages, temperature: 0.7 },
        { headers: { Authorization: `Bearer ${key}` }, timeout: 25000 }
      );
      return response.data.choices[0].message.content.trim();
    } catch (e) {
      lastErr = e;
      console.error(`Groq key ${key.slice(0, 10)}… failed:`, e.response?.data?.error?.message || e.message);
    }
  }
  throw new Error("All Groq keys failed: " + (lastErr?.message || "unknown"));
}

export function getAiStatus() {
  const hasPrimary = !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.startsWith("gsk_"));
  const hasFallback = !!(process.env.GROQ_API_KEY_FALLBACK && process.env.GROQ_API_KEY_FALLBACK.startsWith("gsk_"));
  return {
    provider: "groq",
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    primaryKey: hasPrimary,
    fallbackKey: hasFallback,
    ready: hasPrimary || hasFallback,
  };
}

export async function aiReply({ sender, message, userName }) {
  if (CLOSING_PATTERN.test(message.trim())) {
    return { text: "Thik hai! Agar aur koi kaam ho toh zaroor bataiye ga. 🙏", isUnknown: false, isOrder: false };
  }

  const history = state.history[sender] || [];
  const systemPrompt = buildSystemPrompt(userName);

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  let text = "";
  try {
    text = await groqChat(messages);
  } catch (e) {
    console.error("AI Generation Error:", e.message);
    state.lastError = e.message;
    text = "Maaf kijiye, system mein masla hai. Thori dair mein dobara try karein.";
  }

  const isUnknown = text.includes("[UNKNOWN]");
  const isOrder = text.includes("[ORDER]");
  const cleanedText = text.replace("[UNKNOWN]", "").replace("[ORDER]", "").trim();

  let orderDetails = null;
  if (isOrder) {
    try {
      const convoSnippet = history.slice(-6).map((h) => `${h.role === "user" ? "Customer" : "AI"}: ${h.content}`).join("\n");
      const fullContext = `${convoSnippet}\nCustomer: ${message}\nAI: ${cleanedText}`;
      const extractionPrompt = `Extract order details from this WhatsApp conversation as STRICT JSON only:
{"name":"...","item":"...","price":"...","address":"...","phone":"..."}
Use "Not provided" if missing.

Conversation:
${fullContext}`;
      const raw = await groqChat([
        { role: "system", content: "You are a JSON extraction bot. Output ONLY valid JSON, no prose, no code fences." },
        { role: "user", content: extractionPrompt },
      ]);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      orderDetails = JSON.parse(cleaned);
    } catch (e) {
      console.warn("Order extraction failed:", e.message);
    }
  }

  return { text: cleanedText, isUnknown, isOrder, orderDetails };
}

export async function aiRewriteBusiness(input) {
  const prompt = `You are a World-Class Business Analyst. Transform raw business data into a comprehensive, high-converting Knowledge Base.

GUIDELINES:
1. EXPAND each section into 3-5 professional bullet points.
2. SYNTHESIZE website data, FAQ, and services into a cohesive narrative.
3. Generate 5 likely customer FAQs with clear answers.
4. Retain all phone numbers, prices, and URLs exactly.
5. Use Markdown sections: # Business Profile, # Detailed Services, # Pricing Strategy, # Comprehensive FAQ, # Technical Context.

Output ONLY the markdown — no preamble.

RAW DATA:
${JSON.stringify(input)}

KNOWLEDGE BASE:`;

  const messages = [
    { role: "system", content: "You transform raw business notes into world-class knowledge bases." },
    { role: "user", content: prompt },
  ];
  return await groqChat(messages);
}
