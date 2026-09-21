/* AstrOlmué — app móvil (PWA estática). Push por Pusher Beams; bandeja guardada en el celular. */
(() => {
  const CFG = window.ASTROLMUE || {};
  const KIND = { alerta: "🌙", captura: "📷", cola: "📋", sync: "📥", error: "⚠️", info: "🔭" };
  const $ = (id) => document.getElementById(id);
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
               set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  // ---- token de dispositivo (viene en el link ?token=…) ----------------------
  const q = new URLSearchParams(location.search);
  // el token se queda en la URL a propósito: al "Agregar a pantalla de inicio" el ícono guarda esta URL
  // (en iPhone la app instalada no comparte almacenamiento con Safari)
  // formato preferido: …/astrolmue-app/<token>/  (iOS conserva la ruta, pero descarta ?token= al instalar)
  const mPath = location.pathname.match(/\/([a-z0-9]{8,24})\/?$/);
  const token = (mPath && mPath[1]) || q.get("token") || LS.get("token");
  if (token) LS.set("token", token);
  const interest = token ? `astrolmue-${token}` : null;

  // ---- bandeja en IndexedDB (la escribe también el service worker) -----------
  const DB = "astrolmue", STORE = "inbox";
  function openDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function all() {
    const db = await openDb();
    return new Promise((res) => {
      const out = []; const c = db.transaction(STORE).objectStore(STORE).openCursor(null, "prev");
      c.onsuccess = () => { const cur = c.result; if (cur) { out.push(cur.value); cur.continue(); } else res(out); };
    });
  }
  async function put(items) {
    const db = await openDb(); const tx = db.transaction(STORE, "readwrite");
    items.forEach((n) => tx.objectStore(STORE).put(n));
    return new Promise((res) => (tx.oncomplete = res));
  }
  async function clear() { const db = await openDb(); db.transaction(STORE, "readwrite").objectStore(STORE).clear(); }

  function fmt(ts) {
    const d = new Date(ts); if (isNaN(d)) return ts || "";
    return d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  async function render() {
    const items = await all();
    const unread = items.filter((n) => !n.read).length;
    $("badge").hidden = !unread; $("badge").textContent = unread;
    if (navigator.setAppBadge) { try { unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge(); } catch {} }
    if (!items.length) return;
    $("inbox").innerHTML = items.map((n) => `
      <div class="mapp-item ${n.read ? "" : "unread"}">
        <div class="mapp-ico">${KIND[n.kind] || "🔭"}</div>
        <div><div class="mapp-title">${esc(n.title)}</div><div class="mapp-body">${esc(n.body)}</div>
          <div class="mapp-when">${fmt(n.ts)}</div></div></div>`).join("");
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  $("btn-read").onclick = async () => { const items = await all(); await put(items.map((n) => ({ ...n, read: true }))); render(); };
  $("btn-clear").onclick = async () => { await clear(); $("inbox").innerHTML = '<p class="mapp-hint">Bandeja vacía.</p>'; render(); };

  // ---- push (Pusher Beams) ---------------------------------------------------
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  $("install-hint").hidden = standalone;
  let swReg = null;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then((r) => { swReg = r; }).catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type !== "notification") return;
      if (e.data.registered) { try { localStorage.removeItem("pending-reg"); } catch {} $("push-msg").innerHTML = '<span class="msg-ok">✓ Registrado en el Mac.</span>'; }
      render();
    });
  }

  async function pushState() {
    if (!token) { $("push-state").innerHTML = '<span class="msg-err">Falta el token: abre la app desde el link que te dieron (…?token=…).</span>'; return; }
    if (!CFG.instanceId && !CFG.vapidPublicKey) { $("push-state").innerHTML = '<span class="msg-err">Falta config.js (correr build_mobile.sh y volver a publicar).</span>'; return; }
    if (!("Notification" in window) || !("PushManager" in window)) {
      $("push-state").textContent = ios && !standalone
        ? "En iPhone: primero agrega la app a la pantalla de inicio y ábrela desde el ícono."
        : "Este navegador no soporta notificaciones push."; return;
    }
    if (Notification.permission === "granted" && LS.get("subscribed") === "1") {
      $("push-state").innerHTML = `<span class="msg-ok">✓ Activadas en este dispositivo (${useWebPush ? "Web Push" : "Pusher Beams"})</span>`;
      $("btn-push").hidden = true;
      const pend = LS.get("pending-reg");
      if (pend && CFG.home) registrar(JSON.parse(pend), LS.get("sub"));
      else if (useWebPush && LS.get("sub") && LS.get("sub-registered") !== "1") showSub(LS.get("sub"));
      return;
    }
    $("push-state").textContent = Notification.permission === "denied"
      ? "Permiso denegado: actívalo en Ajustes → Notificaciones → AstrOlmué." : "Aún no activadas en este dispositivo.";
    $("btn-push").hidden = Notification.permission === "denied";
  }
  const b64 = (k) => { const p = "=".repeat((4 - (k.length % 4)) % 4); const r = atob((k + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
  const useWebPush = !!CFG.vapidPublicKey && (ios || !CFG.instanceId);   // iPhone: Web Push (Apple); Android: Beams
  $("btn-push").onclick = async () => {
    $("push-msg").textContent = "";
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { $("push-msg").textContent = "Permiso no concedido."; return; }
      const reg = swReg || (await navigator.serviceWorker.ready);
      if (useWebPush) {
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(CFG.vapidPublicKey) });
        LS.set("subscribed", "1"); LS.set("sub", JSON.stringify(sub));
        await registrar({ token, sub: JSON.stringify(sub) }, JSON.stringify(sub));
      } else {
        const client = new PusherPushNotifications.Client({ instanceId: CFG.instanceId, serviceWorkerRegistration: reg });
        await client.start();
        await client.addDeviceInterest(interest);
        LS.set("subscribed", "1");
        await registrar({ token, beams: 1 }, null);
      }
      pushState();
    } catch (e) { $("push-msg").innerHTML = `<span class="msg-err">${esc(e.message || e)}</span>`; }
  };
  // registro del dispositivo en el Mac (una sola vez):
  //  1) en casa, por la red local: abre http://<mac>:3000/api/app/registrar?… (CFG.home) — sin terceros
  //  2) relay ntfy (CFG.relay), si está configurado
  //  3) manual: copiar la suscripción y pegarla en el chat
  async function registrar(params, subJson) {
    if (CFG.relay) {
      try {
        const r = await fetch(CFG.relay, { method: "POST", body: JSON.stringify(subJson ? { token, subscription: JSON.parse(subJson) } : { token, beams: true }) });
        if (r.ok) { LS.set("sub-registered", "1"); $("push-msg").innerHTML = '<span class="msg-ok">Listo. En menos de un minuto llega un aviso de confirmación.</span>'; return; }
      } catch {}
    }
    if (CFG.home) {
      LS.set("sub-registered", "1");
      const u = CFG.home.replace(/\/$/, "") + "/api/app/registrar?" + new URLSearchParams(params).toString();
      $("push-msg").innerHTML = `<div class="mapp-hint">Registrando en el Mac (tienes que estar en la misma Wi-Fi)…</div>
        <a class="primary" style="display:block;text-align:center;text-decoration:none;padding:9px;border-radius:10px;background:var(--accent);color:#06101f;font-weight:600;margin-top:8px" href="${u}" target="_blank" rel="noopener">Registrar en el Mac</a>
        <div class="mapp-hint" style="margin-top:6px">Si no estás en casa, hazlo cuando llegues: el botón queda aquí.</div>`;
      LS.set("pending-reg", JSON.stringify(params));
      return;
    }
    if (subJson) showSub(subJson);
    else $("push-msg").innerHTML = '<span class="msg-ok">Listo. Pide una notificación de prueba desde el Mac.</span>';
  }
  // respaldo manual (si el relay no está configurado): la suscripción hay que dársela al Mac una vez (copiar → pegar en el chat de Claude, tool "notificaciones registrar")
  function showSub(json) {
    const reg = LS.get("sub-registered") === "1";
    $("push-msg").innerHTML = reg ? '<span class="msg-ok">Suscripción registrada en el Mac.</span>' : `
      <div class="mapp-hint" style="margin-top:6px">Último paso: copia esta suscripción y pégala en el chat de Claude ("registra esta suscripción para el token ${esc(token)}"), o envíasela a Fernando.</div>
      <textarea id="sub-json" readonly rows="3" style="width:100%;margin-top:6px;font-size:11px;background:var(--bg);color:var(--dim);border:1px solid var(--border);border-radius:8px;padding:6px">${esc(json)}</textarea>
      <div class="row" style="margin-top:6px"><button class="ghost small" id="btn-copy">copiar</button><button class="ghost small" id="btn-share">compartir</button><button class="ghost small" id="btn-done">ya la registré</button></div>`;
    if (reg) return;
    $("btn-copy").onclick = async () => { try { await navigator.clipboard.writeText(json); $("btn-copy").textContent = "copiado ✓"; } catch { $("sub-json").select(); } };
    $("btn-share").onclick = () => { if (navigator.share) navigator.share({ title: `Suscripción AstrOlmué (${token})`, text: json }); };
    $("btn-done").onclick = () => { LS.set("sub-registered", "1"); showSub(json); };
  }

  // ---- tarjeta "Noche": última alerta recibida ------------------------------
  async function loadNight() {
    const a = (await all()).find((n) => n.kind === "alerta"); if (!a) return;
    const grade = /buena/i.test(a.title) ? "buena" : /parcial/i.test(a.title) ? "parcial" : "mala";
    $("night").hidden = false; $("night").className = `card mapp-night ${grade}`;
    $("night-title").textContent = a.title.replace(/^🌙\s*/, ""); $("night-text").textContent = a.body;
    $("night-targets").innerHTML = "";
  }

  $("device-info").textContent = token ? `Dispositivo: ${token}` : "";
  render(); pushState(); loadNight();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { render(); loadNight(); } });
})();
