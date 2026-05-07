export const state = {
  business: null,
  messages: [],
  history: {}, // sender -> [{role, content}]
  contacts: {}, // sender -> name
  qrPng: null,
  lastError: null,
  startedAt: null,
  orders: [],
  unknownQuestions: [],
  settings: {
    responseDelay: {
      min: Number(process.env.RESPONSE_DELAY_MIN || 2),
      max: Number(process.env.RESPONSE_DELAY_MAX || 2),
    },
    aiProvider: process.env.AI_PROVIDER || "auto", // "groq" | "gemini" | "auto"
  },
};

export function setBusiness(b) { state.business = b; }
export function setSettings(patch) { state.settings = { ...state.settings, ...patch }; }
export function addMessage(m) {
  state.messages.unshift(m);
  if (state.messages.length > 500) state.messages.pop();
  
  if (m.pushName) {
    state.contacts[m.sender] = m.pushName;
  }
  
  const h = (state.history[m.sender] ||= []);
  h.push({ role: "user", content: m.message });
  h.push({ role: "assistant", content: m.reply });
  while (h.length > 20) h.shift();
}

export function addOrder(order) {
  state.orders.unshift({
    id: `ORD-${Date.now()}`,
    timestamp: Date.now(),
    status: "pending",
    ...order
  });
  if (state.orders.length > 100) state.orders.pop();
}

export function addUnknownQuestion(q) {
  if (!state.unknownQuestions.find(x => x.question === q)) {
    state.unknownQuestions.unshift({
      id: `Q-${Date.now()}`,
      question: q,
      timestamp: Date.now()
    });
  }
}
