import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { 
  state, 
  setBusiness, 
  setSettings, 
  addMessage,
  addOrder,
  addUnknownQuestion
} from "./src/services/state.js";
import { 
  startWhatsApp, 
  stopWhatsApp, 
  getConnState, 
  getQrPng, 
  sendText
} from "./src/services/whatsapp.js";
import { 
  aiReply, 
  aiRewriteBusiness, 
  getAiStatus 
} from "./src/services/ai.js";
import { scrapeUrl } from "./src/services/scraper.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));

// --- HELPERS ---
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function handleIncoming({ sender, message, pushName }) {
  const timestamp = Date.now();
  try {
    console.log(`[INCOMING] From: ${pushName} (${sender}) | Msg: ${message}`);
    
    // 1. Wait for random delay (typing effect)
    const { min, max } = state.settings.responseDelay;
    const waitSec = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log(`Waiting ${waitSec}s...`);
    await delay(waitSec * 1000);
    
    // 2. Get AI Reply with logic flags and personalized name
    const { text, isUnknown, isOrder, orderDetails } = await aiReply({ sender, message, userName: pushName });
    
    // 3. Send text on WhatsApp
    await sendText(sender, text);
    
    // 4. Handle Logic Markers
    if (isUnknown) addUnknownQuestion(message);
    if (isOrder) {
      addOrder({ 
        customerPhone: sender, 
        lastMessage: message,
        details: orderDetails || { name: "Pending", item: "Pending", price: "Pending", address: "Pending", phone: sender }
      });
    }
    
    // 5. Add to memory
    addMessage({ sender, message, reply: text, timestamp, pushName });
    console.log(`[REPLIED] To: ${sender} | Logic: UNK:${isUnknown}, ORD:${isOrder}`);
    
  } catch (e) {
    console.error("handleIncoming Error:", e.message);
    state.lastError = e.message;
    
    try {
      const fallbackMsg = "Maaf kijiyega, bot me kuch masala agaya hai. Thori dair baad rabita karein.";
      await sendText(sender, fallbackMsg);
      addMessage({ sender, message, reply: `[ERROR] ${fallbackMsg}`, timestamp: Date.now() });
    } catch {}
  }
}

// --- ENDPOINTS ---

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    name: "WaliBot Backend",
    version: "11.0.0",
    status: getConnState(),
    hasBusiness: !!state.business,
    messageCount: state.messages.length,
  });
});

app.get("/status", (req, res) => {
  res.json({
    status: getConnState(),
    hasBusiness: !!state.business,
    messageCount: state.messages.length,
    qrAvailable: !!getQrPng(),
    lastError: state.lastError,
    backendVersion: "11.0.0",
    totalMessages: state.messages.length,
    uniqueUsers: Object.keys(state.history).length,
    startedAt: state.startedAt,
    responseDelay: state.settings.responseDelay,
    aiProvider: state.settings.aiProvider,
    aiStatus: getAiStatus(),
  });
});

app.get("/qr", (req, res) => {
  res.json({ qr: getQrPng(), status: getConnState() });
});

app.get("/qr.png", (req, res) => {
  const qr = getQrPng();
  if (!qr) return res.status(404).send("QR not available");
  const base64Data = qr.replace(/^data:image\/png;base64,/, "");
  const img = Buffer.from(base64Data, "base64");
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": img.length,
  });
  res.end(img);
});

app.get("/messages", (req, res) => {
  res.json([...state.messages].reverse());
});

app.get("/dashboard-data", (req, res) => {
  const convos = Object.entries(state.history).map(([sender, logs]) => {
    const historyLogs = logs as any[];
    return {
      user: sender,
      userName: state.contacts[sender] || null,
      msgs: historyLogs.length / 2,
      lastMsg: historyLogs[historyLogs.length - 2]?.content || "",
      lastReply: historyLogs[historyLogs.length - 1]?.content || "",
      time: Date.now(), // approximation
    };
  });
  res.json({ 
    stats: { 
      total: state.messages.length, 
      users: convos.length, 
      pendingOrders: state.orders.filter(o => o.status === 'pending').length 
    }, 
    convos,
    orders: state.orders,
    unknownQuestions: state.unknownQuestions
  });
});

app.post("/confirm-order", async (req, res) => {
  const { id, confirmedDetails } = req.body;
  const order = state.orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: "Order not found" });

  try {
    order.status = "confirmed";
    if (confirmedDetails) order.details = confirmedDetails;
    
    const msg = `✅ *Order Confirmed!*
    
*Details:*
- Name: ${order.details?.name || 'N/A'}
- Item: ${order.details?.item || 'N/A'}
- Price: ${order.details?.price || 'N/A'}
- Address: ${order.details?.address || 'N/A'}

Thank you for shopping with us. Hamari team jald hi aap se contact kare gi advance payment aur baki details confirm karne ke liye. 🙏`;
    
    await sendText(order.customerPhone, msg);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/add-to-kb", (req, res) => {
  const { question, answer, id } = req.body;
  if (!state.business) return res.status(400).json({ error: "No business data" });
  
  // Add to FAQ
  const newFaq = `Q: ${question}\nA: ${answer}\n\n${state.business.faq || ""}`;
  state.business.faq = newFaq;
  
  // Remove from unknown
  if (id) {
    state.unknownQuestions = state.unknownQuestions.filter(q => q.id !== id);
  }
  
  res.json({ ok: true });
});

app.post("/start-bot", async (req, res) => {
  const body = req.body;
  if (!body.businessName) return res.status(400).json({ error: "Missing business name" });
  
  try {
    state.startedAt = Date.now();
    let scratchedContent = "";
    if (body.websiteUrl) {
      console.log("Scraping website:", body.websiteUrl);
      scratchedContent = await scrapeUrl(body.websiteUrl);
    }
    
    setBusiness({ ...body, scraped: scratchedContent });
    console.log("Business Data Saved. Starting WhatsApp...");
    
    await startWhatsApp({ onMessage: handleIncoming });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/stop-bot", async (req, res) => {
  await stopWhatsApp();
  res.json({ ok: true });
});

app.post("/rewrite-business", async (req, res) => {
  try {
    const config = req.body;
    let scrapedData = "";
    
    // If URL is provided during rewrite, scan it first
    if (config.websiteUrl) {
      console.log("[REWRITE] Scanning website before AI processing:", config.websiteUrl);
      try {
        scrapedData = await scrapeUrl(config.websiteUrl);
      } catch (scrapeErr) {
        console.warn("[REWRITE] Scrape failed, proceeding with form data only:", scrapeErr.message);
      }
    }

    // Merge scraped data into the config for the AI
    const combinedData = {
      ...config,
      scraped: scrapedData || config.scraped || ""
    };

    const rewritten = await aiRewriteBusiness(combinedData);
    res.json({ ok: true, rewritten });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/settings", (req, res) => {
  res.json(state.settings);
});

app.post("/settings", (req, res) => {
  setSettings(req.body);
  res.json({ ok: true });
});

app.post("/webhook/order", async (req, res) => {
  const { customer_phone, status, order_number, customer_name } = req.body;
  if (!customer_phone || !status) return res.status(400).json({ error: "Invalid data" });

  let jid = customer_phone.replace(/\D/g, "");
  if (!jid.includes("@")) jid += "@s.whatsapp.net";

  const name = customer_name || "Customer";
  const num = order_number || "order";

  const msgs = {
    confirmed: `Hi ${name}! Aap ka order #${num} confirm ho gaya hai. Shukriya! 🎉`,
    processing: `Aap ka order #${num} taiyar ho raha hai.`,
    completed: `Aap ka order #${num} complete ho gaya hai. Shukriya! 🙌`,
    cancelled: `Aap ka order #${num} cancel kar diya gaya hai. Mazid info ke liye rabita karein.`,
  };

  const text = msgs[status] || `Order #${num} status: ${status}`;

  try {
    await sendText(jid, text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/ai-status", (req, res) => {
  res.json(getAiStatus());
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WaliBot v11 running on http://localhost:${PORT}`);
});
