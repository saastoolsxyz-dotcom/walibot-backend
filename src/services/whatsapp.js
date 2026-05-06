import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import pino from "pino";
import { state } from "./state.js";
import path from "path";
import fs from "fs";

let sock = null;
let connState = "disconnected";
let onMessageCb = null;

export function getConnState() { return connState; }
export function getQrPng() { return state.qrPng; }

export async function startWhatsApp({ onMessage }) {
  if (sock && connState !== "disconnected") return;
  onMessageCb = onMessage;

  const authPath = path.resolve(process.cwd(), "auth_data");
  if (!fs.existsSync(authPath)) {
    fs.mkdirSync(authPath, { recursive: true });
  }

  const { state: auth, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth,
    printQRInTerminal: false,
    logger: pino({ level: "warn" }),
    browser: ["WaliBot", "Chrome", "1.0"],
  });

  connState = "connecting";

  sock.ev.on("creds.update", saveCreds);
  
  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    
    if (qr) {
      try { 
        state.qrPng = await qrcode.toDataURL(qr); 
        console.log("New QR Generated");
      } catch (e) {
        console.error("QR Generation error", e);
      }
    }

    if (connection === "open") {
      connState = "connected";
      state.qrPng = null;
      state.lastError = null;
      console.log("WhatsApp Connected!");
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      connState = "disconnected";
      console.log("WhatsApp Connection Closed, code:", code);
      
      if (code !== DisconnectReason.loggedOut) {
        console.log("Attempting to reconnect...");
        setTimeout(() => startWhatsApp({ onMessage: onMessageCb }).catch(() => {}), 3000);
      } else {
        console.log("Logged out, will not reconnect automatically.");
      }
    }
  });

  sock.ev.on("messages.upsert", async (ev) => {
    for (const msg of ev.messages) {
      if (!msg.message || msg.key.fromMe) continue;
      
      const sender = msg.key.remoteJid;
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";
        
      if (!text) continue;
      
      const pushName = msg.pushName || "";
      
      try { 
        await onMessageCb?.({ sender, message: text, pushName }); 
      } catch (e) { 
        console.error("onMessage Callback Error:", e); 
      }
    }
  });
}

export async function stopWhatsApp() {
  try { 
    if (sock) {
      await sock.logout(); 
    }
  } catch (e) {
    console.error("Logout error:", e);
  }
  sock = null;
  connState = "disconnected";
  state.qrPng = null;
}

export async function sendText(jid, text) {
  if (!sock) throw new Error("WhatsApp not connected");
  await sock.sendMessage(jid, { text });
}

export async function sendImage(jid, imagePath, caption = "") {
  if (!sock) throw new Error("WhatsApp not connected");
  const buffer = fs.readFileSync(imagePath);
  await sock.sendMessage(jid, {
    image: buffer,
    caption,
  });
}
