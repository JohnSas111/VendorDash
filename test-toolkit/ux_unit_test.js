// Usage: PROJECT_ROOT=/path/to/unzipped/project node ux_unit_test.js   (needs node_modules: npm ci --ignore-scripts). Expect 23/23 passed.
const ts=require((process.env.PROJECT_ROOT+"/node_modules/typescript"));const fs=require("fs");
const js=ts.transpileModule(fs.readFileSync(process.env.PROJECT_ROOT+"/lib/uxHelpers.ts","utf8"),{compilerOptions:{module:"CommonJS",target:"ES2022"}}).outputText;
const m={exports:{}};new Function("module","exports",js)(m,m.exports);const {vendorDisplay,ownerPrefix,scrollEdges,splitContainerStyle}=m.exports;
let n=0,f=0;const t=(name,ok,x="")=>{n++;if(!ok)f++;console.log((ok?"PASS":"FAIL")+" | "+name+(ok?"":"  <-- "+x));};
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// vendorDisplay
t("U01 business name wins, person kept as owner",eq(vendorDisplay({full_name:"Johnny",vendor_details:{business_name:"Fisheatery"}}),{name:"Fisheatery",owner:"Johnny"}));
t("U02 embed as one-item array also works",eq(vendorDisplay({full_name:"Mick",vendor_details:[{business_name:"Foods"}]}),{name:"Foods",owner:"Mick"}));
t("U03 no business name -> falls back to the person",eq(vendorDisplay({full_name:"Mick",vendor_details:{business_name:null}}),{name:"Mick",owner:"Mick"}));
t("U04 blank/space business name -> falls back",eq(vendorDisplay({full_name:"Mick",vendor_details:{business_name:"   "}}),{name:"Mick",owner:"Mick"}));
t("U05 nothing at all -> Unknown vendor",eq(vendorDisplay(null),{name:"Unknown vendor",owner:"Unknown vendor"}));
t("U06 vendor_details missing entirely",eq(vendorDisplay({full_name:"Rick"}),{name:"Rick",owner:"Rick"}));
t("U07 names are trimmed",eq(vendorDisplay({full_name:"  Rick ",vendor_details:{business_name:" Craft "}}),{name:"Craft",owner:"Rick"}));
// ownerPrefix
t("U08 prefix shown when different","Johnny · "===ownerPrefix("Fisheatery","Johnny"));
t("U09 no prefix when same",""===ownerPrefix("Mick","Mick"));
t("U10 no prefix for Unknown vendor",""===ownerPrefix("Fisheatery","Unknown vendor"));
// scrollEdges
t("U11 content fits -> no cue",eq(scrollEdges(0,600,500),{canScrollUp:false,canScrollDown:false}));
t("U12 top of long list -> only down",eq(scrollEdges(0,400,640),{canScrollUp:false,canScrollDown:true}));
t("U13 middle -> both",eq(scrollEdges(100,400,640),{canScrollUp:true,canScrollDown:true}));
t("U14 bottom -> only up",eq(scrollEdges(240,400,640),{canScrollUp:true,canScrollDown:false}));
t("U15 within 4px of the bottom counts as bottom",eq(scrollEdges(237,400,640),{canScrollUp:true,canScrollDown:false}));
t("U16 within 4px of the top counts as top",eq(scrollEdges(3,400,640),{canScrollUp:false,canScrollDown:true}));
t("U17 not measured yet (0,0,0) -> no cue",eq(scrollEdges(0,0,0),{canScrollUp:false,canScrollDown:false}));
t("U18 exactly one pixel of overflow is ignored",eq(scrollEdges(0,400,401),{canScrollUp:false,canScrollDown:false}));
// splitContainerStyle
const r=splitContainerStyle({flex:1,width:"100%",maxWidth:640,alignSelf:"center",backgroundColor:"#eee",padding:24,paddingTop:60});
t("U19 flex removed (would stop scrolling)",!("flex" in r.content));
t("U20 background kept for the outer ScrollView",eq(r.outer,{backgroundColor:"#eee"}));
t("U21 padding / maxWidth / alignment kept inside",r.content.padding===24&&r.content.paddingTop===60&&r.content.maxWidth===640&&r.content.alignSelf==="center");
t("U22 undefined style is safe",eq(splitContainerStyle(undefined),{outer:{},content:{}}));
t("U23 input object not mutated",(()=>{const o={flex:1,backgroundColor:"x"};splitContainerStyle(o);return o.flex===1&&o.backgroundColor==="x";})());
console.log(`\n${n-f}/${n} passed`+(f?` — ${f} FAILED`:""));
