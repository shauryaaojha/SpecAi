# ⬡ SpecAI

> Turn any app idea into a production-ready spec, prompt, and 4-phase build chain — through a smart conversational interface.

---

## What is SpecAI?

SpecAI is an AI-powered product spec generator. You describe your app idea in plain language, and SpecAI asks contextual follow-up questions until it understands your vision completely. Then it generates three things you can use immediately:

- **Spec Doc** — a detailed product specification in markdown
- **Ready Prompt** — a single production-ready prompt you can paste directly into Claude to build your app
- **Phase Chain** — 4 focused prompts broken into Architecture, Backend, Frontend, and Integration phases

---

## Demo

```
You:     "I want to build an app for managing restaurant orders and staff shifts"
SpecAI:  "Who are the primary users — restaurant owners, managers, or both?"
You:     "Both, with different permission levels"
SpecAI:  "Should staff be able to clock in/out from the app, or just view their shifts?"
...
SpecAI:  "Got everything I need! Generating your full spec..."
         ✓ Spec Doc
         ✓ Ready Prompt
         ✓ Phase Chain
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + Vite |
| Language | JavaScript (JSX) |
| AI Provider | Groq API (free) or Anthropic API |
| Styling | Inline styles + Google Fonts (DM Sans, DM Mono) |
| State | React hooks (useState, useEffect, useRef) |
| Output | Copy to clipboard + Download as .md |

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/specai.git
cd specai
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and add your API key:

**Using Groq (free, recommended):**
```env
VITE_GROQ_API_KEY=your_groq_key_here
```

Get a free key at [console.groq.com](https://console.groq.com) — no credit card needed.

**Using Anthropic (paid):**
```env
VITE_ANTHROPIC_API_KEY=your_anthropic_key_here
```

Get a key at [console.anthropic.com](https://console.anthropic.com).

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Switching AI Providers

### Using Groq (default recommended)

In `src/App.jsx`, update the `callAPI` function:

```js
const callAPI = async (messages, system, maxTokens = 500) => {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        ...messages
      ]
    })
  });
  const data = await res.json();
  return data.choices[0].message.content;
};
```

### Using Anthropic API

```js
const callAPI = async (messages, system, maxTokens = 500) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system,
      messages
    })
  });
  const data = await res.json();
  return data.content.map(b => b.text || "").join("");
};
```

---

## Project Structure

```
specai/
├── public/
├── src/
│   ├── App.jsx          # Main SpecAI component (entire app)
│   └── main.jsx         # React entry point
├── .env                 # Your API keys (never commit this)
├── .env.example         # Template for env vars
├── .gitignore
├── index.html
├── package.json
├── README.md
└── vite.config.js
```

---

## How It Works

```
User types idea
      ↓
Discovery phase — AI asks ONE question at a time (unlimited until complete)
      ↓
User answers each question
      ↓
AI detects when it has enough info → phase: "complete"
      ↓
3 separate API calls (to avoid token limits):
  Call 1 → Spec Doc      (2000 tokens)
  Call 2 → Ready Prompt  (2000 tokens)
  Call 3 → Phase Chain   (2000 tokens)
      ↓
Live progress shown while generating
      ↓
Output rendered in 3 tabs — copy or download each
```

---

## Deploying to Vercel

```bash
npm i -g vercel
vercel
```

Then go to **Vercel Dashboard → Your Project → Settings → Environment Variables** and add your API key there.

---

## .env.example

```env
# Groq (free) — get key at console.groq.com
VITE_GROQ_API_KEY=

# Anthropic (paid) — get key at console.anthropic.com
VITE_ANTHROPIC_API_KEY=
```

---

## ⚠️ Security Note

This app calls the AI API directly from the browser (frontend). This is fine for local development and personal use, but for a public deployment you should proxy API calls through a backend (Next.js API route, Express, etc.) to keep your API key hidden.

---

## Built With

- [React](https://react.dev)
- [Vite](https://vitejs.dev)
- [Groq API](https://console.groq.com)
- [Anthropic Claude](https://anthropic.com)
- [DM Sans](https://fonts.google.com/specimen/DM+Sans) — Google Fonts

---

## License

MIT — free to use, modify, and ship.