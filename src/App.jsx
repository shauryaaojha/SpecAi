import { useState, useRef, useEffect } from "react";

const DISCOVERY_SYSTEM = `You are SpecAI, an expert product architect. Help users define their app idea through smart questions.

- Auto-detect app type (ecommerce, SaaS, social, tool, marketplace, dashboard, etc.)
- Ask ONE smart contextual follow-up question at a time
- Cover: core features, users, stack, design, auth, DB, integrations, edge cases
- When you have enough info to build a complete spec, set phase to "complete"

Respond ONLY in JSON, no markdown fences:

During questioning:
{"phase":"questioning","appType":"type or null","question":"one question","insight":"one line summary"}

When ready:
{"phase":"complete","appType":"final type","appName":"suggested name","summary":"3-5 sentence summary of everything discussed"}`;

const SPEC_SYSTEM = `You are an expert product architect. Write extremely detailed, production-ready product spec documents in markdown. Be exhaustive — every feature, every edge case, every DB field, every API endpoint. Plain markdown only. No preamble.`;
const PROMPT_SYSTEM = `You are an expert prompt engineer who writes production-ready prompts for AI coding assistants. Your prompts are extremely detailed and spoonfeeding — zero ambiguity. Plain text only. No preamble.`;
const CHAIN_SYSTEM = `You are an expert prompt engineer. Write 4 detailed, self-contained phase-wise build prompts. Each must be spoonfeeding — exact file names, folder structure, code patterns, edge cases. Plain text only. No preamble.`;

const extractText = (response) => {
  try {
    if (typeof response === "string") return response;
    if (response?.message?.content?.[0]?.text) return response.message.content[0].text;
    if (response?.message?.content && typeof response.message.content === "string") return response.message.content;
    if (response?.message && typeof response.message === "string") return response.message;
    if (response?.text) return response.text;
    if (response?.content?.[0]?.text) return response.content[0].text;
    if (Array.isArray(response?.content)) return response.content.map(c => c.text || "").join("");
    return "";
  } catch { return ""; }
};

const callAPI = async (messages, system, maxTokens = 2000) => {
  try {
    const response = await window.puter.ai.chat(
      [{ role: "system", content: system }, ...messages],
      { model: "claude-3-5-sonnet", max_tokens: maxTokens }
    );
    const text = extractText(response);
    if (!text) console.warn("Empty response from Puter:", JSON.stringify(response));
    return text || "Error: empty response.";
  } catch (err) {
    console.error("Puter API Error:", err);
    return `Error: ${err?.message || "API call failed"}`;
  }
};

const parseJSON = (text) => {
  if (!text || text.startsWith("Error:")) return null;
  try {
    const clean = text.replace(/```json[\s\S]*?```/g, m => m.slice(7,-3)).replace(/```/g,"").trim();
    try { return JSON.parse(clean); } catch {}
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
};

const buildSpecPrompt = (summary, feedback = null) => `${feedback ? `PREVIOUS FEEDBACK: "${feedback}"\nUpdate the spec accordingly. Keep everything else intact.\n\n` : ""}Write a COMPLETE, EXHAUSTIVE product spec document in markdown for this app.

Include ALL sections with full detail:

## 1. App Overview
- App name, tagline, purpose
- Problem it solves
- Target audience (primary + secondary)
- Key value proposition

## 2. User Roles & Permissions
- Every user role
- Exact permissions per role (what they can/cannot do)

## 3. Core Features
For EACH feature:
- Feature name + detailed description
- User flow (step by step)
- Edge cases to handle
- UI components involved

## 4. Database Schema
For EACH table/collection:
- All fields with data types
- Required vs optional
- Relationships/foreign keys
- Indexes to add

## 5. API Endpoints
For EACH endpoint:
- Method + route
- Request body (all fields + types)
- Response body (success + error)
- Auth required (yes/no + role)
- Business logic notes

## 6. Authentication & Authorization
- Auth strategy
- Token storage + refresh flow
- Protected routes list

## 7. UI/UX Flows
- Every screen/page
- Navigation flow between screens
- Loading/error/empty states for each screen

## 8. Tech Stack
- Frontend, Backend, Database, Auth, Storage, Deployment, 3rd party APIs

## 9. Folder Structure
- Full folder tree with file names and purpose

## 10. Edge Cases & Error Handling
- Every edge case per feature and how to handle it

App Summary:
${summary}`;

const buildPromptPrompt = (summary, feedback = null) => `${feedback ? `PREVIOUS FEEDBACK: "${feedback}"\nUpdate the prompt accordingly.\n\n` : ""}Write a single COMPLETE, SPOONFEEDING production-ready prompt a developer can paste directly into Claude to build this entire app.

Structure it EXACTLY like this:

## Role
[Who the AI should act as — specific seniority and expertise]

## App Overview
[2-3 sentences — what it does and who it's for]

## Tech Stack
\`\`\`json
{ "frontend": "...", "backend": "...", "database": "...", "auth": "...", "styling": "...", "deployment": "..." }
\`\`\`

## Folder Structure
[Complete folder tree — every file listed with its purpose]

## Pages & Routes
[Every page, its route, and exactly what it renders]

## Database Schema
\`\`\`json
[Every collection/table with all fields, types, and relationships]
\`\`\`

## API Endpoints
[Every endpoint: method, route, full request body, full response, auth requirement, business logic]

## Feature Specifications
[Every feature with: exact behavior, all edge cases, validation rules, error states]

## UI Requirements
[Every component, design system, responsive rules, loading/error/empty states]

## Auth Flow
[Step by step auth implementation — registration, login, token refresh, logout]

## Environment Variables
[Every .env variable with description and example value]

## Output Rules
- Full files only — no placeholders, no TODOs, no "add your logic here"
- Folder structure first, then each file completely
- Include .env.example
- Include README with setup and run steps

App Summary:
${summary}`;

const buildChainPrompt = (summary, feedback = null) => `${feedback ? `PREVIOUS FEEDBACK: "${feedback}"\nUpdate the phase chain accordingly.\n\n` : ""}Write 4 DETAILED, SPOONFEEDING phase-wise build prompts for this app.

Each phase must be completely self-contained. List exact files to create. Include exact code patterns. Specify what to verify before moving to next phase.

Format EXACTLY as:

PHASE 1 - ARCHITECTURE:
[Cover: project init, full folder structure, all config files (.env, tsconfig, etc.), base routing setup, DB connection, auth skeleton. List every file to create with its exact purpose and initial content outline.]

PHASE 2 - BACKEND:
[Cover: every API endpoint with full implementation, all DB models/schema with validations, middleware (auth, error handling, logging), input validation, business logic for each feature. Include exact request/response shapes.]

PHASE 3 - FRONTEND:
[Cover: every page and component, state management setup, API service layer, all forms with validation, loading/error/empty states, responsive design rules. List every component with its props and behavior.]

PHASE 4 - INTEGRATION:
[Cover: connecting all frontend to backend, end-to-end auth flow, file uploads if any, 3rd party service integrations, error boundaries, environment config for deployment, final testing checklist.]

App Summary:
${summary}`;

const TypewriterText = ({ text, speed = 14 }) => {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed(""); setDone(false);
    let i = 0;
    const iv = setInterval(() => {
      if (i < text.length) setDisplayed(text.slice(0, ++i));
      else { setDone(true); clearInterval(iv); }
    }, speed);
    return () => clearInterval(iv);
  }, [text]);
  return <span>{displayed}{!done && <span style={{ animation: "blink 1s step-end infinite" }}>|</span>}</span>;
};

const Badge = ({ type }) => {
  if (!type) return null;
  const map = { ecommerce: "#f59e0b", saas: "#3b82f6", social: "#ec4899", tool: "#10b981", marketplace: "#8b5cf6", dashboard: "#06b6d4" };
  const c = Object.entries(map).find(([k]) => type.toLowerCase().includes(k))?.[1] || "#6b7280";
  return <span style={{ background: c+"18", color: c, border: `1px solid ${c}30`, padding: "2px 10px", borderRadius: "100px", fontSize: "11px", fontFamily: "monospace", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{type}</span>;
};

const GeneratingStep = ({ label, done, active }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "5px 0" }}>
    <div style={{ width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0, background: done ? "#111" : "transparent", border: done ? "none" : `2px solid ${active ? "#111" : "#e5e7eb"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "#fff", transition: "all 0.3s" }}>
      {done ? "✓" : active ? <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#111", display: "block", animation: "pulse 1s infinite" }} /> : ""}
    </div>
    <span style={{ fontSize: "13px", color: done ? "#111" : active ? "#374151" : "#9ca3af", fontWeight: done || active ? 500 : 400, transition: "color 0.3s" }}>{label}</span>
    {done && <span style={{ fontSize: "11px", color: "#10b981", marginLeft: "auto" }}>✓</span>}
  </div>
);

const OutputSection = ({ specDoc, readyPrompt, phaseChain, appName, onFeedback, regenerating }) => {
  const [tab, setTab] = useState("spec");
  const [copied, setCopied] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const tabLabels = { spec: "Spec Doc", prompt: "Ready Prompt", chain: "Phase Chain" };

  const getContent = () => {
    if (tab === "spec") return specDoc;
    if (tab === "prompt") return readyPrompt;
    return Object.entries(phaseChain).map(([, v], i) =>
      `PHASE ${i+1} - ${["ARCHITECTURE","BACKEND","FRONTEND","INTEGRATION"][i]}:\n\n${v}`
    ).join("\n\n---\n\n");
  };

  const copy = (text, key) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 2000); };
  const download = (content, name) => { const b = new Blob([content], { type: "text/markdown" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); };

  const submitFeedback = () => {
    if (!feedback.trim() || regenerating) return;
    onFeedback(feedback.trim(), tab);
    setFeedback("");
    setShowFeedback(false);
  };

  return (
    <div style={{ marginTop: "28px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", gap: "2px", background: "#f3f4f6", borderRadius: "10px", padding: "3px" }}>
          {[["spec","Spec Doc"],["prompt","Ready Prompt"],["chain","Phase Chain"]].map(([k,l]) => (
            <button key={k} onClick={() => { setTab(k); setShowFeedback(false); }} style={{ padding: "5px 14px", borderRadius: "8px", border: "none", background: tab===k ? "#fff" : "transparent", color: tab===k ? "#111" : "#6b7280", fontSize: "12px", fontWeight: 500, cursor: "pointer", boxShadow: tab===k ? "0 1px 3px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button onClick={() => copy(getContent(), tab)} style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "11px", cursor: "pointer" }}>{copied===tab ? "✓ Copied" : "Copy"}</button>
          <button onClick={() => download(getContent(), `specai-${tab}-${(appName||"output").toLowerCase().replace(/\s/g,"-")}.md`)} style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "11px", cursor: "pointer" }}>↓ .md</button>
          <button onClick={() => setShowFeedback(v => !v)} style={{ padding: "5px 12px", borderRadius: "7px", border: `1px solid ${showFeedback ? "#111" : "#e5e7eb"}`, background: showFeedback ? "#111" : "#fff", color: showFeedback ? "#fff" : "#111", fontSize: "11px", cursor: "pointer", fontWeight: 500, transition: "all 0.15s" }}>✎ Refine</button>
        </div>
      </div>

      {showFeedback && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "14px", marginBottom: "14px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace", marginBottom: "8px" }}>
            ✎ Refining: <span style={{ color: "#111", fontWeight: 600 }}>{tabLabels[tab]}</span>
          </div>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); submitFeedback(); }}}
            placeholder={`What should change? e.g. "Add WebSocket support", "Include Stripe payment flow", "Add admin dashboard"...`}
            rows={2}
            style={{ width: "100%", border: "none", fontSize: "13px", lineHeight: "1.6", color: "#111", background: "transparent", fontFamily: "DM Sans, sans-serif", resize: "none", outline: "none" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #f3f4f6" }}>
            <span style={{ fontSize: "10px", color: "#d1d5db", fontFamily: "monospace" }}>Enter to send</span>
            <div style={{ display: "flex", gap: "6px" }}>
              <button onClick={() => { setShowFeedback(false); setFeedback(""); }} style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: "11px", cursor: "pointer" }}>Cancel</button>
              <button onClick={submitFeedback} disabled={!feedback.trim() || regenerating} style={{ padding: "5px 14px", borderRadius: "7px", border: "none", background: "#111", color: "#fff", fontSize: "11px", cursor: "pointer", opacity: !feedback.trim() || regenerating ? 0.4 : 1, transition: "opacity 0.15s" }}>
                {regenerating ? "Regenerating..." : "Regenerate →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {regenerating && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "10px", marginBottom: "12px" }}>
          <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#111", animation: "pulse 1s infinite" }} />
          <span style={{ fontSize: "12px", color: "#374151", fontFamily: "monospace" }}>Regenerating {tabLabels[tab]}...</span>
        </div>
      )}

      {tab === "chain" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {Object.entries(phaseChain).map(([key, value], i) => (
            <div key={key} style={{ border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ background: "#f9fafb", padding: "8px 14px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#374151", fontFamily: "monospace" }}>PHASE {i+1} — {["ARCHITECTURE","BACKEND","FRONTEND","INTEGRATION"][i]}</span>
                <button onClick={() => copy(value, key)} style={{ padding: "2px 8px", borderRadius: "5px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: "10px", cursor: "pointer" }}>{copied===key ? "✓" : "Copy"}</button>
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

export default function SpecAI() {
  const [idea, setIdea] = useState("");
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [appType, setAppType] = useState(null);
  const [output, setOutput] = useState(null);
  const [summary, setSummary] = useState("");
  const [questionCount, setQuestionCount] = useState(0);
  const [generating, setGenerating] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, generating]);

  const parsePhaseChain = (chainRaw) => {
    const phaseChain = { phase1: "", phase2: "", phase3: "", phase4: "" };
    const headers = ["PHASE 1 - ARCHITECTURE:","PHASE 2 - BACKEND:","PHASE 3 - FRONTEND:","PHASE 4 - INTEGRATION:"];
    const keys = ["phase1","phase2","phase3","phase4"];
    headers.forEach((h, i) => {
      const start = chainRaw.indexOf(h);
      if (start === -1) return;
      const contentStart = start + h.length;
      const nextIdx = headers.slice(i+1).map(nh => chainRaw.indexOf(nh, contentStart)).find(n => n !== -1) ?? chainRaw.length;
      phaseChain[keys[i]] = chainRaw.slice(contentStart, nextIdx).trim();
    });
    return phaseChain;
  };

  const generateOutputs = async (sum, appName) => {
    const steps = ["Generating Spec Doc...","Generating Ready Prompt...","Generating Phase Chain..."];
    const done = [];
    setGenerating({ step: 0, done });

    const specDoc = await callAPI([{ role: "user", content: buildSpecPrompt(sum) }], SPEC_SYSTEM, 2500);
    done.push(steps[0]);
    setGenerating({ step: 1, done: [...done] });

    const readyPrompt = await callAPI([{ role: "user", content: buildPromptPrompt(sum) }], PROMPT_SYSTEM, 2500);
    done.push(steps[1]);
    setGenerating({ step: 2, done: [...done] });

    const chainRaw = await callAPI([{ role: "user", content: buildChainPrompt(sum) }], CHAIN_SYSTEM, 2500);
    done.push(steps[2]);
    setGenerating({ step: 3, done: [...done] });

    setTimeout(() => {
      setGenerating(null);
      setOutput({ specDoc: specDoc.trim(), readyPrompt: readyPrompt.trim(), phaseChain: parsePhaseChain(chainRaw), appName });
      setMessages(prev => [...prev, {
        type: "ai",
        text: `Done! Your complete spec for "${appName}" is ready 👇\n\nNot satisfied with any section? Hit the ✎ Refine button on any tab to give feedback and regenerate just that part.`,
        insight: "Generation complete"
      }]);
    }, 300);
  };

  const handleFeedback = async (feedbackText, targetTab) => {
    setRegenerating(true);
    setMessages(prev => [...prev,
      { type: "user", text: `Refine ${targetTab === "spec" ? "Spec Doc" : targetTab === "prompt" ? "Ready Prompt" : "Phase Chain"}: ${feedbackText}` }
    ]);

    let updated = { ...output };

    if (targetTab === "spec") {
      const specDoc = await callAPI([{ role: "user", content: buildSpecPrompt(summary, feedbackText) }], SPEC_SYSTEM, 2500);
      updated.specDoc = specDoc.trim();
    } else if (targetTab === "prompt") {
      const readyPrompt = await callAPI([{ role: "user", content: buildPromptPrompt(summary, feedbackText) }], PROMPT_SYSTEM, 2500);
      updated.readyPrompt = readyPrompt.trim();
    } else if (targetTab === "chain") {
      const chainRaw = await callAPI([{ role: "user", content: buildChainPrompt(summary, feedbackText) }], CHAIN_SYSTEM, 2500);
      updated.phaseChain = parsePhaseChain(chainRaw);
    }

    setOutput(updated);
    setRegenerating(false);
    setMessages(prev => [...prev, {
      type: "ai",
      text: `Updated! Check the ${targetTab === "spec" ? "Spec Doc" : targetTab === "prompt" ? "Ready Prompt" : "Phase Chain"} tab 🔄`,
      insight: "Regenerated from feedback"
    }]);
  };

  const callDiscovery = async (hist) => {
    const text = await callAPI(hist, DISCOVERY_SYSTEM, 400);
    const parsed = parseJSON(text);
    if (parsed) return parsed;
    // If JSON parse fails but we got real text back, use it as the question
    if (text && !text.startsWith("Error:") && text.length > 10) {
      const cleanText = text.replace(/```json|```/g,"").trim().slice(0, 300);
      return { phase: "questioning", question: cleanText, insight: "Thinking..." };
    }
    // True fallback — but make it context-aware using last user message
    const lastUserMsg = hist.filter(m => m.role === "user").slice(-1)[0]?.content || "";
    return {
      phase: "questioning",
      question: `Thanks for that. What tech stack are you thinking — or should I suggest one based on your idea?`,
      insight: "Continuing discovery..."
    };
  };

  const startSession = async () => {
    if (!idea.trim()) return;
    setStarted(true); setLoading(true);
    const hist = [{ role: "user", content: `My app idea: ${idea}` }];
    const result = await callDiscovery(hist);
    if (result.appType) setAppType(result.appType);
    setHistory([...hist, { role: "assistant", content: JSON.stringify(result) }]);
    setMessages([{ type: "user", text: idea }, { type: "ai", text: result.question || "Tell me more!", insight: result.insight }]);
    setQuestionCount(1); setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const sendAnswer = async () => {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");
    const newHist = [...history, { role: "user", content: userText }];
    setMessages(prev => [...prev, { type: "user", text: userText }]);
    setHistory(newHist);
    setLoading(true);

    const result = await callDiscovery(newHist);
    if (result.appType) setAppType(result.appType);
    setHistory([...newHist, { role: "assistant", content: JSON.stringify(result) }]);

    // Force complete if user says "that's all", "done", "generate", etc.
    const forceComplete = /^(that'?s?\s*(all|it|enough)|done|generate|finish|complete|go|yes|ok(ay)?|proceed|build it)$/i.test(userText.trim());

    if (result.phase === "complete" || (forceComplete && questionCount >= 3)) {
      const finalSummary = result.summary || `${idea}. User confirmed all features are specified after ${questionCount} questions. Last context: ${hist.slice(-4).map(m=>m.content).join(" | ")}`;
      const finalName = result.appName || "Your App";
      setLoading(false);
      setSummary(finalSummary);
      setMessages(prev => [...prev, { type: "ai", text: `Got everything! Generating your full spec for "${finalName}"...`, insight: "Spec complete — building outputs" }]);
      await generateOutputs(finalSummary, finalName);
    } else {
      setMessages(prev => [...prev, { type: "ai", text: result.question, insight: result.insight }]);
      setQuestionCount(q => q + 1); setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const reset = () => { setIdea(""); setStarted(false); setMessages([]); setHistory([]); setInput(""); setLoading(false); setAppType(null); setOutput(null); setSummary(""); setQuestionCount(0); setGenerating(null); setRegenerating(false); };

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "'DM Sans','Helvetica Neue',sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 16px 80px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        textarea:focus { outline: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
        .msg { animation: fadeUp 0.25s ease forwards; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes blink { 50%{opacity:0} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .sbtn:hover:not(:disabled){background:#1a1a1a!important}
        .sbtn:disabled{opacity:.35;cursor:not-allowed}
        .chip:hover{background:#f3f4f6!important}
      `}</style>

      <div style={{ width:"100%", maxWidth:"700px", padding:"28px 0 0", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <div style={{ width:"30px", height:"30px", background:"#111", borderRadius:"8px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"14px" }}>⬡</div>
          <span style={{ fontWeight:600, fontSize:"15px", color:"#111", letterSpacing:"-0.02em" }}>SpecAI</span>
          {appType && <Badge type={appType} />}
        </div>
        {started && (
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <span style={{ fontSize:"11px", color:"#9ca3af", fontFamily:"DM Mono, monospace" }}>{questionCount} questions</span>
            <button onClick={reset} style={{ padding:"4px 10px", borderRadius:"7px", border:"1px solid #e5e7eb", background:"#fff", color:"#6b7280", fontSize:"12px", cursor:"pointer" }}>↺ Reset</button>
          </div>
        )}
      </div>

      <div style={{ width:"100%", maxWidth:"700px", marginTop:"36px" }}>
        {!started && (
          <div style={{ animation:"fadeUp 0.4s ease" }}>
            <h1 style={{ fontSize:"34px", fontWeight:600, color:"#111", letterSpacing:"-0.04em", lineHeight:1.15, margin:"0 0 10px" }}>Idea → Production Prompt.</h1>
            <p style={{ fontSize:"14px", color:"#6b7280", margin:"0 0 28px", lineHeight:1.65 }}>Describe your app. SpecAI asks smart questions, generates a full spec, and lets you refine each section with feedback.</p>
            <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:"14px", padding:"18px", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
              <textarea value={idea} onChange={e=>setIdea(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&e.metaKey) startSession(); }} placeholder="e.g. An app where restaurant owners manage menus, orders and staff shifts from one dashboard..." rows={4} style={{ width:"100%", border:"none", resize:"none", fontSize:"14px", lineHeight:"1.7", color:"#111", background:"transparent", fontFamily:"DM Sans, sans-serif" }} />
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:"10px", paddingTop:"10px", borderTop:"1px solid #f3f4f6" }}>
                <span style={{ fontSize:"11px", color:"#d1d5db", fontFamily:"DM Mono, monospace" }}>⌘+Enter to start</span>
                <button onClick={startSession} disabled={!idea.trim()} className="sbtn" style={{ padding:"7px 18px", borderRadius:"9px", border:"none", background:"#111", color:"#fff", fontSize:"13px", fontWeight:500, cursor:"pointer", transition:"background 0.15s" }}>Start →</button>
              </div>
            </div>
            <div style={{ display:"flex", gap:"6px", marginTop:"12px", flexWrap:"wrap" }}>
              {["Ecommerce with AI recommendations","SaaS analytics dashboard","Doctor-patient app","Social app for book clubs"].map(ex=>(
                <button key={ex} className="chip" onClick={()=>setIdea(ex)} style={{ padding:"5px 12px", borderRadius:"100px", border:"1px solid #e5e7eb", background:"#fff", color:"#6b7280", fontSize:"12px", cursor:"pointer", transition:"background 0.15s" }}>{ex}</button>
              ))}
            </div>
          </div>
        )}

        {started && (
          <div>
            <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
              {messages.map((msg,i)=>(
                <div key={i} className="msg" style={{ display:"flex", justifyContent:msg.type==="user"?"flex-end":"flex-start" }}>
                  {msg.type==="ai" && (
                    <div style={{ maxWidth:"84%" }}>
                      {msg.insight && <div style={{ fontSize:"10px", color:"#9ca3af", fontFamily:"DM Mono, monospace", marginBottom:"5px", paddingLeft:"2px" }}>⬡ {msg.insight}</div>}
                      <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:"14px 14px 14px 3px", padding:"12px 16px", fontSize:"14px", lineHeight:"1.7", color:"#111", boxShadow:"0 1px 3px rgba(0,0,0,0.04)", whiteSpace:"pre-line" }}>
                        {i===messages.length-1&&!output&&!generating ? <TypewriterText text={msg.text}/> : msg.text}
                      </div>
                    </div>
                  )}
                  {msg.type==="user" && (
                    <div style={{ background:"#111", borderRadius:"14px 14px 3px 14px", padding:"11px 16px", fontSize:"14px", lineHeight:"1.7", color:"#fff", maxWidth:"80%" }}>{msg.text}</div>
                  )}
                </div>
              ))}

              {generating && (
                <div className="msg" style={{ display:"flex" }}>
                  <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:"14px", padding:"16px 20px", boxShadow:"0 1px 3px rgba(0,0,0,0.04)", minWidth:"270px" }}>
                    <div style={{ fontSize:"10px", color:"#9ca3af", fontFamily:"DM Mono, monospace", marginBottom:"10px" }}>⬡ Building your spec</div>
                    {["Generating Spec Doc...","Generating Ready Prompt...","Generating Phase Chain..."].map((label,i)=>(
                      <GeneratingStep key={label} label={label} done={generating.done.includes(label)} active={generating.step===i}/>
                    ))}
                  </div>
                </div>
              )}

              {loading&&!generating && (
                <div className="msg" style={{ display:"flex" }}>
                  <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:"14px", padding:"12px 16px", display:"flex", gap:"4px", alignItems:"center" }}>
                    {[0,1,2].map(i=><div key={i} style={{ width:"5px", height:"5px", borderRadius:"50%", background:"#d1d5db", animation:`blink 1.2s ${i*0.2}s infinite` }}/>)}
                  </div>
                </div>
              )}
              <div ref={bottomRef}/>
            </div>

            {output && <OutputSection {...output} onFeedback={handleFeedback} regenerating={regenerating}/>}

            {!output&&!generating && (
              <div style={{ position:"sticky", bottom:"14px", marginTop:"20px", background:"#fff", border:"1px solid #e5e7eb", borderRadius:"13px", padding:"10px 14px", display:"flex", gap:"8px", alignItems:"flex-end", boxShadow:"0 4px 20px rgba(0,0,0,0.06)" }}>
                <textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendAnswer();}}} placeholder="Your answer..." rows={1} style={{ flex:1, border:"none", resize:"none", fontSize:"14px", lineHeight:"1.6", color:"#111", background:"transparent", fontFamily:"DM Sans, sans-serif", maxHeight:"100px", overflowY:"auto" }}/>
                <button onClick={sendAnswer} disabled={!input.trim()||loading} className="sbtn" style={{ padding:"7px 14px", borderRadius:"9px", border:"none", background:"#111", color:"#fff", fontSize:"13px", fontWeight:500, cursor:"pointer", transition:"background 0.15s", flexShrink:0 }}>→</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}