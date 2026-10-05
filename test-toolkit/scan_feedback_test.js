// Usage: PROJECT_ROOT=/path/to/project node floor_panel_test.js   (needs node_modules)
const fs=require("fs"),path=require("path");
const ROOT=process.env.PROJECT_ROOT; const ts=require(ROOT+"/node_modules/typescript");
const cache={};
const RN=new Proxy({StyleSheet:{create:o=>o,flatten:o=>o,hairlineWidth:1},Platform:{OS:"web",select:o=>o.web??o.default??Object.values(o)[0]},Dimensions:{get:()=>({width:1000,height:800})}},{get:(t,k)=>k in t?t[k]:undefined});
function load(file){
  if(cache[file])return cache[file].exports;
  const src=fs.readFileSync(file,"utf8");
  const js=ts.transpileModule(src,{compilerOptions:{module:"CommonJS",target:"ES2022",jsx:"react"}}).outputText;
  const m={exports:{}};cache[file]=m;
  const req=(id)=>{
    if(id==="react-native")return RN;
    if(id.startsWith("@/")){const base=path.join(ROOT,id.slice(2));for(const e of [".ts",".tsx","/index.ts"]) if(fs.existsSync(base+e)) return load(base+e);}
    return new Proxy({}, {get:()=>()=>null});
  };
  new Function("module","exports","require",js)(m,m.exports,req);return m.exports;
}
const S=load(ROOT+"/lib/scanFeedback.ts");
let n=0,f=0;const t=(name,ok,x="")=>{n++;if(!ok)f++;console.log((ok?"PASS":"FAIL")+" | "+name+(ok?"":"  <-- "+JSON.stringify(x)));};
const row=(o={})=>({vendor_name:"Fisheatery",owner_name:"Johnny",stall_number:"A1",days:["friday","saturday","sunday"],...o});
t("F01 days are shown in week order, whatever the stored order",S.daysLabel(["sunday","friday"])==="Fri, Sun",S.daysLabel(["sunday","friday"]));
t("F02 all three days",S.daysLabel(["saturday","sunday","friday"])==="Fri, Sat, Sun");
t("F03 no days -> empty text",S.daysLabel([])==="");
t("F04 unknown day values are ignored",S.daysLabel(["monday","friday"])==="Fri");
t("F05 summary: person, stall and days",S.rowSummary(row())==="Johnny · Stall A1 · Fri, Sat, Sun",S.rowSummary(row()));
t("F06 summary hides the person when it equals the business name",S.rowSummary(row({vendor_name:"Mick",owner_name:"Mick"}))==="Stall A1 · Fri, Sat, Sun");
t("F07 summary hides 'Unknown vendor'",S.rowSummary(row({owner_name:"Unknown vendor"}))==="Stall A1 · Fri, Sat, Sun");
t("F08 summary without days has no dangling separator",S.rowSummary(row({days:[]}))==="Johnny · Stall A1");
const ok=S.scanSuccess(row());
t("F09 success: green type, 'Checked in', business name, summary",ok.type==="success"&&ok.title==="Checked in"&&ok.name==="Fisheatery"&&ok.detail==="Johnny · Stall A1 · Fri, Sat, Sun",ok);
const a1=S.scanAlready(row(),"checked_in"),a2=S.scanAlready(row(),"completed");
t("F10 already checked in is an ERROR (red) with the vendor named",a1.type==="error"&&a1.title==="Already checked in"&&a1.name==="Fisheatery",a1);
t("F11 already completed has its own title",a2.type==="error"&&a2.title==="Already completed",a2);
const u=S.scanUnknown();
t("F12 unknown QR: error, no vendor name, tells you to check the session",u.type==="error"&&u.name===null&&/session/i.test(u.detail)&&u.title==="QR not recognised",u);
const fl=S.scanFailed(row(),"Only paid bookings can be checked in (current status: approved).");
t("F13 server refusal: error, names vendor and stall, shows the server's reason",fl.type==="error"&&fl.name==="Fisheatery"&&/Stall A1/.test(fl.detail)&&/Only paid bookings/.test(fl.detail),fl);
t("F14 time-window refusal text is passed through unchanged",S.scanFailed(row(),"Check-in is only allowed on the vendor's booked days.").detail.endsWith("Check-in is only allowed on the vendor's booked days."));
t("F15 only 'Checked in' is ever green",[a1,a2,u,fl].every(x=>x.type==="error")&&ok.type==="success");
t("F16 every result has a non-empty title and detail",[ok,a1,a2,u,fl].every(x=>x.title.length>0&&x.detail.length>0));
t("F17 input rows are not modified",(()=>{const r=row();const before=JSON.stringify(r);S.scanSuccess(r);S.rowSummary(r);return JSON.stringify(r)===before;})());
console.log(`\n${n-f}/${n} passed`+(f?` — ${f} FAILED`:""));
