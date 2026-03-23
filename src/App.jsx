import { useState, useRef, useEffect } from "react";

// ════════════════════════════════
// MODEL STRATEGY
// Discovery   → gpt-5.4-nano    (OpenAI credits, fast, cheap)
// Compression → gpt-5.4-nano    (OpenAI credits)
// Spec/Chain  → claude-sonnet-4-6 (Anthropic credits)
// Prompt      → claude-opus-4-6   (Anthropic credits, best quality)
// ════════════════════════════════

const MODELS = {
  discovery: "gpt-5.4-nano",
  compress: "gpt-5.4-nano",
  spec: "claude-sonnet-4-6",
  chain: "claude-sonnet-4-6",
  prompt: "claude-opus-4-6",
};

// ── Puter API call ──
const ask = async (userMessage, systemPrompt, maxTokens, model) => {
  try {
    const response = await window.puter.ai.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      { model, max_tokens: maxTokens }
    );
    // Handle all Puter response shapes
    if (typeof response === "string") return response;
    const r = response;
    if (r?.message?.content?.[0]?.text) return r.message.content[0].text;
    if (typeof r?.message?.content === "string") return r.message.content;
    if (typeof r?.message === "string") return r.message;
    if (r?.text) return r.text;
    if (r?.content?.[0]?.text) return r.content[0].text;
    if (Array.isArray(r?.content)) return r.content.map(c => c.text || "").join("");
    const s = JSON.stringify(r);
    const m = s.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    return "";
  } catch (e) {
    console.error("Puter error:", e);
    return "";
  }
};

// ── Extract ONLY the first question from a response ──
// Fixes GPT dumping multiple questions at once
const extractFirstQuestion = (text) => {
  if (!text) return "";
  // If it's a ready signal, return as-is
  if (text.includes("SPECAI_READY:")) return text.trim();
  // Split by Q: pattern and take only the first one
  const lines = text.split("\n");
  const result = [];
  let foundQ = false;
  for (const line of lines) {
    if (line.trim().startsWith("Q:")) {
      if (foundQ) break; // Stop at second question
      foundQ = true;
      result.push(line);
    } else if (foundQ) {
      // Include bullets under the first question
      if (line.trim().startsWith("•") || line.trim().startsWith("-") || line.trim() === "") {
        result.push(line);
      } else if (line.trim().length > 0) {
        // Non-bullet content after Q — include if short (part of question)
        result.push(line);
      }
    }
  }
  if (result.length > 0) return result.join("\n").trim();
  // Fallback — just return first 2 lines
  return lines.slice(0, 2).join("\n").trim();
};

// ── Compress a user's long answer to key facts ──
const compressAnswer = (answer) => {
  if (answer.length < 100) return answer; // Short enough, keep as-is
  // Strip filler
  let c = answer
    .replace(/^(yeah|yes|sure|ok|okay|so|well|basically|actually|i mean|i think|i want|we want)\s*/gi, "")
    .replace(/\b(you know|kind of|sort of|like|basically|essentially|probably|maybe)\b/gi, "")
    .replace(/\s+/g, " ").trim();
  // Take first 150 chars if still long
  if (c.length > 150) {
    const sentences = c.split(/[.!?]/).filter(s => s.trim().length > 5);
    c = sentences.slice(0, 2).join(". ").trim();
  }
  return c || answer.slice(0, 150);
};

// ── Build discovery prompt with full context ──
// Stateless — pass everything each time, no sliding window confusion
const buildDiscoveryPrompt = (idea, qaHistory, questionNumber) => {
  const remaining = 8 - questionNumber;
  let context = `App idea: "${idea}"\n`;
  if (qaHistory.length > 0) {
    context += "\nWhat we know so far:\n";
    qaHistory.forEach(({ q, a }) => {
      const qClean = q.replace(/^Q:\s*/i, "").split("\n")[0].slice(0, 60);
      context += `- ${qClean} → ${a}\n`;
    });
  }
  context += `\nQuestions remaining: ${remaining}`;
  if (remaining <= 2) context += ` (CONVERGE — ask only if critical gap remains, else say SPECAI_READY)`;
  return context;
};

// ── Build compressed context for generation ──
const buildContext = async (idea, qaHistory) => {
  const raw = qaHistory.map(({ q, a }) =>
    `${q.replace(/^Q:\s*/i, "").split("\n")[0]}: ${a}`
  ).join("\n");

  const prompt = `App: "${idea}"\nDiscovery answers:\n${raw}\n\nExtract into this JSON (be thorough, infer reasonable defaults):\n{"appName":"","appType":"","targetUsers":"","coreFeatures":[],"techStack":{"frontend":"","backend":"","database":"","auth":""},"pages":[],"integrations":[],"designStyle":"","deployment":"","monetization":"","specialRequirements":""}`;

  const result = await ask(prompt, "Extract app requirements into compact JSON. No explanations. Valid JSON only.", 400, MODELS.compress);

  try {
    const match = (result.replace(/```json|```/g, "").trim()).match(/\{[\s\S]*\}/);
    if (match) {
      const d = JSON.parse(match[0]);
      return {
        parsed: d,
        text: [
          `APP: ${d.appName || idea}`,
          `TYPE: ${d.appType}`,
          `USERS: ${d.targetUsers}`,
          `FEATURES: ${(d.coreFeatures || []).join(", ")}`,
          `STACK: frontend=${d.techStack?.frontend}, backend=${d.techStack?.backend}, db=${d.techStack?.database}, auth=${d.techStack?.auth}`,
          `PAGES: ${(d.pages || []).join(", ")}`,
          `INTEGRATIONS: ${(d.integrations || []).join(", ")}`,
          `DESIGN: ${d.designStyle}`,
          `DEPLOY: ${d.deployment}`,
          `MONETIZATION: ${d.monetization}`,
          `SPECIAL: ${d.specialRequirements}`,
        ].join("\n")
      };
    }
  } catch { }

  // Fallback — use raw Q&A
  return { parsed: null, text: `App: ${idea}\n${raw}` };
};

// ── Generation chunk definitions ──
const SPEC_CHUNKS = [
  {
    key: "s1", label: "Overview & Features", model: MODELS.spec, tokens: 1200,
    prompt: ctx => `Write product spec sections 1-3 in markdown:\n1. App Overview (name, purpose, users, value prop)\n2. User Roles & Permissions (each role + exact permissions)\n3. Core Features (each: description, user flow, edge cases, UI components)\n\n${ctx}`
  },
  {
    key: "s2", label: "DB & API", model: MODELS.spec, tokens: 1200,
    prompt: ctx => `Write product spec sections 4-6 in markdown:\n4. Database Schema (each table: fields+types, required/optional, relations, indexes)\n5. API Endpoints (each: method+route, request, response success+error, auth, logic)\n6. Auth & Authorization (strategy, token flow, protected routes)\n\n${ctx}`
  },
  {
    key: "s3", label: "UI & Structure", model: MODELS.spec, tokens: 1000,
    prompt: ctx => `Write product spec sections 7-10 in markdown:\n7. UI/UX Flows (every screen, navigation, states)\n8. Tech Stack (all layers)\n9. Folder Structure (complete tree with file purposes)\n10. Edge Cases & Error Handling\n\n${ctx}`
  },
];

const PROMPT_CHUNKS = [
  {
    key: "p1", label: "Stack & Structure", model: MODELS.spec, tokens: 1200,
    prompt: ctx => `Write first half of a production developer prompt:\n## Role\n## App Overview\n## Tech Stack (JSON)\n## Folder Structure (complete)\n## Pages & Routes\n## Database Schema (JSON)\n\n${ctx}`
  },
  {
    key: "p2", label: "Features & Rules", model: MODELS.prompt, tokens: 1500,
    prompt: ctx => `Write second half of a spoonfeeding developer prompt:\n## API Endpoints (full shapes)\n## Feature Specifications (exact behavior, all edge cases)\n## UI Requirements (every component, states)\n## Auth Flow (step by step)\n## Environment Variables\n## Output Rules: full files only, no placeholders, folder structure first\n\n${ctx}`
  },
];

const CHAIN_CHUNKS = [
  {
    key: "c1", label: "Phase 1 & 2", model: MODELS.chain, tokens: 1200,
    prompt: ctx => `Write Phase 1 and Phase 2 build prompts:\n\nPHASE 1 - ARCHITECTURE:\n[project init, full folder tree, config files, env setup, routing, DB connection, auth skeleton — list every file]\n\nPHASE 2 - BACKEND:\n[every endpoint, DB models, middleware, validation, business logic, exact request/response shapes]\n\n${ctx}`
  },
  {
    key: "c2", label: "Phase 3 & 4", model: MODELS.chain, tokens: 1200,
    prompt: ctx => `Write Phase 3 and Phase 4 build prompts:\n\nPHASE 3 - FRONTEND:\n[every page+component, state management, API layer, forms+validation, loading/error/empty states — each component with props]\n\nPHASE 4 - INTEGRATION:\n[connect frontend+backend, e2e auth, uploads, 3rd party, error boundaries, deploy config, testing checklist]\n\n${ctx}`
  },
];

const ALL_CHUNKS = [...SPEC_CHUNKS, ...PROMPT_CHUNKS, ...CHAIN_CHUNKS];

// ── Parse phase chain ──
const parsePhaseChain = (raw) => {
  const result = { phase1: "", phase2: "", phase3: "", phase4: "" };
  const headers = ["PHASE 1 - ARCHITECTURE:", "PHASE 2 - BACKEND:", "PHASE 3 - FRONTEND:", "PHASE 4 - INTEGRATION:"];
  const keys = ["phase1", "phase2", "phase3", "phase4"];
  headers.forEach((h, i) => {
    const start = raw.indexOf(h);
    if (start === -1) return;
    const from = start + h.length;
    const to = headers.slice(i + 1).map(nh => raw.indexOf(nh, from)).find(n => n !== -1) ?? raw.length;
    result[keys[i]] = raw.slice(from, to).trim();
  });
  return result;
};

// ════════════════════════════════
// UI COMPONENTS
// ════════════════════════════════

const TypewriterText = ({ text }) => {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed(""); setDone(false);
    let i = 0;
    const iv = setInterval(() => {
      if (i < text.length) setDisplayed(text.slice(0, ++i));
      else { setDone(true); clearInterval(iv); }
    }, 14);
    return () => clearInterval(iv);
  }, [text]);
  return <span>{displayed}{!done && <span style={{ animation: "blink 1s step-end infinite" }}>|</span>}</span>;
};

const Badge = ({ type }) => {
  if (!type) return null;
  const map = { ecommerce: "#f59e0b", saas: "#3b82f6", social: "#ec4899", tool: "#10b981", marketplace: "#8b5cf6", dashboard: "#06b6d4" };
  const c = Object.entries(map).find(([k]) => type.toLowerCase().includes(k))?.[1] || "#6b7280";
  return <span style={{ background: c + "18", color: c, border: `1px solid ${c}30`, padding: "2px 10px", borderRadius: "100px", fontSize: "11px", fontFamily: "monospace", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{type}</span>;
};

const OutputSection = ({ specDoc, readyPrompt, phaseChain, appName, onFeedback, regenerating }) => {
  const [tab, setTab] = useState("spec");
  const [copied, setCopied] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const labels = { spec: "Spec Doc", prompt: "Ready Prompt", chain: "Phase Chain" };

  const getContent = () => {
    if (tab === "spec") return specDoc;
    if (tab === "prompt") return readyPrompt;
    return Object.entries(phaseChain).map(([, v], i) => `PHASE ${i + 1} - ${["ARCHITECTURE", "BACKEND", "FRONTEND", "INTEGRATION"][i]}:\n\n${v}`).join("\n\n---\n\n");
  };
  const copy = (text, key) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 2000); };
  const dl = (content, name) => { const b = new Blob([content], { type: "text/markdown" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); };
  const submit = () => { if (!feedback.trim() || regenerating) return; onFeedback(feedback.trim(), tab); setFeedback(""); setShowFeedback(false); };

  return (
    <div style={{ marginTop: "28px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", gap: "2px", background: "#f3f4f6", borderRadius: "10px", padding: "3px" }}>
          {[["spec", "Spec Doc"], ["prompt", "Ready Prompt"], ["chain", "Phase Chain"]].map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setShowFeedback(false); }} style={{ padding: "5px 14px", borderRadius: "8px", border: "none", background: tab === k ? "#fff" : "transparent", color: tab === k ? "#111" : "#6b7280", fontSize: "12px", fontWeight: 500, cursor: "pointer", boxShadow: tab === k ? "0 1px 3px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button onClick={() => copy(getContent(), tab)} style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "11px", cursor: "pointer" }}>{copied === tab ? "✓ Copied" : "Copy"}</button>
          <button onClick={() => dl(getContent(), `specai-${tab}-${(appName || "output").toLowerCase().replace(/\s/g, "-")}.md`)} style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "11px", cursor: "pointer" }}>↓ .md</button>
          <button onClick={() => setShowFeedback(v => !v)} style={{ padding: "5px 12px", borderRadius: "7px", border: `1px solid ${showFeedback ? "#111" : "#e5e7eb"}`, background: showFeedback ? "#111" : "#fff", color: showFeedback ? "#fff" : "#111", fontSize: "11px", cursor: "pointer", fontWeight: 500, transition: "all 0.15s" }}>✎ Refine</button>
        </div>
      </div>

      {showFeedback && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "14px", marginBottom: "14px" }}>
          <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace", marginBottom: "8px" }}>✎ Refining: <span style={{ color: "#111", fontWeight: 600 }}>{labels[tab]}</span></div>
          <textarea value={feedback} onChange={e => setFeedback(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder='e.g. "Add Stripe payments", "Use PostgreSQL instead"...' rows={2} style={{ width: "100%", border: "none", fontSize: "13px", lineHeight: "1.6", color: "#111", background: "transparent", fontFamily: "DM Sans, sans-serif", resize: "none", outline: "none" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #f3f4f6" }}>
            <button onClick={() => { setShowFeedback(false); setFeedback(""); }} style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: "11px", cursor: "pointer" }}>Cancel</button>
            <button onClick={submit} disabled={!feedback.trim() || regenerating} style={{ padding: "5px 14px", borderRadius: "7px", border: "none", background: "#111", color: "#fff", fontSize: "11px", cursor: "pointer", opacity: !feedback.trim() || regenerating ? 0.4 : 1 }}>{regenerating ? "Regenerating..." : "Regenerate →"}</button>
          </div>
        </div>
      )}

      {regenerating && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "10px", marginBottom: "12px" }}>
          <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#111", animation: "pulse 1s infinite" }} />
          <span style={{ fontSize: "12px", color: "#374151", fontFamily: "monospace" }}>Regenerating {labels[tab]}...</span>
        </div>
      )}

      {tab === "chain" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {Object.entries(phaseChain).map(([key, value], i) => (
            <div key={key} style={{ border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ background: "#f9fafb", padding: "8px 14px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#374151", fontFamily: "monospace" }}>PHASE {i + 1} — {["ARCHITECTURE", "BACKEND", "FRONTEND", "INTEGRATION"][i]}</span>
                <button onClick={() => copy(value, key)} style={{ padding: "2px 8px", borderRadius: "5px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: "10px", cursor: "pointer" }}>{copied === key ? "✓" : "Copy"}</button>
              </div>
              <pre style={{ margin: 0, padding: "14px", fontSize: "12px", lineHeight: "1.7", color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "DM Mono, monospace", maxHeight: "220px", overflowY: "auto" }}>{value}</pre>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden" }}>
          <pre style={{ margin: 0, padding: "18px", fontSize: "12.5px", lineHeight: "1.8", color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "DM Mono, monospace", maxHeight: "460px", overflowY: "auto" }}>{getContent()}</pre>
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════
// MAIN APP
// ════════════════════════════════
export default function SpecAI() {
  const [idea, setIdea] = useState("");
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState([]);
  const [qaHistory, setQaHistory] = useState([]);  // {q, a} — single source of truth
  const [lastQ, setLastQ] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [qCount, setQCount] = useState(0);
  const [appType, setAppType] = useState(null);
  const [appName, setAppName] = useState("Your App");
  const [output, setOutput] = useState(null);
  const [ctxText, setCtxText] = useState("");
  const [generating, setGenerating] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, generating]);

  const detectType = (text) => {
    const t = text.toLowerCase();
    if (t.includes("ecommerce") || t.includes("shop") || t.includes("store")) return "ecommerce";
    if (t.includes("social") || t.includes("community") || t.includes("feed")) return "social";
    if (t.includes("dashboard") || t.includes("analytics")) return "dashboard";
    if (t.includes("marketplace")) return "marketplace";
    if (t.includes("saas") || t.includes("subscription")) return "saas";
    return "tool";
  };

  // ── Ask one discovery question ──
  const askDiscovery = async (currentIdea, currentHistory, currentCount) => {
    const userMsg = buildDiscoveryPrompt(currentIdea, currentHistory, currentCount);
    const system = `You are SpecAI, a product architect. Ask exactly ONE question to understand an app idea.

FORMAT (strict):
Q: [question — max 10 words]
• option or sub-point (only if needed)
• option or sub-point

RULES:
- ONE question only. If you write Q: twice you have failed.
- No preamble. No "Great!". No filler.
- When you have enough info (by Q8 latest): respond ONLY with: SPECAI_READY: [App Name]
- Infer what you can. Only ask what truly matters.`;

    const raw = await ask(userMsg, system, 100, MODELS.discovery);
    // Extract only the first question — fixes GPT multi-Q dump
    return extractFirstQuestion(raw);
  };

  // ── Run generation ──
  const runGeneration = async (ctx, name) => {
    const done = [];
    setGenerating({ done, total: ALL_CHUNKS.length });

    const specParts = [];
    for (const c of SPEC_CHUNKS) {
      const t = await ask(c.prompt(ctx), "Write product spec in markdown. Thorough. No preamble.", c.tokens, c.model);
      specParts.push(t.trim());
      done.push(c.key);
      setGenerating({ done: [...done], total: ALL_CHUNKS.length });
    }

    const promptParts = [];
    for (const c of PROMPT_CHUNKS) {
      const t = await ask(c.prompt(ctx), "Write a spoonfeeding developer prompt. No preamble.", c.tokens, c.model);
      promptParts.push(t.trim());
      done.push(c.key);
      setGenerating({ done: [...done], total: ALL_CHUNKS.length });
    }

    const chainParts = [];
    for (const c of CHAIN_CHUNKS) {
      const t = await ask(c.prompt(ctx), "Write phase-wise build prompts. Spoonfeeding. No preamble.", c.tokens, c.model);
      chainParts.push(t.trim());
      done.push(c.key);
      setGenerating({ done: [...done], total: ALL_CHUNKS.length });
    }

    setGenerating(null);
    setOutput({
      specDoc: specParts.join("\n\n"),
      readyPrompt: promptParts.join("\n\n"),
      phaseChain: parsePhaseChain(chainParts.join("\n\n")),
      appName: name
    });
    setMessages(prev => [...prev, {
      type: "ai",
      text: `Done! "${name}" is ready 👇\n\nUse ✎ Refine on any tab to update specific sections.`,
      insight: "Complete"
    }]);
  };

  // ── Trigger context compression + generation ──
  const triggerGeneration = async (finalHistory, name) => {
    setMessages(prev => [...prev, { type: "ai", text: `Compressing context and generating spec for "${name}"...`, insight: "Building" }]);
    const ctx = await buildContext(idea, finalHistory);
    if (ctx.parsed?.appType) setAppType(ctx.parsed.appType);
    setCtxText(ctx.text);
    await runGeneration(ctx.text, name);
  };

  // ── Start session ──
  const startSession = async () => {
    if (!idea.trim()) return;
    setStarted(true); setLoading(true);
    setAppType(detectType(idea));
    const q = await askDiscovery(idea, [], 0);
    if (q.includes("SPECAI_READY:")) {
      const name = q.split("SPECAI_READY:")[1]?.trim() || "Your App";
      setAppName(name); setLoading(false);
      await triggerGeneration([], name); return;
    }
    setLastQ(q);
    setMessages([{ type: "user", text: idea }, { type: "ai", text: q, insight: "1/8" }]);
    setQCount(1); setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // ── Send answer ──
  const sendAnswer = async () => {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");

    // Compress answer before storing
    const compressed = compressAnswer(userText);
    const newHistory = [...qaHistory, { q: lastQ, a: compressed }];
    setQaHistory(newHistory);
    setMessages(prev => [...prev, { type: "user", text: userText }]);

    // Force words or hit limit
    const forceWords = /^(done|generate|go|proceed|finish|that'?s?\s*(all|it|enough)|ok(ay)?|yes|build)$/i;
    if (qCount >= 8 || forceWords.test(userText.trim())) {
      await triggerGeneration(newHistory, appName); return;
    }

    setLoading(true);
    const q = await askDiscovery(idea, newHistory, qCount);

    if (q.includes("SPECAI_READY:")) {
      const name = q.split("SPECAI_READY:")[1]?.trim() || appName;
      setAppName(name); setLoading(false);
      await triggerGeneration(newHistory, name); return;
    }

    setLastQ(q);
    if (!appType) setAppType(detectType(idea + " " + userText));
    const next = qCount + 1;
    setMessages(prev => [...prev, { type: "ai", text: q, insight: `${next}/8` }]);
    setQCount(next); setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // ── Handle feedback (regenerate specific tab) ──
  const handleFeedback = async (feedbackText, targetTab) => {
    setRegenerating(true);
    const label = targetTab === "spec" ? "Spec Doc" : targetTab === "prompt" ? "Ready Prompt" : "Phase Chain";
    setMessages(prev => [...prev, { type: "user", text: `Refine ${label}: ${feedbackText}` }]);
    const ctx = `FEEDBACK: "${feedbackText}"\n\n${ctxText}`;
    let updated = { ...output };
    try {
      if (targetTab === "spec") {
        const parts = [];
        for (const c of SPEC_CHUNKS) {
          parts.push((await ask(c.prompt(ctx), "Write product spec in markdown. No preamble.", c.tokens, c.model)).trim());
        }
        updated.specDoc = parts.join("\n\n");
      } else if (targetTab === "prompt") {
        const parts = [];
        for (const c of PROMPT_CHUNKS) {
          parts.push((await ask(c.prompt(ctx), "Write a spoonfeeding developer prompt. No preamble.", c.tokens, c.model)).trim());
        }
        updated.readyPrompt = parts.join("\n\n");
      } else {
        const parts = [];
        for (const c of CHAIN_CHUNKS) {
          parts.push((await ask(c.prompt(ctx), "Write phase-wise build prompts. No preamble.", c.tokens, c.model)).trim());
        }
        updated.phaseChain = parsePhaseChain(parts.join("\n\n"));
      }
      setOutput(updated);
      setMessages(prev => [...prev, { type: "ai", text: `${label} updated 🔄`, insight: "Regenerated" }]);
    } catch {
      setMessages(prev => [...prev, { type: "ai", text: "Regeneration failed. Try again.", insight: "Error" }]);
    }
    setRegenerating(false);
  };

  const reset = () => {
    setIdea(""); setStarted(false); setMessages([]); setQaHistory([]);
    setLastQ(""); setInput(""); setLoading(false); setQCount(0);
    setAppType(null); setAppName("Your App"); setOutput(null);
    setCtxText(""); setGenerating(null); setRegenerating(false);
  };

  // ════════════════════════════════
  // RENDER
  // ════════════════════════════════
  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "'DM Sans','Helvetica Neue',sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 16px 80px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box} textarea:focus{outline:none}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}
        .msg{animation:fadeUp 0.25s ease forwards}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{50%{opacity:0}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        .sbtn:hover:not(:disabled){background:#1a1a1a!important}
        .sbtn:disabled{opacity:.35;cursor:not-allowed}
        .chip:hover{background:#f3f4f6!important}
      `}</style>

      {/* Header */}
      <div style={{ width: "100%", maxWidth: "700px", padding: "28px 0 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", background: "#111", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}>⬡</div>
          <span style={{ fontWeight: 600, fontSize: "15px", color: "#111", letterSpacing: "-0.02em" }}>SpecAI</span>
          {appType && <Badge type={appType} />}
        </div>
        {started && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {!output && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{ display: "flex", gap: "3px" }}>
                  {[...Array(8)].map((_, i) => (
                    <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: i < qCount ? "#111" : "#e5e7eb", transition: "background 0.3s" }} />
                  ))}
                </div>
                <span style={{ fontSize: "10px", color: qCount >= 6 ? "#f59e0b" : "#9ca3af", fontFamily: "DM Mono, monospace", fontWeight: qCount >= 6 ? 600 : 400 }}>{qCount}/8</span>
              </div>
            )}
            <button onClick={reset} style={{ padding: "4px 10px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: "12px", cursor: "pointer" }}>↺ Reset</button>
          </div>
        )}
      </div>

      <div style={{ width: "100%", maxWidth: "700px", marginTop: "36px" }}>
        {/* Landing */}
        {!started && (
          <div style={{ animation: "fadeUp 0.4s ease" }}>
            <h1 style={{ fontSize: "34px", fontWeight: 600, color: "#111", letterSpacing: "-0.04em", lineHeight: 1.15, margin: "0 0 10px" }}>Idea → Production Prompt.</h1>
            <p style={{ fontSize: "14px", color: "#6b7280", margin: "0 0 28px", lineHeight: 1.65 }}>8 sharp questions. Compressed context. Full spec, ready prompt, and 4-phase build chain.</p>
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "18px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <textarea value={idea} onChange={e => setIdea(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && e.metaKey) startSession(); }} placeholder="e.g. A social app for book clubs where members discuss chapters, share notes, and vote on next reads..." rows={4} style={{ width: "100%", border: "none", resize: "none", fontSize: "14px", lineHeight: "1.7", color: "#111", background: "transparent", fontFamily: "DM Sans, sans-serif" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "10px", paddingTop: "10px", borderTop: "1px solid #f3f4f6" }}>
                <span style={{ fontSize: "11px", color: "#d1d5db", fontFamily: "DM Mono, monospace" }}>⌘+Enter to start</span>
                <button onClick={startSession} disabled={!idea.trim()} className="sbtn" style={{ padding: "7px 18px", borderRadius: "9px", border: "none", background: "#111", color: "#fff", fontSize: "13px", fontWeight: 500, cursor: "pointer", transition: "background 0.15s" }}>Start →</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>
              {["Ecommerce with AI recommendations", "SaaS analytics dashboard", "Doctor-patient app", "Social app for book clubs"].map(ex => (
                <button key={ex} className="chip" onClick={() => setIdea(ex)} style={{ padding: "5px 12px", borderRadius: "100px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: "12px", cursor: "pointer", transition: "background 0.15s" }}>{ex}</button>
              ))}
            </div>
          </div>
        )}

        {/* Chat */}
        {started && (
          <div>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {messages.map((msg, i) => (
                <div key={i} className="msg" style={{ display: "flex", justifyContent: msg.type === "user" ? "flex-end" : "flex-start" }}>
                  {msg.type === "ai" && (
                    <div style={{ maxWidth: "84%" }}>
                      {msg.insight && <div style={{ fontSize: "10px", color: "#9ca3af", fontFamily: "DM Mono, monospace", marginBottom: "5px", paddingLeft: "2px" }}>⬡ {msg.insight}</div>}
                      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "14px 14px 14px 3px", padding: "12px 16px", fontSize: "14px", lineHeight: "1.7", color: "#111", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", whiteSpace: "pre-line" }}>
                        {i === messages.length - 1 && !output && !generating ? <TypewriterText text={msg.text} /> : msg.text}
                      </div>
                    </div>
                  )}
                  {msg.type === "user" && (
                    <div style={{ background: "#111", borderRadius: "14px 14px 3px 14px", padding: "11px 16px", fontSize: "14px", lineHeight: "1.7", color: "#fff", maxWidth: "80%" }}>{msg.text}</div>
                  )}
                </div>
              ))}

              {/* Generation progress */}
              {generating && (
                <div className="msg" style={{ display: "flex" }}>
                  <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", minWidth: "280px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                      <span style={{ fontSize: "10px", color: "#9ca3af", fontFamily: "DM Mono, monospace" }}>⬡ Building spec</span>
                      <span style={{ fontSize: "10px", color: "#111", fontFamily: "DM Mono, monospace", fontWeight: 600 }}>{generating.done.length}/{generating.total}</span>
                    </div>
                    <div style={{ width: "100%", height: "2px", background: "#f3f4f6", borderRadius: "2px", marginBottom: "12px" }}>
                      <div style={{ width: `${(generating.done.length / generating.total) * 100}%`, height: "100%", background: "#111", borderRadius: "2px", transition: "width 0.4s ease" }} />
                    </div>
                    {[
                      { label: "Spec Doc", keys: SPEC_CHUNKS.map(c => c.key), color: "#3b82f6" },
                      { label: "Ready Prompt", keys: PROMPT_CHUNKS.map(c => c.key), color: "#10b981" },
                      { label: "Phase Chain", keys: CHAIN_CHUNKS.map(c => c.key), color: "#8b5cf6" },
                    ].map(g => {
                      const allDone = g.keys.every(k => generating.done.includes(k));
                      const anyDone = g.keys.some(k => generating.done.includes(k));
                      const isActive = !allDone && (anyDone || g.keys[0] === ALL_CHUNKS[generating.done.length]?.key);
                      return (
                        <div key={g.label} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "4px 0" }}>
                          <div style={{ width: "16px", height: "16px", borderRadius: "50%", flexShrink: 0, background: allDone ? "#111" : "transparent", border: allDone ? "none" : `2px solid ${isActive || anyDone ? g.color : "#e5e7eb"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", color: "#fff", transition: "all 0.3s" }}>
                            {allDone ? "✓" : isActive ? <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: g.color, display: "block" }} /> : ""}
                          </div>
                          <span style={{ fontSize: "12px", color: allDone ? "#111" : isActive ? "#374151" : "#9ca3af", fontWeight: allDone || isActive ? 500 : 400 }}>{g.label}</span>
                          {allDone && <span style={{ fontSize: "10px", color: "#10b981", marginLeft: "auto" }}>✓</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {loading && !generating && (
                <div className="msg" style={{ display: "flex" }}>
                  <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "12px 16px", display: "flex", gap: "4px", alignItems: "center" }}>
                    {[0, 1, 2].map(i => <div key={i} style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#d1d5db", animation: `blink 1.2s ${i * 0.2}s infinite` }} />)}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {output && <OutputSection {...output} onFeedback={handleFeedback} regenerating={regenerating} />}

            {!output && !generating && (
              <div style={{ position: "sticky", bottom: "14px", marginTop: "20px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: "13px", padding: "10px 14px", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
                <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAnswer(); } }} placeholder={qCount >= 7 ? "Last question — answer to generate spec..." : qCount >= 5 ? `Answer or type "done" to generate early...` : "Your answer..."} rows={1} style={{ width: "100%", border: "none", resize: "none", fontSize: "14px", lineHeight: "1.6", color: "#111", background: "transparent", fontFamily: "DM Sans, sans-serif", maxHeight: "100px", overflowY: "auto", outline: "none" }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "6px" }}>
                  <span style={{ fontSize: "10px", color: "#d1d5db", fontFamily: "DM Mono, monospace" }}>
                    {qCount >= 5 ? `"done" to generate early · auto at Q8` : "Enter to send"}
                  </span>
                  <button onClick={sendAnswer} disabled={!input.trim() || loading} className="sbtn" style={{ padding: "6px 14px", borderRadius: "8px", border: "none", background: "#111", color: "#fff", fontSize: "12px", fontWeight: 500, cursor: "pointer", transition: "background 0.15s" }}>→</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}