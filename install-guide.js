(() => {
  'use strict';

  const app = document.getElementById('app');
  if (!app) return;

  const appId = String(app.dataset.app || 'app');
  const appName = document.querySelector('meta[name="application-name"]')?.content || document.title || 'Aplicación';
  const seenKey = 'apps.' + appId + '.install-guide.seen.v1';
  const standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;

  if (standalone) return;

  try {
    if (localStorage.getItem(seenKey) === '1') return;
  } catch (_) {}

  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  let deferredPrompt = null;
  let primaryButton = null;
  let helperText = null;

  function markSeen() {
    try { localStorage.setItem(seenKey, '1'); } catch (_) {}
  }

  function removeGuide(mark = true) {
    if (mark) markSeen();
    document.getElementById('installGuide')?.remove();
  }

  function updateInstallAction() {
    if (!primaryButton || isIOS) return;
    if (deferredPrompt) {
      primaryButton.disabled = false;
      primaryButton.textContent = 'Instalar aplicación';
      if (helperText) helperText.textContent = 'El navegador ya puede instalarla como aplicación.';
    } else {
      primaryButton.disabled = true;
      primaryButton.textContent = 'Instalación desde el navegador';
      if (helperText) {
        helperText.textContent = isAndroid
          ? 'Si no aparece el botón de instalación, usa el menú ⋮ del navegador y elige “Instalar aplicación” o “Agregar a pantalla principal”.'
          : 'Usa el icono de instalación de la barra del navegador o su menú y elige “Instalar aplicación”.';
      }
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    updateInstallAction();
  });

  window.addEventListener('appinstalled', () => {
    markSeen();
    removeGuide(false);
  });

  const style = document.createElement('style');
  style.textContent = `
    #installGuide{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:max(20px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));background:rgba(16,40,31,.72);backdrop-filter:blur(8px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #installGuide .ig-card{width:min(430px,100%);overflow:hidden;background:#fff;border-radius:18px;padding:22px 20px 18px;color:#173d2b;box-shadow:0 18px 50px rgba(0,0,0,.28)}
    #installGuide .ig-kicker{margin:0 0 5px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#557166}
    #installGuide h2{margin:0 0 8px;font-size:23px;line-height:1.2;color:#173d2b}
    #installGuide .ig-intro{margin:0 0 17px;color:#53665e;font-size:15px;line-height:1.45}
    #installGuide .ig-steps{display:grid;gap:10px;margin:0 0 16px}
    #installGuide .ig-step{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:start;padding:10px 11px;border:1px solid #d8e2dc;border-radius:12px;background:#f7faf8}
    #installGuide .ig-num{display:flex;align-items:center;justify-content:center;width:32px;height:32px;min-width:32px;min-height:32px;border-radius:50%;background:#173d2b;color:#fff!important;font-size:15px!important;font-weight:800;line-height:1!important;text-align:center}
    #installGuide .ig-step strong{display:block;margin:1px 0 2px;font-size:15px}
    #installGuide .ig-step>div>span{display:block;color:#5c6c65;font-size:13px;line-height:1.35}
    #installGuide .ig-note{margin:0 0 16px;padding:10px 12px;border-radius:10px;background:#eef4f0;color:#425b50;font-size:13px;line-height:1.4}
    #installGuide .ig-actions{display:grid;gap:9px}
    #installGuide button{min-height:48px;border-radius:10px;border:1px solid #b9cabe;padding:10px 14px;font:700 15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
    #installGuide .ig-primary{background:#173d2b;color:#fff;border-color:#173d2b}
    #installGuide .ig-secondary{background:#fff;color:#173d2b}
    #installGuide button:disabled{opacity:.62;cursor:default}
    @media(max-height:720px){
      #installGuide{padding:max(10px,env(safe-area-inset-top)) 12px max(10px,env(safe-area-inset-bottom))}
      #installGuide .ig-card{padding:15px 16px 13px}
      #installGuide .ig-kicker{font-size:11px}
      #installGuide h2{font-size:20px;margin-bottom:6px}
      #installGuide .ig-intro{font-size:13px;line-height:1.32;margin-bottom:10px}
      #installGuide .ig-steps{gap:7px;margin-bottom:10px}
      #installGuide .ig-step{padding:7px 9px}
      #installGuide .ig-note{margin-bottom:10px;padding:8px 10px;font-size:12px;line-height:1.3}
      #installGuide .ig-actions{gap:7px}
      #installGuide button{min-height:42px;padding:8px 12px;font-size:14px}
    }
  `;
  document.head.appendChild(style);

  const guide = document.createElement('section');
  guide.id = 'installGuide';
  guide.setAttribute('role', 'dialog');
  guide.setAttribute('aria-modal', 'true');
  guide.setAttribute('aria-labelledby', 'installGuideTitle');

  const card = document.createElement('div');
  card.className = 'ig-card';

  const kicker = document.createElement('p');
  kicker.className = 'ig-kicker';
  kicker.textContent = 'Instalación recomendada';

  const title = document.createElement('h2');
  title.id = 'installGuideTitle';
  title.textContent = 'Agrega ' + appName + ' a tu inicio';

  const intro = document.createElement('p');
  intro.className = 'ig-intro';
  intro.textContent = 'Así podrás abrirla como una app, mantener tu dispositivo vinculado y acceder directamente desde su icono.';

  const steps = document.createElement('div');
  steps.className = 'ig-steps';

  function addStep(number, heading, detail) {
    const row = document.createElement('div');
    row.className = 'ig-step';
    const num = document.createElement('span');
    num.className = 'ig-num';
    num.textContent = String(number);
    const text = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = heading;
    const span = document.createElement('span');
    span.textContent = detail;
    text.append(strong, span);
    row.append(num, text);
    steps.appendChild(row);
  }

  if (isIOS) {
    addStep(1, 'Toca Compartir', 'Usa el botón de compartir del navegador.');
    addStep(2, 'Selecciona Más', 'Busca las acciones disponibles si no aparece de inmediato.');
    addStep(3, 'Toca “Agregar a inicio”', 'El nombre “' + appName + '” ya vendrá precargado.');
  } else if (isAndroid) {
    addStep(1, 'Instala la aplicación', 'Usa el botón de abajo cuando esté disponible.');
    addStep(2, 'Confirma la instalación', 'Android agregará el icono a tu pantalla de inicio.');
    addStep(3, 'Abre desde el icono', 'Desde ahí funcionará como una aplicación independiente.');
  } else {
    addStep(1, 'Busca “Instalar” en el navegador', 'Chrome y Edge suelen mostrar un icono de instalación en la barra.');
    addStep(2, 'Confirma', 'La aplicación quedará disponible como acceso independiente.');
    addStep(3, 'Ábrela desde su icono', 'No necesitarás volver al enlace de WhatsApp.');
  }

  const note = document.createElement('p');
  note.className = 'ig-note';
  helperText = note;
  if (isIOS) {
    note.textContent = 'Si abriste el enlace dentro de WhatsApp y no aparece “Agregar a inicio”, elige “Abrir en Safari” y repite estos pasos.';
  } else {
    note.textContent = 'Comprobando si el navegador permite instalación directa…';
  }

  const actions = document.createElement('div');
  actions.className = 'ig-actions';

  primaryButton = document.createElement('button');
  primaryButton.type = 'button';
  primaryButton.className = 'ig-primary';

  if (isIOS) {
    primaryButton.textContent = 'Entendido';
    primaryButton.addEventListener('click', () => removeGuide(true));
  } else {
    primaryButton.textContent = 'Preparando instalación…';
    primaryButton.disabled = true;
    primaryButton.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          markSeen();
          removeGuide(false);
        }
      } finally {
        deferredPrompt = null;
        updateInstallAction();
      }
    });
  }

  const secondary = document.createElement('button');
  secondary.type = 'button';
  secondary.className = 'ig-secondary';
  secondary.textContent = 'Continuar sin instalar';
  secondary.addEventListener('click', () => removeGuide(true));

  actions.append(primaryButton, secondary);
  card.append(kicker, title, intro, steps, note, actions);
  guide.appendChild(card);
  document.body.appendChild(guide);

  updateInstallAction();
})();
