"use strict";
const $=id=>document.getElementById(id);
const DEFAULTS={provider:"ollama",baseUrl:"http://localhost:11434",model:"",temperature:.7,contextSize:4096,
systemPrompt:"You are OllaVox, a concise, friendly voice assistant. Answer clearly and naturally.",sttEngine:"native",
voice:"",speechRate:1,autoBargeIn:true,stopCommands:"stop, cancel, hold on, never mind, quiet, pause",
theme:"midnight",bgColor:"#0b0f17",bgImage:"",voskModelName:""};
const state={messages:[],prefs:{...DEFAULTS},listening:false,continuous:false,generating:false,speaking:false,
abortController:null,recognition:null,vosk:null,voskRecognizer:null,audioContext:null,processor:null,ttsQueue:"",muted:false,pendingTurn:"",turnTimer:null,echoGuardUntil:0,lastSpoken:""};

const PreferencesManager={
 load(){try{state.prefs={...DEFAULTS,...JSON.parse(localStorage.getItem("vanillavox_prefs")||"{}")}}catch(e){state.prefs={...DEFAULTS}}},
 save(){localStorage.setItem("vanillavox_prefs",JSON.stringify(state.prefs))},
 reset(){state.prefs={...DEFAULTS};this.save();location.reload()}
};
const ContextManager={
 estimate(t){return Math.ceil((t||"").length/4)},
 total(){return this.estimate(state.prefs.systemPrompt)+state.messages.reduce((n,m)=>n+this.estimate(m.content),0)},
 trim(limit){
  const sys={role:"system",content:state.prefs.systemPrompt};
  let budget=Math.max(256,limit)-this.estimate(sys.content)-64;
  const kept=[];
  for(let i=state.messages.length-1;i>=0&&budget>0;i--){
   const cost=this.estimate(state.messages[i].content);
   if(cost>budget&&kept.length)break;
   kept.unshift(state.messages[i]);budget-=cost;
  }
  return [sys,...kept];
 }
};
const APIClient={
 endpoint(){return state.prefs.provider==="ollama"?state.prefs.baseUrl.replace(/\/+$/,"")+"/api/chat":state.prefs.baseUrl.replace(/\/+$/,"")+"/v1/chat/completions"},
 modelsEndpoint(){return state.prefs.provider==="ollama"?state.prefs.baseUrl.replace(/\/+$/,"")+"/api/tags":state.prefs.baseUrl.replace(/\/+$/,"")+"/v1/models"},
 async models(){
  const r=await fetch(this.modelsEndpoint(),{method:"GET"});
  if(!r.ok)throw new Error("HTTP "+r.status);
  const j=await r.json();
  return state.prefs.provider==="ollama"?(j.models||[]).map(m=>m.name):(j.data||[]).map(m=>m.id);
 },
 async stream(messages,onToken){
  state.abortController=new AbortController();
  const ctx=Number(state.prefs.contextSize)||4096;
  const body=state.prefs.provider==="ollama"?{model:state.prefs.model,messages,options:{num_ctx:ctx,temperature:Number(state.prefs.temperature)},stream:true}
   :{model:state.prefs.model,messages,temperature:Number(state.prefs.temperature),stream:true};
  const r=await fetch(this.endpoint(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:state.abortController.signal});
  if(!r.ok)throw new Error("HTTP "+r.status+" — "+(await r.text()).slice(0,180));
  const reader=r.body.getReader(),dec=new TextDecoder();let buf="";
  while(true){
   const {value,done}=await reader.read();if(done)break;
   buf+=dec.decode(value,{stream:true});
   const lines=buf.split("\n");buf=lines.pop();
   for(const line of lines){
    const s=line.trim();if(!s)continue;
    try{const j=JSON.parse(s);
     const tok=state.prefs.provider==="ollama"?(j.message?.content||""):(j.choices?.[0]?.delta?.content||"");
     if(tok)onToken(tok);
    }catch(e){}
   }
  }
 }
};
const MarkdownParser={
 esc(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))},
 render(t){
  let s=this.esc(t);
  s=s.replace(/```(\w*)\n([\s\S]*?)```/g,(m,l,c)=>'<pre><code>'+c+'</code></pre>');
  s=s.replace(/`([^`\n]+)`/g,"<code>$1</code>");
  s=s.replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>").replace(/\*([^*\n]+)\*/g,"<em>$1</em>");
  return s;
 },
 plain(t){return t.replace(/```[\s\S]*?```/g," code block ").replace(/[#*_`>]/g,"").replace(/\[(.*?)\]\(.*?\)/g,"$1")}
};
const UIRenderer={
 add(role,text){
  const d=document.createElement("div");d.className="msg "+role;
  d.innerHTML='<div class="meta">'+(role==="user"?"You":"Assistant")+'</div><div class="body"></div>';
  d.querySelector(".body").innerHTML=MarkdownParser.render(text);
  if(role==="assistant"){
   const b=document.createElement("button");b.className="copy";b.textContent="Copy";
   b.onclick=()=>{navigator.clipboard.writeText(text);UIRenderer.toast("Copied")};d.prepend(b);
  }
  $("chat").appendChild(d);$("chat").scrollTop=$("chat").scrollHeight;return d;
 },
 update(el,text){el.querySelector(".body").innerHTML=MarkdownParser.render(text);$("chat").scrollTop=$("chat").scrollHeight},
 pill(text){const p=$("statusPill");if(!text){p.classList.remove("show");return}p.textContent=text;p.classList.add("show")},
 toast(t){const x=$("toast");x.textContent=t;x.classList.add("show");clearTimeout(x._t);x._t=setTimeout(()=>x.classList.remove("show"),1800)},
 badge(){$("ctxBadge").textContent=ContextManager.total()+" / "+(Number(state.prefs.contextSize)||4096)+" tokens"},
 status(cls,text){$("statusDot").className="dot "+cls;$("statusText").textContent=text}
};
const BargeInController = {
 interrupt() {
  window.speechSynthesis.cancel();
  state.speaking = false;
  state.ttsQueue = "";
  if (state.abortController) {
   state.abortController.abort();
   state.abortController = null;
  }
  state.generating = false;
  clearTimeout(state.turnTimer);
  state.pendingTurn = "";
  UIRenderer.pill("");
  UIRenderer.status("warn", "Interrupted");
  setTimeout(() => {
   if (!state.listening) {
    UIRenderer.status(state.prefs.model ? "ok" : "warn", state.prefs.model ? "Ready" : "Disconnected");
   }
  }, 900);
 },
 isStopCommand(t) {
  const norm = t.trim().toLowerCase().replace(/[.,!?]/g, "").replace(/\s+/g, " ");
  const stops = state.prefs.stopCommands.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  return stops.some(s => norm === s || norm.startsWith(s + " ") || norm.endsWith(" " + s));
 }
};

const SpeechEngine = {
 voices() { return window.speechSynthesis?.getVoices?.() || []; },
 populateVoices() {
  const sel = $("voiceSelect");
  sel.innerHTML = '<option value="">System default</option>';
  this.voices().forEach(v => {
   const o = document.createElement("option");
   o.value = v.name;
   o.textContent = v.name + " (" + v.lang + ")";
   sel.appendChild(o);
  });
  if (state.prefs.voice) sel.value = state.prefs.voice;
 },
 normalize(t) {
  return (t || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
 },
 isEchoGuardActive() {
  return state.speaking || window.speechSynthesis.speaking || window.speechSynthesis.pending || Date.now() < state.echoGuardUntil;
 },
 isEcho(t) {
  const heard = this.normalize(t);
  const spoken = this.normalize(state.lastSpoken);
  if (!heard || !spoken || !this.isEchoGuardActive()) return false;

  // 1. Direct substring match (e.g. mic caught a fragment of TTS output)
  if (heard.length >= 4 && spoken.includes(heard)) return true;

  // 2. Word overlap ratio based on HEARD words (not total spoken words)
  const aw = heard.split(" ").filter(w => w.length > 2);
  const bw = new Set(spoken.split(" "));
  if (aw.length === 0) return true; // Ignore tiny 1-2 letter mic glitches during echo guard

  const overlap = aw.filter(w => bw.has(w)).length;
  return (overlap / aw.length) >= 0.45; // 45%+ word match with recent TTS = self-echo
 },
 queueTurn(text) {
  if (this.isEcho(text)) {
   UIRenderer.toast("Ignored self-echo");
   return;
  }
  state.pendingTurn = (state.pendingTurn ? state.pendingTurn + " " : "") + text;
  clearTimeout(state.turnTimer);
  state.turnTimer = setTimeout(() => {
   const turn = state.pendingTurn.trim();
   state.pendingTurn = "";
   if (!turn || this.isEcho(turn)) return;

   if (this.isEchoGuardActive() || state.generating) {
    if (!state.prefs.autoBargeIn) {
     UIRenderer.toast("Waiting for assistant to finish");
     return;
    }
    BargeInController.interrupt();
    setTimeout(() => App.send(turn), 180);
   } else {
    App.send(turn);
   }
  }, 1100);
 },
 speak(text) {
  const cleanText = MarkdownParser.plain(text).trim();
  if (state.muted || !cleanText || !("speechSynthesis" in window)) return;

  const u = new SpeechSynthesisUtterance(cleanText);
  const v = this.voices().find(x => x.name === state.prefs.voice);
  if (v) u.voice = v;
  u.rate = Number(state.prefs.speechRate) || 1;

  // Keep a rolling 800-char history of spoken text so multi-sentence replies don't overwrite each other
  state.lastSpoken = ((state.lastSpoken || "") + " " + cleanText).slice(-800);
  state.echoGuardUntil = Date.now() + Math.max(3500, cleanText.length * 90);

  u.onstart = () => {
   state.speaking = true;
   UIRenderer.pill("Speaking");
  };
  const finishUtterance = () => {
   // Only clear speaking state when the entire TTS queue has finished
   if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
    state.speaking = false;
    state.echoGuardUntil = Date.now() + 1200; // 1.2s cooldown for trailing room echo & STT buffer flush
    if (!state.generating) UIRenderer.pill("");
   }
  };
  u.onend = finishUtterance;
  u.onerror = finishUtterance;
  speechSynthesis.speak(u);
 },
 flushTTS(full) {
  const parts = full.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const speakable = parts.slice(0, -1).join(" ");
  if (speakable) {
   this.speak(speakable);
   return parts[parts.length - 1];
  }
  return full;
 },
 nativeSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
 startNative(continuous) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { UIRenderer.toast("Native speech recognition unavailable; use Vosk"); return false; }
  this.stop();
  const r = new SR();
  state.recognition = r;
  r.continuous = continuous;
  r.interimResults = true;
  r.lang = navigator.language || "en-US";

  r.onresult = e => {
   let interim = "", final = "";
   for (let i = e.resultIndex; i < e.results.length; i++) {
    const res = e.results[i];
    if (res.isFinal) final += res[0].transcript;
    else interim += res[0].transcript;
   }

   const guardActive = SpeechEngine.isEchoGuardActive();

   // While AI is speaking (or within the 1.2s echo cooldown):
   if (guardActive) {
    $("prompt").value = "";
    const candidate = (final || interim).trim();
    if (!candidate) return;

    // Always allow explicit stop commands (e.g., "stop", "quiet")
    if (BargeInController.isStopCommand(candidate)) {
     BargeInController.interrupt();
     UIRenderer.toast("Interrupted");
     return;
    }

    // If autoBargeIn is OFF, or if the words match what the AI is saying, drop completely
    if (!state.prefs.autoBargeIn || SpeechEngine.isEcho(candidate)) {
     return;
    }

    // Only allow barge-in on a finalized non-echo phrase of 2+ words
    if (final && candidate.split(/\s+/).length >= 2) {
     BargeInController.interrupt();
     SpeechEngine.queueTurn(candidate);
    }
    return;
   }

   // Normal listening state (AI is silent)
   if (interim) {
    $("prompt").value = interim;
    if (state.prefs.autoBargeIn && state.generating && !SpeechEngine.isEcho(interim) && interim.trim().split(/\s+/).length >= 2) {
     BargeInController.interrupt();
    }
   }
   if (final) {
    const text = final.trim();
    $("prompt").value = "";
    if (!text) return;
    if (BargeInController.isStopCommand(text)) {
     BargeInController.interrupt();
     UIRenderer.toast("Interrupted");
     return;
    }
    if (SpeechEngine.isEcho(text)) {
     UIRenderer.toast("Ignored possible microphone echo");
     return;
    }
    SpeechEngine.queueTurn(text);
   }
  };

  r.onerror = e => { if (e.error !== "no-speech") UIRenderer.toast("Mic error: " + e.error); };
  r.onend = () => {
   if (state.continuous) setTimeout(() => { try { r.start(); } catch (e) {} }, 150);
   else { state.listening = false; UIRenderer.pill(""); $("wave").classList.add("off"); }
  };
  try {
   r.start();
   state.listening = true;
   UIRenderer.pill(continuous ? "Listening continuously" : "Listening");
   $("wave").classList.remove("off");
   return true;
  } catch (e) {
   UIRenderer.toast("Could not start microphone");
   return false;
  }
 },
 async startVosk(continuous) {
  if (typeof Vosk === "undefined") {
   try {
    await new Promise((res, rej) => {
     const s = document.createElement("script");
     s.src = "./vosk.js";
     s.onload = res;
     s.onerror = rej;
     document.head.appendChild(s);
    });
   } catch (e) {
    UIRenderer.toast("Load local vosk.js beside index.html, then select a model .zip");
    return false;
   }
  }
  if (!state.voskModel) {
   UIRenderer.toast("Choose a local Vosk model .zip in Settings");
   return false;
  }
  try {
   if (!state.vosk) {
    const model = await Vosk.createModel(state.voskModel);
    state.vosk = model;
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = state.audioContext.createMediaStreamSource(stream);
    state.processor = state.audioContext.createScriptProcessor(4096, 1, 1);
    state.voskRecognizer = new model.KaldiRecognizer(16000);

    state.voskRecognizer.on("result", e => {
     const text = (e.result?.text || "").trim();
     if (!text) return;
     if (BargeInController.isStopCommand(text)) {
      BargeInController.interrupt();
      UIRenderer.toast("Interrupted");
      return;
     }
     if (SpeechEngine.isEcho(text)) {
      UIRenderer.toast("Ignored possible microphone echo");
      return;
     }
     if (SpeechEngine.isEchoGuardActive() && !state.prefs.autoBargeIn) return;
     SpeechEngine.queueTurn(text);
    });

    state.voskRecognizer.on("partialresult", e => {
     const t = (e.result?.partial || "").trim();
     if (SpeechEngine.isEchoGuardActive()) {
      $("prompt").value = "";
      if (t && BargeInController.isStopCommand(t)) {
       BargeInController.interrupt();
       UIRenderer.toast("Interrupted");
      }
      return;
     }
     $("prompt").value = t;
     if (t && state.prefs.autoBargeIn && state.generating && !SpeechEngine.isEcho(t)) {
      BargeInController.interrupt();
     }
    });

    // Gate raw audio frames sent to Vosk if echo guard is active and autoBargeIn is disabled
    state.processor.onaudioprocess = ev => {
     if (SpeechEngine.isEchoGuardActive() && !state.prefs.autoBargeIn) return;
     try { state.voskRecognizer.acceptWaveform(ev.inputBuffer); } catch (e) {}
    };
    source.connect(state.processor);
    state.processor.connect(state.audioContext.destination);
   }
   state.listening = true;
   state.continuous = continuous;
   UIRenderer.pill(continuous ? "Listening continuously" : "Listening");
   $("wave").classList.remove("off");
   return true;
  } catch (e) {
   UIRenderer.toast("Vosk initialization failed");
   return false;
  }
 },
 stop(){
  try{state.recognition?.stop()}catch(e){}
  try{state.voskRecognizer?.removeAllListeners?.()}catch(e){}
  state.listening=false;state.continuous=false;UIRenderer.pill("");$("wave").classList.add("off");
 }
};
const App={
 async refreshModels(){
  UIRenderer.status("warn","Connecting…");
  try{
   const models=await APIClient.models();const sel=$("modelSelect");sel.innerHTML="";
   if(!models.length){sel.innerHTML='<option value="">No models found</option>'}
   models.forEach(m=>{const o=document.createElement("option");o.value=m;o.textContent=m;sel.appendChild(o)});
   if(state.prefs.model&&models.includes(state.prefs.model))sel.value=state.prefs.model;
   else if(models[0]){sel.value=models[0];state.prefs.model=models[0];PreferencesManager.save()}
   UIRenderer.status("ok","Connected");
  }catch(e){
   UIRenderer.status("danger","Disconnected");$("corsTip").style.display="block";
  }
 },
 async send(text){
  text=(text||$("prompt").value).trim();if(!text||state.generating)return;
  if(!state.prefs.model){UIRenderer.toast("Select a model first");return}
  $("prompt").value="";state.messages.push({role:"user",content:text});
  const userEl=UIRenderer.add("user",text);
  const aiEl=UIRenderer.add("assistant","");
  state.generating=true;UIRenderer.pill("Thinking");UIRenderer.badge();
  let full="",pending="";
  try{
   await APIClient.stream(ContextManager.trim(Number(state.prefs.contextSize)||4096),tok=>{
    full+=tok;pending+=tok;pending=SpeechEngine.flushTTS(pending);UIRenderer.update(aiEl,full);
   });
   if(pending.trim())SpeechEngine.speak(pending);
   state.messages.push({role:"assistant",content:full});
  }catch(e){
   if(e.name!=="AbortError"){UIRenderer.update(aiEl,full+"\n\n**Error:** "+e.message);UIRenderer.toast("Request failed")}
  }finally{
   state.generating=false;state.abortController=null;UIRenderer.pill(state.speaking?"Speaking":"");UIRenderer.badge();
  }
 },
 applyTheme(){
  const themes={
   midnight:{"--bg-primary":"#0b0f17","--text-primary":"#e8edf7","--accent":"#5b8cff"},
   oled:{"--bg-primary":"#000000","--text-primary":"#f2f2f2","--accent":"#8f7bff"},
   slate:{"--bg-primary":"#eef1f6","--text-primary":"#18202c","--accent":"#2f6bff"},
   terminal:{"--bg-primary":"#04120a","--text-primary":"#c9ffd8","--accent":"#22c55e"}
  };
  const t=themes[state.prefs.theme]||themes.midnight;
  Object.entries(t).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
  document.documentElement.style.setProperty("--bg-primary",state.prefs.bgColor||t["--bg-primary"]);
  $("bgLayer").style.backgroundImage=state.prefs.bgImage?'url("'+state.prefs.bgImage+'")':"none";
 },
 bind(){
  const save=()=>{PreferencesManager.save();App.applyTheme();UIRenderer.badge()};
  $("provider").onchange=e=>{state.prefs.provider=e.target.value;state.prefs.baseUrl=e.target.value==="ollama"?"http://localhost:11434":"http://localhost:1234";$("baseUrl").value=state.prefs.baseUrl;save();App.refreshModels()};
  $("modelSelect").onchange=e=>{state.prefs.model=e.target.value;save()};
  $("baseUrl").onchange=e=>{state.prefs.baseUrl=e.target.value.trim();save();App.refreshModels()};
  $("temperature").oninput=e=>{state.prefs.temperature=Number(e.target.value);$("tempVal").textContent=Number(e.target.value).toFixed(2)+"x";save()};
  $("contextSize").onchange=e=>{if(e.target.value==="custom"){$("customContext").style.display="block"}else{state.prefs.contextSize=Number(e.target.value);$("customContext").style.display="none";save()}};
  $("customContext").oninput=e=>{state.prefs.contextSize=Number(e.target.value)||4096;save()};
  $("systemPrompt").oninput=e=>{state.prefs.systemPrompt=e.target.value;save();UIRenderer.badge()};
  document.querySelectorAll("[data-persona]").forEach(b=>b.onclick=()=>{state.prefs.systemPrompt=b.dataset.persona;$("systemPrompt").value=b.dataset.persona;save();UIRenderer.badge()});
  $("sttEngine").onchange=e=>{state.prefs.sttEngine=e.target.value;save()};
  $("voskModel").onchange=e=>{state.voskModel=e.target.files[0];state.prefs.voskModelName=state.voskModel?.name||"";save();UIRenderer.toast("Vosk model selected")};
  $("voiceSelect").onchange=e=>{state.prefs.voice=e.target.value;save()};
  $("speechRate").oninput=e=>{state.prefs.speechRate=Number(e.target.value);$("rateVal").textContent=Number(e.target.value).toFixed(2)+"x";save()};
  $("autoBargeIn").onchange=e=>{state.prefs.autoBargeIn=e.target.checked;save()};
  $("stopCommands").oninput=e=>{state.prefs.stopCommands=e.target.value;save()};
  $("theme").onchange=e=>{state.prefs.theme=e.target.value;save()};
  $("bgColor").oninput=e=>{state.prefs.bgColor=e.target.value;save()};
  $("bgImage").onchange=e=>{state.prefs.bgImage=e.target.value.trim();save()};
  $("resetPrefs").onclick=()=>PreferencesManager.reset();
  $("settingsBtn").onclick=()=>$("drawer").classList.add("open");
  $("closeSettings").onclick=$("drawerScrim").onclick=()=>$("drawer").classList.remove("open");
  $("sendBtn").onclick=()=>App.send();
  $("prompt").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();App.send()}};
  $("prompt").oninput=e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,150)+"px"};
  $("stopBtn").onclick=()=>BargeInController.interrupt();
  $("muteBtn").onclick=()=>{state.muted=!state.muted;if(state.muted)speechSynthesis.cancel();$("muteBtn").textContent=state.muted?"🔇":"🔊";UIRenderer.toast(state.muted?"AI voice muted":"AI voice unmuted")};
  $("micBtn").onclick=()=>{
   if(state.listening){SpeechEngine.stop();return}
   const ok=state.prefs.sttEngine==="vosk"?SpeechEngine.startVosk(false):SpeechEngine.startNative(false);
   if(!ok&&state.prefs.sttEngine==="native")UIRenderer.toast("Switch to Offline Vosk-Browser in Settings");
  };
  $("continuousBtn").onclick=()=>{
   if(state.continuous){SpeechEngine.stop();return}
   const ok=state.prefs.sttEngine==="vosk"?SpeechEngine.startVosk(true):SpeechEngine.startNative(true);
   if(ok)UIRenderer.toast("Hands-free mode on — use headphones");
  };
  window.addEventListener("beforeunload",()=>{try{state.recognition?.stop()}catch(e){}speechSynthesis.cancel()});
 }
};
PreferencesManager.load();
const p=state.prefs;
$("provider").value=p.provider;$("baseUrl").value=p.baseUrl;$("temperature").value=p.temperature;$("tempVal").textContent=Number(p.temperature).toFixed(2)+"x";
$("contextSize").value=[2048,4096,8192,16384,32768].includes(String(p.contextSize))?String(p.contextSize):"custom";
if($("contextSize").value==="custom"){$("customContext").style.display="block";$("customContext").value=p.contextSize}
$("systemPrompt").value=p.systemPrompt;$("sttEngine").value=p.sttEngine;$("speechRate").value=p.speechRate;$("rateVal").textContent=Number(p.speechRate).toFixed(2)+"x";
$("autoBargeIn").checked=p.autoBargeIn;$("stopCommands").value=p.stopCommands;$("theme").value=p.theme;$("bgColor").value=p.bgColor;$("bgImage").value=p.bgImage;
App.applyTheme();UIRenderer.badge();App.bind();App.refreshModels();
if("speechSynthesis" in window){SpeechEngine.populateVoices();speechSynthesis.onvoiceschanged=()=>SpeechEngine.populateVoices()}
if(!SpeechEngine.nativeSupported())UIRenderer.toast("Native STT unavailable in this browser — use Offline Vosk-Browser");
