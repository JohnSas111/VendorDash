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
const P=load(ROOT+"/lib/floorMapPanel.ts");
let n=0,f=0;const t=(name,ok,x="")=>{n++;if(!ok)f++;console.log((ok?"PASS":"FAIL")+" | "+name+(ok?"":"  <-- "+JSON.stringify(x)));};
const st=(id,num,price=80000,act=true)=>({id,stall_number:num,is_active:act,price_per_day_cents:price});
const bk=(o)=>({id:"b"+o.stall_id,stall_id:o.stall_id,status:"paid",attending_days:["friday","saturday","sunday"],requested_at:"2026-10-02T04:00:00Z",payment_due_at:"2026-10-05T07:00:00Z",checked_in_at:null,paid_at:"2026-10-03T06:15:00Z",vendor_name:"Fisheatery",owner_name:"Johnny",category:"Seafood",is_verified:true,...o});
const TARGETS=["/(organizer)/(tabs)/booking-requests","/(organizer)/(tabs)/check-in","/(organizer)/(tabs)/stalls"];
const stalls=[st("s1","A1"),st("s2","A2",80000,false),st("s3","A3"),st("s4","A4"),st("s5","A5"),st("s6","A6")];
const by={s1:bk({stall_id:"s1",status:"paid"}),s3:bk({stall_id:"s3",status:"approved",attending_days:["sunday"]}),s4:bk({stall_id:"s4",status:"pending",attending_days:["friday","sunday"]}),s5:bk({stall_id:"s5",status:"checked_in",attending_days:["saturday"],checked_in_at:"2026-10-04T02:00:00Z"})};
// ---------- overview
const o=P.buildOverview(stalls,by,"Oct 2 – Oct 4");
t("O01 counts: 6 stalls -> 1 available, 2 reserved, 2 booked, 1 inactive",JSON.stringify(o.metrics.map(m=>m.value))===JSON.stringify(["1 of 6","2","2","1"]),o.metrics);
t("O02 paid = paid(3d x 800) + checked_in(1d x 800) = 3,200",o.rows[0].value.includes("3,200.00"),o.rows);
t("O03 waiting = approved only (1d x 800) = 800 (pending is not money yet)",o.rows[1].value.includes("800.00")&&!o.rows[1].value.includes("1,"),o.rows);
t("O04 one pending -> singular alert + action",o.alert==="1 request needs your review"&&o.action&&o.action.target===TARGETS[0],o.alert);
const o2=P.buildOverview(stalls,{...by,s6:bk({stall_id:"s6",status:"pending"})},"x");
t("O05 two pending -> plural alert",o2.alert==="2 requests need your review",o2.alert);
const o3=P.buildOverview(stalls,{s1:by.s1},"x");
t("O06 no pending -> no alert, no action",o3.alert===null&&o3.action===null);
const o4=P.buildOverview([],{},"No upcoming session");
t("O07 empty venue is safe (0 of 0, zero money)",o4.metrics[0].value==="0 of 0"&&o4.rows[0].value.includes("0.00"),o4);
t("O08 deactivated stall is counted inactive even if listed",P.buildOverview([st("x","X",1000,false)],{},"s").metrics[3].value==="1");
t("O09 booking for an unknown stall adds no money",P.buildOverview([st("s1","A1")],{zz:bk({stall_id:"zz",status:"paid"})},"s").rows[0].value.includes("0.00"));
t("O10 subtitle is the session label",o.subtitle==="Oct 2 – Oct 4");
// ---------- stall panels
const a=P.buildStallPanel(st("s2","A2",80000,false),undefined);
t("S01 inactive: badge, price row, note, manage-stalls action",a.status==="inactive"&&a.statusLabel==="Inactive"&&a.rows[0].value.includes("800.00")&&a.action.target===TARGETS[2]&&a.vendor===null&&a.days===null,a);
const av=P.buildStallPanel(st("s6","A6"),undefined);
t("S02 available: price, 'no booking' note, edit stall",av.status==="available"&&av.note.includes("No booking")&&av.action.label==="Edit stall"&&av.action.target===TARGETS[2],av);
const pe=P.buildStallPanel(stalls[3],by.s4);
t("S03 pending: 'Waiting for your approval', 2 days -> total 1,600, Review request",pe.rows[0].value==="Waiting for your approval"&&pe.rows[2].value.includes("1,600.00")&&pe.action.label==="Review request"&&pe.action.target===TARGETS[0],pe.rows);
t("S04 pending: status label 'Reserved (unpaid)'",pe.statusLabel==="Reserved (unpaid)");
const ap=P.buildStallPanel(stalls[2],by.s3);
t("S05 approved: 'Pay by' row with a date, total 800",ap.rows[1].label==="Pay by"&&/Oct/.test(ap.rows[1].value)&&ap.rows[2].value.includes("800.00"),ap.rows);
t("S06 approved: opens bookings",ap.action.target===TARGETS[0]);
const pd=P.buildStallPanel(stalls[0],by.s1);
t("S07 paid: 'Booked (paid)', paid date, total 2,400, check-in 'Not yet', Go to check-in",pd.statusLabel==="Booked (paid)"&&/Oct/.test(pd.rows[0].value)&&pd.rows[1].value.includes("2,400.00")&&pd.rows[2].value==="Not yet"&&pd.action.label==="Go to check-in"&&pd.action.target===TARGETS[1],pd.rows);
const ci=P.buildStallPanel(stalls[4],by.s5);
t("S08 checked in: shows when, total 800 (1 day)",/^Checked in /.test(ci.rows[2].value)&&/Oct/.test(ci.rows[2].value)&&ci.rows[1].value.includes("800.00"),ci.rows);
t("S09 day chips: Fri/Sat/Sun with the booked ones on",JSON.stringify(pe.days)===JSON.stringify([{label:"Fri",on:true},{label:"Sat",on:false},{label:"Sun",on:true}]),pe.days);
t("S10 vendor: business name main, owner + category shown, verified",pd.vendor.name==="Fisheatery"&&pd.vendor.owner==="Johnny"&&pd.vendor.category==="Seafood"&&pd.vendor.verified===true,pd.vendor);
const same=P.buildStallPanel(stalls[0],bk({stall_id:"s1",vendor_name:"Mick",owner_name:"Mick"}));
t("S11 owner hidden when it equals the business/person name",same.vendor.owner===null);
const unv=P.buildStallPanel(stalls[0],bk({stall_id:"s1",is_verified:false,category:null}));
t("S12 unverified vendor flagged; missing category is fine",unv.vendor.verified===false&&unv.vendor.category===null);
const nop=P.buildStallPanel(stalls[0],bk({stall_id:"s1",paid_at:null}));
t("S13 paid but no paid_at -> dash, no crash",nop.rows[0].value==="—");
const weird=P.buildStallPanel(stalls[0],bk({stall_id:"s1",status:"weird"}));
t("S14 unexpected booking status does not crash",weird.kind==="stall"&&Array.isArray(weird.rows));
t("S15 inactive stall wins over a booking (never shows a vendor)",P.buildStallPanel(st("s2","A2",80000,false),bk({stall_id:"s2"})).vendor===null);
t("S16 every button goes to a real organizer route",[o,o2,a,av,pe,ap,pd,ci].map(x=>x.action&&x.action.target).filter(Boolean).every(x=>TARGETS.includes(x)));
t("S17 price 0 -> total 0, never negative",P.stallTotalCents(0,["friday"])===0&&P.stallTotalCents(-5,["friday"])===0);
t("S18 no days -> total 0",P.stallTotalCents(80000,[])===0);
t("S19 formatDateTime: null/invalid -> dash",P.formatDateTime(null)==="—"&&P.formatDateTime("nope")==="—"&&P.formatDateTime(undefined)==="—");
t("S20 formatDateTime: valid has month and a time",/Oct 3/.test(P.formatDateTime("2026-10-03T06:15:00Z","Asia/Manila"))&&/2:15 PM/.test(P.formatDateTime("2026-10-03T06:15:00Z","Asia/Manila")),P.formatDateTime("2026-10-03T06:15:00Z","Asia/Manila"));
t("S21 bad timezone name does not crash",typeof P.formatDateTime("2026-10-03T06:15:00Z","Not/AZone")==="string");
t("S22 title is 'Stall <number>'",pd.title==="Stall A1");
const U=load(ROOT+"/lib/uxHelpers.ts");
t("S23 vendorDetails reads object and array shapes",U.vendorDetails({vendor_details:{business_name:"B",category:"Food",is_verified:true}}).category==="Food"&&U.vendorDetails({vendor_details:[{is_verified:true}]}).is_verified===true&&U.vendorDetails(null)===null&&U.vendorDetails({vendor_details:{is_verified:"yes"}}).is_verified===false);
console.log(`\n${n-f}/${n} passed`+(f?` — ${f} FAILED`:""));
