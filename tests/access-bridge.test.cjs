const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'../access-bridge.js'),'utf8');

function boot(saved=new Map(),nav={}){
 const handlers={},timers=new Map();let tid=0;const classList={add(){},remove(){}};
 const elements=new Map();
 const el=id=>{
   if(!elements.has(id))elements.set(id,{id,classList,hidden:true,textContent:'',dataset:{app:'revisor',src:'https://revisor-cargo-l5.vercel.app/?build=test'},addEventListener(){}});
   return elements.get(id);
 };
 const context={
   URL,Uint8Array,crypto:crypto.webcrypto,console:{info(){}},Date,Math,
   location:{href:'https://johngreen017.github.io/apps/revisor-cargo-fiscal/',reload(){}},
   navigator:{platform:nav.platform||'iPhone',userAgent:nav.userAgent||'iPhone',maxTouchPoints:nav.maxTouchPoints??5},
   localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
   document:{getElementById:el,createElement:()=>({}),head:{appendChild(){}}},
   setTimeout:f=>{timers.set(++tid,f);return tid;},clearTimeout:i=>timers.delete(i)
 };
 context.window={addEventListener:(name,f)=>handlers[name]=f,innerWidth:390};
 vm.runInNewContext(source,context);
 const url=new URL(el('app').src),channel=url.searchParams.get('bridge'),sent=[];
 const inner={postMessage:(d,origin)=>sent.push({d,origin})};
 const emit=(d,origin='https://revisor-cargo-l5.vercel.app',src=inner)=>handlers.message({data:{app:'revisor',channel,...d},origin,source:src});
 return {el,url,channel,sent,inner,emit,saved,timers};
}

test('launch assigns src with a persistent typed device and a new channel per opening',()=>{
 const a=boot(),b=boot(a.saved);
 assert.match(a.url.searchParams.get('device'),/^mobile:[a-f0-9]{64}$/);
 assert.equal(a.url.searchParams.get('device'),b.url.searchParams.get('device'));
 assert.notEqual(a.channel,b.channel);
 assert.equal(a.url.origin,'https://revisor-cargo-l5.vercel.app');
 assert.equal(a.url.searchParams.has('direct'),false);
 assert.equal(a.url.searchParams.has('embedded'),false);
});

test('only the exact app Vercel origin and nonce can bind the bridge',async()=>{
 const a=boot();
 await a.emit({type:'apps-bridge-ready',version:1},'https://evil.example');
 await a.emit({type:'apps-bridge-ready',version:1},'https://script.google.com');
 await a.emit({type:'apps-bridge-ready',version:1},'null');
 assert.equal(a.sent.length,0);
 await a.emit({type:'apps-bridge-ready',version:1,channel:'bad'});
 assert.equal(a.sent.length,0);
 await a.emit({type:'apps-bridge-ready',version:1});
 assert.equal(a.sent.length,1);
 assert.equal(a.sent[0].d.type,'apps-bridge-ack');
 assert.equal(a.sent[0].origin,'https://revisor-cargo-l5.vercel.app');
});

test('bound source cannot be replaced by another frame',async()=>{
 const a=boot();
 await a.emit({type:'apps-bridge-ready',version:1});
 await a.emit({type:'apps-bridge-signout',value:true},undefined,{postMessage(){throw Error('wrong frame');}});
 assert.equal(a.saved.get('apps.revisor.signed-out.v1'),undefined);
 await a.emit({type:'apps-bridge-signout',value:true});
 assert.equal(a.saved.get('apps.revisor.signed-out.v1'),'1');
});

test('missing bridge exposes bounded error and a retry action',()=>{
 const a=boot();
 [...a.timers.values()].forEach(f=>f());
 assert.match(a.el('loadingText').textContent,/Último estado: OPENING/);
 assert.equal(a.el('retry').hidden,false);
});

test('all entrypoints use Vercel and never expose Apps Script URLs',()=>{
 const expected={
   'escalafon-online':'https://escalafon-pns.vercel.app/',
   'revisor-cargo-fiscal':'https://revisor-cargo-l5.vercel.app/',
   'simulador-remuneraciones':'https://simulador-remuneraciones-delta.vercel.app/'
 };
 for(const folder of Object.keys(expected)){
   for(const file of ['index.html','windows.html']){
     const html=fs.readFileSync(require('node:path').join(__dirname,'..',folder,file),'utf8');
     assert.match(html,/src="\.\.\/access-bridge\.js\?v=/);
     assert.ok(html.includes(expected[folder]));
     assert.doesNotMatch(html,/script\.google\.com|googleusercontent\.com/);
   }
 }
});
