// Finde — calcula el plan de sábado a domingo de un circuito y lo pinta.
// Todos los datos vienen de datos.json (herramientas/construir.py); aquí no hay llamadas fuera.
const D = await (await fetch(new URL("datos.json", import.meta.url))).json();
const C = D.ciudades, CIRC = D.circuitos;
const $ = s => document.querySelector(s);
const EN = document.documentElement.lang === "en";

const APARCAR = 15;          // min por tramo: entrar en la ciudad y aparcar
const DESCANSO = 15;         // min por cada 2 h seguidas al volante (DGT)
const LIMITE_SAB = 22 * 60 + 30; // terminar el sábado más tarde ya es mal plan
const MUCHO_VOLANTE = 6 * 60;  // en carretera, paradas incluidas
// l y p a null = los del tipo de coche (datos/coches.json y la mediana de precios del día).
const AJ = { s1: "08:30", s2: "09:30", fin: "22:00", np: false, coche: "media", l: null, p: null };

let A = { ...AJ };  // ajustes
let S;              // estado del circuito elegido

// ---------- utilidades ----------
const hm = v => { const [a, b] = (v || "00:00").split(":").map(Number); return a * 60 + (b || 0); };
const reloj = m => { m = Math.round(m); const d = m >= 1440 ? " +1" : ""; m %= 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0") + d; };
const dur = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`) : `${r} min`; };
const num = (x, dec = 2) => x.toLocaleString(EN ? "en-GB" : "es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const circ = id => CIRC.find(c => c.id === id);
const nom = c => EN ? C[c].en.nombre : c;              // las claves internas siguen en español
const reg = c => EN ? C[c].en.region : C[c].region;
const ver = c => EN ? C[c].en.ver : C[c].ver;
const nomCirc = c => EN ? c.nombre_en : c.nombre;

// ---------- textos que cambian con el plan (los fijos están en datos/textos.json) ----------
const T = EN ? {
  tarjeta: (km, v, l) => `${km} km · ${v} on the road · home ${l}`,
  noTarde: (l, x) => `Doesn't fit: you'd be back in Madrid at ${l}, ${x} late.`, noTardeSub: "Drop a city, cut some hours or leave earlier on Saturday.",
  noSab: f => `Doesn't fit: Saturday doesn't end until ${f}.`, noSabSub: "Sleep in an earlier city or move hours to Sunday.",
  sabTarde: f => `Fits, but Saturday ends at ${f}.`, sabTardeSub: "A late dinner. Try sleeping in an earlier city.",
  justo: l => `Fits, just: home at ${l}.`, justoSub: (h, f) => `Only ${h} to spare before ${f}. One traffic jam on the way back and you're late.`,
  ok: l => `Fits: home on Sunday at ${l}.`, okSub: (h, f) => `${h} to spare before ${f}.`,
  distancia: "Distance", carretera: "On the road", ciudades: "In cities", peaje: "Tolls", ninguno: "None",
  combustible: "Fuel", enCasa: "Home", elDomingo: "on Sunday",
  inevitables: "unavoidable", evitados: "avoided", evitarlos: "avoiding them", mismo: "same time",
  menos: "Less time", mas: "More time", horasEn: c => `Hours in ${c}`, horasSab: c => `Hours on Saturday in ${c}`, horasDom: c => `Hours on Sunday in ${c}`,
  dormirAqui: "Sleep here", dormirEn: c => `Sleep in ${c}`, incluir: c => `Include ${c}`,
  duermes: "You sleep here", auto: "chosen to balance the two days", tuyo: "chosen by you · tap the moon again to go back to automatic",
  partido: h => `Since you sleep here, the visit is split in two: the afternoon you arrive and the morning before you move on. ${h} in total.`,
  tardeSab: "Saturday afternoon", mananaDom: "Sunday morning", soloCena: "just arrive and have dinner", soloSalir: "leave right after breakfast",
  noCabe: "doesn't fit", casa: l => `home ${l}`,
  dias: ["Saturday", "Sunday"], nota: { tarde: "afternoon", manana: "morning" }, peajeKm: k => `toll ${k} km`,
  cena: c => `Dinner and bed in ${c}`, finCasa: "Home",
  mucho: h => `Over ${h} on the road today: take turns driving`, muyTarde: "The day ends very late", despues: f => `You get home after ${f}`,
  cab: (v, i, t) => `${v} on the road · ${i ? "home" : "ends"} ${t}`,
  copiado: "Link copied: anyone who opens it will see this same plan", copiaTu: "Copy the address from the browser bar",
  fueraTit: "What's not here.", generado: f => `Road data from ${f}`,
  coches: { media: "average", gasolina: "petrol", diesel: "diesel", hibrido: "hybrid" },
  fuelMedia: "average of petrol, diesel and hybrid",
  fuelPie: (p, f) => `<strong>Fuel.</strong> By default, the average of what a petrol car (${f(D.coches.gasolina.l, 1)} L/100 km), a diesel (${f(D.coches.diesel.l, 1)}) and a non-plug-in hybrid (${f(D.coches.hibrido.l, 1)}) would use on the motorway, at the national median price on ${p.fecha}: petrol 95 at ${f(p.gasolina, 3)} €/L and diesel at ${f(p.diesel, 3)} €/L (Spanish Ministry for the Ecological Transition, ${p.gasolina_estaciones.toLocaleString("en-GB")} petrol stations). In Settings you can pick your type of car and change the consumption and the price.`,
} : {
  tarjeta: (km, v, l) => `${km} km · ${v} de carretera · vuelta ${l}`,
  noTarde: (l, x) => `No cabe: llegarías a Madrid a las ${l}, ${x} tarde.`, noTardeSub: "Quita una ciudad, recorta horas o sal antes el sábado.",
  noSab: f => `No cabe: el sábado no terminas hasta las ${f}.`, noSabSub: "Duerme en una ciudad anterior o pasa horas al domingo.",
  sabTarde: f => `Cabe, pero el sábado terminas a las ${f}.`, sabTardeSub: "Cenas tarde. Prueba a dormir en una ciudad anterior.",
  justo: l => `Cabe muy justo: en casa a las ${l}.`, justoSub: (h, f) => `Solo ${h} de margen antes de las ${f}. Un atasco a la vuelta y no llegas.`,
  ok: l => `Cabe: en casa el domingo a las ${l}.`, okSub: (h, f) => `Te sobran ${h} antes de las ${f}.`,
  distancia: "Distancia", carretera: "En carretera", ciudades: "En ciudades", peaje: "Peaje", ninguno: "Ninguno",
  combustible: "Combustible", enCasa: "En casa", elDomingo: "el domingo",
  inevitables: "inevitables", evitados: "evitados", evitarlos: "evitarlos", mismo: "mismo tiempo",
  menos: "Menos tiempo", mas: "Más tiempo", horasEn: c => `Horas en ${c}`, horasSab: c => `Horas el sábado en ${c}`, horasDom: c => `Horas el domingo en ${c}`,
  dormirAqui: "Dormir aquí", dormirEn: c => `Dormir en ${c}`, incluir: c => `Incluir ${c}`,
  duermes: "Aquí duermes", auto: "elegida para cuadrar los dos días", tuyo: "elegida por ti · pulsa otra vez la luna para volver al automático",
  partido: h => `Como duermes aquí, la visita se parte en dos: la tarde que llegas y la mañana antes de seguir. En total, ${h}.`,
  tardeSab: "Sábado por la tarde", mananaDom: "Domingo por la mañana", soloCena: "solo llegar y cenar", soloSalir: "sales nada más desayunar",
  noCabe: "no cabe", casa: l => `en casa ${l}`,
  dias: ["Sábado", "Domingo"], nota: { tarde: "tarde", manana: "mañana" }, peajeKm: k => `peaje ${k} km`,
  cena: c => `Cena y a dormir en ${c}`, finCasa: "En casa",
  mucho: h => `Más de ${h} en carretera hoy: mejor turnarse`, muyTarde: "Terminas el día muy tarde", despues: f => `Llegas después de las ${f}`,
  cab: (v, i, t) => `${v} en carretera · ${i ? "en casa" : "fin"} ${t}`,
  copiado: "Enlace copiado: quien lo abra verá este mismo plan", copiaTu: "Copia la dirección de la barra del navegador",
  fueraTit: "Lo que no está.", generado: f => `Datos de carretera del ${f}`,
  coches: { media: "media", gasolina: "gasolina", diesel: "diésel", hibrido: "híbrido" },
  fuelMedia: "media de gasolina, diésel e híbrido",
  fuelPie: (p, f) => `<strong>Combustible.</strong> Por defecto, la media de lo que gastarían en autovía un coche de gasolina (${f(D.coches.gasolina.l, 1)} L/100 km), uno diésel (${f(D.coches.diesel.l, 1)}) y un híbrido no enchufable (${f(D.coches.hibrido.l, 1)}), a la mediana nacional de precios del ${p.fecha}: gasolina 95 a ${f(p.gasolina, 3)} €/L y diésel a ${f(p.diesel, 3)} €/L (Ministerio para la Transición Ecológica, ${p.gasolina_estaciones.toLocaleString("es-ES")} gasolineras). En «Ajustes» puedes elegir tu tipo de coche y cambiar el consumo y el precio.`,
};

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

// ---------- combustible ----------
// Con «media», el coste es la media de los tres tipos de coche, cada uno con su consumo y su
// combustible al precio del día. Con un tipo elegido, su consumo y precio, o los que ponga quien planifica.
const consumo = () => A.l ?? D.coches[A.coche].l;
const precio = () => A.p ?? D.precios[D.coches[A.coche].combustible];
function gasto(km) {
  if (A.coche === "media") {
    const tipos = Object.values(D.coches);
    return tipos.reduce((s, c) => s + km * c.l / 100 * D.precios[c.combustible], 0) / tipos.length;
  }
  return km * consumo() / 100 * precio();
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
        if (d === 1) { filas.push({ k: "visita", t: r, c, min: m * 60, nota: "manana" }); r += m * 60; vis += m * 60; }
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
           finSab: dias[0].fin, llegada: dias[1].fin, gasolina: gasto(km) };
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
  for (const k in AJ) if (A[k] !== AJ[k]) q.set(k, A[k] === true ? 1 : A[k]);
  history.replaceState(null, "", "#" + q.toString());
  const idioma = $("#idioma");   // el otro idioma abre el mismo plan
  idioma.href = idioma.getAttribute("href").split("#")[0] + location.hash;
}
function deURL() {
  const q = new URLSearchParams(location.hash.slice(1));
  S = base(q.get("c"));
  const pool = circ(S.c).ciudades, n_ = v => (v !== null && v !== "" && !isNaN(+v) ? +v : null);
  const sel = (q.get("s") || "").split(",").filter(c => pool.includes(c));
  if (sel.length) S.sel = sel;
  const n = q.get("n");
  if (n && S.sel.includes(n)) S.n = n;
  S.inv = q.get("i") === "1";
  for (const par of (q.get("h") || "").split(",")) {
    const [c, v] = par.split(":");
    if (pool.includes(c) && n_(v) !== null) S.h[c] = Math.max(0.5, Math.min(12, +v));
  }
  S.t = n_(q.get("t")); S.m = n_(q.get("m"));
  for (const k of ["s1", "s2", "fin"]) if (/^\d\d:\d\d$/.test(q.get(k) || "")) A[k] = q.get(k);
  A.np = q.get("np") === "1";
  if (q.get("coche") in D.coches || q.get("coche") === "media") A.coche = q.get("coche");
  if (A.coche !== "media") { A.l = n_(q.get("l")); A.p = n_(q.get("p")); }
}

// ---------- pintar ----------
function pintar() {
  const p = plan(S), e = estado(p);
  pintarCircuitos(); pintarMapa(p); pintarVeredicto(p, e); pintarCifras(p);
  pintarCiudades(p); pintarDias(p); pintarComparar(); pintarAjustes(); aURL();
}

function pintarCircuitos() {
  $("#circuitos").innerHTML = CIRC.map(c => {
    const p = plan(base(c.id)), e = estado(p);
    return `<button type="button" class="circ" role="radio" aria-checked="${c.id === S.c}" data-circ="${c.id}">
      <strong>${esc(nomCirc(c))}</strong>
      <small><span class="punto ${e}" aria-hidden="true"></span>${T.tarjeta(p.km, dur(p.vol), reloj(p.llegada))}</small></button>`;
  }).join("");
}

function pintarVeredicto(p, e) {
  const h = hm(A.fin) - p.llegada;
  let t, sub;
  if (e === "no" && h < 0) { t = T.noTarde(reloj(p.llegada), dur(-h)); sub = T.noTardeSub; }
  else if (e === "no") { t = T.noSab(reloj(p.finSab)); sub = T.noSabSub; }
  else if (p.finSab > LIMITE_SAB) { t = T.sabTarde(reloj(p.finSab)); sub = T.sabTardeSub; }
  else if (e === "justo") { t = T.justo(reloj(p.llegada)); sub = T.justoSub(dur(h), A.fin); }
  else { t = T.ok(reloj(p.llegada)); sub = T.okSub(dur(h), A.fin); }
  const v = $("#veredicto"); v.className = "veredicto " + e;
  v.innerHTML = `${esc(t)}<span>${esc(sub)}</span>`;
}

function pintarCifras(p) {
  const cel = (dt, dd, sm) => `<div><dt>${dt}</dt><dd>${dd}${sm ? `<small>${sm}</small>` : ""}</dd></div>`;
  const nota = A.coche === "media" ? T.fuelMedia
    : `${T.coches[A.coche]} · ${num(consumo(), 1)} L/100 km · ${num(precio(), 2)} €/L`;
  $("#cifras").innerHTML =
    cel(T.distancia, `${p.km} km`) +
    cel(T.carretera, dur(p.vol), `${dur(p.dias[0].vol)} + ${dur(p.dias[1].vol)}`) +
    cel(T.ciudades, dur(p.vis)) +
    cel(T.peaje, p.peaje ? `${p.peaje} km` : T.ninguno, peajeNota(p)) +
    cel(T.combustible, `≈ ${Math.round(p.gasolina)} €`, nota) +
    cel(T.enCasa, reloj(p.llegada), T.elDomingo);
}

function peajeNota(p) {
  if (A.np) return p.peaje ? T.inevitables : T.evitados;
  if (!p.peaje) return "";
  const q = plan(S, true), m = q.llegada - p.llegada;
  return `${p.viasPeaje.join(", ")} · ${T.evitarlos}: ${m > 0 ? "+" + dur(m) : T.mismo}`;
}

function paso(campo, c, valor, cambiado, etiqueta) {
  return `<span class="paso${cambiado ? " cambiado" : ""}" role="group" aria-label="${esc(etiqueta)}">
    <button type="button" data-paso="-1" data-campo="${campo}" data-c="${esc(c)}" aria-label="${T.menos}">−</button>
    <output>${dur(valor * 60)}</output>
    <button type="button" data-paso="1" data-campo="${campo}" data-c="${esc(c)}" aria-label="${T.mas}">+</button></span>`;
}

// La ciudad donde se duerme se ve distinta y explica sus dos contadores con la hora real de cada mitad.
function bloqueNoche(p, c) {
  const tarde = p.dias[0].filas.find(f => f.k === "visita" && f.c === c && f.nota === "tarde");
  const manana = p.dias[1].filas[0];
  const franja = (f, vacio) => f.min ? `${reloj(f.t)} – ${reloj(f.t + f.min)}` : vacio;
  return `<div class="partido">
      <p class="partido-txt">${esc(T.partido(dur((p.t + p.m) * 60)))}</p>
      <div class="mitad"><div><strong>${T.tardeSab}</strong><small>${franja(tarde, T.soloCena)}</small></div>
        ${paso("t", c, p.t, S.t !== null, T.horasSab(nom(c)))}</div>
      <div class="mitad"><div><strong>${T.mananaDom}</strong><small>${franja(manana, T.soloSalir)}</small></div>
        ${paso("m", c, p.m, S.m !== null, T.horasDom(nom(c)))}</div>
    </div>`;
}

function pintarCiudades(p) {
  const pool = circ(S.c).ciudades.slice(), lista = S.inv ? pool.reverse() : pool;
  $("#ciudades").innerHTML = lista.map(c => {
    const dentro = S.sel.includes(c), noche = c === p.n, n = p.o.indexOf(c) + 1;
    let ctrl = "", extra = "", chip = "";
    if (dentro) {
      if (noche) {
        extra = bloqueNoche(p, c);
        chip = `<p class="chip-noche"><span>☾ ${T.duermes}</span> ${S.n ? T.tuyo : T.auto}</p>`;
      } else ctrl = paso("h", c, horas(S, c), S.h[c] !== undefined, T.horasEn(nom(c)));
      ctrl += `<button type="button" class="luna" data-noche="${esc(c)}" aria-pressed="${noche}" title="${T.dormirAqui}" aria-label="${esc(T.dormirEn(nom(c)))}">☾</button>`;
    } else {
      const q = plan({ ...S, sel: [...S.sel, c] }), e = estado(q);
      const mas = (q.vol + q.vis) - (p.vol + p.vis);
      ctrl = `<span class="coste ${e === "no" ? "nocabe" : "cabe"}">+${dur(mas)}<br>${e === "no" ? T.noCabe : T.casa(reloj(q.llegada))}</span>`;
    }
    return `<li class="ciudad${dentro ? "" : " fuera"}${noche ? " noche" : ""}">
      <input type="checkbox" data-sel="${esc(c)}" ${dentro ? "checked" : ""} aria-label="${esc(T.incluir(nom(c)))}"${dentro && S.sel.length === 1 ? " disabled" : ""}>
      <div class="nom">${dentro ? `<span class="num">${n}</span>` : ""}${esc(nom(c))}<small>${esc(reg(c))}</small></div>
      <div class="ctrl">${ctrl}</div>
      ${chip}<p class="ver">${esc(ver(c))}</p>${extra}</li>`;
  }).join("");
}

function badgeVias(vias, ap) {
  return vias.map(v => `<span class="via${ap.includes(v) ? " ap" : ""}">${esc(v)}</span>`).join("");
}
function pintarDias(p) {
  $("#dias").innerHTML = p.dias.map((d, i) => {
    const filas = d.filas.map(f => f.k === "coche"
      ? `<li class="coche"><time>${reloj(f.t)}</time><span class="que">${esc(nom(f.de))} → ${esc(nom(f.a))}${badgeVias(f.vias, f.viasPeaje)}<span class="etq">${f.km} km</span>${f.peaje ? `<span class="peaje">${T.peajeKm(f.peaje)}</span>` : ""}</span><span class="dur">${dur(f.min)}</span></li>`
      : `<li class="visita"><time>${reloj(f.t)}</time><span class="que">${esc(nom(f.c))}${f.nota ? `<span class="etq">☾ ${T.nota[f.nota]}</span>` : ""}</span><span class="dur">${dur(f.min)}</span></li>`).join("");
    const fin = i === 0 ? T.cena(esc(nom(p.n))) : T.finCasa;
    const avisos = [];
    if (d.vol > MUCHO_VOLANTE) avisos.push(T.mucho(dur(MUCHO_VOLANTE)));
    if (i === 0 && d.fin > LIMITE_SAB) avisos.push(T.muyTarde);
    if (i === 1 && d.fin > hm(A.fin)) avisos.push(T.despues(A.fin));
    return `<article class="dia"><h3>${T.dias[i]}<small>${T.cab(dur(d.vol), i, reloj(d.fin))}</small></h3>
      <ol class="tl">${filas}<li class="fin"><time>${reloj(d.fin)}</time><span class="que">${fin}</span><span></span></li></ol>
      ${avisos.map(a => `<span class="aviso">${a}</span>`).join("")}</article>`;
  }).join("");
}

function pintarComparar() {
  $("#comparar").innerHTML = CIRC.map(c => {
    const p = plan(base(c.id)), e = estado(p);
    return `<tr class="${c.id === S.c ? "sel" : ""}"><td><button type="button" data-circ="${c.id}">${esc(nomCirc(c))}</button></td>
      <td>${c.por_defecto.map(x => esc(nom(x))).join(", ")}</td><td class="n">${p.km}</td><td class="n">${dur(p.vol)}</td>
      <td class="n">${dur(p.vis)}</td><td class="n">${p.peaje ? p.peaje + " km" : "—"}</td>
      <td class="n${e === "no" ? " tarde" : ""}">${reloj(p.llegada)}</td></tr>`;
  }).join("");
}

// Con «media» no hay un consumo ni un precio que enseñar: los campos se apagan.
function pintarAjustes() {
  const media = A.coche === "media";
  for (const k of ["l", "p"]) {
    const el = $("#" + k);
    el.disabled = media;
    if (document.activeElement !== el) el.value = media ? "" : num(k === "l" ? consumo() : precio(), k === "l" ? 1 : 3).replace(",", ".");
    el.placeholder = media ? T.coches.media : "";
  }
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
    textos.push(rotulo(x, y, nom(c) + (c === p.n ? " ☾" : ""), (i >= 0 ? 10 : 5) * k, i >= 0 ? "rot" : "rot rot-fuera"));
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
for (const k of ["s1", "s2", "fin"]) {
  const el = $("#" + k); el.value = A[k];
  el.addEventListener("input", () => { if (el.value) { A[k] = el.value; pintar(); } });
}
$("#np").checked = A.np;
$("#np").addEventListener("change", () => { A.np = $("#np").checked; pintar(); });
$("#coche").value = A.coche;
$("#coche").addEventListener("change", () => { A.coche = $("#coche").value; A.l = A.p = null; pintar(); });
for (const k of ["l", "p"]) $("#" + k).addEventListener("input", ev => {
  const v = ev.target.value.replace(",", ".");
  A[k] = v === "" || isNaN(+v) ? null : +v;
  pintar();
});
$("#compartir").addEventListener("click", async () => {
  aURL();
  let ok = true;
  try { await navigator.clipboard.writeText(location.href); } catch { ok = false; }
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status");
  t.textContent = ok ? T.copiado : T.copiaTu;
  document.body.append(t); setTimeout(() => t.remove(), 2600);
});
$("#fuera").innerHTML = `<strong>${T.fueraTit}</strong> ${esc(EN ? D.fuera_en : D.fuera)}`;
$("#pie-combustible").innerHTML = T.fuelPie({ ...D.precios, fecha: EN ? D.precios.fecha.split("/").reverse().join("-") : D.precios.fecha.replaceAll("/", "-") }, num);
$("#generado").textContent = T.generado(EN ? D.generado : D.generado.split("-").reverse().join("-"));

deURL();
pintar();
