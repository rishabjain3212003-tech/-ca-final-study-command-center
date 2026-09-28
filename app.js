const D = document;
const MAIN = D.querySelector("#main");
const modal = D.querySelector("#modal");
const modalBody = D.querySelector("#modalBody");
const restoreInput = D.querySelector("#restoreInput");
const fmtDate = d => new Intl.DateTimeFormat("en-IN",{day:"2-digit",month:"short",year:"numeric"}).format(d);
const fmtTime = d => new Intl.DateTimeFormat("en-IN",{hour:"numeric",minute:"2-digit"}).format(d);
const isoDate = d => new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const uid = ()=>crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

const DEFAULT_START="2026-09-24", DEFAULT_LECTURE_TARGET="2026-12-31", DEFAULT_FINAL_TARGET="2026-12-31";
const DB_NAME="ca-final-study-command-center", DB_VERSION=1;
let state=null, currentView="home", deferredInstall=null, googleToken=null, googleTokenExpiry=0;

const DEFAULT_STATE = {
  version:1,
  createdAt:Date.now(),
  settings:{
    timezone:"Asia/Kolkata", officialStart:DEFAULT_START, lectureTarget:DEFAULT_LECTURE_TARGET, syllabusTarget:DEFAULT_FINAL_TARGET, examDate:"",
    maxDailyHours:10,minBreakMin:20,weeklyBufferDay:"Saturday",weeklyReviewDay:"Sunday",
    dailyPlanEnabled:true, googleClientId:"",
    studyCalendarId:"",lastCalendarSync:0,lastCloudBackup:0,driveBackupFileId:"",
    reminders:{lecture:10,test:30,revision:10,weekly:30}
  },
  subjects:[
    {code:"FR",name:"Financial Reporting",faculty:"",total:null,completed:60,duration:120,chapters:0,chaptersCompleted:0,questions:0,revision:"Not Started",test:"Not Started"},
    {code:"AFM",name:"Advanced Financial Management",faculty:"",total:null,completed:0,duration:120,chapters:0,chaptersCompleted:0,questions:0,revision:"Not Started",test:"Not Started"},
    {code:"DT",name:"Direct Tax",faculty:"BB Sir",total:85,completed:0,duration:120,chapters:0,chaptersCompleted:0,questions:0,revision:"Not Started",test:"Not Started"},
    {code:"GST",name:"GST / IDT",faculty:"Vishal Bhattad Sir",total:50,completed:0,duration:90,chapters:0,chaptersCompleted:0,questions:0,revision:"Not Started",test:"Not Started"},
    {code:"AUDIT",name:"Audit",faculty:"Rishabh Jain Sir",total:80,completed:0,duration:90,chapters:0,chaptersCompleted:0,questions:0,revision:"Not Started",test:"Not Started"}
  ],
  studyBlocks:[
    {name:"Morning",start:"06:30",end:"08:30",prefs:["AFM","FR"]},
    {name:"Late Morning",start:"11:00",end:"13:30",prefs:["FR","AFM","QUESTION"]},
    {name:"Afternoon",start:"14:00",end:"16:30",prefs:["DT","GST"]},
    {name:"Evening",start:"17:30",end:"19:30",prefs:["AUDIT"]},
    {name:"Night",start:"21:00",end:"22:30",prefs:["REVISION","QUESTION","WEEKLY","RTP_MTP"]}
  ],
  tasks:[],
  busyEvents:[],
  metadata:{lastSaved:0,lastSnapshot:0}
};

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if(!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots",{keyPath:"id",autoIncrement:true});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function idbGet(store,key){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(store,"readonly"),r=tx.objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbPut(store,val,key){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(store,"readwrite"),r=key===undefined?tx.objectStore(store).put(val):tx.objectStore(store).put(val,key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbAll(store){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(store,"readonly"),r=tx.objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbDelete(store,key){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(store,"readwrite"),r=tx.objectStore(store).delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

function deepClone(x){return JSON.parse(JSON.stringify(x))}
async function loadState(){
  const saved=await idbGet("kv","state");
  state=saved||deepClone(DEFAULT_STATE);
  if(!state.settings.officialStart) state.settings.officialStart=DEFAULT_START;
  if(!state.settings.lectureTarget) state.settings.lectureTarget=DEFAULT_LECTURE_TARGET;
  if(!state.settings.syllabusTarget) state.settings.syllabusTarget=DEFAULT_FINAL_TARGET;
  if(state.settings.examDate===undefined) state.settings.examDate="";
  return state;
}
let saveTimer=null;
async function saveState({snapshot=false,cloud=true}={}){
  state.metadata.lastSaved=Date.now();
  await idbPut("kv",state,"state");
  const dueSnapshot = snapshot || !state.metadata.lastSnapshot || Date.now()-state.metadata.lastSnapshot>60*60*1000;
  if(dueSnapshot){
    const snap=deepClone(state); snap.snapshotAt=Date.now();
    await idbPut("snapshots",snap);
    state.metadata.lastSnapshot=Date.now();
    await idbPut("kv",state,"state");
    const all=await idbAll("snapshots");
    if(all.length>30){
      for(const x of all.sort((a,b)=>(a.snapshotAt||0)-(b.snapshotAt||0)).slice(0,all.length-30)) await idbDelete("snapshots",x.id);
    }
  }
  if(cloud && googleToken && Date.now()<googleTokenExpiry-60000 && Date.now()-(state.settings.lastCloudBackup||0)>30*60*1000){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>cloudBackup().catch(()=>{}),1500);
  }
}
function toast(msg,type="info"){
  const el=D.createElement("div"); el.textContent=msg;
  Object.assign(el.style,{position:"fixed",top:"74px",left:"50%",transform:"translateX(-50%)",zIndex:99,padding:"11px 14px",borderRadius:"12px",background:type==="error"?"#55222b":"#1b2941",color:"#fff",border:"1px solid #354766",boxShadow:"0 12px 30px rgba(0,0,0,.35)",maxWidth:"90vw"});
  D.body.append(el); setTimeout(()=>el.remove(),3200);
}
const byKey=k=>state.tasks.find(t=>t.taskKey===k);
function upsertTask(t){
  const i=state.tasks.findIndex(x=>x.taskKey===t.taskKey);
  if(i>=0) state.tasks[i]={...state.tasks[i],...t,updatedAt:Date.now()};
  else state.tasks.push({...t,id:uid(),createdAt:Date.now(),updatedAt:Date.now()});
}
function taskDate(t){return t.plannedDate || (t.start?new Date(t.start).toISOString().slice(0,10):null)}
function phaseFor(ds){
  const start=state.settings.officialStart||DEFAULT_START;
  const lectureTarget=state.settings.lectureTarget||DEFAULT_LECTURE_TARGET;
  if(ds<start)return"Pre-plan";
  if(ds<="2026-10-15")return"Foundation";
  if(ds<="2026-11-15")return"Heavy Coverage";
  const closeStart=new Date(lectureTarget+"T00:00:00");
  closeStart.setDate(closeStart.getDate()-10);
  const closeStartStr=isoDate(closeStart);
  if(ds<closeStartStr)return"Syllabus Closure";
  if(ds<=lectureTarget)return"Lecture Closure";
  return"Revision & Consolidation";
}
function planEnd(){return state.settings.examDate || state.settings.syllabusTarget || DEFAULT_FINAL_TARGET}
function buildCoreTasks(){
  for(const s of state.subjects){
    if(!s.total)continue;
    for(let n=s.completed+1;n<=s.total;n++){
      const key=`LECTURE:${s.code}:${String(n).padStart(3,"0")}`;
      const old=byKey(key);
      upsertTask({
        taskKey:key,subject:s.code,type:"LECTURE",title:`${s.code} Lecture ${String(n).padStart(2,"0")}`,
        faculty:s.faculty,duration:s.duration,status:old?.status||"Not Started",priority:80,
        plannedDate:old?.plannedDate||null,start:old?.start||null,end:old?.end||null,
        googleEventId:old?.googleEventId||null,originalDate:old?.originalDate||null,reasonMissed:old?.reasonMissed||""
      });
      if(n%5===0){
        const qk=`QUESTION:${s.code}:${String(n).padStart(3,"0")}`,qo=byKey(qk);
        upsertTask({taskKey:qk,subject:s.code,type:"QUESTION",title:`Question Practice | Lectures ${Math.max(1,n-4)}–${n}`,
          duration:60,status:qo?.status||"Not Started",priority:84,parentKey:key,plannedDate:qo?.plannedDate||null,start:qo?.start||null,end:qo?.end||null,googleEventId:qo?.googleEventId||null});
      }
    }
  }
  let d=new Date((state.settings.officialStart||DEFAULT_START)+"T00:00:00"),end=new Date(planEnd()+"T00:00:00");
  while(d<=end){
    const ds=isoDate(d),day=d.getDay();
    if(day===0){
      const k=`WEEKLY:${ds}`,o=byKey(k);
      upsertTask({taskKey:k,type:"WEEKLY",title:"Weekly Review",duration:45,status:o?.status||"Not Started",priority:92,plannedDate:ds,start:o?.start||null,end:o?.end||null,googleEventId:o?.googleEventId||null});
    }
    if(ds>(state.settings.lectureTarget||DEFAULT_LECTURE_TARGET)&&[2,4,6].includes(day)){
      const k=`RTP_MTP:${ds}`,o=byKey(k);
      upsertTask({taskKey:k,type:"RTP_MTP",title:"RTP / MTP / Past Paper Practice",duration:120,status:o?.status||"Not Started",priority:94,plannedDate:ds,start:o?.start||null,end:o?.end||null,googleEventId:o?.googleEventId||null});
    }
    d.setDate(d.getDate()+1);
  }
}
function combineDateTime(ds,hm){return new Date(`${ds}T${hm}:00`).getTime()}
function overlaps(a,b,busy){return busy.some(x=>x.start<b&&x.end>a)}
function prefsScore(t,b){return b.prefs.includes(t.subject)||b.prefs.includes(t.type)?30:0}
function eligibleTaskForDay(t,ds){
  if(t.status==="Completed")return false;
  if(t.parentKey){const p=byKey(t.parentKey);if(p&&p.status!=="Completed")return false}
  if(["WEEKLY","RTP_MTP","TEST","REVISION","BUFFER"].includes(t.type)&&t.plannedDate)return t.plannedDate===ds;
  if(t.type==="LECTURE"&&ds>(state.settings.lectureTarget||DEFAULT_LECTURE_TARGET)&&!["Missed","Rescheduled"].includes(t.status))return false;
  return !t.plannedDate || ["Missed","Rescheduled"].includes(t.status);
}
function schedulePlan(from=isoDate(new Date()),through=planEnd()){
  buildCoreTasks();
  const startDate=state.settings.officialStart||DEFAULT_START; let d=new Date((from<startDate?startDate:from)+"T00:00:00"),end=new Date(through+"T00:00:00"),assigned=0;
  while(d<=end){
    const ds=isoDate(d), maxMin=Math.round((state.settings.maxDailyHours||10)*60);
    let used=0;
    const busy=state.busyEvents.filter(x=>x.date===ds);
    for(const block of state.studyBlocks){
      let cursor=combineDateTime(ds,block.start), blockEnd=combineDateTime(ds,block.end);
      while(cursor<blockEnd&&used<maxMin){
        const candidates=state.tasks.filter(t=>eligibleTaskForDay(t,ds)&&(!t.start||["Missed","Rescheduled"].includes(t.status)))
          .sort((a,b)=>((b.status==="Missed"||b.status==="Rescheduled")-(a.status==="Missed"||a.status==="Rescheduled"))*1000 + (prefsScore(b,block)+b.priority)-(prefsScore(a,block)+a.priority));
        let chosen=null;
        for(const t of candidates){
          const e=cursor+t.duration*60000;
          if(e<=blockEnd&&used+t.duration<=maxMin&&!overlaps(cursor,e,busy)){chosen=t;break}
        }
        if(!chosen)break;
        chosen.plannedDate=ds;chosen.start=cursor;chosen.end=cursor+chosen.duration*60000;
        chosen.originalDate=chosen.originalDate||ds;
        if(chosen.status==="Missed")chosen.status="Rescheduled";
        assigned++;used+=chosen.duration;cursor=chosen.end+(state.settings.minBreakMin||20)*60000;
      }
    }
    d.setDate(d.getDate()+1);
  }
  return assigned;
}
function stats(){
  const known=state.subjects.filter(s=>s.total), total=known.reduce((a,s)=>a+s.total,0), completed=known.reduce((a,s)=>a+Math.min(s.completed,s.total),0);
  const today=isoDate(new Date()),tt=state.tasks.filter(t=>taskDate(t)===today),backlog=state.tasks.filter(t=>["Missed","Rescheduled"].includes(t.status));
  return {total,completed,remaining:Math.max(0,total-completed),pct:total?completed/total*100:0,tt,backlog,
    todayMin:tt.reduce((a,t)=>a+t.duration,0),doneMin:tt.filter(t=>t.status==="Completed").reduce((a,t)=>a+t.duration,0)};
}
function projectedCompletion(){
  const remMin=state.subjects.reduce((a,s)=>a+((s.total?Math.max(0,s.total-s.completed):0)*s.duration),0);
  const lectureHours=Math.max(1,(state.settings.maxDailyHours||10)*.72);
  const days=Math.ceil((remMin/60)/lectureHours),d=new Date();d.setDate(d.getDate()+days);return d;
}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function kpi(label,value,sub=""){return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`}
function statusPill(s){return `<span class="status ${String(s).toLowerCase().replaceAll(" ","-")}">${escapeHtml(s)}</span>`}
function taskHtml(t,actions=true){
  const when=t.start?`${fmtTime(new Date(t.start))}–${fmtTime(new Date(t.end))}`:"Unscheduled";
  return `<div class="task"><div><h4>${escapeHtml(when)} · ${escapeHtml(t.title)}</h4><div class="meta">${escapeHtml(t.subject||"CA Final")} · ${escapeHtml(t.type)} · ${t.duration} min<br>${statusPill(t.status)}</div></div>
  ${actions?`<div class="row"><button class="btn success" data-act="complete" data-key="${escapeHtml(t.taskKey)}">✓</button><button class="btn secondary" data-act="move" data-key="${escapeHtml(t.taskKey)}">↔</button><button class="btn danger" data-act="miss" data-key="${escapeHtml(t.taskKey)}">!</button></div>`:""}</div>`;
}
function homeView(){
  const s=stats(), today=new Date(), lectureTarget=state.settings.lectureTarget||DEFAULT_LECTURE_TARGET, syllabusTarget=state.settings.syllabusTarget||DEFAULT_FINAL_TARGET;
  const daysLecture=Math.max(0,Math.ceil((new Date(lectureTarget+"T23:59:59")-today)/86400000)),daysSyllabus=Math.max(0,Math.ceil((new Date(syllabusTarget+"T23:59:59")-today)/86400000)),proj=projectedCompletion();
  const phase=phaseFor(isoDate(today)),cloud=state.settings.lastCloudBackup?fmtDate(new Date(state.settings.lastCloudBackup)):"Never";
  return `<section class="hero"><div class="chips"><span class="chip">${phase}</span><span class="chip">NO EXPIRY</span><span class="chip">PWA WEBSITE</span></div><h2>CA Final<br>Study Operating System</h2><p>Lecture target: ${fmtDate(new Date(lectureTarget+"T00:00:00"))}. Revision, RTP/MTP, tests and consolidation continue after lecture closure through your exam date.</p></section>
  <div class="grid kpi-grid">
    ${kpi("Lecture target",daysLecture+" d",fmtDate(new Date(lectureTarget+"T00:00:00")))}${kpi("Syllabus target",daysSyllabus+" d",fmtDate(new Date(syllabusTarget+"T00:00:00")))}${kpi("Remaining",s.remaining,"Known totals")}${kpi("Completion",s.pct.toFixed(1)+"%","Known totals")}${kpi("Backlog",s.backlog.length,"Needs recovery")}${kpi("Projected",fmtDate(proj),"Configured pace")}
  </div>
  <div class="card"><h3>Today’s Smart Message</h3><p>${smartMessage()}</p></div>
  <div class="actions"><button class="btn wide" id="buildPlan">⚡ Build / Refresh Plan</button><button class="btn secondary wide" id="recoveryMode">🛟 Recovery Mode</button></div>
  <div class="section-title">Today</div>
  ${s.tt.length?s.tt.slice(0,8).map(t=>taskHtml(t)).join(""):`<div class="notice">No study sessions scheduled for today yet.</div>`}
  <div class="card"><h3>Data Protection</h3><p>IndexedDB stores your study data in this browser. Rolling local snapshots are kept automatically. Last Google Drive app-data backup: <b>${cloud}</b>.</p><div class="row"><button class="btn secondary" data-nav="settings">Backup & Restore</button><button class="btn secondary" id="cloudBackupHome">Cloud backup now</button></div></div>`;
}
function smartMessage(){
  const s=stats(), today=isoDate(new Date()), tasks=s.tt.filter(t=>t.status!=="Completed"), proj=projectedCompletion(), lectureTarget=state.settings.lectureTarget||DEFAULT_LECTURE_TARGET, target=new Date(lectureTarget+"T23:59:59");
  const schedule=tasks.slice(0,5).map(t=>`${t.start?fmtTime(new Date(t.start)):"Unscheduled"} ${t.title}`).join("; ");
  return `Today is ${fmtDate(new Date())}. You have ${s.remaining} known lectures remaining and ${s.backlog.length} backlog task(s). ${schedule||"Build the smart plan to generate today's schedule."} Projected lecture completion is ${fmtDate(proj)} — ${proj<=target?"within":"after"} your ${fmtDate(target)} lecture target.`;
}
function todayView(){
  const ds=isoDate(new Date()),tasks=state.tasks.filter(t=>taskDate(t)===ds).sort((a,b)=>(a.start||9e15)-(b.start||9e15)),s=stats();
  const busy=state.busyEvents.filter(x=>x.date===ds);
  return `<div class="section-title">Today’s Timeline</div><div class="grid kpi-grid">${kpi("Planned",(s.todayMin/60).toFixed(1)+" h")}${kpi("Completed",(s.doneMin/60).toFixed(1)+" h")}${kpi("Remaining",((s.todayMin-s.doneMin)/60).toFixed(1)+" h")}${kpi("Conflicts",busy.length)}</div>
  ${tasks.length?tasks.map(t=>taskHtml(t)).join(""):`<div class="notice">No tasks scheduled today.</div>`}
  ${busy.length?`<div class="section-title">Calendar commitments</div>${busy.map(x=>`<div class="task"><div><h4>${fmtTime(new Date(x.start))}–${fmtTime(new Date(x.end))} · ${escapeHtml(x.title)}</h4><div class="meta">Personal / external calendar · read only</div></div></div>`).join("")}`:""}`;
}
function weekView(){
  const now=new Date(),monday=new Date(now);monday.setDate(now.getDate()-((now.getDay()+6)%7));monday.setHours(0,0,0,0);
  const days=[...Array(7)].map((_,i)=>{const d=new Date(monday);d.setDate(d.getDate()+i);return d});
  return `<div class="section-title">Week View</div><div class="day-grid">${days.map(d=>{const ds=isoDate(d),ts=state.tasks.filter(t=>taskDate(t)===ds),busy=state.busyEvents.filter(x=>x.date===ds);return `<div class="day"><div class="day-head"><b>${d.toLocaleDateString("en-IN",{weekday:"short"})}</b><small>${d.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}</small></div><div class="capacity">${ts.filter(t=>t.type==="LECTURE").length} lectures · ${(ts.reduce((a,t)=>a+t.duration,0)/60).toFixed(1)}h · ${ts.filter(t=>t.type==="REVISION").length} revision · ${busy.length} conflict(s)</div><hr>${ts.slice(0,5).map(t=>`<div class="small">${t.start?fmtTime(new Date(t.start)):"—"} · ${escapeHtml(t.title)}</div>`).join("")||`<span class="muted small">No plan</span>`}</div>`}).join("")}</div>`;
}
function subjectsView(){
  return `<div class="section-title">Subject Master</div><div class="notice">FR starts with 60 lectures completed. FR and AFM totals are intentionally blank until you enter them. Audit defaults to 80 but is editable.</div>
  ${state.subjects.map(s=>{const pct=s.total?clamp(s.completed/s.total*100,0,100):0;return `<div class="subject-card"><div class="row"><div class="flex1"><b>${s.code} — ${escapeHtml(s.name)}</b><div class="muted small">${escapeHtml(s.faculty||"Faculty not set")}</div></div><b>${s.total?pct.toFixed(0)+"%":"Set total"}</b></div><div class="progress"><span style="width:${pct}%"></span></div>
  <div class="form-grid"><div class="field"><label>Total lectures</label><input inputmode="numeric" data-sub="${s.code}" data-field="total" value="${s.total??""}"></div><div class="field"><label>Completed</label><input inputmode="numeric" data-sub="${s.code}" data-field="completed" value="${s.completed}"></div><div class="field"><label>Avg lecture duration (min)</label><input inputmode="numeric" data-sub="${s.code}" data-field="duration" value="${s.duration}"></div><div class="field"><label>Faculty</label><input data-sub="${s.code}" data-field="faculty" value="${escapeHtml(s.faculty)}"></div><div class="field"><label>Chapters completed / total</label><div class="row"><input class="flex1" inputmode="numeric" data-sub="${s.code}" data-field="chaptersCompleted" value="${s.chaptersCompleted}"><input class="flex1" inputmode="numeric" data-sub="${s.code}" data-field="chapters" value="${s.chapters}"></div></div><div class="field"><label>Questions completed</label><input inputmode="numeric" data-sub="${s.code}" data-field="questions" value="${s.questions}"></div></div>
  <button class="btn secondary wide" data-save-sub="${s.code}">Save ${s.code}</button></div>`}).join("")}`;
}
function backlogView(){
  const b=state.tasks.filter(t=>["Missed","Rescheduled"].includes(t.status)).sort((a,b)=>(a.originalDate||"").localeCompare(b.originalDate||""));
  return `<div class="section-title">Backlog Recovery</div><div class="actions"><button class="btn wide" id="recoveryBacklog">Find next suitable slots</button><button class="btn secondary wide" id="backupBacklog">Backup now</button></div>
  ${b.length?b.map(t=>`<div class="task"><div><h4>${escapeHtml(t.title)}</h4><div class="meta">Original: ${escapeHtml(t.originalDate||"—")} · ${escapeHtml(t.reasonMissed||"No reason")}<br>${statusPill(t.status)}</div></div><button class="btn secondary" data-act="move" data-key="${escapeHtml(t.taskKey)}">Move</button></div>`).join(""):`<div class="notice good">No backlog tasks.</div>`}`;
}
function testsView(){
  const upcoming=state.tasks.filter(t=>["REVISION","TEST","RTP_MTP"].includes(t.type)).sort((a,b)=>(a.plannedDate||"").localeCompare(b.plannedDate||""));
  return `<div class="section-title">Tests & Revision</div>
  <div class="card"><h3>Create spaced revision</h3><div class="form-grid"><div class="field"><label>Subject</label><select id="revSubject">${state.subjects.map(s=>`<option>${s.code}</option>`)}</select></div><div class="field"><label>Chapter / lecture group</label><input id="revLabel" value="Chapter 1"></div><div class="field"><label>Completed on</label><input type="date" id="revDate" value="${isoDate(new Date())}"></div><div class="field"><label>Duration (min)</label><input id="revDuration" inputmode="numeric" value="45"></div></div><button class="btn wide" id="createRevision">Create revision cycle</button></div>
  <div class="card"><h3>Add test</h3><div class="form-grid"><div class="field"><label>Subject</label><select id="testSubject">${state.subjects.map(s=>`<option>${s.code}</option>`)}</select></div><div class="field"><label>Coverage</label><input id="testCoverage" value="Chapter / Full syllabus"></div><div class="field"><label>Date</label><input type="date" id="testDate" value="${isoDate(new Date(Date.now()+7*86400000))}"></div><div class="field"><label>Duration (min)</label><input id="testDuration" inputmode="numeric" value="180"></div><div class="field"><label>Marks</label><input id="testMarks" inputmode="numeric" value="100"></div><div class="field"><label>Target score (%)</label><input id="testTarget" inputmode="decimal" value="60"></div></div><button class="btn wide" id="addTest">Add test</button></div>
  <div class="section-title">Upcoming</div>${upcoming.slice(0,60).map(t=>taskHtml(t)).join("")||`<div class="notice">No revision/test tasks yet.</div>`}`;
}
function calendarView(){
  const start=new Date(),end=new Date();end.setDate(end.getDate()+14);
  const tasks=state.tasks.filter(t=>t.start&&new Date(t.start)>=new Date(start.toDateString())&&new Date(t.start)<=end).sort((a,b)=>a.start-b.start);
  return `<div class="section-title">Study Calendar</div>
  <div class="card"><h3>Google Calendar</h3><p>Personal calendars are read-only. Study events are created/updated only on <b>CA Final Study Plan</b>.</p><div class="row"><button class="btn" id="connectGoogle">${googleToken&&Date.now()<googleTokenExpiry?"Refresh Google access":"Connect Google"}</button><button class="btn secondary" id="syncCalendar">Sync now</button><button class="btn secondary" id="readAvailability">Read availability</button></div><div class="small muted">Last sync: ${state.settings.lastCalendarSync?fmtDate(new Date(state.settings.lastCalendarSync))+" "+fmtTime(new Date(state.settings.lastCalendarSync)):"Never"}</div></div>
  <div class="section-title">Next 14 days</div>${tasks.map(t=>taskHtml(t)).join("")||`<div class="notice">No scheduled study events. Build the plan first.</div>`}`;
}
function settingsView(){
  const last=state.metadata.lastSaved?new Date(state.metadata.lastSaved):null;
  return `<div class="section-title">Settings</div>
  <div class="card"><h3>Study Dates</h3><p>You can change these dates anytime without editing GitHub code. The website never expires.</p><div class="form-grid"><div class="field"><label>Official study start</label><input type="date" id="officialStart" value="${state.settings.officialStart||DEFAULT_START}"></div><div class="field"><label>Lecture completion target</label><input type="date" id="lectureTarget" value="${state.settings.lectureTarget||DEFAULT_LECTURE_TARGET}"></div><div class="field"><label>Syllabus completion target</label><input type="date" id="syllabusTarget" value="${state.settings.syllabusTarget||DEFAULT_FINAL_TARGET}"></div><div class="field"><label>Actual exam date (optional)</label><input type="date" id="examDate" value="${state.settings.examDate||""}"></div></div></div>
  <div class="card"><h3>Planning</h3><div class="form-grid"><div class="field"><label>Maximum daily study hours</label><input id="maxHours" inputmode="decimal" value="${state.settings.maxDailyHours}"></div><div class="field"><label>Minimum break (minutes)</label><input id="minBreak" inputmode="numeric" value="${state.settings.minBreakMin}"></div></div></div>
  <div class="card"><h3>Google OAuth for this website</h3><p>Create a Google OAuth 2.0 <b>Web application</b> client and paste its Client ID here. The Client ID is not a password/secret.</p><div class="field"><label>Google Web Client ID</label><input id="googleClientId" value="${escapeHtml(state.settings.googleClientId||"")}" placeholder="...apps.googleusercontent.com"></div><div class="notice warn small">For Google Calendar/Drive integration, enable Calendar API and Drive API and add this website's HTTPS origin to Authorized JavaScript origins.</div></div>
  <div class="card"><h3>Backup & Restore</h3><p>Browser storage can be cleared by the browser or device. Keep an external backup. Google Drive app-data backup is private to this web app and uses the narrow <code>drive.appdata</code> scope.</p><div class="row"><button class="btn" id="exportBackup">Export JSON</button><button class="btn secondary" id="restoreBackup">Restore JSON</button><button class="btn secondary" id="cloudBackup">Backup to Google Drive</button><button class="btn secondary" id="cloudRestore">Restore from Google Drive</button></div><div class="small muted">Last local save: ${last?fmtDate(last)+" "+fmtTime(last):"Never"} · local rolling snapshots: up to 30</div></div>
  <div class="card"><h3>Study blocks</h3>${state.studyBlocks.map((b,i)=>`<div class="form-grid"><div class="field"><label>${escapeHtml(b.name)} start</label><input type="time" data-block="${i}" data-bfield="start" value="${b.start}"></div><div class="field"><label>${escapeHtml(b.name)} end</label><input type="time" data-block="${i}" data-bfield="end" value="${b.end}"></div></div>`).join("")}</div>
  <button class="btn wide" id="saveSettings">Save settings</button>`;
}
function render(){
  const views={home:homeView,today:todayView,week:weekView,subjects:subjectsView,backlog:backlogView,tests:testsView,calendar:calendarView,settings:settingsView};
  MAIN.innerHTML=views[currentView]();
  D.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.view===currentView));
  bindView();
}
function navigate(v){currentView=v;history.replaceState(null,"","#"+v);render();window.scrollTo({top:0,behavior:"smooth"})}
function showMove(t){
  const start=t.start?new Date(t.start):new Date(), val=new Date(start.getTime()-start.getTimezoneOffset()*60000).toISOString().slice(0,16);
  modalBody.innerHTML=`<h3>Move study event</h3><p class="muted">${escapeHtml(t.title)}</p><div class="field"><label>New date/time</label><input id="moveDateTime" type="datetime-local" value="${val}"></div><div class="row"><button value="cancel" class="btn secondary">Cancel</button><button id="confirmMove" value="default" class="btn">Move</button></div>`;
  modal.showModal();
  D.querySelector("#confirmMove").onclick=async e=>{e.preventDefault();const d=new Date(D.querySelector("#moveDateTime").value);t.plannedDate=isoDate(d);t.start=d.getTime();t.end=t.start+t.duration*60000;t.status=t.status==="Missed"?"Rescheduled":t.status;await saveState({snapshot:true});modal.close();render();if(googleToken&&t.googleEventId)syncOneTask(t).catch(()=>{})}
}
function showMiss(t){
  modalBody.innerHTML=`<h3>Mark missed</h3><p class="muted">${escapeHtml(t.title)}</p><div class="field"><label>Reason missed</label><textarea id="missReason" rows="3" placeholder="Optional"></textarea></div><div class="row"><button value="cancel" class="btn secondary">Cancel</button><button id="confirmMiss" value="default" class="btn danger">Move to backlog</button></div>`;
  modal.showModal();
  D.querySelector("#confirmMiss").onclick=async e=>{e.preventDefault();t.status="Missed";t.reasonMissed=D.querySelector("#missReason").value;t.originalDate=t.originalDate||t.plannedDate;t.start=null;t.end=null;await saveState({snapshot:true});modal.close();render()}
}
async function completeTask(t){
  t.status="Completed";
  if(t.type==="LECTURE"&&t.subject){
    const s=state.subjects.find(x=>x.code===t.subject),n=Number(t.taskKey.split(":").pop());if(s&&n>s.completed)s.completed=n;
    if(n%5===0)createRevisionCycle(t.subject,`Lectures ${Math.max(1,n-4)}–${n}`,t.plannedDate||isoDate(new Date()),45);
  }
  await saveState({snapshot:true});render();if(googleToken&&t.googleEventId)syncOneTask(t).catch(()=>{});
}
function createRevisionCycle(subject,label,dateStr,duration=45){
  const offsets=[[0,"Same-Day Revision"],[1,"Next-Day Revision"],[7,"7-Day Revision"],[21,"21-Day Revision"],[30,"30-Day Revision"]];
  for(const [off,name] of offsets){const d=new Date(dateStr+"T00:00:00");d.setDate(d.getDate()+off);const ds=isoDate(d),k=`REV:${subject}:${label}:${ds}`,o=byKey(k);upsertTask({taskKey:k,subject,type:"REVISION",title:`${label} | ${name}`,duration,status:o?.status||"Not Started",priority:90,plannedDate:ds,start:o?.start||null,end:o?.end||null,googleEventId:o?.googleEventId||null})}
}
function bindView(){
  MAIN.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>navigate(b.dataset.nav));
  MAIN.querySelectorAll("[data-act]").forEach(b=>b.onclick=()=>{const t=byKey(b.dataset.key);if(!t)return;if(b.dataset.act==="complete")completeTask(t);if(b.dataset.act==="miss")showMiss(t);if(b.dataset.act==="move")showMove(t)});
  if(D.querySelector("#buildPlan"))D.querySelector("#buildPlan").onclick=async()=>{const n=schedulePlan();await saveState({snapshot:true});toast(`${n} tasks placed into study slots.`);render()};
  if(D.querySelector("#recoveryMode"))D.querySelector("#recoveryMode").onclick=()=>recovery();
  if(D.querySelector("#recoveryBacklog"))D.querySelector("#recoveryBacklog").onclick=()=>recovery();
  if(D.querySelector("#backupBacklog"))D.querySelector("#backupBacklog").onclick=()=>exportBackup();
  if(D.querySelector("#cloudBackupHome"))D.querySelector("#cloudBackupHome").onclick=()=>cloudBackup().then(()=>render()).catch(e=>toast(e.message,"error"));
  MAIN.querySelectorAll("[data-save-sub]").forEach(btn=>btn.onclick=async()=>{
    const code=btn.dataset.saveSub,s=state.subjects.find(x=>x.code===code);
    MAIN.querySelectorAll(`[data-sub="${code}"]`).forEach(i=>{const f=i.dataset.field;if(["total","completed","duration","chapters","chaptersCompleted","questions"].includes(f))s[f]=i.value===""?(f==="total"?null:0):Number(i.value);else s[f]=i.value});
    buildCoreTasks();await saveState({snapshot:true});toast(`${code} saved`);render()
  });
  if(D.querySelector("#createRevision"))D.querySelector("#createRevision").onclick=async()=>{createRevisionCycle(D.querySelector("#revSubject").value,D.querySelector("#revLabel").value,D.querySelector("#revDate").value,Number(D.querySelector("#revDuration").value)||45);await saveState({snapshot:true});render()};
  if(D.querySelector("#addTest"))D.querySelector("#addTest").onclick=async()=>{const sub=D.querySelector("#testSubject").value,date=D.querySelector("#testDate").value,cov=D.querySelector("#testCoverage").value,k=`TEST:${sub}:${date}:${uid().slice(0,6)}`;upsertTask({taskKey:k,subject:sub,type:"TEST",title:`Test | ${cov}`,duration:Number(D.querySelector("#testDuration").value)||180,status:"Not Started",priority:96,plannedDate:date,start:null,end:null,marks:Number(D.querySelector("#testMarks").value)||100,targetScore:Number(D.querySelector("#testTarget").value)||60});await saveState({snapshot:true});render()};
  if(D.querySelector("#saveSettings"))D.querySelector("#saveSettings").onclick=async()=>{state.settings.officialStart=D.querySelector("#officialStart").value||DEFAULT_START;state.settings.lectureTarget=D.querySelector("#lectureTarget").value||DEFAULT_LECTURE_TARGET;state.settings.syllabusTarget=D.querySelector("#syllabusTarget").value||DEFAULT_FINAL_TARGET;state.settings.examDate=D.querySelector("#examDate").value;state.settings.maxDailyHours=Number(D.querySelector("#maxHours").value)||10;state.settings.minBreakMin=Number(D.querySelector("#minBreak").value)||20;state.settings.googleClientId=D.querySelector("#googleClientId").value.trim();MAIN.querySelectorAll("[data-block]").forEach(i=>state.studyBlocks[Number(i.dataset.block)][i.dataset.bfield]=i.value);buildCoreTasks();await saveState({snapshot:true});toast("Dates and settings saved");render()};
  if(D.querySelector("#exportBackup"))D.querySelector("#exportBackup").onclick=exportBackup;
  if(D.querySelector("#restoreBackup"))D.querySelector("#restoreBackup").onclick=()=>restoreInput.click();
  if(D.querySelector("#cloudBackup"))D.querySelector("#cloudBackup").onclick=()=>cloudBackup().then(()=>render()).catch(e=>toast(e.message,"error"));
  if(D.querySelector("#cloudRestore"))D.querySelector("#cloudRestore").onclick=()=>cloudRestore().catch(e=>toast(e.message,"error"));
  if(D.querySelector("#connectGoogle"))D.querySelector("#connectGoogle").onclick=()=>connectGoogle();
  if(D.querySelector("#syncCalendar"))D.querySelector("#syncCalendar").onclick=()=>syncAll().then(()=>render()).catch(e=>toast(e.message,"error"));
  if(D.querySelector("#readAvailability"))D.querySelector("#readAvailability").onclick=()=>readAvailability().then(()=>{toast("Calendar availability refreshed");render()}).catch(e=>toast(e.message,"error"));
}
async function recovery(){
  const start=isoDate(new Date()),end=new Date();end.setDate(end.getDate()+6);const n=schedulePlan(start,isoDate(end));await saveState({snapshot:true});toast(`Recovery mode placed ${n} tasks across the next 7 days.`);render()
}
function exportBackup(){
  const blob=new Blob([JSON.stringify({format:"CA_FINAL_STUDY_COMMAND_CENTER_WEB",exportedAt:Date.now(),state},null,2)],{type:"application/json"});
  const a=D.createElement("a");a.href=URL.createObjectURL(blob);a.download=`CA_Final_Backup_${isoDate(new Date())}.json`;a.click();URL.revokeObjectURL(a.href)
}
restoreInput.onchange=async()=>{
  const f=restoreInput.files?.[0];if(!f)return;
  try{const x=JSON.parse(await f.text());if(x.format!=="CA_FINAL_STUDY_COMMAND_CENTER_WEB"||!x.state)throw new Error("Invalid backup");state=x.state;await saveState({snapshot:true,cloud:false});toast("Backup restored");render()}catch(e){toast(e.message,"error")}finally{restoreInput.value=""}
};

function requireGoogle(){
  if(!state.settings.googleClientId)throw new Error("Add your Google Web Client ID in Settings first.");
  if(!window.google?.accounts?.oauth2)throw new Error("Google Identity Services has not loaded. Check internet and refresh.");
}
function connectGoogle(){
  try{requireGoogle()}catch(e){toast(e.message,"error");navigate("settings");return}
  const client=google.accounts.oauth2.initTokenClient({
    client_id:state.settings.googleClientId,
    scope:[
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.app.created",
      "https://www.googleapis.com/auth/drive.appdata"
    ].join(" "),
    callback:async resp=>{
      if(resp.error){toast(resp.error,"error");return}
      googleToken=resp.access_token;googleTokenExpiry=Date.now()+(resp.expires_in||3600)*1000;
      toast("Google connected");
      try{await ensureStudyCalendar();await readAvailability();await syncAll();await cloudBackup();render()}catch(e){toast(e.message,"error")}
    }
  });
  client.requestAccessToken({prompt:googleToken?"":"consent"});
}
async function gfetch(url,opts={}){
  if(!googleToken||Date.now()>googleTokenExpiry-30000)throw new Error("Google access expired. Tap Connect Google again.");
  const headers={Authorization:`Bearer ${googleToken}`,...(opts.headers||{})};
  const r=await fetch(url,{...opts,headers});if(!r.ok){const t=await r.text();throw new Error(`Google API ${r.status}: ${t.slice(0,240)}`)}return r.status===204?{}:r.json();
}
async function listCalendars(){
  let url="https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250",items=[];
  while(url){const j=await gfetch(url);items.push(...(j.items||[]));url=j.nextPageToken?`https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&pageToken=${encodeURIComponent(j.nextPageToken)}`:null}return items;
}
async function ensureStudyCalendar(){
  if(state.settings.studyCalendarId)return state.settings.studyCalendarId;
  const cals=await listCalendars(),found=cals.find(c=>c.summary==="CA Final Study Plan");
  if(found){state.settings.studyCalendarId=found.id;await saveState({cloud:false});return found.id}
  const j=await gfetch("https://www.googleapis.com/calendar/v3/calendars",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({summary:"CA Final Study Plan",description:"CA Final study events managed by CA Final Study Command Center.",timeZone:state.settings.timezone})});
  state.settings.studyCalendarId=j.id;await saveState({cloud:false});return j.id;
}
async function readAvailability(){
  const studyId=await ensureStudyCalendar(),cals=(await listCalendars()).filter(c=>c.id!==studyId);
  const start=new Date(),end=new Date(planEnd()+"T23:59:59"),busy=[];
  for(const cal of cals){
    let url=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(start.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}&maxResults=2500`;
    const j=await gfetch(url);
    for(const e of j.items||[]){
      if(e.status==="cancelled"||e.transparency==="transparent")continue;
      if(e.start?.dateTime&&e.end?.dateTime){const s=new Date(e.start.dateTime),en=new Date(e.end.dateTime);busy.push({date:isoDate(s),start:s.getTime(),end:en.getTime(),title:e.summary||"Busy",calendarId:cal.id})}
      else if(e.start?.date&&e.end?.date){let d=new Date(e.start.date+"T00:00:00"),last=new Date(e.end.date+"T00:00:00");while(d<last){busy.push({date:isoDate(d),start:new Date(isoDate(d)+"T00:00:00").getTime(),end:new Date(isoDate(d)+"T23:59:59").getTime(),title:e.summary||"All-day commitment",calendarId:cal.id});d.setDate(d.getDate()+1)}}
    }
  }
  state.busyEvents=busy;await saveState({snapshot:true,cloud:false});return busy;
}
function eventTitle(t){
  if(t.type==="LECTURE"){const n=t.taskKey.split(":").pop();const s=state.subjects.find(x=>x.code===t.subject);return `CA Final | ${t.subject} | Lecture ${Number(n).toString().padStart(2,"0")}${s?.faculty?` | ${s.faculty}`:""}`}
  if(t.type==="WEEKLY")return"CA Final | Weekly Review";
  return`CA Final | ${t.subject||"Study"} | ${t.title}`;
}
function eventBody(t){
  const s=state.subjects.find(x=>x.code===t.subject);
  return{summary:eventTitle(t),description:[`Subject: ${t.subject||"CA Final"}`,`Task: ${t.title}`,`Planned Duration: ${t.duration} minutes`,`Faculty: ${s?.faculty||"-"}`,`Dashboard Status: ${t.status}`,"Managed by CA Final Study Command Center"].join("\n"),start:{dateTime:new Date(t.start).toISOString(),timeZone:state.settings.timezone},end:{dateTime:new Date(t.end).toISOString(),timeZone:state.settings.timezone},extendedProperties:{private:{ca_final_app:"1",ca_task_key:t.taskKey,dashboard_status:t.status}}};
}
async function syncOneTask(t){
  if(!t.start||!t.end)return;
  const cid=await ensureStudyCalendar(),body=eventBody(t);
  if(t.googleEventId){
    try{const j=await gfetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(t.googleEventId)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});t.googleEventId=j.id;return}
    catch(e){if(!String(e.message).includes("404"))throw e;t.googleEventId=null}
  }
  const q=await gfetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cid)}/events?privateExtendedProperty=${encodeURIComponent("ca_task_key="+t.taskKey)}&maxResults=5`);
  if(q.items?.length){const ev=q.items[0],j=await gfetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(ev.id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});t.googleEventId=j.id}
  else{const j=await gfetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cid)}/events`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});t.googleEventId=j.id}
}
async function syncAll(){
  if(!googleToken)throw new Error("Connect Google first.");
  const planned=state.tasks.filter(t=>t.start&&t.end);
  let n=0;for(const t of planned){await syncOneTask(t);n++}
  state.settings.lastCalendarSync=Date.now();await saveState({snapshot:true,cloud:false});toast(`${n} study events synced without editing personal events.`)
}

const DRIVE_NAME="ca-final-study-command-center-backup.json";
async function findDriveBackup(){
  const q=encodeURIComponent(`name='${DRIVE_NAME}'`);
  const j=await gfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)&pageSize=10`);
  return j.files?.[0]||null;
}
async function cloudBackup(){
  if(!googleToken)throw new Error("Connect Google first.");
  const payload=JSON.stringify({format:"CA_FINAL_STUDY_COMMAND_CENTER_WEB",exportedAt:Date.now(),state});
  let fileId=state.settings.driveBackupFileId;
  if(!fileId){fileId=(await findDriveBackup())?.id||""}
  if(fileId){
    await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:payload});
  }else{
    const boundary="-------CAFINAL"+Date.now();
    const metadata=JSON.stringify({name:DRIVE_NAME,parents:["appDataFolder"]});
    const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`;
    const j=await gfetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",{method:"POST",headers:{"Content-Type":`multipart/related; boundary=${boundary}`},body});fileId=j.id;
  }
  state.settings.driveBackupFileId=fileId;state.settings.lastCloudBackup=Date.now();await saveState({cloud:false});toast("Backed up to private Google Drive app data.");return fileId;
}
async function cloudRestore(){
  if(!googleToken)throw new Error("Connect Google first.");
  const f=(state.settings.driveBackupFileId&&{id:state.settings.driveBackupFileId})||await findDriveBackup();if(!f)throw new Error("No cloud backup found.");
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?alt=media`,{headers:{Authorization:`Bearer ${googleToken}`}});if(!r.ok)throw new Error("Could not download cloud backup.");
  const x=await r.json();if(x.format!=="CA_FINAL_STUDY_COMMAND_CENTER_WEB"||!x.state)throw new Error("Cloud backup format is invalid.");
  state=x.state;state.settings.driveBackupFileId=f.id;await saveState({snapshot:true,cloud:false});toast("Cloud backup restored.");render();
}

D.querySelector("#nav").onclick=e=>{const b=e.target.closest("[data-view]");if(b)navigate(b.dataset.view)};
D.querySelector("#quickBackupBtn").onclick=exportBackup;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;D.querySelector("#installBtn").classList.remove("hidden")});
D.querySelector("#installBtn").onclick=async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;D.querySelector("#installBtn").classList.add("hidden")};
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));

(async function init(){
  await loadState();buildCoreTasks();await saveState({cloud:false});
  const hash=location.hash.replace("#","");if(["home","today","week","subjects","backlog","tests","calendar","settings"].includes(hash))currentView=hash;
  render();
})();
