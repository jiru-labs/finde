// Finde — calcula el plan de sábado a domingo de un circuito y lo pinta.
// Todos los datos vienen de datos.json (herramientas/construir.py); aquí no hay llamadas fuera.
const D = await (await fetch("datos.json")).json();
const C = D.ciudades, CIRC = D.circuitos;
const $ = s => document.querySelector(s);

const APARCAR = 15;          // min por tramo: entrar en la ciudad y aparcar
const DESCANSO = 15;         // min por cada 2 h seguidas al volante (DGT)
const LIMITE_SAB = 22 * 60 + 30; // terminar el sábado más tarde ya es mal plan
const MUCHO_VOLANTE = 6 * 60;  // en carretera, paradas incluidas
const AJ = { s1: "08:30", s2: "09:30", fin: "22:00", l: 6.5, p: 1.55, np: false };

let A = { ...AJ };  // ajustes
let S;              // estado del circuito elegido

// ---------- utilidades ----------
const hm = v => { const [a, b] = (v || "00:00").split(":").map(Number); return a * 60 + (b || 0); };
const reloj = m => { m = Math.round(m); const d = m >= 1440 ? " +1" : ""; m %= 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0") + d; };
const dur = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`) : `${r} min`; };
const r05 = x => Math.round(x * 2) / 2;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const circ = id => CIRC.find(c => c.id === id);

function base(id) {
  const c = circ(id) || CIRC[0];
  return { c: c.id, sel: [...c.por_defecto], n: null, inv: false, h: {}, t: null, m: null };  // n null = automática
}
const horas = (st, c) => st.h[c] ?? C[c].horas;
function orden(st) {
  const o = circ(st.c).ciudades.filter(c => st.sel.includes(c));
  return st.inv ? o.reverse() : o;
}
const tramo = (a, b) => D.tramos[[a, b].sort().join("|")];
function conduce(a, b, sinPeajes = A.np) {
  const t = tramo(a, b), v = sinPeajes && t.libre ? t.libre : t;
  return { min: v.min + APARCAR + Math.floor(v.min / 120) * DESCANSO, base: v.min, km: v.km,
           vias: v.vias, peaje: v.peaje_km, viasPeaje: v.peaje_vias, trazado: v.trazado };
}

// ---------- el plan ----------
// Lo que no fija quien planifica —dónde dormir, y cómo repartir las horas de esa ciudad entre la
// tarde del sábado y la mañana del domingo— se elige solo, por este orden: más margen en el PEOR
// de los dos días (fin del sábado contra las 21:30, llegada del domingo contra la hora de vuelta;
// por encima de 2 h ya da igual), reparto más cercano a mitad y mitad, y carretera más repartida.
const OBJ_SAB = 21 * 60 + 30;
function plan(st, sinPeajes = A.np) {
  let mejor = null, nota = null;
  for (const n of st.n ? [st.n] : st.sel) {
    const H = horas(st, n);
    const ts = st.t !== null ? [st.t] : st.m !== null ? [Math.max(0, H - st.m)]
             : Array.from({ length: H * 2 + 1 }, (_, i) => i / 2);
    for (const t of ts) {
      const p = calcular(st, n, t, st.m ?? Math.max(0, H - t), sinPeajes);
      const v = [Math.min(OBJ_SAB - p.finSab, hm(A.fin) - p.llegada, 120), -Math.abs(t - H / 2),
                 -Math.abs(p.dias[0].vol - p.dias[1].vol)];
      if (!nota || v[0] > nota[0] || (v[0] === nota[0] && (v[1] > nota[1] || (v[1] === nota[1] && v[2] > nota[2])))) {
        nota = v; mejor = p;
      }
    }
  }
  return mejor;
}

function calcular(st, n, t, m, sinPeajes) {
  const o = orden(st), ni = o.indexOf(n);
  const tramos = [["Madrid", ...o.slice(0, ni + 1)], [...o.slice(ni), "Madrid"]];
  let km = 0, vol = 0, vis = 0, peaje = 0; const viasPeaje = new Set(), piernas = [];
  const dias = tramos.map((seq, d) => {
    let r = hm(d ? A.s2 : A.s1), volD = 0; const filas = [];
    seq.forEach((c, j) => {
      if (j === 0) {
        if (d === 1) { filas.push({ k: "visita", t: r, c, min: m * 60, nota: "mañana" }); r += m * 60; vis += m * 60; }
        return;
      }
      const x = conduce(seq[j - 1], c, sinPeajes);
      filas.push({ k: "coche", t: r, de: seq[j - 1], a: c, ...x });
      r += x.min; volD += x.min; km += x.km; peaje += x.peaje; x.viasPeaje.forEach(v => viasPeaje.add(v));
      piernas.push(x.trazado);
      if (c === "Madrid") return;
      const noche = d === 0 && c === n, mm = (noche ? t : horas(st, c)) * 60;
      filas.push({ k: "visita", t: r, c, min: mm, nota: noche ? "tarde" : null });
      r += mm; vis += mm;
    });
    vol += volD;
    return { filas, fin: r, vol: volD };
  });
  return { n, t, m, o, dias, km, vol, vis, peaje, viasPeaje: [...viasPeaje].sort(), piernas,
           finSab: dias[0].fin, llegada: dias[1].fin, gasolina: km * A.l / 100 * A.p };
}
function estado(p) {
  const holgura = hm(A.fin) - p.llegada;
  if (holgura < 0 || p.finSab > 24 * 60) return "no";
  if (holgura < 30 || p.finSab > LIMITE_SAB) return "justo";
  return "ok";
}

// ---------- estado en la URL (para compartir un plan) ----------
function aURL() {
  const q = new URLSearchParams(), d = base(S.c);
  q.set("c", S.c);
  if (S.sel.join() !== d.sel.join()) q.set("s", S.sel.join(","));
  if (S.n) q.set("n", S.n);
  if (S.inv) q.set("i", "1");
  const h = Object.entries(S.h).map(([c, v]) => `${c}:${v}`).join(",");
  if (h) q.set("h", h);
  if (S.t !== null) q.set("t", S.t);
  if (S.m !== null) q.set("m", S.m);
  for (const k in AJ) if (String(A[k]) !== String(AJ[k])) q.set(k, A[k] === true ? 1 : A[k]);
  history.replaceState(null, "", "#" + q.toString());
}
function deURL() {
  const q = new URLSearchParams(location.hash.slice(1));
  S = base(q.get("c"));
  const pool = circ(S.c).ciudades, num = v => (v !== null && !isNaN(+v) ? +v : null);
  const sel = (q.get("s") || "").split(",").filter(c => pool.includes(c));
  if (sel.length) S.sel = sel;
  const n = q.get("n");
  if (n && S.sel.includes(n)) S.n = n;
  S.inv = q.get("i") === "1";
  for (const par of (q.get("h") || "").split(",")) {
    const [c, v] = par.split(":");
    if (pool.includes(c) && num(v) !== null) S.h[c] = Math.max(0.5, Math.min(12, +v));
  }
  S.t = num(q.get("t")); S.m = num(q.get("m"));
  for (const k in AJ) if (q.get(k) !== null)
    A[k] = typeof AJ[k] === "boolean" ? q.get(k) === "1" : typeof AJ[k] === "number" ? (num(q.get(k)) ?? AJ[k]) : q.get(k);
}

// ---------- pintar ----------
function pintar() {
  const p = plan(S), e = estado(p);
  pintarCircuitos(); pintarMapa(p); pintarVeredicto(p, e); pintarCifras(p);
  pintarCiudades(p); pintarDias(p); pintarComparar(); aURL();
}

function pintarCircuitos() {
  $("#circuitos").innerHTML = CIRC.map(c => {
    const p = plan(base(c.id)), e = estado(p);
    return `<button type="button" class="circ" role="radio" aria-checked="${c.id === S.c}" data-circ="${c.id}">
      <strong>${esc(c.nombre)}</strong>
      <small><span class="punto ${e}" aria-hidden="true"></span>${p.km} km · ${dur(p.vol)} de carretera · vuelta ${reloj(p.llegada)}</small></button>`;
  }).join("");
}

function pintarVeredicto(p, e) {
  const fin = hm(A.fin), h = fin - p.llegada;
  let t, sub;
  if (e === "no" && h < 0) { t = `No cabe: llegarías a Madrid a las ${reloj(p.llegada)}, ${dur(-h)} tarde.`;
    sub = "Quita una ciudad, recorta horas o sal antes el sábado."; }
  else if (e === "no") { t = `No cabe: el sábado no terminas hasta las ${reloj(p.finSab)}.`;
    sub = "Duerme en una ciudad anterior o pasa horas al domingo."; }
  else if (p.finSab > LIMITE_SAB) { t = `Cabe, pero el sábado terminas a las ${reloj(p.finSab)}.`;
    sub = "Cenas tarde. Prueba a dormir en una ciudad anterior."; }
  else if (e === "justo") { t = `Cabe muy justo: en casa a las ${reloj(p.llegada)}.`;
    sub = `Solo ${dur(h)} de margen antes de las ${A.fin}. Un atasco a la vuelta y no llegas.`; }
  else { t = `Cabe: en casa el domingo a las ${reloj(p.llegada)}.`;
    sub = `Te sobran ${dur(h)} antes de las ${A.fin}.`; }
  const v = $("#veredicto"); v.className = "veredicto " + e;
  v.innerHTML = `${esc(t)}<span>${esc(sub)}</span>`;
}

function pintarCifras(p) {
  const cel = (dt, dd, sm) => `<div><dt>${dt}</dt><dd>${dd}${sm ? `<small>${sm}</small>` : ""}</dd></div>`;
  $("#cifras").innerHTML =
    cel("Distancia", `${p.km} km`) +
    cel("En carretera", dur(p.vol), `${dur(p.dias[0].vol)} + ${dur(p.dias[1].vol)}`) +
    cel("En ciudades", dur(p.vis)) +
    cel("Peaje", p.peaje ? `${p.peaje} km` : "Ninguno", peajeNota(p)) +
    cel("Combustible", `${Math.round(p.gasolina)} €`, `${String(A.l).replace(".", ",")} L/100 km`) +
    cel("En casa", reloj(p.llegada), "el domingo");
}

function peajeNota(p) {
  if (A.np) return p.peaje ? "inevitables" : "evitados";
  if (!p.peaje) return "";
  const q = plan(S, true), m = q.llegada - p.llegada;
  return `${p.viasPeaje.join(", ")} · evitarlos: ${m > 0 ? "+" + dur(m) : "mismo tiempo"}`;
}

function paso(campo, c, valor, cambiado, etiqueta) {
  return `<span class="paso${cambiado ? " cambiado" : ""}" role="group" aria-label="${esc(etiqueta)}">
    <button type="button" data-paso="-1" data-campo="${campo}" data-c="${esc(c)}" aria-label="Menos tiempo">−</button>
    <output>${dur(valor * 60)}</output>
    <button type="button" data-paso="1" data-campo="${campo}" data-c="${esc(c)}" aria-label="Más tiempo">+</button></span>`;
}

function pintarCiudades(p) {
  const pool = circ(S.c).ciudades.slice(), lista = S.inv ? pool.reverse() : pool;
  $("#ciudades").innerHTML = lista.map(c => {
    const dentro = S.sel.includes(c), noche = c === p.n, n = p.o.indexOf(c) + 1;
    let ctrl = "", extra = "";
    if (dentro) {
      if (noche) {
        const { t, m } = p;
        extra = `<div class="partido">Sábado por la tarde ${paso("t", c, t, S.t !== null, "Horas el sábado en " + c)}
                 Domingo por la mañana ${paso("m", c, m, S.m !== null, "Horas el domingo en " + c)}</div>`;
      } else ctrl = paso("h", c, horas(S, c), S.h[c] !== undefined, "Horas en " + c);
      ctrl += `<button type="button" class="luna" data-noche="${esc(c)}" aria-pressed="${noche}" title="Dormir aquí" aria-label="Dormir en ${esc(c)}">☾</button>`;
    } else {
      const q = plan({ ...S, sel: [...S.sel, c] }), e = estado(q);
      const extra = (q.vol + q.vis) - (p.vol + p.vis);
      ctrl = `<span class="coste ${e === "no" ? "nocabe" : "cabe"}">+${dur(extra)}<br>${e === "no" ? "no cabe" : "en casa " + reloj(q.llegada)}</span>`;
    }
    return `<li class="ciudad${dentro ? "" : " fuera"}">
      <input type="checkbox" data-sel="${esc(c)}" ${dentro ? "checked" : ""} aria-label="Incluir ${esc(c)}"${dentro && S.sel.length === 1 ? " disabled" : ""}>
      <div class="nom">${dentro ? `<span class="num">${n}</span>` : ""}${esc(c)}<small>${esc(C[c].region)}${noche ? (S.n ? " · aquí duermes" : " · aquí duermes (lo mejor para cuadrar los dos días)") : ""}</small></div>
      <div class="ctrl">${ctrl}</div>
      <p class="ver">${esc(C[c].ver)}</p>${extra}</li>`;
  }).join("");
}

function badgeVias(vias, ap) {
  return vias.map(v => `<span class="via${ap.includes(v) ? " ap" : ""}">${esc(v)}</span>`).join("");
}
function pintarDias(p) {
  const nombres = ["Sábado", "Domingo"];
  $("#dias").innerHTML = p.dias.map((d, i) => {
    const filas = d.filas.map(f => f.k === "coche"
      ? `<li class="coche"><time>${reloj(f.t)}</time><span class="que">${esc(f.de)} → ${esc(f.a)}${badgeVias(f.vias, f.viasPeaje)}<span class="etq">${f.km} km</span>${f.peaje ? `<span class="peaje">peaje ${f.peaje} km</span>` : ""}</span><span class="dur">${dur(f.min)}</span></li>`
      : `<li class="visita"><time>${reloj(f.t)}</time><span class="que">${esc(f.c)}${f.nota ? `<span class="etq">${f.nota}</span>` : ""}</span><span class="dur">${dur(f.min)}</span></li>`).join("");
    const fin = i === 0 ? `Cena y a dormir en ${esc(p.n)}` : "En casa";
    const avisos = [];
    if (d.vol > MUCHO_VOLANTE) avisos.push(`Más de ${dur(MUCHO_VOLANTE)} en carretera hoy: mejor turnarse`);
    if (i === 0 && d.fin > LIMITE_SAB) avisos.push("Terminas el día muy tarde");
    if (i === 1 && d.fin > hm(A.fin)) avisos.push(`Llegas después de las ${A.fin}`);
    return `<article class="dia"><h3>${nombres[i]}<small>${dur(d.vol)} en carretera · ${i ? "en casa" : "fin"} ${reloj(d.fin)}</small></h3>
      <ol class="tl">${filas}<li class="fin"><time>${reloj(d.fin)}</time><span class="que">${fin}</span><span></span></li></ol>
      ${avisos.map(a => `<span class="aviso">${a}</span>`).join("")}</article>`;
  }).join("");
}

function pintarComparar() {
  $("#comparar").innerHTML = CIRC.map(c => {
    const p = plan(base(c.id)), e = estado(p);
    return `<tr class="${c.id === S.c ? "sel" : ""}"><td><button type="button" data-circ="${c.id}">${esc(c.nombre)}</button></td>
      <td>${c.por_defecto.map(esc).join(", ")}</td><td class="n">${p.km}</td><td class="n">${dur(p.vol)}</td>
      <td class="n">${dur(p.vis)}</td><td class="n">${p.peaje ? p.peaje + " km" : "—"}</td>
      <td class="n${e === "no" ? " tarde" : ""}">${reloj(p.llegada)}</td></tr>`;
  }).join("");
}

// ---------- mapa ----------
function pintarMapa(p) {
  const pool = circ(S.c).ciudades;
  const pts = [C.Madrid.xy, ...pool.map(c => C[c].xy)];
  p.piernas.forEach(t => t.forEach(q => pts.push(q)));
  let x0 = Math.min(...pts.map(q => q[0])), x1 = Math.max(...pts.map(q => q[0]));
  let y0 = Math.min(...pts.map(q => q[1])), y1 = Math.max(...pts.map(q => q[1]));
  const ratio = 1.15, pad = 0.18;
  let w = Math.max(x1 - x0, 140) * (1 + 2 * pad), h = Math.max(y1 - y0, 120) * (1 + 2 * pad);
  if (w / h < ratio) w = h * ratio; else h = w / ratio;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, vx = cx - w / 2, vy = cy - h / 2;
  const k = w / 420; // escala de trazos y letras
  const svg = $("#mapa");
  svg.setAttribute("viewBox", `${vx.toFixed(1)} ${vy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  let s = "";
  for (const [iso, d] of Object.entries(D.mapa.paises))
    s += `<path d="${d}" fill="var(${iso === "ESP" ? "--tierra" : "--tierra-otra"})" stroke="var(--borde)" stroke-width="${0.9 * k}" stroke-linejoin="round"/>`;
  const linea = p.piernas.map(t => `<polyline points="${t.map(q => q.join(",")).join(" ")}"/>`).join("");
  s += `<g fill="none" stroke-linejoin="round" stroke-linecap="round"><g stroke="var(--surface)" stroke-width="${6.5 * k}">${linea}</g><g stroke="var(--via)" stroke-width="${3.4 * k}">${linea}</g></g>`;

  const fs = 14 * k, ocupado = [];
  const solape = r => ocupado.reduce((s, o) =>
    s + Math.max(0, Math.min(r[2], o[2]) - Math.max(r[0], o[0])) * Math.max(0, Math.min(r[3], o[3]) - Math.max(r[1], o[1])), 0);
  const rotulo = (x, y, txt, rad, clase) => {
    const ancho = txt.length * fs * 0.5, alto = fs;
    const cand = [[x + rad + 4 * k, y + fs * 0.35, "start"], [x - rad - 4 * k, y + fs * 0.35, "end"],
                  [x, y - rad - 5 * k, "middle"], [x, y + rad + fs + 2 * k, "middle"]];
    // La primera posición libre; si ninguna lo está, la que menos pisa.
    let elegido = null, rect = null, menor = Infinity;
    for (const c of cand) {
      const lx = c[2] === "start" ? c[0] : c[2] === "end" ? c[0] - ancho : c[0] - ancho / 2;
      const r = [lx, c[1] - alto * 0.85, lx + ancho, c[1] + alto * 0.2], a = solape(r);
      if (a < menor) { menor = a; elegido = c; rect = r; }
      if (a === 0) break;
    }
    ocupado.push(rect);
    return `<text x="${elegido[0]}" y="${elegido[1]}" text-anchor="${elegido[2]}" class="${clase}" font-size="${fs}" paint-order="stroke" stroke="var(--tierra)" stroke-width="${3 * k}" stroke-linejoin="round">${esc(txt)}</text>`;
  };
  // Primero se reservan los puntos, después se colocan los nombres sin pisarlos.
  const marcas = [], textos = [];
  const [mx, my] = C.Madrid.xy;
  ocupado.push([mx - 8 * k, my - 8 * k, mx + 8 * k, my + 8 * k]);
  marcas.push(`<rect x="${mx - 6 * k}" y="${my - 6 * k}" width="${12 * k}" height="${12 * k}" fill="var(--ink)" transform="rotate(45 ${mx} ${my})"/>`);
  pool.forEach(c => {
    const [x, y] = C[c].xy, i = p.o.indexOf(c), r = (i >= 0 ? 10 : 5) * k;
    ocupado.push([x - r, y - r, x + r, y + r]);
    marcas.push(i >= 0
      ? `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--via)" stroke="var(--surface)" stroke-width="${2 * k}"/><text x="${x}" y="${y + 4 * k}" text-anchor="middle" font-size="${11 * k}" font-weight="600" fill="var(--via-ink)">${i + 1}</text>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--surface)" stroke="var(--muted)" stroke-width="${1.4 * k}" stroke-dasharray="${2 * k} ${1.5 * k}"/>`);
  });
  textos.push(rotulo(mx, my, "Madrid", 8 * k, "rot rot-madrid"));
  pool.forEach(c => {
    const [x, y] = C[c].xy, i = p.o.indexOf(c);
    textos.push(rotulo(x, y, c + (c === p.n ? " ☾" : ""), (i >= 0 ? 10 : 5) * k, i >= 0 ? "rot" : "rot rot-fuera"));
  });
  svg.innerHTML = s + marcas.join("") + textos.join("");
}

// ---------- eventos ----------
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-circ],[data-paso],[data-noche]");
  if (!b) return;
  if (b.dataset.circ) { S = base(b.dataset.circ); pintar(); return; }
  if (b.dataset.noche) { S.n = S.n === b.dataset.noche ? null : b.dataset.noche; S.t = S.m = null; pintar(); return; }
  const c = b.dataset.c, d = +b.dataset.paso * 0.5, campo = b.dataset.campo;
  if (campo === "h") S.h[c] = Math.max(0.5, Math.min(12, horas(S, c) + d));
  else {  // al tocar una mitad se fijan las dos, para que la otra no se recoloque sola
    const p = plan(S); S.t = p.t; S.m = p.m; S[campo] = Math.max(0, Math.min(12, p[campo] + d));
  }
  pintar();
});
$("#ciudades").addEventListener("change", ev => {
  const c = ev.target.dataset.sel; if (!c) return;
  if (ev.target.checked) S.sel.push(c);
  else { S.sel = S.sel.filter(x => x !== c); if (S.n === c) { S.n = null; S.t = S.m = null; } }
  pintar();
});
$("#invertir").addEventListener("click", () => { S.inv = !S.inv; pintar(); });
$("#estandar").addEventListener("click", () => { S = base(S.c); pintar(); });
const ponAjuste = k => { const el = $("#" + k); if (el.type === "checkbox") el.checked = A[k]; else el.value = A[k]; };
for (const k in AJ) {
  const el = $("#" + k);
  el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
    if (el.type === "checkbox") A[k] = el.checked;
    else if (typeof AJ[k] === "number") { if (el.value === "" || isNaN(+el.value)) return; A[k] = +el.value; }
    else { if (!el.value) return; A[k] = el.value; }
    pintar();
  });
}
$("#compartir").addEventListener("click", async () => {
  aURL();
  let ok = true;
  try { await navigator.clipboard.writeText(location.href); } catch { ok = false; }
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status");
  t.textContent = ok ? "Enlace copiado: quien lo abra verá este mismo plan" : "Copia la dirección de la barra del navegador";
  document.body.append(t); setTimeout(() => t.remove(), 2600);
});
$("#fuera").innerHTML = `<strong>Lo que no está.</strong> ${esc(D.fuera)}`;
$("#generado").textContent = `Datos de carretera del ${D.generado.split("-").reverse().join("-")}`;

deURL();
for (const k in AJ) ponAjuste(k);
pintar();
