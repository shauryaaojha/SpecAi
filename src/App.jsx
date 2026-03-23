import { useState, useRef, useEffect } from "react";

// Phase 1: Discovery only - small JSON responses
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

const parseJSON = (text) => {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
};

const TypewriterText = ({ text, speed = 16 }) => {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed(""); setDone(false);
    let i = 0;
    const iv = setInterval(() => {
      if (i < text.length) { setDisplayed(text.slice(0, ++i)); }
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
  <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0" }}>
    <div style={{ width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0, background: done ? "#111" : "transparent", border: done ? "none" : `2px solid ${active ? "#111" : "#e5e7eb"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "#fff", transition: "all 0.3s" }}>
      {done ? "✓" : active ? <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#111", display: "block", animation: "pulse 1s infinite" }} /> : ""}
    </div>
    <span style={{ fontSize: "13px", color: done ? "#111" : active ? "#374151" : "#9ca3af", fontWeight: done || active ? 500 : 400, transition: "color 0.3s" }}>{label}</span>
    {done && <span style={{ fontSize: "11px", color: "#10b981", marginLeft: "auto" }}>done</span>}
  </div>
);

const OutputSection = ({ specDoc, readyPrompt, phaseChain, appName }) => {
  const [tab, setTab] = useState("spec");
  const [copied, setCopied] = useState(null);

  const getContent = () => {
    if (tab === "spec") return specDoc;
    if (tab === "prompt") return readyPrompt;
    return Object.entries(phaseChain).map(([, v], i) => `PHASE ${i+1} - ${["ARCHITECTURE","BACKEND","FRONTEND","INTEGRATION"][i]}:\n\n${v}`).join("\n\n---\n\n");
  };

  const copy = (text, key) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 2000); };
  const download = (content, name) => { const b = new Blob([content], { type: "text/markdown" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); };

  return (
    <div style={{ marginTop: "28px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
        <div style={{ display: "flex", gap: "2px", background: "#f3f4f6", borderRadius: "10px", padding: "3px" }}>
          {[["spec","Spec Doc"],["prompt","Ready Prompt"],["chain","Phase Chain"]].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: "5px 14px", borderRadius: "8px", border: "none", background: tab===k ? "#fff" : "transparent", color: tab===k ? "#111" : "#6b7280", fontSize: "12px", fontWeight: 500, cursor: "pointer", boxShadow: tab===k ? "0 1px 3px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button onClick={() => copy(getContent(), tab)} style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "11px", cursor: "pointer" }}>{copied===tab ? "✓ Copied" : "Copy"}</button>
          <button onClick={() => download(getContent(), `specai-${tab}-${(appName||"output").toLowerCase().replace(/\s/g,"-")}.md`)} style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "11px", cursor: "pointer" }}>↓ .md</button>
        </div>
      </div>

      {tab === "chain" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {Object.entries(phaseChain).map(([key, value], i) => (
            <div key={key} style={{ border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ background: "#f9fafb", padding: "8px 14px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#374151", fontFamily: "monospace" }}>PHASE {i+1} — {["ARCHITECTURE","BACKEND","FRONTEND","INTEGRATION"][i]}</span>
                <button onClick={() => copy(value, key)} style={{ padding: "2px 8px", borderRadius: "5px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: "10px", cursor: "pointer" }}>{copied===key ? "✓" : "Copy"}</button>
              </div>
              <pre style={{ margin: 0, padding: "14px", fontSize: "12px", lineHeight: "1.7", color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "DM Mono, monospace", maxHeight: "200px", overflowY: "auto" }}>{value}</pre>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden" }}>
          <pre style={{ margin: 0, padding: "18px", fontSize: "12.5px", lineHeight: "1.8", color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "DM Mono, monospace", maxHeight: "440px", overflowY: "auto" }}>{getContent()}</pre>
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
  const [questionCount, setQuestionCount] = useState(0);
  const [generating, setGenerating] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, generating]);

  const generateOutputs = async (summary, appName) => {
    const steps = ["Generating Spec Doc...","Generating Ready Prompt...","Generating Phase Chain..."];
    const done = [];

    setGenerating({ step: 0, done });

    const specDoc = await callAPI(
      [{ role: "user", content: `Write a detailed product spec document in markdown.\nInclude: Overview, Target Users, Core Features, DB Schema, API Endpoints, Auth Flow, Edge Cases, Tech Stack.\nBe thorough and specific.\n\nApp Summary:\n${summary}` }],
      "You are an expert product architect. Write detailed, production-ready specs. Plain markdown only.",
      2000
    );

    done.push(steps[0]);
    setGenerating({ step: 1, done: [...done] });

    const readyPrompt = await callAPI(
      [{ role: "user", content: `Write a single production-ready prompt in MD+JSON hybrid style for building this app.\nInclude: role, stack, all pages, DB schema, API endpoints, all features with edge cases, design requirements, output rules (full files, no placeholders).\nPlain text only.\n\nApp Summary:\n${summary}` }],
      "You are an expert prompt engineer. Write detailed, production-ready prompts a developer can paste directly into Claude.",
      2000
    );

    done.push(steps[1]);
    setGenerating({ step: 2, done: [...done] });

    const chainRaw = await callAPI(
      [{ role: "user", content: `Write 4 phase-wise build prompts for this app.\n\nFormat exactly:\nPHASE 1 - ARCHITECTURE:\n[prompt]\n\nPHASE 2 - BACKEND:\n[prompt]\n\nPHASE 3 - FRONTEND:\n[prompt]\n\nPHASE 4 - INTEGRATION:\n[prompt]\n\nEach self-contained and production-ready.\n\nApp Summary:\n${summary}` }],
      "You are an expert prompt engineer. Write detailed phase-wise build prompts.",
      2000
    );

    done.push(steps[2]);
    setGenerating({ step: 3, done: [...done] });

    // Parse phase chain
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

    setTimeout(() => {
      setGenerating(null);
      setOutput({ specDoc: specDoc.trim(), readyPrompt: readyPrompt.trim(), phaseChain, appName });
      setMessages(prev => [...prev, { type: "ai", text: `Done! Your complete spec for "${appName}" is ready. Check the three tabs below 👇`, insight: "Generation complete" }]);
    }, 400);
  };

  const callDiscovery = async (hist) => {
    const text = await callAPI(hist, DISCOVERY_SYSTEM, 300);
    const parsed = parseJSON(text);
    if (!parsed) return { phase: "questioning", question: "Can you tell me more about the main problem this app solves?", insight: "Processing your answer..." };
    return parsed;
  };

  const startSession = async () => {
    if (!idea.trim()) return;
    setStarted(true); setLoading(true);
    const hist = [{ role: "user", content: `My app idea: ${idea}` }];
    const result = await callDiscovery(hist);
    if (result.appType) setAppType(result.appType);
    setHistory([...hist, { role: "assistant", content: JSON.stringify(result) }]);
    setMessages([
      { type: "user", text: idea },
      { type: "ai", text: result.question || "Tell me more!", insight: result.insight }
    ]);
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

    if (result.phase === "complete") {
      setLoading(false);
      setMessages(prev => [...prev, { type: "ai", text: `Got everything I need! Generating your full spec for "${result.appName}"...`, insight: "Spec complete — building outputs" }]);
      await generateOutputs(result.summary || `App: ${idea}`, result.appName || "Your App");
    } else {
      setMessages(prev => [...prev, { type: "ai", text: result.question, insight: result.insight }]);
      setQuestionCount(q => q + 1); setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const reset = () => { setIdea(""); setStarted(false); setMessages([]); setHistory([]); setInput(""); setLoading(false); setAppType(null); setOutput(null); setQuestionCount(0); setGenerating(null); };

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "'DM Sans','Helvetica Neue',sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 16px 80px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        textarea:focus { outline: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
        .msg { animation: fadeUp 0.25s ease forwards; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes blink { 50% { opacity:0; } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .sbtn:hover:not(:disabled) { background: #1a1a1a !important; }
        .sbtn:disabled { opacity: 0.35; cursor: not-allowed; }
        .chip:hover { background: #f3f4f6 !important; }
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
            <span style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "DM Mono, monospace" }}>{questionCount} questions</span>
            <button onClick={reset} style={{ padding: "4px 10px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: "12px", cursor: "pointer" }}>↺ Reset</button>
          </div>
        )}
      </div>

      <div style={{ width: "100%", maxWidth: "700px", marginTop: "36px" }}>
        {!started && (
          <div style={{ animation: "fadeUp 0.4s ease" }}>
            <h1 style={{ fontSize: "34px", fontWeight: 600, color: "#111", letterSpacing: "-0.04em", lineHeight: 1.15, margin: "0 0 10px" }}>Idea → Production Prompt.</h1>
            <p style={{ fontSize: "14px", color: "#6b7280", margin: "0 0 28px", lineHeight: 1.65 }}>Describe your app. SpecAI asks the right questions, then generates a spec doc, ready-to-use prompt, and 4-phase build chain.</p>
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "18px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <textarea value={idea} onChange={e => setIdea(e.target.value)} onKeyDown={e => { if (e.key==="Enter" && e.metaKey) startSession(); }} placeholder="e.g. An app where restaurant owners manage menus, orders and staff shifts from one dashboard..." rows={4} style={{ width: "100%", border: "none", resize: "none", fontSize: "14px", lineHeight: "1.7", color: "#111", background: "transparent", fontFamily: "DM Sans, sans-serif" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "10px", paddingTop: "10px", borderTop: "1px solid #f3f4f6" }}>
                <span style={{ fontSize: "11px", color: "#d1d5db", fontFamily: "DM Mono, monospace" }}>⌘+Enter to start</span>
                <button onClick={startSession} disabled={!idea.trim()} className="sbtn" style={{ padding: "7px 18px", borderRadius: "9px", border: "none", background: "#111", color: "#fff", fontSize: "13px", fontWeight: 500, cursor: "pointer", transition: "background 0.15s" }}>Start →</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>
              {["Ecommerce with AI recommendations","SaaS analytics dashboard","Doctor-patient app","Social app for book clubs"].map(ex => (
                <button key={ex} className="chip" onClick={() => setIdea(ex)} style={{ padding: "5px 12px", borderRadius: "100px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: "12px", cursor: "pointer", transition: "background 0.15s" }}>{ex}</button>
              ))}
            </div>
          </div>
        )}

        {started && (
          <div>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {messages.map((msg, i) => (
                <div key={i} className="msg" style={{ display: "flex", justifyContent: msg.type==="user" ? "flex-end" : "flex-start" }}>
                  {msg.type === "ai" && (
                    <div style={{ maxWidth: "84%" }}>
                      {msg.insight && <div style={{ fontSize: "10px", color: "#9ca3af", fontFamily: "DM Mono, monospace", marginBottom: "5px", paddingLeft: "2px" }}>⬡ {msg.insight}</div>}
                      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "14px 14px 14px 3px", padding: "12px 16px", fontSize: "14px", lineHeight: "1.7", color: "#111", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                        {i === messages.length - 1 && !output && !generating ? <TypewriterText text={msg.text} /> : msg.text}
                      </div>
                    </div>
                  )}
                  {msg.type === "user" && (
                    <div style={{ background: "#111", borderRadius: "14px 14px 3px 14px", padding: "11px 16px", fontSize: "14px", lineHeight: "1.7", color: "#fff", maxWidth: "80%" }}>{msg.text}</div>
                  )}
                </div>
              ))}

              {generating && (
                <div className="msg" style={{ display: "flex" }}>
                  <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", minWidth: "270px" }}>
                    <div style={{ fontSize: "10px", color: "#9ca3af", fontFamily: "DM Mono, monospace", marginBottom: "10px" }}>⬡ Building your spec</div>
                    {["Generating Spec Doc...","Generating Ready Prompt...","Generating Phase Chain..."].map((label, i) => (
                      <GeneratingStep key={label} label={label} done={generating.done.includes(label)} active={generating.step === i} />
                    ))}
                  </div>
                </div>
              )}

              {loading && !generating && (
                <div className="msg" style={{ display: "flex" }}>
                  <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "14px", padding: "12px 16px", display: "flex", gap: "4px", alignItems: "center" }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#d1d5db", animation: `blink 1.2s ${i*0.2}s infinite` }} />)}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {output && <OutputSection {...output} />}

            {!output && !generating && (
              <div style={{ position: "sticky", bottom: "14px", marginTop: "20px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: "13px", padding: "10px 14px", display: "flex", gap: "8px", alignItems: "flex-end", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
                <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendAnswer(); }}} placeholder="Your answer..." rows={1} style={{ flex: 1, border: "none", resize: "none", fontSize: "14px", lineHeight: "1.6", color: "#111", background: "transparent", fontFamily: "DM Sans, sans-serif", maxHeight: "100px", overflowY: "auto" }} />
                <button onClick={sendAnswer} disabled={!input.trim() || loading} className="sbtn" style={{ padding: "7px 14px", borderRadius: "9px", border: "none", background: "#111", color: "#fff", fontSize: "13px", fontWeight: 500, cursor: "pointer", transition: "background 0.15s", flexShrink: 0 }}>→</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}