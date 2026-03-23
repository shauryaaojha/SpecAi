import { useState, useRef, useEffect } from "react";

// ════════════════════════════════════════════════════
// NEW OUTPUT ARCHITECTURE:
//   gemini.md  → Full frontend prompt (UI, components, pages, styling)
//                Split into Phase 1 + Phase 2 if needed
//   claude.md  → Full backend prompt (API, DB, auth, logic)
//                Split into Phase 1 + Phase 2 if needed
//
// MODEL STRATEGY:
//   Discovery    → claude-sonnet-4-6   (best brainstorming)
//   Compression  → claude-sonnet-4-6   (same context)
//   gemini.md    → gpt-5.4             (strong structured output)
//   claude.md    → claude-sonnet-4-6   (Claude writes best backend prompts)
// ════════════════════════════════════════════════════

const MODELS = {
  discovery: "claude-haiku-4-5",  // cheap + fast for questions
  compress:  "claude-haiku-4-5",  // cheap for JSON extraction
  gemini:    "claude-sonnet-4-6", // quality for frontend prompt
  claude:    "claude-sonnet-4-6", // quality for backend prompt
};

// ── Puter API call ──
const ask = async (userMessage, systemPrompt, maxTokens, model) => {
  try {
    const response = await window.puter.ai.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage  }
      ],
      { model, max_tokens: maxTokens }
    );
    if (typeof response === "string") return response;
    const r = response;
    if (r?.message?.content?.[0]?.text) return r.message.content[0].text;
    if (typeof r?.message?.content === "string") return r.message.content;
    if (typeof r?.message === "string") return r.message;
    if (r?.text) return r.text;
    if (r?.content?.[0]?.text) return r.content[0].text;
    if (Array.isArray(r?.content)) return r.content.map(c => c.text||"").join("");
    const s = JSON.stringify(r);
    const m = s.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) return m[1].replace(/\\n/g,"\n").replace(/\\"/g,'"');
    return "";
  } catch(e) {
    console.error("Puter error:", e);
    return "";
  }
};

// ── Extract first question only ──
const extractFirstQuestion = (text) => {
  if (!text || text.includes("SPECAI_READY:")) return text?.trim() || "";
  const lines = text.split("\n");
  const result = [];
  let foundQ = false;
  for (const line of lines) {
    if (line.trim().match(/^Q:/i)) {
      if (foundQ) break;
      foundQ = true;
      result.push(line);
    } else if (foundQ) {
      if (line.trim().startsWith("•") || line.trim().startsWith("-") || line.trim() === "") {
        result.push(line);
      } else {
        result.push(line);
      }
    }
  }
  return result.length > 0 ? result.join("\n").trim() : lines.slice(0, 3).join("\n").trim();
};

// ── Compress answer ──
const compressAnswer = (answer) => {
  if (answer.length < 100) return answer;
  let c = answer
    .replace(/^(yeah|yes|sure|ok|okay|so|well|basically|actually|i mean|i think|i want|we want)\s*/gi, "")
    .replace(/\b(you know|kind of|sort of|like|basically|essentially|probably|maybe)\b/gi, "")
    .replace(/\s+/g, " ").trim();
  if (c.length > 150) {
    const sentences = c.split(/[.!?]/).filter(s => s.trim().length > 5);
    c = sentences.slice(0, 2).join(". ").trim();
  }
  return c || answer.slice(0, 150);
};

// ── Build discovery prompt ──
const buildDiscoveryPrompt = (idea, qaHistory, questionNumber) => {
  const remaining = 5 - questionNumber;
  let context = `App idea: "${idea}"\n`;
  if (qaHistory.length > 0) {
    context += "\nKnown so far:\n";
    qaHistory.forEach(({q, a}) => {
      const qClean = q.replace(/^Q:\s*/i,"").split("\n")[0].slice(0,60);
      context += `- ${qClean} → ${a}\n`;
    });
  }
  context += `\nQuestions remaining: ${remaining}`;
  if (remaining <= 1) context += ` (last question — then SPECAI_READY)`;
  return context;
};

// ── Build compressed context ──
const buildContext = async (idea, qaHistory) => {
  const raw = qaHistory.map(({q,a}) =>
    `${q.replace(/^Q:\s*/i,"").split("\n")[0]}: ${a}`
  ).join("\n");

  const prompt = `App: "${idea}"\nDiscovery:\n${raw}\n\nExtract into JSON:\n{"appName":"","appType":"","targetUsers":"","coreFeatures":[],"techStack":{"frontend":"","backend":"","database":"","auth":"","styling":""},"pages":[],"components":[],"apiEndpoints":[],"dbSchema":[],"integrations":[],"designStyle":"","deployment":"","monetization":"","specialRequirements":""}`;

  const result = await ask(
    prompt,
    "Extract app requirements into compact JSON. Valid JSON only. No explanations.",
    300, MODELS.compress
  );

  try {
    const match = (result.replace(/```json|```/g,"").trim()).match(/\{[\s\S]*\}/);
    if (match) {
      const d = JSON.parse(match[0]);
      return {
        parsed: d,
        text: [
          `APP NAME: ${d.appName || idea}`,
          `TYPE: ${d.appType}`,
          `USERS: ${d.targetUsers}`,
          `FEATURES: ${(d.coreFeatures||[]).join(", ")}`,
          `FRONTEND: ${d.techStack?.frontend}`,
          `BACKEND: ${d.techStack?.backend}`,
          `DATABASE: ${d.techStack?.database}`,
          `AUTH: ${d.techStack?.auth}`,
          `STYLING: ${d.techStack?.styling}`,
          `PAGES: ${(d.pages||[]).join(", ")}`,
          `COMPONENTS: ${(d.components||[]).join(", ")}`,
          `API ENDPOINTS: ${(d.apiEndpoints||[]).join(", ")}`,
          `DB SCHEMA: ${(d.dbSchema||[]).join(", ")}`,
          `INTEGRATIONS: ${(d.integrations||[]).join(", ")}`,
          `DESIGN: ${d.designStyle}`,
          `DEPLOY: ${d.deployment}`,
          `SPECIAL: ${d.specialRequirements}`,
        ].filter(l => !l.endsWith("undefined") && !l.endsWith("null") && !l.endsWith(": ")).join("\n")
      };
    }
  } catch {}
  return { parsed: null, text: `App: ${idea}\n${raw}` };
};

// ════════════════════════════════
// GENERATION PROMPTS
// gemini.md = frontend
// claude.md = backend
// Max 2 phases each
// ════════════════════════════════

const buildGeminiPhase1 = (ctx) => `You are writing gemini.md — a complete frontend build prompt for Gemini AI.
Gemini will use this prompt with MCP (Model Context Protocol) tools to scaffold and build the frontend.

Write a spoonfeeding frontend prompt that Gemini can execute directly. Include:

## Role
Senior frontend engineer using [stack] with MCP file system tools.

## Tech Stack
- Framework: [from context]
- Styling: [from context — if not specified, use Tailwind CSS]
- State management: [suggest based on app]
- Component library: [suggest]

## Project Structure
Complete folder tree for frontend only — every file with purpose.

## Pages & Routes
Every page with:
- Route path
- Exact layout and components
- Data it needs (from API)
- Loading / error / empty states

## Components
Every reusable component with:
- Props and types
- Exact UI behavior
- Responsive rules

## API Integration Layer
- Base URL config
- Auth token handling
- Every API call the frontend makes (endpoint, method, request, response shape)
- Error handling per call

## Forms & Validation
Every form with field validations, error messages, submit behavior.

## Design System
Colors, fonts, spacing, component variants — be exact.

## MCP Instructions
Tell Gemini to use nano-banana MCP to:
- Create all files in order
- Install dependencies
- Run dev server to verify

## Output Rules
- Create all files completely — no placeholders
- Mobile-first, fully responsive
- Commit after each page is complete

Context:
${ctx}`;

const buildGeminiPhase2 = (ctx) => `You are writing gemini.md Phase 2 — remaining frontend work.

This is the continuation after Phase 1 is complete. Build on the existing structure.

Cover:
## Remaining Pages
Any pages not covered in Phase 1.

## Advanced Components
Complex interactive components, modals, drawers, data tables.

## State Management
Global state setup, store structure, actions.

## Animations & Transitions
Page transitions, loading animations, micro-interactions.

## Testing
Component tests for critical UI paths.

## Build & Deploy
Vite/Next.js build config, env variables, deploy to [platform].

## MCP Instructions
Continue using nano-banana MCP to complete all remaining files.

Context:
${ctx}`;

const buildClaudePhase1 = (ctx) => `You are writing claude.md — a complete backend build prompt for Claude AI.
Claude will use this prompt to build the entire backend from scratch.

Write a spoonfeeding backend prompt Claude can execute directly. Include:

## Role
Senior backend engineer building a production-ready API.

## Tech Stack
- Runtime: [from context]
- Framework: [from context]
- Database: [from context]
- Auth: [from context]
- ORM/Query builder: [suggest]

## Project Structure
Complete folder tree for backend only — every file with purpose.

## Environment Variables
Every .env variable with description and example value.

## Database Schema
Every table/collection with:
- All fields, types, constraints
- Relationships and foreign keys
- Indexes to create
- Migration order

## Authentication
Step by step:
- Registration flow with validation
- Login flow with JWT/session
- Token refresh logic
- Middleware for protected routes
- Role-based access control

## API Endpoints — Phase 1 (core)
For each endpoint:
- Method + route
- Auth required + role
- Request body (all fields + validation rules)
- Response (success + all error cases)
- Business logic step by step
- DB queries to run

## Error Handling
Global error handler, validation errors, DB errors, auth errors.

## Output Rules
- Complete files only — no placeholders, no TODOs
- Include package.json with all dependencies
- Include .env.example
- Include README with setup + run instructions

Context:
${ctx}`;

const buildClaudePhase2 = (ctx) => `You are writing claude.md Phase 2 — remaining backend work.

Continuation after Phase 1 core API is complete.

Cover:
## Remaining API Endpoints
All non-core endpoints not covered in Phase 1.

## File Uploads
If applicable — multer/S3 setup, validation, storage logic.

## Background Jobs / Queues
If applicable — cron jobs, email sending, notifications.

## Third-party Integrations
Each integration with full setup and usage:
- Payment (Stripe/Razorpay if needed)
- Email (SendGrid/Resend)
- SMS/Push notifications
- Any other services mentioned

## Caching
Redis/in-memory caching where applicable.

## Security Hardening
Rate limiting, CORS config, helmet, input sanitization, SQL injection prevention.

## Testing
Unit tests for critical business logic and API endpoints.

## Deployment
Dockerfile, docker-compose, deploy config for [platform].

Context:
${ctx}`;

// ── Estimate if context needs 2 phases ──
// If app has >5 features or >6 pages → use 2 phases
const needsTwoPhases = (parsed) => {
  if (!parsed) return false;
  const features = parsed.coreFeatures?.length || 0;
  const pages = parsed.pages?.length || 0;
  const endpoints = parsed.apiEndpoints?.length || 0;
  return features > 5 || pages > 6 || endpoints > 8;
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
      if (i < text.length) setDisplayed(text.slice(0,++i));
      else { setDone(true); clearInterval(iv); }
    }, 14);
    return () => clearInterval(iv);
  }, [text]);
  return <span>{displayed}{!done && <span style={{animation:"blink 1s step-end infinite"}}>|</span>}</span>;
};

const Badge = ({ type }) => {
  if (!type) return null;
  const map = {ecommerce:"#f59e0b",saas:"#3b82f6",social:"#ec4899",tool:"#10b981",marketplace:"#8b5cf6",dashboard:"#06b6d4"};
  const c = Object.entries(map).find(([k]) => type.toLowerCase().includes(k))?.[1] || "#6b7280";
  return <span style={{background:c+"18",color:c,border:`1px solid ${c}30`,padding:"2px 10px",borderRadius:"100px",fontSize:"11px",fontFamily:"monospace",fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase"}}>{type}</span>;
};

const OutputSection = ({ geminiDoc, claudeDoc, hasTwoPhases, appName, onFeedback, regenerating }) => {
  const [tab, setTab] = useState("gemini");
  const [copied, setCopied] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const labels = { gemini: "gemini.md", claude: "claude.md" };

  const getContent = () => tab === "gemini" ? geminiDoc : claudeDoc;

  const copy = (text, key) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(()=>setCopied(null),2000); };
  const dl = (content, name) => {
    const b = new Blob([content],{type:"text/markdown"});
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = name; a.click();
  };
  const submit = () => { if (!feedback.trim()||regenerating) return; onFeedback(feedback.trim(),tab); setFeedback(""); setShowFeedback(false); };

  return (
    <div style={{marginTop:"28px"}}>
      {/* Tab header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"14px",flexWrap:"wrap",gap:"8px"}}>
        <div style={{display:"flex",gap:"2px",background:"#f3f4f6",borderRadius:"10px",padding:"3px"}}>
          {[["gemini","gemini.md"],["claude","claude.md"]].map(([k,l])=>(
            <button key={k} onClick={()=>{setTab(k);setShowFeedback(false);}} style={{padding:"5px 16px",borderRadius:"8px",border:"none",background:tab===k?"#fff":"transparent",color:tab===k?"#111":"#6b7280",fontSize:"12px",fontWeight:600,cursor:"pointer",boxShadow:tab===k?"0 1px 3px rgba(0,0,0,0.08)":"none",transition:"all 0.15s",fontFamily:"DM Mono, monospace"}}>{l}</button>
          ))}
          {hasTwoPhases && (
            <span style={{fontSize:"10px",color:"#9ca3af",fontFamily:"monospace",padding:"5px 8px",alignSelf:"center"}}>2 phases each</span>
          )}
        </div>
        <div style={{display:"flex",gap:"6px"}}>
          <button onClick={()=>copy(getContent(),tab)} style={{padding:"5px 12px",borderRadius:"7px",border:"1px solid #e5e7eb",background:"#fff",color:"#374151",fontSize:"11px",cursor:"pointer"}}>{copied===tab?"✓ Copied":"Copy"}</button>
          <button onClick={()=>dl(getContent(), tab==="gemini"?"gemini.md":"claude.md")} style={{padding:"5px 12px",borderRadius:"7px",border:"1px solid #e5e7eb",background:"#fff",color:"#374151",fontSize:"11px",cursor:"pointer",fontWeight:600}}>↓ {tab==="gemini"?"gemini.md":"claude.md"}</button>
          <button onClick={()=>setShowFeedback(v=>!v)} style={{padding:"5px 12px",borderRadius:"7px",border:`1px solid ${showFeedback?"#111":"#e5e7eb"}`,background:showFeedback?"#111":"#fff",color:showFeedback?"#fff":"#111",fontSize:"11px",cursor:"pointer",fontWeight:500,transition:"all 0.15s"}}>✎ Refine</button>
        </div>
      </div>

      {/* What each file is for */}
      <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
        <div style={{flex:1,padding:"10px 14px",borderRadius:"10px",background:tab==="gemini"?"#111":"#f9fafb",border:`1px solid ${tab==="gemini"?"#111":"#e5e7eb"}`,cursor:"pointer",transition:"all 0.2s"}} onClick={()=>setTab("gemini")}>
          <div style={{fontSize:"11px",fontWeight:600,color:tab==="gemini"?"#fff":"#374151",fontFamily:"monospace",marginBottom:"2px"}}>gemini.md</div>
          <div style={{fontSize:"10px",color:tab==="gemini"?"rgba(255,255,255,0.6)":"#9ca3af"}}>Frontend · UI · Pages · Components · MCP</div>
        </div>
        <div style={{flex:1,padding:"10px 14px",borderRadius:"10px",background:tab==="claude"?"#111":"#f9fafb",border:`1px solid ${tab==="claude"?"#111":"#e5e7eb"}`,cursor:"pointer",transition:"all 0.2s"}} onClick={()=>setTab("claude")}>
          <div style={{fontSize:"11px",fontWeight:600,color:tab==="claude"?"#fff":"#374151",fontFamily:"monospace",marginBottom:"2px"}}>claude.md</div>
          <div style={{fontSize:"10px",color:tab==="claude"?"rgba(255,255,255,0.6)":"#9ca3af"}}>Backend · API · DB · Auth · Logic</div>
        </div>
      </div>

      {/* Feedback box */}
      {showFeedback && (
        <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
          <div style={{fontSize:"11px",color:"#9ca3af",fontFamily:"monospace",marginBottom:"8px"}}>✎ Refining: <span style={{color:"#111",fontWeight:600,fontFamily:"monospace"}}>{labels[tab]}</span></div>
          <textarea value={feedback} onChange={e=>setFeedback(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}}} placeholder={`e.g. "Add dark mode", "Use PostgreSQL instead of MongoDB"...`} rows={2} style={{width:"100%",border:"none",fontSize:"13px",lineHeight:"1.6",color:"#111",background:"transparent",fontFamily:"DM Sans, sans-serif",resize:"none",outline:"none"}}/>
          <div style={{display:"flex",justifyContent:"flex-end",gap:"6px",marginTop:"8px",paddingTop:"8px",borderTop:"1px solid #f3f4f6"}}>
            <button onClick={()=>{setShowFeedback(false);setFeedback("");}} style={{padding:"5px 12px",borderRadius:"7px",border:"1px solid #e5e7eb",background:"#fff",color:"#6b7280",fontSize:"11px",cursor:"pointer"}}>Cancel</button>
            <button onClick={submit} disabled={!feedback.trim()||regenerating} style={{padding:"5px 14px",borderRadius:"7px",border:"none",background:"#111",color:"#fff",fontSize:"11px",cursor:"pointer",opacity:!feedback.trim()||regenerating?0.4:1}}>{regenerating?"Regenerating...":"Regenerate →"}</button>
          </div>
        </div>
      )}

      {regenerating && (
        <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:"10px",marginBottom:"12px"}}>
          <div style={{width:"5px",height:"5px",borderRadius:"50%",background:"#111",animation:"pulse 1s infinite"}}/>
          <span style={{fontSize:"12px",color:"#374151",fontFamily:"monospace"}}>Regenerating {labels[tab]}...</span>
        </div>
      )}

      {/* Content */}
      <div style={{border:"1px solid #e5e7eb",borderRadius:"12px",overflow:"hidden"}}>
        {getContent() ? (
          <pre style={{margin:0,padding:"18px",fontSize:"12.5px",lineHeight:"1.8",color:"#374151",whiteSpace:"pre-wrap",wordBreak:"break-word",fontFamily:"DM Mono, monospace",maxHeight:"500px",overflowY:"auto"}}>{getContent()}</pre>
        ) : (
          <div style={{padding:"20px",fontSize:"12px",color:"#9ca3af",fontStyle:"italic",fontFamily:"DM Mono, monospace",textAlign:"center"}}>
            Content not generated — use ✎ Refine to regenerate.
          </div>
        )}
      </div>
    </div>
  );
};

// ════════════════════════════════
// MAIN APP
// ════════════════════════════════
export default function SpecAI() {
  const [idea, setIdea]             = useState("");
  const [started, setStarted]       = useState(false);
  const [messages, setMessages]     = useState([]);
  const [qaHistory, setQaHistory]   = useState([]);
  const [lastQ, setLastQ]           = useState("");
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [qCount, setQCount]         = useState(0);
  const [appType, setAppType]       = useState(null);
  const [appName, setAppName]       = useState("Your App");
  const [output, setOutput]         = useState(null);
  const [ctxData, setCtxData]       = useState(null);
  const [generating, setGenerating] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages, loading, generating]);

  const detectType = (text) => {
    const t = text.toLowerCase();
    if (t.includes("ecommerce")||t.includes("shop")||t.includes("store")) return "ecommerce";
    if (t.includes("social")||t.includes("community")||t.includes("feed")) return "social";
    if (t.includes("dashboard")||t.includes("analytics")) return "dashboard";
    if (t.includes("marketplace")) return "marketplace";
    if (t.includes("saas")||t.includes("subscription")) return "saas";
    return "tool";
  };

  const askDiscovery = async (currentIdea, currentHistory, currentCount) => {
    const userMsg = buildDiscoveryPrompt(currentIdea, currentHistory, currentCount);
    const system = `You are SpecAI. Ask ONE question to spec an app in max 5 questions.

FORMAT:
Q: [max 8 words]
• bullet if listing options

RULES: One question. No preamble. No filler.
Cover in 5 questions: users + features + stack + auth/DB + design/deploy
By Q5 at latest: respond ONLY "SPECAI_READY: [App Name]"`;

    const raw = await ask(userMsg, system, 80, MODELS.discovery);
    return extractFirstQuestion(raw);
  };

  // ── Generate both documents ──
  const runGeneration = async (ctx, parsed, name) => {
    const twoPhases = false; // always single phase to stay under 7000 tokens
    const steps = twoPhases
      ? ["gemini.md Phase 1", "gemini.md Phase 2", "claude.md Phase 1", "claude.md Phase 2"]
      : ["gemini.md", "claude.md"];

    setGenerating({ done: [], total: steps.length, steps, twoPhases });
    const done = [];

    let geminiDoc = "";
    let claudeDoc = "";

    if (twoPhases) {
      // Gemini Phase 1
      const g1 = await ask(buildGeminiPhase1(ctx), "Write a complete, spoonfeeding frontend build prompt in markdown. No preamble.", 1200, MODELS.gemini);
      done.push(steps[0]); setGenerating({ done:[...done], total:steps.length, steps, twoPhases });

      // Gemini Phase 2
      const g2 = await ask(buildGeminiPhase2(ctx), "Write a complete frontend Phase 2 build prompt in markdown. No preamble.", 1400, MODELS.gemini);
      done.push(steps[1]); setGenerating({ done:[...done], total:steps.length, steps, twoPhases });

      // Claude Phase 1
      const c1 = await ask(buildClaudePhase1(ctx), "Write a complete, spoonfeeding backend build prompt in markdown. No preamble.", 1200, MODELS.claude);
      done.push(steps[2]); setGenerating({ done:[...done], total:steps.length, steps, twoPhases });

      // Claude Phase 2
      const c2 = await ask(buildClaudePhase2(ctx), "Write a complete backend Phase 2 build prompt in markdown. No preamble.", 1400, MODELS.claude);
      done.push(steps[3]); setGenerating({ done:[...done], total:steps.length, steps, twoPhases });

      geminiDoc = `# gemini.md — Frontend Build Prompt\n\n## Phase 1\n\n${g1.trim()}\n\n---\n\n## Phase 2\n\n${g2.trim()}`;
      claudeDoc = `# claude.md — Backend Build Prompt\n\n## Phase 1\n\n${c1.trim()}\n\n---\n\n## Phase 2\n\n${c2.trim()}`;
    } else {
      // Single phase each
      const g = await ask(buildGeminiPhase1(ctx), "Write a complete, spoonfeeding frontend build prompt in markdown. No preamble.", 1200, MODELS.gemini);
      done.push(steps[0]); setGenerating({ done:[...done], total:steps.length, steps, twoPhases });

      const c = await ask(buildClaudePhase1(ctx), "Write a complete, spoonfeeding backend build prompt in markdown. No preamble.", 1200, MODELS.claude);
      done.push(steps[1]); setGenerating({ done:[...done], total:steps.length, steps, twoPhases });

      geminiDoc = `# gemini.md — Frontend Build Prompt\n\n${g.trim()}`;
      claudeDoc = `# claude.md — Backend Build Prompt\n\n${c.trim()}`;
    }

    setGenerating(null);
    setOutput({ geminiDoc, claudeDoc, hasTwoPhases: twoPhases, appName: name });
    setMessages(prev=>[...prev,{
      type:"ai",
      text:`Done! "${name}" — two files ready.\n\n📄 gemini.md → give to Gemini for frontend\n📄 claude.md → give to Claude for backend${twoPhases ? "\n\n⚡ App is complex — each file has 2 phases. Complete Phase 1 before Phase 2." : ""}`,
      insight:"Complete"
    }]);
  };

  const triggerGeneration = async (finalHistory, name) => {
    setMessages(prev=>[...prev,{type:"ai",text:`Compressing context and generating gemini.md + claude.md...`,insight:"Building"}]);
    const ctx = await buildContext(idea, finalHistory);
    if (ctx.parsed?.appType) setAppType(ctx.parsed.appType);
    if (ctx.parsed?.appName) setAppName(ctx.parsed.appName);
    setCtxData(ctx);
    await runGeneration(ctx.text, ctx.parsed, name);
  };

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
    setMessages([{type:"user",text:idea},{type:"ai",text:q,insight:"1/8"}]);
    setQCount(1); setLoading(false);
    setTimeout(()=>inputRef.current?.focus(),100);
  };

  const sendAnswer = async () => {
    if (!input.trim()||loading) return;
    const userText = input.trim();
    setInput("");
    const compressed = compressAnswer(userText);
    const newHistory = [...qaHistory, {q:lastQ, a:compressed}];
    setQaHistory(newHistory);
    setMessages(prev=>[...prev,{type:"user",text:userText}]);

    const forceWords = /^(done|generate|go|proceed|finish|that'?s?\s*(all|it|enough)|ok(ay)?|yes|build)$/i;
    if (qCount >= 5 || forceWords.test(userText.trim())) {
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
    if (!appType) setAppType(detectType(idea+" "+userText));
    const next = qCount + 1;
    setMessages(prev=>[...prev,{type:"ai",text:q,insight:`${next}/8`}]);
    setQCount(next); setLoading(false);
    setTimeout(()=>inputRef.current?.focus(),100);
  };

  const handleFeedback = async (feedbackText, targetTab) => {
    setRegenerating(true);
    const label = targetTab==="gemini"?"gemini.md":"claude.md";
    setMessages(prev=>[...prev,{type:"user",text:`Refine ${label}: ${feedbackText}`}]);
    const ctx = `FEEDBACK: "${feedbackText}"\n\n${ctxData?.text || idea}`;
    const twoPhases = output?.hasTwoPhases;
    let updated = {...output};

    try {
      if (targetTab==="gemini") {
        if (twoPhases) {
          const g1 = await ask(buildGeminiPhase1(ctx),"Write complete frontend build prompt. No preamble.",1800,MODELS.gemini);
          const g2 = await ask(buildGeminiPhase2(ctx),"Write complete frontend Phase 2 prompt. No preamble.",1400,MODELS.gemini);
          updated.geminiDoc = `# gemini.md — Frontend Build Prompt\n\n## Phase 1\n\n${g1.trim()}\n\n---\n\n## Phase 2\n\n${g2.trim()}`;
        } else {
          const g = await ask(buildGeminiPhase1(ctx),"Write complete frontend build prompt. No preamble.",1800,MODELS.gemini);
          updated.geminiDoc = `# gemini.md — Frontend Build Prompt\n\n${g.trim()}`;
        }
      } else {
        if (twoPhases) {
          const c1 = await ask(buildClaudePhase1(ctx),"Write complete backend build prompt. No preamble.",1800,MODELS.claude);
          const c2 = await ask(buildClaudePhase2(ctx),"Write complete backend Phase 2 prompt. No preamble.",1400,MODELS.claude);
          updated.claudeDoc = `# claude.md — Backend Build Prompt\n\n## Phase 1\n\n${c1.trim()}\n\n---\n\n## Phase 2\n\n${c2.trim()}`;
        } else {
          const c = await ask(buildClaudePhase1(ctx),"Write complete backend build prompt. No preamble.",1800,MODELS.claude);
          updated.claudeDoc = `# claude.md — Backend Build Prompt\n\n${c.trim()}`;
        }
      }
      setOutput(updated);
      setMessages(prev=>[...prev,{type:"ai",text:`${label} updated 🔄`,insight:"Regenerated"}]);
    } catch {
      setMessages(prev=>[...prev,{type:"ai",text:"Regeneration failed. Try again.",insight:"Error"}]);
    }
    setRegenerating(false);
  };

  const reset = () => {
    setIdea(""); setStarted(false); setMessages([]); setQaHistory([]);
    setLastQ(""); setInput(""); setLoading(false); setQCount(0);
    setAppType(null); setAppName("Your App"); setOutput(null);
    setCtxData(null); setGenerating(null); setRegenerating(false);
  };

  return (
    <div style={{minHeight:"100vh",background:"#fafafa",fontFamily:"'DM Sans','Helvetica Neue',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",padding:"0 16px 80px"}}>
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
      <div style={{width:"100%",maxWidth:"700px",padding:"28px 0 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <div style={{width:"30px",height:"30px",background:"#111",borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px"}}>⬡</div>
          <span style={{fontWeight:600,fontSize:"15px",color:"#111",letterSpacing:"-0.02em"}}>SpecAI</span>
          {appType && <Badge type={appType}/>}
        </div>
        {started && (
          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
            {!output && (
              <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                <div style={{display:"flex",gap:"3px"}}>
                  {[...Array(5)].map((_,i)=>(
                    <div key={i} style={{width:"6px",height:"6px",borderRadius:"50%",background:i<qCount?"#111":"#e5e7eb",transition:"background 0.3s"}}/>
                  ))}
                </div>
                <span style={{fontSize:"10px",color:qCount>=6?"#f59e0b":"#9ca3af",fontFamily:"DM Mono, monospace",fontWeight:qCount>=4?600:400}}>{qCount}/5</span>
              </div>
            )}
            <button onClick={reset} style={{padding:"4px 10px",borderRadius:"7px",border:"1px solid #e5e7eb",background:"#fff",color:"#6b7280",fontSize:"12px",cursor:"pointer"}}>↺ Reset</button>
          </div>
        )}
      </div>

      <div style={{width:"100%",maxWidth:"700px",marginTop:"36px"}}>
        {/* Landing */}
        {!started && (
          <div style={{animation:"fadeUp 0.4s ease"}}>
            <h1 style={{fontSize:"34px",fontWeight:600,color:"#111",letterSpacing:"-0.04em",lineHeight:1.15,margin:"0 0 10px"}}>Idea → Production Prompt.</h1>
            <p style={{fontSize:"14px",color:"#6b7280",margin:"0 0 6px",lineHeight:1.65}}>8 sharp questions. Then generates two files:</p>
            <div style={{display:"flex",gap:"8px",marginBottom:"28px"}}>
              <span style={{padding:"4px 12px",borderRadius:"6px",background:"#f0fdf4",color:"#16a34a",fontSize:"12px",fontFamily:"monospace",fontWeight:600,border:"1px solid #bbf7d0"}}>gemini.md → Frontend</span>
              <span style={{padding:"4px 12px",borderRadius:"6px",background:"#eff6ff",color:"#2563eb",fontSize:"12px",fontFamily:"monospace",fontWeight:600,border:"1px solid #bfdbfe"}}>claude.md → Backend</span>
            </div>
            <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:"14px",padding:"18px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
              <textarea value={idea} onChange={e=>setIdea(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&e.metaKey)startSession();}} placeholder="e.g. A social app for book clubs where members discuss chapters, share notes, and vote on next reads..." rows={4} style={{width:"100%",border:"none",resize:"none",fontSize:"14px",lineHeight:"1.7",color:"#111",background:"transparent",fontFamily:"DM Sans, sans-serif"}}/>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:"10px",paddingTop:"10px",borderTop:"1px solid #f3f4f6"}}>
                <span style={{fontSize:"11px",color:"#d1d5db",fontFamily:"DM Mono, monospace"}}>⌘+Enter to start</span>
                <button onClick={startSession} disabled={!idea.trim()} className="sbtn" style={{padding:"7px 18px",borderRadius:"9px",border:"none",background:"#111",color:"#fff",fontSize:"13px",fontWeight:500,cursor:"pointer",transition:"background 0.15s"}}>Start →</button>
              </div>
            </div>
            <div style={{display:"flex",gap:"6px",marginTop:"12px",flexWrap:"wrap"}}>
              {["Ecommerce with AI recommendations","SaaS analytics dashboard","Doctor-patient app","Social app for book clubs"].map(ex=>(
                <button key={ex} className="chip" onClick={()=>setIdea(ex)} style={{padding:"5px 12px",borderRadius:"100px",border:"1px solid #e5e7eb",background:"#fff",color:"#6b7280",fontSize:"12px",cursor:"pointer",transition:"background 0.15s"}}>{ex}</button>
              ))}
            </div>
          </div>
        )}

        {/* Chat */}
        {started && (
          <div>
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
              {messages.map((msg,i)=>(
                <div key={i} className="msg" style={{display:"flex",justifyContent:msg.type==="user"?"flex-end":"flex-start"}}>
                  {msg.type==="ai" && (
                    <div style={{maxWidth:"84%"}}>
                      {msg.insight && <div style={{fontSize:"10px",color:"#9ca3af",fontFamily:"DM Mono, monospace",marginBottom:"5px",paddingLeft:"2px"}}>⬡ {msg.insight}</div>}
                      <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:"14px 14px 14px 3px",padding:"12px 16px",fontSize:"14px",lineHeight:"1.7",color:"#111",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",whiteSpace:"pre-line"}}>
                        {i===messages.length-1&&!output&&!generating?<TypewriterText text={msg.text}/>:msg.text}
                      </div>
                    </div>
                  )}
                  {msg.type==="user" && (
                    <div style={{background:"#111",borderRadius:"14px 14px 3px 14px",padding:"11px 16px",fontSize:"14px",lineHeight:"1.7",color:"#fff",maxWidth:"80%"}}>{msg.text}</div>
                  )}
                </div>
              ))}

              {/* Generation progress */}
              {generating && (
                <div className="msg" style={{display:"flex"}}>
                  <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:"14px",padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",minWidth:"280px"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
                      <span style={{fontSize:"10px",color:"#9ca3af",fontFamily:"DM Mono, monospace"}}>⬡ Generating</span>
                      <span style={{fontSize:"10px",color:"#111",fontFamily:"DM Mono, monospace",fontWeight:600}}>{generating.done.length}/{generating.total}</span>
                    </div>
                    <div style={{width:"100%",height:"2px",background:"#f3f4f6",borderRadius:"2px",marginBottom:"14px"}}>
                      <div style={{width:`${(generating.done.length/generating.total)*100}%`,height:"100%",background:"#111",borderRadius:"2px",transition:"width 0.4s ease"}}/>
                    </div>
                    {generating.steps.map((step, i) => {
                      const done = generating.done.includes(step);
                      const active = generating.done.length === i;
                      const isGemini = step.toLowerCase().includes("gemini");
                      return (
                        <div key={step} style={{display:"flex",alignItems:"center",gap:"10px",padding:"4px 0"}}>
                          <div style={{width:"16px",height:"16px",borderRadius:"50%",flexShrink:0,background:done?"#111":"transparent",border:done?"none":`2px solid ${active?(isGemini?"#10b981":"#3b82f6"):"#e5e7eb"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"8px",color:"#fff",transition:"all 0.3s"}}>
                            {done?"✓":active?<span style={{width:"5px",height:"5px",borderRadius:"50%",background:isGemini?"#10b981":"#3b82f6",display:"block",animation:"pulse 1s infinite"}}/>:""}
                          </div>
                          <span style={{fontSize:"12px",fontFamily:"monospace",color:done?"#111":active?"#374151":"#9ca3af",fontWeight:done||active?500:400}}>{step}</span>
                          {done&&<span style={{fontSize:"10px",color:"#10b981",marginLeft:"auto"}}>✓</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {loading&&!generating&&(
                <div className="msg" style={{display:"flex"}}>
                  <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:"14px",padding:"12px 16px",display:"flex",gap:"4px",alignItems:"center"}}>
                    {[0,1,2].map(i=><div key={i} style={{width:"5px",height:"5px",borderRadius:"50%",background:"#d1d5db",animation:`blink 1.2s ${i*0.2}s infinite`}}/>)}
                  </div>
                </div>
              )}
              <div ref={bottomRef}/>
            </div>

            {output && <OutputSection {...output} onFeedback={handleFeedback} regenerating={regenerating}/>}

            {!output&&!generating&&(
              <div style={{position:"sticky",bottom:"14px",marginTop:"20px",background:"#fff",border:"1px solid #e5e7eb",borderRadius:"13px",padding:"10px 14px",boxShadow:"0 4px 20px rgba(0,0,0,0.06)"}}>
                <textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendAnswer();}}} placeholder={qCount>=4?"Last question — answer to generate...":qCount>=3?`Answer or type "done" to generate early...`:"Your answer..."} rows={1} style={{width:"100%",border:"none",resize:"none",fontSize:"14px",lineHeight:"1.6",color:"#111",background:"transparent",fontFamily:"DM Sans, sans-serif",maxHeight:"100px",overflowY:"auto",outline:"none"}}/>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:"6px"}}>
                  <span style={{fontSize:"10px",color:"#d1d5db",fontFamily:"DM Mono, monospace"}}>{qCount>=3?`"done" to generate early · auto at Q5`:"Enter to send"}</span>
                  <button onClick={sendAnswer} disabled={!input.trim()||loading} className="sbtn" style={{padding:"6px 14px",borderRadius:"8px",border:"none",background:"#111",color:"#fff",fontSize:"12px",fontWeight:500,cursor:"pointer",transition:"background 0.15s"}}>→</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}