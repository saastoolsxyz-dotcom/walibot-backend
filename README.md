# WaliBot Backend v11

Advanced WhatsApp AI Chatbot with Dual AI Support (Groq & Gemini).

## Features
- **WhatsApp Integration**: Using Baileys library.
- **AI Dual-Engine**: Primary Groq (Llama 3), Fallback Gemini 1.5 Flash.
- **Auto-Reply**: Intelligent conversation handling with memory.
- **Dashboard**: Real-time message feed, state management, and configuration.
- **Webhooks**: Send order notifications via CLI or external apps.

## Setup
1. Copy `.env.example` to `.env`
2. Add your Groq and Gemini API keys.
3. Run `npm install`
4. Run `npm run dev`
5. Open `http://localhost:3000`

## Tech Stack
- Frontend: Vanilla JS + Tailwind
- Backend: Node.js + Express
- AI: Groq SDK, Google Generative AI
- WhatsApp: @whiskeysockets/baileys
