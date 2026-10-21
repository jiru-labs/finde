// Finde — calcula el plan de sábado a domingo de un circuito (o de un recorrido propio) y lo pinta.
// Todos los datos vienen de datos.json y catalogo.json (herramientas/construir.py); no hay llamadas fuera.
const D = await (await fetch(new URL("datos.json", import.meta.url))).json();
const C = D.ciudades, CIRC = D.circuitos;
const $ = s => document.querySelector(s);
const EN = document.documentElement.lang === "en";
const PROPIO = "propio";
let K = null;  // catálogo de «Tu recorrido»: se descarga la primera vez que se abre
async function cargaCatalogo() {
  if (!K) K = await (await fetch(new URL("catalogo.json", import.meta.url))).json();
}

const APARCAR = 15;          // min por tramo: entrar en la ciudad y aparcar
const DESCANSO = 15;         // min por cada 2 h seguidas al volante (DGT)
// En tren + coche de alquiler el circuito sale y vuelve a la estación (D.trenes, de herramientas/descargar.py).
const EST = D.trenes.estaciones;
const RECOGER = 30;          // min: recoger el coche en la estación (el mismo RECOGER que descargar.py)
const DEVOLVER = 30;         // min: devolverlo y llegar al andén antes del tren de vuelta
const TREN_DESDE = 7 * 60;   // tren de ida por defecto: el primero que sale de Madrid a partir de esta hora
const TREN_JUSTO = 20;       // menos margen que esto para coger el tren de vuelta = muy justo
const LIMITE_SAB = 22 * 60 + 30; // terminar el sábado más tarde ya es mal plan
const MUCHO_VOLANTE = 6 * 60;  // en carretera, paradas incluidas
// l y p a null = los del tipo de coche (datos/coches.json y la mediana de precios del día).
const AJ = { s1: "08:30", s2: "09:30", fin: "22:00", np: false, coche: "media", l: null, p: null };

let A = { ...AJ };  // ajustes
let S;              // estado del circuito elegido
let propioGuardado = null;  // «Tu recorrido» sobrevive a mirar otros circuitos

// ---------- utilidades ----------
const hm = v => { const [a, b] = (v || "00:00").split(":").map(Number); return a * 60 + (b || 0); };
const reloj = m => { m = Math.round(m); const d = m >= 1440 ? " +1" : ""; m %= 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0") + d; };
const dur = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`) : `${r} min`; };
const num = (x, dec = 2) => x.toLocaleString(EN ? "en-GB" : "es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const plano = s => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const circ = id => CIRC.find(c => c.id === id);
const nom = c => EN ? C[c].en.nombre : c;              // las claves internas siguen en español
const reg = c => EN ? C[c].en.region : C[c].region;
const ver = c => EN ? C[c].en.ver : C[c].ver;
const nomCirc = c => EN ? c.nombre_en : c.nombre;
const esPropio = st => st.c === PROPIO;
const origen = st => st.tren || "Madrid";
// Estaciones que se pueden elegir: las de las ciudades del circuito, o todas en «Tu recorrido».
const estacionesDe = st => esPropio(st) ? Object.keys(EST).sort((a, b) => nom(a).localeCompare(nom(b)))
                                        : circ(st.c).ciudades.filter(c => EST[c]);
// [sale, llega, tipo, estación de Madrid]: el elegido, o el primero desde TREN_DESDE.
function trenIda(st) {
  const l = EST[st.tren].ida, t = st.ti && hm(st.ti);
  return l.find(x => x[0] === t) || l.find(x => x[0] >= TREN_DESDE) || l[l.length - 1];
}

// ---------- textos que cambian con el plan (los fijos están en datos/textos.json) ----------
const T = EN ? {
  tarjeta: (km, v, l) => `${km} km · ${v} on the road · home ${l}`,
  noTarde: (l, x) => `Doesn't fit: you'd be back in Madrid at ${l}, ${x} late.`, noTardeSub: "Drop a city, cut some hours or leave earlier on Saturday.",
  noSab: f => `Doesn't fit: Saturday doesn't end until ${f}.`, noSabSub: "Sleep in an earlier city or move hours to Sunday.",
  sabTarde: f => `Fits, but Saturday ends at ${f}.`, sabTardeSub: "A late dinner. Try sleeping in an earlier city.",
  justo: l => `Fits, just: home at ${l}.`, justoSub: (h, f) => `Only ${h} to spare before ${f}. One traffic jam on the way back and you're late.`,
  ok: l => `Fits: home on Sunday at ${l}.`, okSub: (h, f) => `${h} to spare before ${f}.`,
  lejos: (a, b) => `Doesn't fit: ${a} and ${b} are too far apart for the same weekend.`, lejosSub: "Remove one of them or put a city in between.",
  vacio: "Add your first city with the search box.", vacioSub: "Each result shows how much time it adds and whether you'd still be home on time.",
  distancia: "Distance", carretera: "On the road", ciudades: "In cities", peaje: "Tolls", ninguno: "None",
  combustible: "Fuel", enCasa: "Home", elDomingo: "on Sunday",
  inevitables: "unavoidable", evitados: "avoided", evitarlos: "avoiding them", mismo: "same time",
  menos: "Less time", mas: "More time", horasEn: c => `Hours in ${c}`, horasSab: c => `Hours on Saturday in ${c}`, horasDom: c => `Hours on Sunday in ${c}`,
  dormirAqui: "Sleep here", dormirEn: c => `Sleep in ${c}`, incluir: c => `Include ${c}`,
  subir: c => `Move ${c} earlier`, bajar: c => `Move ${c} later`, quitar: c => `Remove ${c}`,
  duermes: "You sleep here", auto: "chosen to balance the two days", tuyo: "chosen by you · tap the moon again to go back to automatic",
  partido: h => `Since you sleep here, the visit is split in two: the afternoon you arrive and the morning before you move on. ${h} in total.`,
  tardeSab: "Saturday afternoon", mananaDom: "Sunday morning", soloCena: "just arrive and have dinner", soloSalir: "leave right after breakfast",
  noCabe: "doesn't fit", casa: (l, tren) => tren ? `Madrid ${l}` : `home ${l}`, demasiadoLejos: "too far from your route",
  dias: ["Saturday", "Sunday"], nota: { tarde: "afternoon", manana: "morning" }, peajeKm: k => `toll ${k} km`,
  cena: c => `Dinner and bed in ${c}`, finCasa: "Home",
  mucho: h => `Over ${h} on the road today: take turns driving`, muyTarde: "The day ends very late", despues: f => `You get home after ${f}`,
  cab: (v, i, t, tren) => `${v} on the road · ${i ? (tren ? "Madrid" : "home") : "ends"} ${t}`,
  copiado: "Link copied: anyone who opens it will see this same plan", copiaTu: "Copy the address from the browser bar",
  fueraTit: "What's not here.", generado: f => `Road data from ${f}`,
  portada: (c, n, r) => `<b>${c}</b> ready-made routes · <b>${n}</b> places by car or by train · <b>${r}</b> regions · free, no sign-up`,
  propio: "Your own route", propioVacio: n => `＋ Build it with any of ${n} places`,
  sugerencias: "On your way, and you'd still be home on time:", sugerenciasVacio: "To start, the closest ones:",
  resultados: n => n ? `${n} result${n > 1 ? "s" : ""}:` : "No place in the catalogue matches.",
  coches: { media: "average", gasolina: "petrol", diesel: "diesel", hibrido: "hybrid" },
  fuelMedia: "average of petrol, diesel and hybrid",
  sinTren: (e, u) => `Doesn't fit: the last train from ${e} to Madrid leaves at ${u} and you won't make it.`,
  sinTrenSub: l => `You'd have to be back at the station by ${l} to return the car. Cut some hours on Sunday or drop a city.`,
  noTardeTren: (l, x) => `Doesn't fit: the first train you can catch gets to Madrid at ${l}, ${x} late.`,
  noTardeTrenSub: "Cut some hours on Sunday to catch an earlier one, or change the arrival time in Settings.",
  justoTren: (s, h) => `Fits, just: the ${s} train leaves ${h} after you return the car.`,
  justoTrenSub: "One traffic jam on the way back and you miss it.",
  okTren: (s, l) => `Fits: train back at ${s}, in Madrid at ${l}.`,
  okTrenSub: h => `You reach the station with ${h} to spare, on top of the half hour to return the car.`,
  masTarde: (u, h) => ` There are trains until ${u}: you could stay ${h} longer.`,
  tarjetaTren: (e, km, l) => `🚄 to ${e} · ${km} km by car · Madrid ${l}`,
  enTren: "By train", enCoche: "By car", enMadrid: "In Madrid", idaVuelta: (a, b) => `out ${a} · back ${b}`,
  recoger: a => `Pick up the hire car${a ? ` and drive to the centre (${a} min)` : ""}`,
  devolver: a => `${a ? `Drive to the station (${a} min) and r` : "R"}eturn the car`,
  espera: h => `wait ${h}`, finMadrid: e => `In Madrid (${e})`, sinTrenFin: "No train back",
  trenAyuda: (s, d) => `Renfe timetables for Saturday ${s} and Sunday ${d}, direct trains only (no Ouigo or Iryo). The train back is the first one you can catch after returning the car. Check times and fares on renfe.com before you book.`,
  trenPie: (s, d) => `<strong>Train.</strong> The circuits marked 🚄, and any other with a station among its cities, can be done by train from Madrid to that station and by hire car from there; the car is picked up and returned at the same station. Times are Renfe's direct trains for the weekend of ${s} and ${d} (Renfe open data; Ouigo and Iryo are not included). 30 min are added to pick up the car and 30 to return it before the train back. Ticket and car hire prices change every day and are not calculated: check them on renfe.com and with the hire company.`,
  fuelPie: (p, f) => `<strong>Fuel.</strong> By default, the average of what a petrol car (${f(D.coches.gasolina.l, 1)} L/100 km), a diesel (${f(D.coches.diesel.l, 1)}) and a non-plug-in hybrid (${f(D.coches.hibrido.l, 1)}) would use on the motorway, at the national median price on ${p.fecha}: petrol 95 at ${f(p.gasolina, 3)} €/L and diesel at ${f(p.diesel, 3)} €/L (Spanish Ministry for the Ecological Transition, ${p.gasolina_estaciones.toLocaleString("en-GB")} petrol stations). In Settings you can pick your type of car and change the consumption and the price.`,
} : {
  tarjeta: (km, v, l) => `${km} km · ${v} de carretera · vuelta ${l}`,
  noTarde: (l, x) => `No cabe: llegarías a Madrid a las ${l}, ${x} tarde.`, noTardeSub: "Quita una ciudad, recorta horas o sal antes el sábado.",
  noSab: f => `No cabe: el sábado no terminas hasta las ${f}.`, noSabSub: "Duerme en una ciudad anterior o pasa horas al domingo.",
  sabTarde: f => `Cabe, pero el sábado terminas a las ${f}.`, sabTardeSub: "Cenas tarde. Prueba a dormir en una ciudad anterior.",
  justo: l => `Cabe muy justo: en casa a las ${l}.`, justoSub: (h, f) => `Solo ${h} de margen antes de las ${f}. Un atasco a la vuelta y no llegas.`,
  ok: l => `Cabe: en casa el domingo a las ${l}.`, okSub: (h, f) => `Te sobran ${h} antes de las ${f}.`,
  lejos: (a, b) => `No cabe: ${a} y ${b} quedan demasiado lejos para el mismo fin de semana.`, lejosSub: "Quita una de las dos o pon una ciudad en medio.",
  vacio: "Añade tu primera ciudad con el buscador.", vacioSub: "Cada resultado te dice cuánto tiempo añade y si seguirías llegando a tu hora.",
  distancia: "Distancia", carretera: "En carretera", ciudades: "En ciudades", peaje: "Peaje", ninguno: "Ninguno",
  combustible: "Combustible", enCasa: "En casa", elDomingo: "el domingo",
  inevitables: "inevitables", evitados: "evitados", evitarlos: "evitarlos", mismo: "mismo tiempo",
  menos: "Menos tiempo", mas: "Más tiempo", horasEn: c => `Horas en ${c}`, horasSab: c => `Horas el sábado en ${c}`, horasDom: c => `Horas el domingo en ${c}`,
  dormirAqui: "Dormir aquí", dormirEn: c => `Dormir en ${c}`, incluir: c => `Incluir ${c}`,
  subir: c => `Adelantar ${c}`, bajar: c => `Atrasar ${c}`, quitar: c => `Quitar ${c}`,
  duermes: "Aquí duermes", auto: "elegida para cuadrar los dos días", tuyo: "elegida por ti · pulsa otra vez la luna para volver al automático",
  partido: h => `Como duermes aquí, la visita se parte en dos: la tarde que llegas y la mañana antes de seguir. En total, ${h}.`,
  tardeSab: "Sábado por la tarde", mananaDom: "Domingo por la mañana", soloCena: "solo llegar y cenar", soloSalir: "sales nada más desayunar",
  noCabe: "no cabe", casa: (l, tren) => tren ? `en Madrid ${l}` : `en casa ${l}`, demasiadoLejos: "demasiado lejos de tu ruta",
  dias: ["Sábado", "Domingo"], nota: { tarde: "tarde", manana: "mañana" }, peajeKm: k => `peaje ${k} km`,
  cena: c => `Cena y a dormir en ${c}`, finCasa: "En casa",
  mucho: h => `Más de ${h} en carretera hoy: mejor turnarse`, muyTarde: "Terminas el día muy tarde", despues: f => `Llegas después de las ${f}`,
  cab: (v, i, t, tren) => `${v} en carretera · ${i ? (tren ? "en Madrid" : "en casa") : "fin"} ${t}`,
  copiado: "Enlace copiado: quien lo abra verá este mismo plan", copiaTu: "Copia la dirección de la barra del navegador",
  fueraTit: "Lo que no está.", generado: f => `Datos de carretera del ${f}`,
  portada: (c, n, r) => `<b>${c}</b> rutas listas · <b>${n}</b> lugares en coche o en tren · <b>${r}</b> comunidades · gratis y sin registro`,
  propio: "Tu recorrido", propioVacio: n => `＋ Ármalo con cualquiera de ${n} lugares`,
  sugerencias: "Te pillan de camino y seguirías llegando a tu hora:", sugerenciasVacio: "Para empezar, las más cercanas:",
  resultados: n => n ? `${n} resultado${n > 1 ? "s" : ""}:` : "Ningún lugar del catálogo coincide.",
  coches: { media: "media", gasolina: "gasolina", diesel: "diésel", hibrido: "híbrido" },
  fuelMedia: "media de gasolina, diésel e híbrido",
  sinTren: (e, u) => `No cabe: el último tren de ${e} a Madrid sale a las ${u} y no llegas.`,
  sinTrenSub: l => `Tendrías que estar en la estación a las ${l} para devolver el coche. Recorta horas el domingo o quita una ciudad.`,
  noTardeTren: (l, x) => `No cabe: el primer tren que pillas llega a Madrid a las ${l}, ${x} tarde.`,
  noTardeTrenSub: "Recorta horas el domingo para coger uno antes, o cambia la hora de llegada en «Ajustes».",
  justoTren: (s, h) => `Cabe muy justo: el tren de las ${s} sale ${h} después de devolver el coche.`,
  justoTrenSub: "Un atasco a la vuelta y lo pierdes.",
  okTren: (s, l) => `Cabe: tren de vuelta a las ${s}, en Madrid a las ${l}.`,
  okTrenSub: h => `Llegas a la estación con ${h} de margen, además de la media hora para devolver el coche.`,
  masTarde: (u, h) => ` Hay trenes hasta las ${u}: te puedes quedar ${h} más.`,
  tarjetaTren: (e, km, l) => `🚄 a ${e} · ${km} km en coche · Madrid ${l}`,
  enTren: "En tren", enCoche: "En coche", enMadrid: "En Madrid", idaVuelta: (a, b) => `ida ${a} · vuelta ${b}`,
  recoger: a => `Recoger el coche de alquiler${a ? ` e ir al centro (${a} min)` : ""}`,
  devolver: a => `${a ? `Ir a la estación (${a} min) y d` : "D"}evolver el coche`,
  espera: h => `espera ${h}`, finMadrid: e => `En Madrid (${e})`, sinTrenFin: "Sin tren de vuelta",
  trenAyuda: (s, d) => `Horarios de Renfe del sábado ${s} y el domingo ${d}, solo trenes directos (sin Ouigo ni Iryo). El de vuelta es el primero que pillas después de devolver el coche. Comprueba horas y precio en renfe.com antes de comprar.`,
  trenPie: (s, d) => `<strong>Tren.</strong> Los circuitos con 🚄, y cualquier otro con una estación entre sus ciudades, se pueden hacer en tren de Madrid a esa estación y en coche de alquiler desde allí; el coche se recoge y se devuelve en la misma estación. Los horarios son los trenes directos de Renfe del fin de semana del ${s} y el ${d} (datos abiertos de Renfe; Ouigo e Iryo no están). Se suman 30 min para recoger el coche y 30 para devolverlo antes del tren de vuelta. El billete y el alquiler cambian de precio cada día y no se calculan: míralos en renfe.com y en la empresa de alquiler.`,
  fuelPie: (p, f) => `<strong>Combustible.</strong> Por defecto, la media de lo que gastarían en autovía un coche de gasolina (${f(D.coches.gasolina.l, 1)} L/100 km), uno diésel (${f(D.coches.diesel.l, 1)}) y un híbrido no enchufable (${f(D.coches.hibrido.l, 1)}), a la mediana nacional de precios del ${p.fecha}: gasolina 95 a ${f(p.gasolina, 3)} €/L y diésel a ${f(p.diesel, 3)} €/L (Ministerio para la Transición Ecológica, ${p.gasolina_estaciones.toLocaleString("es-ES")} gasolineras). En «Ajustes» puedes elegir tu tipo de coche y cambiar el consumo y el precio.`,
};

// tren = estación a la que se va en tren (null = en coche desde Madrid); ti = hora de salida del tren de ida.
function base(id) {
  if (id === PROPIO) return { c: PROPIO, sel: [], n: null, inv: false, h: {}, t: null, m: null, tren: null, ti: null };
  const c = circ(id) || CIRC[0];
  return { c: c.id, sel: [...c.por_defecto], n: null, inv: false, h: {}, t: null, m: null,  // n null = automática
           tren: c.tren?.estacion ?? null, ti: c.tren?.ida ?? null };
}
const horas = (st, c) => st.h[c] ?? C[c].horas;
// En un circuito el orden es el suyo; en «Tu recorrido», el de la lista (sel ya va en orden de ruta).
function orden(st) {
  const o = esPropio(st) ? [...st.sel] : circ(st.c).ciudades.filter(c => st.sel.includes(c));
  return st.inv ? o.reverse() : o;
}

// Un tramo sale del detalle de los circuitos si existe, si no del catálogo. null = demasiado lejos.
function tramo(a, b, sinPeajes) {
  const k = [a, b].sort().join("|"), t = D.tramos[k];
  if (t) {
    const v = sinPeajes && t.libre ? t.libre : t;
    return { min: v.min, km: v.km, vias: v.vias, peaje: v.peaje_km, viasPeaje: v.peaje_vias, trazado: v.trazado };
  }
  const c = K?.tramos[k];
  if (!c) return null;
  const v = sinPeajes && c[6] ? c[6] : c;
  return { min: v[0], km: v[1], peaje: v[2], vias: v[3], viasPeaje: v[4], trazado: desplano(v[5]) };
}
// El catálogo guarda el trazado plano y en diferencias de medio punto (ver construir.py).
function desplano(f) {
  const out = [];
  for (let i = 0, x = 0, y = 0; i < f.length; i += 2) { x += f[i]; y += f[i + 1]; out.push([x / 2, y / 2]); }
  return out;
}
function conduce(a, b, sinPeajes = A.np) {
  const t = tramo(a, b, sinPeajes);
  return t && { ...t, base: t.min, min: t.min + APARCAR + Math.floor(t.min / 120) * DESCANSO };
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
  if (!st.sel.length) return null;
  let mejor = null, nota = null;
  for (const n of st.n ? [st.n] : st.sel) {
    const H = horas(st, n);
    const ts = st.t !== null ? [st.t] : st.m !== null ? [Math.max(0, H - st.m)]
             : Array.from({ length: H * 2 + 1 }, (_, i) => i / 2);
    for (const t of ts) {
      const p = calcular(st, n, t, st.m ?? Math.max(0, H - t), sinPeajes);
      if (p.imposible) return p;  // un tramo sin ruta no lo arregla ninguna noche
      // En tren cuenta también el margen para coger el de vuelta: 20 min ahí pesan como 30 de llegar a casa.
      // Sin tren posible, el plan que menos se pasa del último.
      const v = [p.sinTren ? -1e4 - (p.sinTren.listo - p.sinTren.ultimo[0])
                 : Math.min(OBJ_SAB - p.finSab, hm(A.fin) - p.llegada, (p.margenTren ?? 1e4) + 10, 120),
                 -Math.abs(t - H / 2), -Math.abs(p.dias[0].vol - p.dias[1].vol)];
      if (!nota || v[0] > nota[0] || (v[0] === nota[0] && (v[1] > nota[1] || (v[1] === nota[1] && v[2] > nota[2])))) {
        nota = v; mejor = p;
      }
    }
  }
  return mejor;
}

// En tren, el sábado empieza al recoger el coche en la estación, y el domingo acaba al devolverlo y
// coger el primer tren que da tiempo; «llegada» es entonces la hora a la que ese tren llega a Madrid.
function calcular(st, n, t, m, sinPeajes) {
  const o = orden(st), ni = o.indexOf(n), E = origen(st), tren = st.tren && EST[st.tren], ida = tren && trenIda(st);
  const tramos = [[E, ...o.slice(0, ni + 1)], [...o.slice(ni), E]];
  let km = 0, vol = 0, vis = 0, peaje = 0, imposible = null, sinTren = null, margenTren = null;
  const viasPeaje = new Set(), piernas = [];
  const dias = tramos.map((seq, d) => {
    let r = d ? hm(A.s2) : tren ? ida[1] + RECOGER + tren.acceso : hm(A.s1), volD = 0; const filas = [];
    if (tren && !d) filas.push({ k: "tren", t: ida[0], llega: ida[1], tipo: ida[2], de: "Madrid " + ida[3], a: tren.estacion },
                               { k: "alquiler", t: ida[1], min: RECOGER + tren.acceso, txt: T.recoger(tren.acceso) });
    seq.forEach((c, j) => {
      if (imposible) return;
      if (j === 0) {
        if (d === 1) { filas.push({ k: "visita", t: r, c, min: m * 60, nota: "manana" }); r += m * 60; vis += m * 60; }
        return;
      }
      if (seq[j - 1] !== c) {   // la estación también puede ser la primera ciudad que se ve: ahí no se conduce
        const x = conduce(seq[j - 1], c, sinPeajes);
        if (!x) { imposible = [seq[j - 1], c]; return; }
        filas.push({ k: "coche", t: r, de: seq[j - 1], a: c, ...x });
        r += x.min; volD += x.min; km += x.km; peaje += x.peaje; x.viasPeaje.forEach(v => viasPeaje.add(v));
        piernas.push(x.trazado);
      }
      if (d === 1 && j === seq.length - 1) return;   // de vuelta en Madrid o en la estación
      const noche = d === 0 && c === n, mm = (noche ? t : horas(st, c)) * 60;
      filas.push({ k: "visita", t: r, c, min: mm, nota: noche ? "tarde" : null });
      r += mm; vis += mm;
    });
    if (tren && d && !imposible) {
      const listo = r + DEVOLVER + tren.acceso, v = tren.vuelta.find(x => x[0] >= listo);
      filas.push({ k: "alquiler", t: r, min: DEVOLVER + tren.acceso, txt: T.devolver(tren.acceso) });
      if (!v) sinTren = { listo, ultimo: tren.vuelta[tren.vuelta.length - 1] };
      else {
        margenTren = v[0] - listo;
        filas.push({ k: "tren", t: v[0], llega: v[1], tipo: v[2], de: tren.estacion, a: "Madrid " + v[3], espera: margenTren, vuelta: v });
        r = v[1];
      }
    }
    vol += volD;
    return { filas, fin: r, vol: volD };
  });
  return { n, t, m, o, dias, km, vol, vis, peaje, viasPeaje: [...viasPeaje].sort(), piernas, imposible,
           finSab: dias[0].fin, llegada: dias[1].fin, gasolina: gasto(km),
           tren: tren ? { e: st.tren, ida, vuelta: dias[1].filas.find(f => f.vuelta)?.vuelta } : null, sinTren, margenTren };
}
function estado(p) {
  if (!p) return "vacio";
  if (p.imposible || p.sinTren) return "no";
  const holgura = hm(A.fin) - p.llegada;
  if (holgura < 0 || p.finSab > 24 * 60) return "no";
  // En tren el riesgo no es llegar tarde a casa, que tiene hora fija, sino perder el tren de vuelta.
  if ((p.tren ? p.margenTren < TREN_JUSTO : holgura < 30) || p.finSab > LIMITE_SAB) return "justo";
  return "ok";
}

// ---------- «Tu recorrido»: dónde meter una ciudad, y el mejor orden ----------
const minutos = (a, b) => a === b ? 0 : tramo(a, b, A.np)?.min;
function inserta(sel, c, E = origen(S)) {   // en la posición que menos conducción añade
  let mejor = null, coste = Infinity;
  for (let i = 0; i <= sel.length; i++) {
    const a = i ? sel[i - 1] : E, b = i < sel.length ? sel[i] : E;
    const ac = minutos(a, c), cb = minutos(c, b), ab = minutos(a, b);
    if (ac == null || cb == null) continue;
    const d = ac + cb - (ab ?? 0);
    if (d < coste) { coste = d; mejor = i; }
  }
  if (mejor === null) return null;
  const s = [...sel]; s.splice(mejor, 0, c); return s;
}
function ordenMejor(sel, E = origen(S)) {   // todas las permutaciones hasta 7 ciudades (5.040); más no cabe en un finde
  if (sel.length < 3 || sel.length > 7) return sel;
  const largo = o => { let t = 0, a = E;
    for (const c of [...o, E]) { const m = minutos(a, c); if (m == null) return Infinity; t += m; a = c; } return t; };
  let mejor = sel, min = largo(sel);
  const permuta = (hecho, resto) => {
    if (!resto.length) { const l = largo(hecho); if (l < min) { min = l; mejor = hecho; } return; }
    resto.forEach((c, i) => permuta([...hecho, c], [...resto.slice(0, i), ...resto.slice(i + 1)]));
  };
  permuta([], sel);
  return mejor;
}
// Qué supone añadir c al recorrido actual: plan resultante, tiempo extra y si cabe.
function siAnado(c, p) {
  const sel = inserta(S.sel, c);
  if (!sel) return { lejos: true };
  const q = plan({ ...S, sel, inv: false, n: S.n && sel.includes(S.n) ? S.n : null });
  if (!q || q.imposible) return { lejos: true };
  return { q, mas: (q.vol + q.vis) - (p ? p.vol + p.vis : 0), cabe: estado(q) !== "no" };
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
  if (S.tren !== d.tren) q.set("e", S.tren ?? "coche");
  if (S.tren && S.ti && S.ti !== d.ti) q.set("ti", S.ti);
  for (const k in AJ) if (A[k] !== AJ[k]) q.set(k, A[k] === true ? 1 : A[k]);
  history.replaceState(null, "", "#" + q.toString());
  const idioma = $("#idioma");   // el otro idioma abre el mismo plan
  idioma.href = idioma.getAttribute("href").split("#")[0] + location.hash;
}
async function deURL() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get("c") === PROPIO) await cargaCatalogo();
  S = base(q.get("c"));
  const pool = esPropio(S) ? K.lugares.filter(c => c !== "Madrid") : circ(S.c).ciudades;
  const n_ = v => (v !== null && v !== "" && !isNaN(+v) ? +v : null);
  const sel = [...new Set((q.get("s") || "").split(",").filter(c => pool.includes(c)))];
  if (sel.length) S.sel = sel;
  const n = q.get("n");
  if (n && S.sel.includes(n)) S.n = n;
  S.inv = q.get("i") === "1";
  for (const par of (q.get("h") || "").split(",")) {
    const [c, v] = par.split(":");
    if (pool.includes(c) && n_(v) !== null) S.h[c] = Math.max(0.5, Math.min(12, +v));
  }
  S.t = n_(q.get("t")); S.m = n_(q.get("m"));
  const e = q.get("e");
  if (e === "coche") S.tren = null;
  else if (estacionesDe(S).includes(e)) { S.tren = e; S.ti = null; }
  if (S.tren && /^\d\d:\d\d$/.test(q.get("ti") || "")) S.ti = q.get("ti");
  for (const k of ["s1", "s2", "fin"]) if (/^\d\d:\d\d$/.test(q.get(k) || "")) A[k] = q.get(k);
  A.np = q.get("np") === "1";
  if (q.get("coche") in D.coches || q.get("coche") === "media") A.coche = q.get("coche");
  if (A.coche !== "media") { A.l = n_(q.get("l")); A.p = n_(q.get("p")); }
}

// ---------- pintar ----------
function pintar() {
  const p = plan(S), e = estado(p), propio = esPropio(S);
  for (const [id, ver_] of [["#estandar", !propio], ["#editar", !propio], ["#ordenar", propio && S.sel.length > 2],
                            ["#vaciar", propio && S.sel.length > 0], ["#invertir", S.sel.length > 1],
                            ["#ayuda-circ", !propio], ["#ayuda-propio", propio], ["#buscador", propio]])
    $(id).hidden = !ver_;
  pintarCircuitos(); pintarModo(); pintarMapa(p); pintarVeredicto(p, e); pintarCifras(p);
  pintarCiudades(p); if (propio) pintarBuscador(p);
  pintarDias(p); pintarComparar(); pintarAjustes(); aURL();
}

function pintarCircuitos() {
  const tarjetas = CIRC.map(c => {
    const b = base(c.id), p = plan(b), e = estado(p);
    const txt = b.tren ? T.tarjetaTren(nom(b.tren), p.km, reloj(p.llegada)) : T.tarjeta(p.km, dur(p.vol), reloj(p.llegada));
    return `<button type="button" class="circ" role="radio" aria-checked="${c.id === S.c}" data-circ="${c.id}">
      <strong>${esc(nomCirc(c))}</strong>
      <small><span class="punto ${e}" aria-hidden="true"></span>${esc(txt)}</small></button>`;
  });
  const g = esPropio(S) ? S : propioGuardado, gp = g && g.sel.length ? plan(g) : null, ge = estado(gp);
  const resumen = gp && !gp.imposible
    ? `<span class="punto ${ge}" aria-hidden="true"></span>${g.tren ? "🚄 " : ""}${g.sel.map(nom).map(esc).join(", ")} · ${T.casa(reloj(gp.llegada), g.tren)}`
    : T.propioVacio(D.catalogo_n);
  tarjetas.push(`<button type="button" class="circ circ-propio" role="radio" aria-checked="${esPropio(S)}" data-circ="${PROPIO}">
      <strong>${T.propio}</strong><small>${resumen}</small></button>`);
  $("#circuitos").innerHTML = tarjetas.join("");
}

function pintarVeredicto(p, e) {
  let t, sub;
  if (!p) { t = T.vacio; sub = T.vacioSub; }
  else if (p.imposible) { t = T.lejos(nom(p.imposible[0]), nom(p.imposible[1])); sub = T.lejosSub; }
  else if (p.sinTren) { t = T.sinTren(nom(p.tren.e), reloj(p.sinTren.ultimo[0])); sub = T.sinTrenSub(reloj(p.sinTren.ultimo[0] - DEVOLVER - EST[p.tren.e].acceso)); }
  else if (p.tren) {
    const h = hm(A.fin) - p.llegada, sale = reloj(p.tren.vuelta[0]);
    if (h < 0) { t = T.noTardeTren(reloj(p.llegada), dur(-h)); sub = T.noTardeTrenSub; }
    else if (e === "no") { t = T.noSab(reloj(p.finSab)); sub = T.noSabSub; }
    else if (p.finSab > LIMITE_SAB) { t = T.sabTarde(reloj(p.finSab)); sub = T.sabTardeSub; }
    else if (e === "justo") { t = T.justoTren(sale, dur(p.margenTren)); sub = T.justoTrenSub; }
    else {
      t = T.okTren(sale, reloj(p.llegada)); sub = T.okTrenSub(dur(p.margenTren));
      // El último tren que aún te deja en Madrid a tu hora: lo que se puede alargar el domingo.
      const u = EST[p.tren.e].vuelta.filter(x => x[1] <= hm(A.fin)).pop();
      if (u && u[0] - p.tren.vuelta[0] >= 60) sub += T.masTarde(reloj(u[0]), dur(u[0] - p.tren.vuelta[0]));
    }
  }
  else {
    const h = hm(A.fin) - p.llegada;
    if (e === "no" && h < 0) { t = T.noTarde(reloj(p.llegada), dur(-h)); sub = T.noTardeSub; }
    else if (e === "no") { t = T.noSab(reloj(p.finSab)); sub = T.noSabSub; }
    else if (p.finSab > LIMITE_SAB) { t = T.sabTarde(reloj(p.finSab)); sub = T.sabTardeSub; }
    else if (e === "justo") { t = T.justo(reloj(p.llegada)); sub = T.justoSub(dur(h), A.fin); }
    else { t = T.ok(reloj(p.llegada)); sub = T.okSub(dur(h), A.fin); }
  }
  const v = $("#veredicto"); v.className = "veredicto " + e;
  v.innerHTML = `${esc(t)}<span>${esc(sub)}</span>`;
}

function pintarCifras(p) {
  const el = $("#cifras");
  el.hidden = !p || !!p.imposible || !!p.sinTren;
  if (el.hidden) return;
  const cel = (dt, dd, sm) => `<div><dt>${dt}</dt><dd>${dd}${sm ? `<small>${sm}</small>` : ""}</dd></div>`;
  const nota = A.coche === "media" ? T.fuelMedia
    : `${T.coches[A.coche]} · ${num(consumo(), 1)} L/100 km · ${num(precio(), 2)} €/L`;
  const tr = p.tren, tramoTren = x => `${reloj(x[0])} → ${reloj(x[1])}`;
  el.innerHTML =
    (tr ? cel(T.enTren, dur(tr.ida[1] - tr.ida[0] + tr.vuelta[1] - tr.vuelta[0]), T.idaVuelta(tramoTren(tr.ida), tramoTren(tr.vuelta)))
        + cel(T.enCoche, `${p.km} km`, dur(p.vol))
        : cel(T.distancia, `${p.km} km`) + cel(T.carretera, dur(p.vol), `${dur(p.dias[0].vol)} + ${dur(p.dias[1].vol)}`)) +
    cel(T.ciudades, dur(p.vis)) +
    cel(T.peaje, p.peaje ? `${p.peaje} km` : T.ninguno, peajeNota(p)) +
    cel(T.combustible, `≈ ${Math.round(p.gasolina)} €`, nota) +
    cel(tr ? T.enMadrid : T.enCasa, reloj(p.llegada), T.elDomingo);
}

function peajeNota(p) {
  if (A.np) return p.peaje ? T.inevitables : T.evitados;
  if (!p.peaje) return "";
  const q = plan(S, true), m = q && !q.imposible && !q.sinTren ? q.llegada - p.llegada : 0;
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
  const franja = (f, vacio) => f && f.min ? `${reloj(f.t)} – ${reloj(f.t + f.min)}` : vacio;
  return `<div class="partido">
      <p class="partido-txt">${esc(T.partido(dur((p.t + p.m) * 60)))}</p>
      <div class="mitad"><div><strong>${T.tardeSab}</strong><small>${franja(tarde, T.soloCena)}</small></div>
        ${paso("t", c, p.t, S.t !== null, T.horasSab(nom(c)))}</div>
      <div class="mitad"><div><strong>${T.mananaDom}</strong><small>${franja(manana, T.soloSalir)}</small></div>
        ${paso("m", c, p.m, S.m !== null, T.horasDom(nom(c)))}</div>
    </div>`;
}

function pintarCiudades(p) {
  const propio = esPropio(S);
  const lista = propio ? orden(S) : (S.inv ? circ(S.c).ciudades.slice().reverse() : circ(S.c).ciudades);
  const valido = p && !p.imposible;
  $("#ciudades").innerHTML = lista.map((c, i) => {
    const dentro = S.sel.includes(c), noche = valido && c === p.n, n = valido ? p.o.indexOf(c) + 1 : i + 1;
    let ctrl = "", extra = "", chip = "", izq;
    if (dentro) {
      if (noche) {
        extra = bloqueNoche(p, c);
        chip = `<p class="chip-noche"><span>☾ ${T.duermes}</span> ${S.n ? T.tuyo : T.auto}</p>`;
      } else ctrl = paso("h", c, horas(S, c), S.h[c] !== undefined, T.horasEn(nom(c)));
      ctrl += `<button type="button" class="luna" data-noche="${esc(c)}" aria-pressed="${noche}" title="${T.dormirAqui}" aria-label="${esc(T.dormirEn(nom(c)))}">☾</button>`;
    } else {
      const q = plan({ ...S, sel: [...S.sel, c] }), e = estado(q);
      const mas = (q.vol + q.vis) - (p.vol + p.vis);
      ctrl = `<span class="coste ${e === "no" ? "nocabe" : "cabe"}">+${dur(mas)}<br>${e === "no" ? T.noCabe : T.casa(reloj(q.llegada), S.tren)}</span>`;
    }
    if (propio) {  // en «Tu recorrido» no hay casilla: se quita con ✕ y se mueve con las flechas
      izq = `<span class="mover">
        <button type="button" data-mover="-1" data-c="${esc(c)}" aria-label="${esc(T.subir(nom(c)))}"${i === 0 ? " disabled" : ""}>↑</button>
        <button type="button" data-mover="1" data-c="${esc(c)}" aria-label="${esc(T.bajar(nom(c)))}"${i === lista.length - 1 ? " disabled" : ""}>↓</button></span>`;
      ctrl += `<button type="button" class="quitar" data-quitar="${esc(c)}" aria-label="${esc(T.quitar(nom(c)))}">✕</button>`;
    } else {
      izq = `<input type="checkbox" data-sel="${esc(c)}" ${dentro ? "checked" : ""} aria-label="${esc(T.incluir(nom(c)))}"${dentro && S.sel.length === 1 ? " disabled" : ""}>`;
    }
    return `<li class="ciudad${dentro ? "" : " fuera"}${noche ? " noche" : ""}">
      ${izq}
      <div class="nom">${dentro ? `<span class="num">${n}</span>` : ""}${esc(nom(c))}<small>${esc(reg(c))}</small></div>
      <div class="ctrl">${ctrl}</div>
      ${chip}<p class="ver">${esc(ver(c))}</p>${extra}</li>`;
  }).join("");
}

// Buscador de «Tu recorrido»: con texto, lo que coincide; sin texto, lo que mejor te pilla de camino.
function pintarBuscador(p) {
  const texto = plano($("#buscar").value.trim());
  const libres = K.lugares.filter(c => c !== "Madrid" && !S.sel.includes(c));
  let filas, titulo;
  if (texto) {
    const coinciden = libres.filter(c => plano(nom(c)).includes(texto) || plano(c).includes(texto) || plano(reg(c)).includes(texto))
      .sort((a, b) => plano(nom(a)).startsWith(texto) === plano(nom(b)).startsWith(texto)
        ? nom(a).localeCompare(nom(b)) : plano(nom(a)).startsWith(texto) ? -1 : 1);
    titulo = T.resultados(coinciden.length);
    filas = coinciden.slice(0, 8).map(c => [c, siAnado(c, p)]);
  } else {
    titulo = p ? T.sugerencias : T.sugerenciasVacio;
    filas = libres.map(c => [c, siAnado(c, p)]).filter(([, r]) => r.cabe)
      .sort((a, b) => a[1].mas - b[1].mas).slice(0, 6);
  }
  $("#sug-tit").textContent = titulo;
  $("#resultados").innerHTML = filas.map(([c, r]) => {
    const coste = r.lejos ? `<span class="nocabe">${T.demasiadoLejos}</span>`
      : `<span class="${r.cabe ? "cabe" : "nocabe"}">+${dur(r.mas)} · ${r.cabe ? T.casa(reloj(r.q.llegada), S.tren) : T.noCabe}</span>`;
    return `<li><button type="button" class="res" data-anadir="${esc(c)}"${r.lejos ? " disabled" : ""}>
      <span class="res-nom">${esc(nom(c))} <small>${esc(reg(c))}</small><span class="res-ver">${esc(ver(c))}</span></span>
      <span class="res-coste">${coste}</span></button></li>`;
  }).join("");
}

function badgeVias(vias, ap) {
  return vias.map(v => `<span class="via${ap.includes(v) ? " ap" : ""}">${esc(v)}</span>`).join("");
}
function pintarDias(p) {
  if (!p || p.imposible) { $("#dias").innerHTML = ""; return; }
  $("#dias").innerHTML = p.dias.map((d, i) => {
    const filas = d.filas.map(f => f.k === "coche"
      ? `<li class="coche"><time>${reloj(f.t)}</time><span class="que">${esc(nom(f.de))} → ${esc(nom(f.a))}${badgeVias(f.vias, f.viasPeaje)}<span class="etq">${f.km} km</span>${f.peaje ? `<span class="peaje">${T.peajeKm(f.peaje)}</span>` : ""}</span><span class="dur">${dur(f.min)}</span></li>`
      : f.k === "tren"
      ? `<li class="tren"><time>${reloj(f.t)}</time><span class="que">🚄 ${esc(f.de)} → ${esc(f.a)}<span class="tipo">${esc(f.tipo)}</span>${f.espera ? `<span class="etq">${T.espera(dur(f.espera))}</span>` : ""}</span><span class="dur">${dur(f.llega - f.t)}</span></li>`
      : f.k === "alquiler"
      ? `<li class="alquiler"><time>${reloj(f.t)}</time><span class="que">${esc(f.txt)}</span><span class="dur">${dur(f.min)}</span></li>`
      : `<li class="visita"><time>${reloj(f.t)}</time><span class="que">${esc(nom(f.c))}${f.nota ? `<span class="etq">☾ ${T.nota[f.nota]}</span>` : ""}</span><span class="dur">${dur(f.min)}</span></li>`).join("");
    const fin = i === 0 ? T.cena(esc(nom(p.n))) : p.sinTren ? T.sinTrenFin : p.tren ? esc(T.finMadrid(p.tren.vuelta[3])) : T.finCasa;
    const avisos = [];
    if (d.vol > MUCHO_VOLANTE) avisos.push(T.mucho(dur(MUCHO_VOLANTE)));
    if (i === 0 && d.fin > LIMITE_SAB) avisos.push(T.muyTarde);
    if (i === 1 && d.fin > hm(A.fin)) avisos.push(T.despues(A.fin));
    return `<article class="dia"><h3>${T.dias[i]}<small>${T.cab(dur(d.vol), i, reloj(d.fin), !!p.tren)}</small></h3>
      <ol class="tl">${filas}<li class="fin"><time>${reloj(d.fin)}</time><span class="que">${fin}</span><span></span></li></ol>
      ${avisos.map(a => `<span class="aviso">${a}</span>`).join("")}</article>`;
  }).join("");
}

function pintarComparar() {
  $("#comparar").innerHTML = CIRC.map(c => {
    const p = plan(base(c.id)), e = estado(p);
    return `<tr class="${c.id === S.c ? "sel" : ""}"><td><button type="button" data-circ="${c.id}">${c.tren ? "🚄 " : ""}${esc(nomCirc(c))}</button></td>
      <td>${c.por_defecto.map(x => esc(nom(x))).join(", ")}</td><td class="n">${p.km}</td><td class="n">${dur(p.vol)}</td>
      <td class="n">${dur(p.vis)}</td><td class="n">${p.peaje ? p.peaje + " km" : "—"}</td>
      <td class="n${e === "no" ? " tarde" : ""}">${reloj(p.llegada)}</td></tr>`;
  }).join("");
}

// Con «media» no hay un consumo ni un precio que enseñar: los campos se apagan.
function pintarAjustes() {
  $("#s1").disabled = !!S.tren;   // en tren manda la hora del tren de ida
  const media = A.coche === "media";
  for (const k of ["l", "p"]) {
    const el = $("#" + k);
    el.disabled = media;
    if (document.activeElement !== el) el.value = media ? "" : num(k === "l" ? consumo() : precio(), k === "l" ? 1 : 3).replace(",", ".");
    el.placeholder = media ? T.coches.media : "";
  }
}

// ---------- cómo se va: en coche desde Madrid, o en tren hasta una estación y en coche de alquiler ----------
function pintarModo() {
  const est = estacionesDe(S), el = $("#modo");
  el.hidden = !est.length;
  if (el.hidden) return;
  for (const b of el.querySelectorAll("[data-modo]")) b.setAttribute("aria-checked", String((b.dataset.modo === "tren") === !!S.tren));
  for (const id of ["#l-estacion", "#l-ida", "#ayuda-tren"]) $(id).hidden = !S.tren;
  if (!S.tren) return;
  $("#estacion").innerHTML = est.map(c => `<option value="${esc(c)}"${c === S.tren ? " selected" : ""}>${esc(nom(c))}${EST[c].estacion !== c ? ` · ${esc(EST[c].estacion)}` : ""}</option>`).join("");
  const ida = trenIda(S);
  $("#ida").innerHTML = EST[S.tren].ida.map(x => `<option value="${reloj(x[0])}"${x === ida ? " selected" : ""}>${reloj(x[0])} → ${reloj(x[1])} · ${esc(x[2])} · ${esc(x[3])}</option>`).join("");
}
// Al pasar a tren: la estación del circuito, o en «Tu recorrido» la que menos conducción deja hasta las ciudades elegidas.
function estacionPorDefecto(st) {
  const est = estacionesDe(st);
  if (!esPropio(st)) return circ(st.c).tren?.estacion ?? est[0];
  if (!st.sel.length) return est.reduce((a, b) => EST[b].ida.length > EST[a].ida.length ? b : a);   // la de más trenes
  const coste = e => st.sel.reduce((s, c) => s + (minutos(e, c) ?? 1e4), 0);
  return est.reduce((a, b) => coste(b) < coste(a) ? b : a);
}
function cambiaTren(e) { S.tren = e; S.ti = null; S.t = S.m = null; pintar(); }

// ---------- mapa ----------
function pintarMapa(p) {
  const pool = [...(esPropio(S) ? S.sel : circ(S.c).ciudades)];
  if (S.tren && !pool.includes(S.tren)) pool.push(S.tren);
  const piernas = p && !p.imposible ? p.piernas : [];
  const pts = [C.Madrid.xy, ...pool.map(c => C[c].xy)];
  piernas.forEach(t => t.forEach(q => pts.push(q)));
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
  const linea = piernas.map(t => `<polyline points="${t.map(q => q.join(",")).join(" ")}"/>`).join("");
  if (S.tren) {
    const [ex, ey] = C[S.tren].xy;
    s += `<line x1="${C.Madrid.xy[0]}" y1="${C.Madrid.xy[1]}" x2="${ex}" y2="${ey}" stroke="var(--tren)" stroke-width="${2.6 * k}" stroke-dasharray="${7 * k} ${4.5 * k}" stroke-linecap="round"/>`;
  }
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
  const marcas = [], textos = [], o = p && !p.imposible ? p.o : orden(S);
  const [mx, my] = C.Madrid.xy;
  ocupado.push([mx - 8 * k, my - 8 * k, mx + 8 * k, my + 8 * k]);
  marcas.push(`<rect x="${mx - 6 * k}" y="${my - 6 * k}" width="${12 * k}" height="${12 * k}" fill="var(--ink)" transform="rotate(45 ${mx} ${my})"/>`);
  pool.forEach(c => {
    const [x, y] = C[c].xy, i = o.indexOf(c), r = (i >= 0 ? 10 : 5) * k;
    ocupado.push([x - r, y - r, x + r, y + r]);
    marcas.push(i >= 0
      ? `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--via)" stroke="var(--surface)" stroke-width="${2 * k}"/><text x="${x}" y="${y + 4 * k}" text-anchor="middle" font-size="${11 * k}" font-weight="600" fill="var(--via-ink)">${i + 1}</text>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--surface)" stroke="var(--muted)" stroke-width="${1.4 * k}" stroke-dasharray="${2 * k} ${1.5 * k}"/>`);
  });
  textos.push(rotulo(mx, my, "Madrid", 8 * k, "rot rot-madrid"));
  pool.forEach(c => {
    const [x, y] = C[c].xy, i = o.indexOf(c);
    textos.push(rotulo(x, y, nom(c) + (p && c === p.n ? " ☾" : ""), (i >= 0 ? 10 : 5) * k, i >= 0 ? "rot" : "rot rot-fuera"));
  });
  svg.innerHTML = s + marcas.join("") + textos.join("");
}

// ---------- eventos ----------
async function irA(id, estado_) {
  if (esPropio(S)) propioGuardado = S;
  if (id === PROPIO) await cargaCatalogo();
  S = estado_ ?? (id === PROPIO && propioGuardado ? propioGuardado : base(id));
  pintar();
}
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-circ],[data-paso],[data-noche],[data-anadir],[data-quitar],[data-mover],[data-modo]");
  if (!b) return;
  if (b.dataset.circ) { irA(b.dataset.circ); return; }
  if (b.dataset.modo) {
    if ((b.dataset.modo === "tren") !== !!S.tren) cambiaTren(b.dataset.modo === "tren" ? estacionPorDefecto(S) : null);
    return;
  }
  if (b.dataset.noche) { S.n = S.n === b.dataset.noche ? null : b.dataset.noche; S.t = S.m = null; pintar(); return; }
  if (b.dataset.anadir) {
    const sel = inserta(S.sel, b.dataset.anadir);
    if (sel) { S.sel = sel; S.t = S.m = null; $("#buscar").value = ""; pintar(); $("#buscar").focus(); }
    return;
  }
  if (b.dataset.quitar) {
    const c = b.dataset.quitar;
    S.sel = S.sel.filter(x => x !== c); delete S.h[c];
    if (S.n === c) S.n = null;
    S.t = S.m = null; pintar(); return;
  }
  if (b.dataset.mover) {   // las flechas mueven en el orden que se VE (con el sentido invertido, al revés)
    const vista = orden(S), i = vista.indexOf(b.dataset.c), j = i + +b.dataset.mover;
    if (j < 0 || j >= vista.length) return;
    [vista[i], vista[j]] = [vista[j], vista[i]];
    S.sel = S.inv ? vista.reverse() : vista; S.t = S.m = null; pintar(); return;
  }
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
$("#editar").addEventListener("click", () => {   // el circuito actual pasa a ser «Tu recorrido», editable
  const copia = { ...S, c: PROPIO, sel: orden(S), inv: false, h: { ...S.h } };
  irA(PROPIO, copia);
});
$("#ordenar").addEventListener("click", () => { S.sel = ordenMejor(S.sel); S.inv = false; S.t = S.m = null; pintar(); });
$("#vaciar").addEventListener("click", () => { S = { ...base(PROPIO), tren: S.tren, ti: S.ti }; pintar(); });
$("#estacion").addEventListener("change", ev => cambiaTren(ev.target.value));
$("#ida").addEventListener("change", ev => { S.ti = ev.target.value; S.t = S.m = null; pintar(); });
$("#buscar").addEventListener("input", () => pintarBuscador(plan(S)));
$("#buscar").addEventListener("keydown", ev => {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  $("#resultados button:not([disabled])")?.click();
});
for (const k of ["s1", "s2", "fin"]) {
  const el = $("#" + k); el.value = A[k];
  el.addEventListener("input", () => { if (el.value) { A[k] = el.value; pintar(); } });
}
$("#np").addEventListener("change", () => { A.np = $("#np").checked; pintar(); });
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
$("#portada").innerHTML = T.portada(CIRC.length, D.catalogo_n, D.catalogo_regiones);
$("#fuera").innerHTML = `<strong>${T.fueraTit}</strong> ${esc(EN ? D.fuera_en : D.fuera)}`;
$("#pie-combustible").innerHTML = T.fuelPie({ ...D.precios, fecha: EN ? D.precios.fecha.split("/").reverse().join("-") : D.precios.fecha.replaceAll("/", "-") }, num);
$("#generado").textContent = T.generado(EN ? D.generado : D.generado.split("-").reverse().join("-"));
const fechaTren = f => EN ? f : f.split("-").reverse().join("-");
$("#pie-tren").innerHTML = T.trenPie(fechaTren(D.trenes.sabado), fechaTren(D.trenes.domingo));
$("#ayuda-tren").textContent = T.trenAyuda(fechaTren(D.trenes.sabado), fechaTren(D.trenes.domingo));

await deURL();
for (const k of ["s1", "s2", "fin"]) $("#" + k).value = A[k];
$("#np").checked = A.np;
$("#coche").value = A.coche;
pintar();
