import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

  const nameContext = userName ? `The customer's name is "${userName}". Start your conversation by addressing them with their name if appropriate (e.g., "Hi ${userName}!") to build rapport.` : "The customer's name is not known yet.";

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
- EMOJIS: Use emojis for a welcoming vibe, but do NOT overdo it.
- FORMATTING: Use plain text only. NEVER use HTML tags or <a> links. Use WhatsApp bold (*text*) or italic (_text_).
- LINKS: Send links as plain text (e.g., https://example.com/item).
- PRICING: Always mention the price next to any item or service you recommend.

=== BUSINESS KNOWLEDGE BASE ===
- CATEGORY: ${b.category}
- SERVICES/PRODUCTS: ${b.services}
- PRICING GUIDELINES: ${b.pricing}
- FAQ INFORMATION: ${b.faq}
- WEBSITE DATA: 
${b.scraped || "Refer to our official website."}
- ESCALATION CONTACT: ${b.fallbackContact}

=== OPERATIONAL RULES ===
1. Sales & Orders: If a customer expresses intent to buy, collect their: Full Name, Active Phone Number, Delivery Address, and preferred Payment Method.
2. Handling Unknowns: If a customer asks a SPECIFIC question about a product or policy that is NOT in the knowledge base above:
   - DO NOT make up an answer.
   - Say: "Maaf kijiye, is barey mein mje abhi confirm maloomat nahi hai. Main ne team ko request forward kar di hai, ya aap hamari website visit kar sakte hain."
   - Append exactly "[UNKNOWN]" at the very end of your response.
3. Order Capture: If you have collected Name, Phone, Address, and Payment Method, confirm the details to the user and append exactly "[ORDER]" at the very end.
4. Professionalism: Represent the business effectively. Keep replies mobile-friendly.`;
}

async function groqChat(messages) {
  const keys = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_FALLBACK].filter(
    (k) => k && k.startsWith("gsk_") && !k.includes("YOUR_")
  );

  if (keys.length === 0) throw new Error("No valid GROQ_API_KEY found");

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  
  const groqMessages = messages.map(m => ({
    role: m.role === "model" ? "assistant" : m.role,
    content: m.content
  }));

  for (const key of keys) {
    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: groqMessages,
          temperature: 0.7,
        },
        {
          headers: { Authorization: `Bearer ${key}` },
          timeout: 25000,
        }
      );
      return response.data.choices[0].message.content.trim();
    } catch (e) {
      console.error(`Groq key failure: ${key.slice(0, 10)}...`, e.message);
    }
  }
  throw new Error("All Groq keys failed");
}

async function geminiChat(messages, modelName = "gemini-1.5-flash") {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !key.startsWith("AIza") || key.includes("YOUR_")) {
    throw new Error("No valid GEMINI_API_KEY found");
  }

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: modelName });

  const systemPrompt = messages.find(m => m.role === "system")?.content || buildSystemPrompt();
  
  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Understood. I will act as the business AI assistant based on the provided data." }] },
  ];

  const historyItems = messages.filter(m => m.role !== "system");

  historyItems.forEach(m => {
    contents.push({
      role: m.role === "assistant" || m.role === "model" ? "model" : m.role,
      parts: [{ text: m.content }]
    });
  });

  const result = await model.generateContent({ contents });
  return result.response.text().trim();
}

export async function aiReply({ sender, message, userName }) {
  if (CLOSING_PATTERN.test(message.trim())) return { text: "Thik hai! Agar aur koi kaam ho toh zaroor bataiye ga. 🙏" };

  const history = state.history[sender] || [];
  let systemPrompt = buildSystemPrompt(userName);

  // Advanced Payment Context Detection
  const paymentKeywords = ["pay", "payment", "bank", "account", "jazzcash", "easypaisa", "transfer", "price", "bill", "invoice", "checkout", "khareedna", "paise"];
  const isPaymentContext = paymentKeywords.some(kw => message.toLowerCase().includes(kw));

  if (isPaymentContext) {
    systemPrompt += `\n\n=== CRITICAL PAYMENT ACCURACY MODE ===
- YOU ARE CURRENTLY HANDLING A PAYMENT/CHECKOUT QUERY.
- ACCURACY IS THE TOP PRIORITY.
- RE-VERIFY BANK DETAILS AND PRICES FROM THE BUSINESS CONTEXT.
- DO NOT MAKE ANY MISTAKES.
- PROVIDE CLEAR, STEP-BY-STEP PAYMENT INSTRUCTION IN RESPONSIVE LANGUAGE.`;
  }

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: message }
  ];

  const provider = state.settings.aiProvider;
  let text = "";

  try {
    // 1. Try Primary Provider
    if (isPaymentContext) {
      console.log("[AI] Payment context detected, attempting Gemini 1.5 Flash...");
      try {
        text = await geminiChat(messages, "gemini-1.5-flash");
      } catch (e) {
        console.warn("[AI] Gemini Payment Mode failed, falling back to Groq", e.message);
        text = await groqChat(messages);
      }
    } else if (provider === "groq") {
      text = await groqChat(messages);
    } else if (provider === "gemini") {
      try {
        text = await geminiChat(messages, "gemini-1.5-pro");
      } catch (e) {
        console.warn("[AI] Gemini Pro failed, falling back to Groq", e.message);
        text = await groqChat(messages);
      }
    } else {
      // AUTO MODE: Prioritize Groq for reliability as requested
      try {
        text = await groqChat(messages);
      } catch (e) {
        console.warn("[AI] Groq failed in Auto mode, trying Gemini Flash", e.message);
        text = await geminiChat(messages, "gemini-1.5-flash");
      }
    }
  } catch (e) {
    console.error("AI Generation Error:", e.message);
    text = "Maaf kijiye, system mein masla hai. Thori dair mein rabita karein.";
  }

  const isUnknown = text.includes("[UNKNOWN]");
  const isOrder = text.includes("[ORDER]");
  
  const cleanedText = text.replace("[UNKNOWN]", "").replace("[ORDER]", "").trim();

  let orderDetails = null;
  if (isOrder) {
    try {
      // Improved extraction: include history and current user message
      const convoSnippet = history.slice(-5).map(h => `${h.role === 'user' ? 'Customer' : 'AI'}: ${h.content}`).join("\n");
      const fullContext = `${convoSnippet}\nCustomer: ${message}\nAI: ${cleanedText}`;
      
      const extractionPrompt = `Extract order details from this WhatsApp conversation. 
      Format as JSON: {"name": "...", "item": "...", "price": "...", "address": "...", "phone": "..."}
      Rules:
      1. If a field is missing, use "Not provided".
      2. If multiple items are mentioned, list them all in "item".
      3. For "phone", use the customer's provided number, otherwise "Not provided".
      
      Conversation:
      ${fullContext}`;
      
      const extraction = await geminiChat([
        { role: "system", content: "You are a data extraction bot. Output ONLY valid JSON." },
        { role: "user", content: extractionPrompt }
      ], "gemini-1.5-flash");
      
      orderDetails = JSON.parse(extraction.replace(/```json|```/g, "").trim());
    } catch (e) {
      console.warn("Order extraction failed:", e.message);
    }
  }

  return { text: cleanedText, isUnknown, isOrder, orderDetails };
}

export async function aiRewriteBusiness(input) {
  const prompt = `You are a World-Class Business Analyst and Data Architect. 
  Your goal is to take sparse or raw business data and REWRITE it into a comprehensive, high-converting Knowledge Base.

  TRANSFORMATION GUIDELINES:
  1. EXPAND: Don't just copy. If a category is mentioned, write 3-5 professional bullet points describing the business expertise in that category.
  2. SYNTHESIZE: Combine the website data (if any), FAQ, and services into a cohesive narrative.
  3. FAQ GENERATION: Based on the raw input, project 5 common questions customers might ask and write clear, professional answers for them in the style of the business.
  4. ACCURACY: Retain all technical details, phone numbers, and URLs exactly as provided.
  5. STRUCTURE: Use Markdown. Sections: # Business Profile, # Detailed Services, # Pricing Strategy, # Comprehensive FAQ, # Technical Context.

  IMPORTANT: Do not include ANY introductory text. Output only the transformed Markdown knowledge base.

  RAW DATA TO TRANSFORM:
  ${JSON.stringify(input)}

  TRANSFORMED KNOWLEDGE BASE:`;

  const messages = [
    { role: "system", content: "You are an expert at transforming raw text into professional business knowledge bases using detailed expansion and synthesis." }, 
    { role: "user", content: prompt }
  ];

  try {
    console.log("[REWRITE] Attempting transformation with Gemini 1.5 Pro...");
    return await geminiChat(messages, "gemini-1.5-pro");
  } catch (e) {
    console.warn("[REWRITE] Gemini 1.5 Pro failed, falling back to Groq for transformation", e.message);
    return await groqChat(messages);
  }
}

export function getAiStatus() {
  const groqKeys = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_FALLBACK].filter(
    k => k && k.startsWith("gsk_") && !k.includes("YOUR_")
  ).length;
  const geminiKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith("AIza") && !process.env.GEMINI_API_KEY.includes("YOUR_"));
  
  return {
    groqKeys,
    geminiKey,
    provider: state.settings.aiProvider,
  };
}
