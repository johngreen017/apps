/* One authenticated WindowProxy and one startup protocol for all launchers. */
(() => {
  'use strict';
  const app=document.getElementById('app'),shell=document.getElementById('shell');
  const appId=app.dataset.app,googleLayer=document.getElementById('googleLayer'),status=document.getElementById('googleStatus');
  const clientId='892491045559-mt2b7iabv71djbu6icf6rpl2a2fa90e8.apps.googleusercontent.com';
  const prefix=appId==='escalafon'?'escalafon-':'apps-'+appId+'-';
  const logoutKey='apps.'+appId+'.signed-out.v1';
  const trace=document.getElementById('bridgeTrace'),summary=document.getElementById('bridgeSummary');
  const appOrigins={
    escalafon:'https://escalafon-pns.vercel.app',
    revisor:'https://revisor-cargo-l5.vercel.app',
    simulador:'https://simulador-remuneraciones-delta.vercel.app'
  };
  const expectedOrigin=appOrigins[appId]||'';
  let source=null,sourceOrigin='',channel='',timer,lastState='OPENING',googlePromise,googleReady=false,owner=false,oneSignal=null;
  const events=[];
  function log(state,detail=''){
    events.push(new Date().toLocaleTimeString('es-CL')+' '+state+(detail?' · '+detail:''));
    trace.textContent=events.slice(-30).join('\n');summary.textContent='Diagnóstico · '+state;
    console.info('[access]',state,detail);
  }
  function fail(message){clearTimeout(timer);log('ERROR',message);document.getElementById('bridgeDiagnostics').open=true;shell.classList.remove('ready');document.getElementById('loadingText').textContent=message;document.getElementById('retry').hidden=false;}
  function deadline(){clearTimeout(timer);timer=setTimeout(()=>fail('No se completó el acceso. Último estado: '+lastState+'. Pulsa Reintentar.'),45000);}
  function transition(state,detail=''){
    lastState=state;log(state,detail);
    if(['LOGIN_READY','GOOGLE_REQUIRED','GOOGLE_READY','APP_READY'].includes(state)){clearTimeout(timer);shell.classList.add('ready');}
    else if(state==='ERROR'){fail(detail||'No se pudo completar el acceso.');return;}
    else deadline();
    if(state==='APP_READY'){googleLayer.hidden=true;document.getElementById('bridgeDiagnostics').open=false;}
  }
  function hex(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');}
  function stableDevice(){
    let key=localStorage.getItem('apps.admin.device.v1');
    if(!key){key=hex();localStorage.setItem('apps.admin.device.v1',key);}
    if(!/^[a-f0-9]{64}$/.test(key))throw Error('El identificador guardado del dispositivo no es válido.');
    const ua=navigator.userAgent||'',ipad=/iPad/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    return (ipad||/Mobi|Android|iPhone|iPod/i.test(ua)?'mobile':'desktop')+':'+key;
  }
  function trustedOrigin(origin){
    return !!expectedOrigin&&origin===expectedOrigin;
  }
  function send(payload){
    if(!source)return false;
    source.postMessage({...payload,channel,app:appId},sourceOrigin);
    return true;
  }
  function loadGoogle(){
    if(googlePromise)return googlePromise;
    googlePromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
      const t=setTimeout(()=>reject(Error('Google no cargó en 20 segundos. Comprueba tu conexión y reintenta.')),20000);
      script.onload=()=>{clearTimeout(t);window.google?.accounts?.id?resolve():reject(Error('Google no pudo inicializarse.'));};
      script.onerror=()=>{clearTimeout(t);reject(Error('No fue posible cargar el acceso de Google.'));};document.head.appendChild(script);
    });return googlePromise;
  }
  async function showGoogle(){
    transition('GOOGLE_REQUIRED');googleLayer.hidden=false;status.textContent='Preparando Google…';
    try{
      await loadGoogle();
      if(!googleReady){
        google.accounts.id.initialize({client_id:clientId,auto_select:false,cancel_on_tap_outside:false,callback:r=>{
          if(!r.credential){status.textContent='Google no entregó una credencial válida.';return;}
          transition('GOOGLE_VERIFYING');status.textContent='Validando la cuenta…';
          send({type:appId==='escalafon'?'escalafon-google-credential':'apps-admin-google-credential',credential:r.credential});
        }});
        google.accounts.id.renderButton(document.getElementById('googleButton'),{type:'standard',theme:'outline',size:'large',text:'signin_with',shape:'rectangular',width:Math.min(320,window.innerWidth-64),locale:'es'});
        googleReady=true;
      }
      status.textContent='Confirma tu identidad con Google.';transition('GOOGLE_READY');
    }catch(e){status.textContent=e.message;fail(e.message);}
  }
  let pushRegistrationId='',pushRegistrationTimer;
  function pushError(message,needsApi=false){send({type:prefix+'push-status',enabled:false,error:message,needsApi});}
  async function sharePush(){
    if(!owner||!oneSignal)return;
    const enabled=oneSignal.User.PushSubscription.optedIn,id=oneSignal.User.PushSubscription.id;
    if(!enabled||!id){pushRegistrationId='';send({type:prefix+'push-status',enabled:false});return;}
    if(pushRegistrationId===id)return;
    pushRegistrationId=id;
    clearTimeout(pushRegistrationTimer);
    pushRegistrationTimer=setTimeout(()=>{pushRegistrationId='';pushError('El servidor no confirmó el registro. Pulsa Activar notificaciones para reintentar.');},20000);
    send({type:prefix+'push-subscription',subscriptionId:id});
  }
  let pushPromise;
  function ensurePush(){
    if(pushPromise)return pushPromise;
    pushPromise=new Promise((resolve,reject)=>{
      window.OneSignalDeferred=window.OneSignalDeferred||[];
      window.OneSignalDeferred.push(async sdk=>{try{await sdk.init({appId:'0956c8db-37fb-4a11-98bd-397d121ae8fa',serviceWorkerParam:{scope:new URL('.',location.href).pathname},serviceWorkerPath:new URL('OneSignalSDKWorker.js',location.href).pathname});oneSignal=sdk;sdk.User.PushSubscription.addEventListener('change',()=>{pushRegistrationId='';void sharePush();});sdk.Notifications.addEventListener('permissionChange',()=>{pushRegistrationId='';void sharePush();});resolve();await sharePush();}catch(e){reject(e);}});
      const s=document.createElement('script');s.src='https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';s.defer=true;s.onerror=()=>reject(Error('No cargaron las notificaciones.'));document.head.appendChild(s);
    });return pushPromise;
  }
  window.addEventListener('message',async event=>{
    const d=event.data;
    if(!d||typeof d!=='object'||d.channel!==channel||d.app!==appId||!trustedOrigin(event.origin)||!event.source)return;
    if(!source){
      if(d.type!=='apps-bridge-ready'||d.version!==1)return;
      // A nonce unique to this iframe load binds the inner Google frame; origin alone is insufficient.
      source=event.source;sourceOrigin=event.origin;transition('BRIDGE_READY');
      send({type:'apps-bridge-ack',signedOut:localStorage.getItem(logoutKey)==='1'});return;
    }
    if(event.source!==source||event.origin!==sourceOrigin)return;
    if(d.type==='apps-bridge-state'){
      const allowed=['DEVICE_RECEIVED','DEVICE_CHECK','DEVICE_TRUSTED','RESUME_SESSION','SESSION_RESUMED','GOOGLE_VERIFYING','GOOGLE_VALIDATED','TRUST_DEVICE','LOGIN_READY','APP_READY','ERROR'];
      if(allowed.includes(d.state))transition(d.state,typeof d.detail==='string'?d.detail.slice(0,250):'');
    }else if(d.type==='apps-bridge-signout'){
      if(d.value===true)localStorage.setItem(logoutKey,'1');else localStorage.removeItem(logoutKey);
    }else if(d.type==='apps-admin-google-required'||d.type==='escalafon-google-login'){
      if(d.type==='escalafon-google-login'&&!d.visible){googleLayer.hidden=true;return;}await showGoogle();
    }else if(d.type==='apps-admin-google-result'||d.type==='escalafon-google-result'){
      if(d.ok===true){googleLayer.hidden=true;}else{transition('GOOGLE_REQUIRED');googleLayer.hidden=false;status.textContent='Google no pudo validar el acceso. Revisa el mensaje de la aplicación.';}
    }else if(d.type===prefix+'owner-session'){
      owner=d.owner===true;if(owner)ensurePush().catch(e=>pushError(e.message||'No fue posible preparar las notificaciones.'));else{pushRegistrationId='';clearTimeout(pushRegistrationTimer);}
    }else if(d.type===prefix+'push-registration-result'&&owner){
      if(d.subscriptionId!==pushRegistrationId)return;
      clearTimeout(pushRegistrationTimer);
      if(d.ok&&d.apiConfigurada){send({type:prefix+'push-status',enabled:true});}
      else{pushRegistrationId='';pushError(d.error||(d.apiConfigurada===false?'Falta configurar la App API Key de OneSignal en esta aplicación.':'El servidor no confirmó el dispositivo.'),d.ok===true&&d.apiConfigurada===false);}
    }else if(d.type===prefix+'enable-push'&&owner){
      try{await ensurePush();if(!oneSignal.Notifications.isPushSupported())throw Error('En iPhone/iPad, agrega esta app a la pantalla de inicio y ábrela desde su icono para activar notificaciones.');await oneSignal.Notifications.requestPermission();if(!oneSignal.Notifications.permission)throw Error('Permite las notificaciones de esta app en los ajustes del dispositivo.');await oneSignal.User.PushSubscription.optIn();pushRegistrationId='';await sharePush();}catch(e){pushError(e.message||'No fue posible activar las notificaciones.');}
    }
  });
  document.getElementById('retry').onclick=()=>location.reload();
  app.addEventListener('load',()=>log('IFRAME_LOADED'));
  log('LAUNCHER_LOADED');
  try{
    const device=stableDevice();
    const url=new URL(app.dataset.src);
    url.searchParams.set('device',device);
    channel=hex();
    url.searchParams.set('bridge',channel);
    transition('OPENING');
    app.src=url.href;
  }catch(e){fail(e.message||'Habilita el almacenamiento del navegador para identificar este dispositivo.');}
})();

