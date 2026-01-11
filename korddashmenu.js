const fs=require("fs"),path=require("path"),os=require("os");
const {kord,wtype,config,prefix,commands,secondsToHms}=require("../core");

let Canvas=null; try{Canvas=require("canvas")}catch{}
let si=null; try{si=require("systeminformation")}catch{}
let prettyBytes=null; try{prettyBytes=require("pretty-bytes")}catch{}

const ROOT="/home/container";
const DIR=path.join(ROOT,"cmds",".korddash");
const DB=path.join(DIR,"db.json");

function ensureDB(){ if(!fs.existsSync(DIR)) fs.mkdirSync(DIR,{recursive:true});
  if(!fs.existsSync(DB)) fs.writeFileSync(DB,JSON.stringify({users:{}},null,2));
}
function readDB(){ ensureDB(); try{return JSON.parse(fs.readFileSync(DB,"utf8"))}catch{return {users:{}}} }
function writeDB(d){ ensureDB(); fs.writeFileSync(DB,JSON.stringify(d,null,2)); }

function getCfg(){ try{ if(typeof config==="function") return config()||{} }catch{} try{return config||{}}catch{return {}} }
function getVar(n,f=""){ const e=process.env?.[n]; if(e!=null){const s=String(e).trim(); if(s) return s;}
  const c=getCfg(); const v=c?.[n]; if(v!=null){const s=String(v).trim(); if(s) return s;} return f;
}
function SAFE_PREFIX(){ const e=process.env.PREFIX; if(e&&String(e).trim()) return String(e).trim();
  if(typeof prefix==="string"&&prefix.trim()) return prefix.trim(); return ".";
}
function sid(m){ return m?.sender||m?.key?.participant||m?.participant||m?.key?.remoteJid||"unknown"; }
function cid(m){ return m?.key?.remoteJid||m?.chat||"unknown"; }

function isAllowed(m){
  if(m?.fromMe||m?.isOwner||m?.isSudo||m?.isMod) return true;
  const c=getCfg(); const sudoRaw=c?.SUDO||c?.SUDO_USERS||c?.SUDOS; const s=sid(m);
  if(sudoRaw&&s){ const list=Array.isArray(sudoRaw)?sudoRaw:String(sudoRaw).split(",").map(x=>x.trim()).filter(Boolean);
    if(list.includes(s)) return true;
  }
  return false;
}

const THEMES={
  neon:{neon:"#27ff9a",dim:"#eafff6",border:"#1ccf7b",panel:"rgba(6,24,15,.72)"},
  ice:{neon:"#7df3ff",dim:"#e8fbff",border:"#3ad7ff",panel:"rgba(6,16,24,.72)"},
  hacker:{neon:"#00ff66",dim:"#d8ffe9",border:"#00cc55",panel:"rgba(0,14,6,.78)"},
  sunset:{neon:"#ff8a3d",dim:"#fff0e6",border:"#ff5f2e",panel:"rgba(24,10,6,.74)"},
  purple:{neon:"#c77dff",dim:"#f4eaff",border:"#8a2be2",panel:"rgba(16,6,24,.74)"},
  gold:{neon:"#ffd166",dim:"#fff7df",border:"#ffb703",panel:"rgba(24,18,6,.74)"},
};
const DEFAULT_BG="https://cdn.kord.live/serve/C9Lt7Cr94t3q.jpg";
function DASH_THEME(){ return getVar("DASH_THEME","neon").toLowerCase(); }
function THEME(){ return THEMES[DASH_THEME()]||THEMES.neon; }
function DASH_BG(){ return getVar("DASH_BG",getVar("MENU_IMAGE",""))||DEFAULT_BG; }
function DASH_FOOTER(){ return getVar("DASH_FOOTER","KORD"); }
function DASH_NAME(){
  const c=getCfg(); const bot=String(c?.BOT_NAME||"KORD").trim()||"KORD";
  return getVar("DASH_NAME","Kord Dashboard")||bot;
}

const https=require("https"),http=require("http");
function fetchBuffer(url){
  return new Promise((resolve,reject)=>{
    const lib=url.startsWith("https")?https:http;
    lib.get(url,res=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location) return resolve(fetchBuffer(res.headers.location));
      if(res.statusCode!==200){ res.resume(); return reject(new Error("HTTP "+res.statusCode)); }
      const chunks=[]; res.on("data",d=>chunks.push(d)); res.on("end",()=>resolve(Buffer.concat(chunks)));
    }).on("error",reject);
  });
}
function bar(p,width=18){
  const x=Math.max(0,Math.min(100,Math.round(p||0)));
  const f=Math.round((x/100)*width);
  return "["+"█".repeat(f)+"░".repeat(Math.max(0,width-f))+`] ${x}%`;
}

async function makeCard({title,lines=[],footer=""}){
  if(!Canvas) return null;
  const {createCanvas,loadImage}=Canvas; const t=THEME();
  const W=900,pad=40,lineH=34,titleH=62,footH=46;
  const H=pad+titleH+20+lines.length*lineH+20+footH+pad;
  const canv=createCanvas(W,H); const ctx=canv.getContext("2d");

  try{
    const bg=await fetchBuffer(DASH_BG()); const img=await loadImage(bg);
    const sc=Math.max(W/img.width,H/img.height);
    const w=img.width*sc,h=img.height*sc,x=(W-w)/2,y=(H-h)/2;
    ctx.drawImage(img,x,y,w,h);
  }catch{ ctx.fillStyle="#06130d"; ctx.fillRect(0,0,W,H); }

  ctx.fillStyle="rgba(0,0,0,.55)"; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle=t.border; ctx.lineWidth=3; ctx.strokeRect(18,18,W-36,H-36);
  ctx.fillStyle=t.panel; ctx.fillRect(30,30,W-60,H-60);

  ctx.globalAlpha=.08; ctx.fillStyle="#fff";
  for(let y=0;y<H;y+=6) ctx.fillRect(0,y,W,1);
  ctx.globalAlpha=1;

  ctx.font="bold 38px Sans"; ctx.fillStyle=t.neon; ctx.fillText(title,pad,pad+42);

  ctx.strokeStyle=t.border; ctx.lineWidth=2; ctx.beginPath();
  ctx.moveTo(pad,pad+62); ctx.lineTo(W-pad,pad+62); ctx.stroke();

  ctx.font="24px Sans"; ctx.fillStyle=t.dim; let y=pad+62+40;
  for(const ln of lines){ ctx.fillText(String(ln),pad,y); y+=lineH; }

  ctx.font="22px Sans"; ctx.fillStyle=t.neon;
  ctx.fillText(footer||DASH_FOOTER(),pad,H-pad);

  return canv.toBuffer("image/png");
}

async function sendImage(m,buf,cap=""){
  try{ if(typeof m.send==="function") return await m.send(buf,{caption:cap},"image"); }catch{}
  try{ if(m?.client?.sendMessage) return await m.client.sendMessage(cid(m),{image:buf,caption:cap},{quoted:m}); }catch{}
  return m.reply?m.reply(cap||"OK"):null;
}
async function safeReact(m,e){
  try{ if(typeof m.react==="function") return await m.react(e); }catch{}
  try{ if(typeof m.reaction==="function") return await m.reaction(e); }catch{}
  try{ if(typeof m.sendReaction==="function") return await m.sendReaction(e); }catch{}
}

function uniqSort(a){ return [...new Set(a)].sort((x,y)=>x.localeCompare(y)); }
function buildCats(){
  const cats={};
  for(const c of commands||[]){
    if(!c?.cmd) continue;
    const primary=String(c.cmd).split("|")[0]?.trim(); if(!primary) continue;
    const type=String(c.type||"other").toLowerCase();
    (cats[type]=cats[type]||[]).push(primary);
  }
  for(const k of Object.keys(cats)) cats[k]=uniqSort(cats[k]);
  return cats;
}
function chunk(a,n){ const out=[]; for(let i=0;i<a.length;i+=n) out.push(a.slice(i,i+n)); return out; }
function normCmd(t){ return String(t||"").trim().replace(/^[.!/]/,""); }

function userKey(m){ return sid(m); }
function getUserDB(m){
  const db=readDB(); db.users=db.users||{};
  const k=userKey(m); db.users[k]=db.users[k]||{fav:[],recent:[]};
  return {db,k};
}
function addRecent(m,cmd){
  try{
    const {db,k}=getUserDB(m);
    const r=db.users[k].recent||[]; const c=String(cmd||"").trim(); if(!c) return;
    db.users[k].recent=[c,...r.filter(x=>x!==c)].slice(0,20);
    writeDB(db);
  }catch{}
}
function addFav(m,cmd){
  const {db,k}=getUserDB(m);
  const fav=db.users[k].fav||[]; const c=String(cmd||"").trim(); if(!c) return {ok:false,msg:"Missing cmd"};
  if(fav.includes(c)) return {ok:false,msg:"Already in favorites"};
  db.users[k].fav=[...fav,c].slice(0,50); writeDB(db); return {ok:true};
}
function delFav(m,cmd){
  const {db,k}=getUserDB(m);
  const c=String(cmd||"").trim(); db.users[k].fav=(db.users[k].fav||[]).filter(x=>x!==c);
  writeDB(db); return {ok:true};
}
function listFav(m){ const {db,k}=getUserDB(m); return db.users[k].fav||[]; }
function listRecent(m){ const {db,k}=getUserDB(m); return db.users[k].recent||[]; }

const SESS=new Map(); const TTL=3*60*1000;
function skey(m){ return `${cid(m)}::${sid(m)}`; }
function setSess(m,d){ SESS.set(skey(m),{...d,ts:Date.now()}); }
function getSess(m){
  const k=skey(m),s=SESS.get(k); if(!s) return null;
  if(Date.now()-s.ts>TTL){ SESS.delete(k); return null; }
  s.ts=Date.now(); SESS.set(k,s); return s;
}
function clearSess(m){ SESS.delete(skey(m)); }

async function getStats(){
  const up=await secondsToHms(process.uptime());
  const total=Array.isArray(commands)?commands.length:0;
  let memPct=0,memText="",cpuPct=0,diskPct=0,diskText="";
  try{
    if(si){
      const [mem,load,disks]=await Promise.all([si.mem(),si.currentLoad(),si.fsSize().catch(()=>[])]);
      memPct=mem.total?Math.round((mem.used/mem.total)*100):0;
      cpuPct=Math.round(load.currentLoad||0);
      memText=prettyBytes?`${prettyBytes(mem.used)} / ${prettyBytes(mem.total)}`:`${Math.round(mem.used/1024/1024)}MB / ${Math.round(mem.total/1024/1024)}MB`;
      if(disks&&disks.length){
        const best=disks.sort((a,b)=>(b.size||0)-(a.size||0))[0];
        diskPct=Math.round(best.use||0);
        diskText=prettyBytes?`${prettyBytes(best.used||0)} / ${prettyBytes(best.size||0)}`:`${Math.round((best.used||0)/1024/1024)}MB / ${Math.round((best.size||0)/1024/1024)}MB`;
      }
    }else{
      const rss=process.memoryUsage().rss;
      memText=`${Math.round(rss/1024/1024)}MB`;
    }
  }catch{}
  return {up,total,memPct,memText,cpuPct,diskPct,diskText};
}

async function showDash(m){
  const c=getCfg(),pfx=SAFE_PREFIX();
  const owner=String(c?.OWNER_NAME||"Not Set").trim()||"Not Set";
  const host=String(c?.client?.platform||"Panel").trim()||"Panel";
  const mode=String(c?.MODE||c?.BOT_MODE||"Public").trim()||"Public";
  const ver=String(c?.VERSION||c?.BOT_VERSION||"1.0.0").trim()||"1.0.0";
  const st=await getStats();

  const lines=[
    `Owner   : ${owner}`,
    `Prefix  : [ ${pfx} ]`,
    `Host    : ${host}`,
    `Plugins : ${st.total}`,
    `Mode    : ${mode}`,
    `Version : ${ver}`,
    `Uptime  : ${st.up}`,
    "",
    `CPU     : ${bar(st.cpuPct)}`,
    `RAM     : ${bar(st.memPct)}  ${st.memText}`.trim(),
    st.diskText?`Disk    : ${bar(st.diskPct)}  ${st.diskText}`:`Disk    : ${bar(st.diskPct)}`,
    "",
    "Reply:",
    "search <word>",
    "categories",
    "fav",
    "recent",
    "config",
    "close",
  ];

  const img=await makeCard({title:DASH_NAME().toUpperCase(),lines,footer:DASH_FOOTER()});
  setSess(m,{mode:"main",page:0});
  await safeReact(m,"📊");
  if(!img) return m.reply?m.reply(lines.join("\n")):null;
  return sendImage(m,img,"Reply: search <word> / categories / fav / recent / config / close");
}

async function showConfig(m){
  const pfx=SAFE_PREFIX();
  const lines=[
    `DASH_NAME  : ${DASH_NAME()}`,
    `DASH_THEME : ${DASH_THEME()}`,
    `DASH_BG    : ${DASH_BG()?"SET":"DEFAULT"}`,
    `DASH_FOOTER: ${DASH_FOOTER()}`,
    "",
    "Setvars:",
    `${pfx}setvar DASH_NAME=Kord Dashboard`,
    `${pfx}setvar DASH_THEME=gold`,
    `${pfx}setvar DASH_BG=https://...jpg`,
    `${pfx}setvar DASH_FOOTER=KORD`,
    "",
    "Reply: home / close",
  ];
  const img=await makeCard({title:"CONFIG",lines,footer:DASH_FOOTER()});
  setSess(m,{mode:"config"});
  await safeReact(m,"⚙️");
  if(!img) return m.reply?m.reply(lines.join("\n")):null;
  return sendImage(m,img,"Reply: home / close");
}
async function showCats(m,page=0){
  const cats=buildCats();
  const keys=Object.keys(cats).sort((a,b)=>a.localeCompare(b));
  const pages=chunk(keys,14);
  const p=Math.max(0,Math.min(page,Math.max(0,pages.length-1)));
  const list=pages[p]||[];

  const lines=[
    "Reply category name to open",
    "",
    ...list.map((k,i)=>{
      const n=String(p*14+i+1).padStart(2,"0");
      const c=String((cats[k]||[]).length).padStart(2,"0");
      return `${n}) ${k} (${c})`;
    }),
    "",
    `Page: ${p+1}/${Math.max(1,pages.length)}`,
    "Controls: next / back / home / close",
  ];

  const img=await makeCard({title:"CATEGORIES",lines,footer:DASH_FOOTER()});
  setSess(m,{mode:"cats",page:p});
  await safeReact(m,"📚");
  if(!img) return m.reply?m.reply(lines.join("\n")):null;
  return sendImage(m,img,"Reply: category name, next/back/home/close");
}

async function showCatCmds(m,catName,page=0){
  const cats=buildCats();
  const keys=Object.keys(cats).sort((a,b)=>a.localeCompare(b));
  const found=keys.find(k=>k.toLowerCase()===String(catName).toLowerCase());

  if(!found){
    const img=await makeCard({title:"NOT FOUND",lines:["Category not found:",String(catName),"","Reply: categories / home / close"],footer:DASH_FOOTER()});
    setSess(m,{mode:"cats",page:0});
    await safeReact(m,"⚠️");
    return img?sendImage(m,img,"Reply: categories / home / close"):(m.reply?m.reply("Category not found"):null);
  }

  const all=cats[found]||[];
  const pages=chunk(all,20);
  const p=Math.max(0,Math.min(page,Math.max(0,pages.length-1)));
  const list=pages[p]||[];
  const pfx=SAFE_PREFIX();

  const lines=[
    `Category: ${found.toUpperCase()}`,
    `Total   : ${all.length}`,
    "",
    ...list.map((c,i)=>`${String(p*20+i+1).padStart(2,"0")}) ${pfx}${c}`),
    "",
    `Page: ${p+1}/${Math.max(1,pages.length)}`,
    "Controls: next / back / categories / home / close",
    "",
    "Tip: use kdfav add <cmd>",
  ];

  const img=await makeCard({title:"COMMANDS",lines,footer:DASH_FOOTER()});
  setSess(m,{mode:"catcmds",cat:found,page:p});
  await safeReact(m,"🧩");
  if(!img) return m.reply?m.reply(lines.join("\n")):null;
  return sendImage(m,img,`Opened ${found}. Reply: next/back/categories/home/close`);
}

async function showSearch(m,q,page=0){
  const query=String(q||"").trim().toLowerCase();
  const pfx=SAFE_PREFIX();
  const all=[];
  for(const c of commands||[]){
    if(!c?.cmd) continue;
    const cmd=String(c.cmd).split("|")[0]?.trim(); if(!cmd) continue;
    const type=String(c.type||"other").toLowerCase();
    all.push({cmd,type});
  }
  const hits=all.filter(x=>x.cmd.toLowerCase().includes(query)||x.type.includes(query)).slice(0,200);
  const pages=chunk(hits,18);
  const p=Math.max(0,Math.min(page,Math.max(0,pages.length-1)));
  const list=pages[p]||[];

  const lines=[
    `Search: ${query||"-"}`,
    `Found : ${hits.length}`,
    "",
    ...list.map((x,i)=>`${String(p*18+i+1).padStart(2,"0")}) ${pfx}${x.cmd} (${x.type})`),
    "",
    `Page: ${p+1}/${Math.max(1,pages.length)}`,
    "Controls: next / back / home / close",
  ];

  const img=await makeCard({title:"SEARCH",lines,footer:DASH_FOOTER()});
  setSess(m,{mode:"search",q:query,page:p});
  await safeReact(m,"🔎");
  if(!img) return m.reply?m.reply(lines.join("\n")):null;
  return sendImage(m,img,"Reply: next/back/home/close");
}

async function showFav(m){
  const pfx=SAFE_PREFIX();
  const fav=listFav(m);
  const lines=[
    "Favorites",
    "",
    ...(fav.length?fav.map((c,i)=>`${String(i+1).padStart(2,"0")}) ${pfx}${c}`):["(none)"]),
    "",
    "Commands:",
    `kdfav add <cmd>`,
    `kdfav del <cmd>`,
    "Reply: home / close",
  ];
  const img=await makeCard({title:"FAVORITES",lines,footer:DASH_FOOTER()});
  setSess(m,{mode:"fav"});
  await safeReact(m,"⭐");
  if(!img) return m.reply?m.reply(lines.join("\n")):null;
  return sendImage(m,img,"Reply: home / close");
}

async function showRecent(m){
  const pfx=SAFE_PREFIX();
  const rec=listRecent(m);
  const lines=[
    "Recent Commands",
    "",
    ...(rec.length?rec.map((c,i)=>`${String(i+1).padStart(2,"0")}) ${pfx}${c}`):["(none)"]),
    "",
    "Reply: home / close",
  ];
  const img=await makeCard({title:"RECENT",lines,footer:DASH_FOOTER()});
  setSess(m,{mode:"recent"});
  await safeReact(m,"🕘");
  if(!img) return m.reply?m.reply(lines.join("\n")):null;
  return sendImage(m,img,"Reply: home / close");
}

kord({cmd:"korddash|dashboard|kdash",desc:"Open Kord Dashboard",fromMe:wtype,type:"help",react:"📊"},async(m)=>{
  try{ if(!isAllowed(m)) return; return await showDash(m); }
  catch(e){ return m.reply?m.reply("❌ dashboard failed: "+(e?.message||e)):null; }
});

kord({cmd:"kdcancel",desc:"Close dashboard session",fromMe:wtype,type:"help",react:"❌"},async(m)=>{
  if(!isAllowed(m)) return;
  clearSess(m); await safeReact(m,"❌");
  return m.reply?m.reply("✅ Dashboard closed."):null;
});

kord({cmd:"kdfav",desc:"Manage dashboard favorites",fromMe:wtype,type:"tools",react:"⭐"},async(m,text)=>{
  if(!isAllowed(m)) return;
  const pfx=SAFE_PREFIX();
  const raw=String(text||"").trim();
  const args=raw.split(/\s+/).filter(Boolean);
  const sub=(args[0]||"").toLowerCase();
  const name=normCmd(args.slice(1).join(" "));
  if(!sub||sub==="help") return m.reply?m.reply(`⭐ Favorites\n• ${pfx}kdfav add <cmd>\n• ${pfx}kdfav del <cmd>\n• ${pfx}kdfav list`):null;
  if(sub==="list"){ const fav=listFav(m); return m.reply?m.reply(fav.length?("⭐ Favorites:\n"+fav.map(c=>`${pfx}${c}`).join("\n")):"⭐ Favorites: (none)"):null; }
  if(sub==="add"){ if(!name) return m.reply?m.reply(`Usage: ${pfx}kdfav add <cmd>`):null;
    const r=addFav(m,name); return m.reply?m.reply(r.ok?`✅ Added: ${pfx}${name}`:`❌ ${r.msg}`):null;
  }
  if(sub==="del"||sub==="remove"){ if(!name) return m.reply?m.reply(`Usage: ${pfx}kdfav del <cmd>`):null;
    delFav(m,name); return m.reply?m.reply(`✅ Removed: ${pfx}${name}`):null;
  }
});

kord({on:"all"},async(m,textArg)=>{
  try{
    if(!isAllowed(m)) return;
    const raw=(typeof textArg==="string"?textArg:"")||m?.message?.conversation||m?.message?.extendedTextMessage?.text||m?.text||m?.body||"";
    const text=String(raw||"").trim(); if(!text) return;

    const pfx=SAFE_PREFIX();
    if(text.startsWith(pfx)){
      const maybe=normCmd(text.slice(pfx.length).split(/\s+/)[0]);
      if(maybe) addRecent(m,maybe);
      return; // never intercept real commands
    }

    const s=getSess(m);
    if(!s) return;

    const input=text.toLowerCase();
    if(["close","exit","kdcancel","cancel"].includes(input)){
      clearSess(m); await safeReact(m,"❌");
      return m.reply?m.reply("✅ Dashboard closed."):null;
    }
    if(input==="home") return await showDash(m);

    if(s.mode==="main"){
      if(input==="categories") return await showCats(m,0);
      if(input==="config") return await showConfig(m);
      if(input==="fav") return await showFav(m);
      if(input==="recent") return await showRecent(m);
      if(input.startsWith("search ")){
        const q=text.slice(7).trim(); if(!q) return;
        return await showSearch(m,q,0);
      }
      return;
    }

    if(s.mode==="cats"){
      if(input==="next") return await showCats(m,(s.page||0)+1);
      if(input==="back") return await showCats(m,(s.page||0)-1);
      if(input==="categories") return await showCats(m,s.page||0);
      if(input==="config") return await showConfig(m);
      return await showCatCmds(m,text,0);
    }

    if(s.mode==="catcmds"){
      if(input==="next") return await showCatCmds(m,s.cat,(s.page||0)+1);
      if(input==="back") return await showCatCmds(m,s.cat,(s.page||0)-1);
      if(input==="categories") return await showCats(m,0);
      return;
    }

    if(s.mode==="search"){
      if(input==="next") return await showSearch(m,s.q,(s.page||0)+1);
      if(input==="back") return await showSearch(m,s.q,(s.page||0)-1);
      return;
    }
  }catch{}
});