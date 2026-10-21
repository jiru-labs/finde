#!/usr/bin/env python3
"""Deriva los datos de carretera a partir de los editoriales y los deja en datos/generado.json.

Se corre a mano cuando cambian ciudades o circuitos; la página no llama a nadie.
  - Coordenadas: Nominatim (OpenStreetMap), 1 consulta/s.
  - Tiempo, km, trazado, kilómetros con peaje y carreteras de cada tramo: Valhalla
    (valhalla1.openstreetmap.de, el de openstreetmap.org), 1 consulta/s. Se probó antes OSRM
    (router.project-osrm.org) y daba un ~17 % más de tiempo que lo habitual (Madrid–Sevilla 5 h 48)
    y sin marca de peaje; Valhalla da 4 h 54 y marca el peaje en cada maniobra.
  - Contorno de la península: Natural Earth 1:50m.
  - Precio de gasolina y diésel: mediana nacional del día, del Geoportal de carburantes del Ministerio.
  - Trenes directos Madrid ↔ cada lugar, del sábado y el domingo siguientes: GTFS de Renfe
    (alta velocidad, larga y media distancia; datos abiertos, se publica cada día). Ouigo e Iryo
    están en el Punto de Acceso Nacional, que pide registrarse: no entran.
Todo se cachea en herramientas/cache/; borra un fichero para volver a pedirlo.
"""
import csv, datetime, io, json, math, sys, time, urllib.error, urllib.parse, urllib.request, zipfile
from collections import Counter, defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CACHE = RAIZ / "herramientas" / "cache"
UA = "jirulabs-finde/0.1 (+https://jirulabs.com)"
VALHALLA = "https://valhalla1.openstreetmap.de"
NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson"

# Proyección equirrectangular centrada en la península (escala x por cos 40°).
LON0, LAT0, K = -9.7, 44.1, 60
COSL = math.cos(math.radians(40))
ANCHO, ALTO = 600, 490

def proyectar(lon, lat):
    return (round((lon - LON0) * COSL * K, 1), round((LAT0 - lat) * K, 1))

_ultima = 0.0
def pedir(url, fichero=None, pausa=1.1):
    global _ultima
    if fichero and fichero.exists():
        return json.loads(fichero.read_text())
    espera = pausa - (time.time() - _ultima)
    if espera > 0:
        time.sleep(espera)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    # Los servidores públicos dan 502/503 o se cuelgan a ratos: reintento con espera creciente.
    # Un 4xx es una respuesta de verdad (p. ej. «no hay ruta») y sube tal cual.
    for intento in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                datos = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code < 500 or intento == 4:
                raise
        except (urllib.error.URLError, TimeoutError):
            if intento == 4:
                raise
        time.sleep(30 * (intento + 1))
    _ultima = time.time()
    if fichero:
        fichero.write_text(json.dumps(datos, ensure_ascii=False))
    return datos

def geocodificar(ciudades):
    coords = {}
    for nombre, c in ciudades.items():
        q = c.get("busqueda", nombre)
        # Se pide el núcleo urbano (city → town → village). Sin featureType, y también con
        # featureType=settlement, «León», «Soria», «Teruel», «Palencia» y «Zamora» caían en el
        # centro de su PROVINCIA (Albarracín–Teruel salía a 81 km y 2 h 20; son 38 km).
        tipos = [None] if c.get("punto_exacto") else ["city", "town", "village", "settlement"]
        for tipo in tipos:
            params = {"q": q, "format": "json", "limit": 1, "countrycodes": "es", "extratags": 1}
            if tipo:
                params["featureType"] = tipo
            url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
            res = pedir(url, CACHE / f"geo-{nombre}{'-' + tipo if tipo else ''}.json")
            if res and (not tipo or res[0].get("addresstype") in ("city", "town", "village", "municipality", "hamlet")):
                break
        else:
            sys.exit(f"Nominatim no da un núcleo urbano para «{q}»: afina 'busqueda'")
        lat, lon = float(res[0]["lat"]), float(res[0]["lon"])
        # Nominatim devuelve el municipio, y su punto puede ser el centro del TÉRMINO (Valladolid
        # a 3,5 km de la Plaza Mayor). Wikidata marca el centro urbano: se usa ese.
        qid = (res[0].get("extratags") or {}).get("wikidata")
        if qid and not c.get("punto_exacto"):
            wd = pedir(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json", CACHE / f"wd-{qid}.json")
            p625 = wd["entities"][qid]["claims"].get("P625")
            if p625:  # sin coordenadas en Wikidata, se queda la de Nominatim
                v = p625[0]["mainsnak"]["datavalue"]["value"]
                d = math.dist((lat, lon * COSL), (v["latitude"], v["longitude"] * COSL)) * 111
                if d > 15:
                    sys.exit(f"{nombre}: Wikidata ({qid}) y Nominatim discrepan {d:.0f} km")
                lat, lon = v["latitude"], v["longitude"]
        if c.get("coord"):  # punto fijado a mano donde Wikidata tampoco acierta (ver ciudades.json)
            lat, lon = c["coord"]
        if not (35.5 < lat < 44 and -9.5 < lon < 3.5):
            sys.exit(f"«{q}» cae fuera de la península: {lat},{lon}")
        coords[nombre] = (lon, lat)
        print(f"  {nombre:28} {lat:.4f},{lon:.4f}  {qid or ''}  {res[0]['display_name'][:50]}")
    return coords

def simplificar(puntos, tol=0.8):
    """Quita puntos a menos de `tol` px del anterior conservado (ya vienen simplificados de OSRM)."""
    out = [puntos[0]]
    for p in puntos[1:-1]:
        if math.dist(p, out[-1]) >= tol:
            out.append(p)
    out.append(puntos[-1])
    return out

def polilinea6(cod):
    """Decodifica el 'shape' de Valhalla (polyline con 6 decimales) a [(lon, lat)]."""
    puntos, i, lat, lon = [], 0, 0, 0
    while i < len(cod):
        for eje in (0, 1):
            res, desp = 0, 0
            while True:
                b = ord(cod[i]) - 63; i += 1
                res |= (b & 0x1F) << desp; desp += 5
                if b < 0x20:
                    break
            d = ~(res >> 1) if res & 1 else res >> 1
            if eje == 0: lat += d
            else: lon += d
        puntos.append((lon / 1e6, lat / 1e6))
    return puntos

def es_via(nombre):  # A-6, AP-6, N-320, A-5R (no calles, ni E-xx, ni nombres largos)
    return nombre[:1] in "AN" and "-" in nombre and len(nombre) <= 7

def tramo(a, b, coords, sin_peajes=False, tol=0.8):
    ca, cb = coords[a], coords[b]
    q = {"locations": [{"lon": ca[0], "lat": ca[1]}, {"lon": cb[0], "lat": cb[1]}],
         "costing": "auto", "units": "km", "directions_options": {"language": "es-ES"}}
    if sin_peajes:
        q["costing_options"] = {"auto": {"use_tolls": 0}}
    # Las coordenadas van en el nombre: si una ciudad cambia de punto, su ruta se vuelve a pedir.
    clave = f"{ca[0]:.4f},{ca[1]:.4f}-{cb[0]:.4f},{cb[1]:.4f}" + ("-libre" if sin_peajes else "")
    res = pedir(f"{VALHALLA}/route?json=" + urllib.parse.quote(json.dumps(q)), CACHE / f"ruta-{clave}.json")
    if "trip" not in res:
        sys.exit(f"Valhalla no da ruta {a} → {b}: {res.get('error')}")
    pierna = res["trip"]["legs"][0]
    peaje, vias, vias_peaje = 0.0, Counter(), set()
    for m in pierna["maneuvers"]:
        refs = [n for n in m.get("street_names", []) if es_via(n)]
        for r in refs:
            vias[r] += m["length"]
        if m.get("toll"):
            peaje += m["length"]
            vias_peaje.update(refs)
    total = res["trip"]["summary"]["length"]
    principales = [v for v, d in vias.most_common(3) if d > 0.15 * total][:2]
    geo = simplificar([proyectar(*p) for p in polilinea6(pierna["shape"])], tol)
    return {"min": round(res["trip"]["summary"]["time"] / 60), "km": round(total),
            "peaje_km": round(peaje), "peaje_vias": sorted(vias_peaje),
            "vias": principales, "trazado": geo}

def contorno():
    ne = pedir(NE, CACHE / "ne_50m_admin_0_countries.json", pausa=0)
    paises = {}
    for f in ne["features"]:
        iso = f["properties"]["ADM0_A3"]
        if iso not in ("ESP", "PRT", "FRA", "AND", "MAR"):
            continue
        g = f["geometry"]
        polis = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        caminos = []
        for poli in polis:
            anillo = poli[0]
            xs = [proyectar(*p) for p in anillo]
            # Solo lo que toca el encuadre (fuera quedan Canarias, Córcega, el resto de Francia...).
            if not any(-40 < x < ANCHO + 40 and -40 < y < ALTO + 40 for x, y in xs):
                continue
            xs = simplificar(xs, 0.6)
            caminos.append("M" + "L".join(f"{x:g},{y:g}" for x, y in xs) + "Z")
        paises[iso] = "".join(caminos)
    return paises

MINETUR = "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/"

def precios():
    """Mediana nacional de hoy de gasolina 95 E5 y gasóleo A, de todas las gasolineras que
    publica el Ministerio (unas 11.000). Se cachea por día: el día siguiente se vuelve a pedir."""
    res = pedir(MINETUR, CACHE / f"precios-{time.strftime('%Y-%m-%d')}.json", pausa=0)
    if res.get("ResultadoConsulta") != "OK":
        sys.exit(f"Precios del Ministerio: {res.get('ResultadoConsulta')}")
    out = {"fecha": res["Fecha"][:10], "fuente": "Ministerio para la Transición Ecológica (Geoportal de carburantes)"}
    for clave, campo in (("gasolina", "Precio Gasolina 95 E5"), ("diesel", "Precio Gasoleo A")):
        v = sorted(float(e[campo].replace(",", ".")) for e in res["ListaEESSPrecio"] if e.get(campo))
        if len(v) < 1000:  # guarda del cero: pocas estaciones = respuesta rota, no un precio
            sys.exit(f"Precios del Ministerio: solo {len(v)} estaciones con {campo}")
        out[clave] = round(v[len(v) // 2], 3)
        out[clave + "_estaciones"] = len(v)
    print(f"Precios {out['fecha']}: gasolina {out['gasolina']} €/L, diésel {out['diesel']} €/L")
    return out

# Tren + coche de alquiler: se va en tren hasta una estación, se recoge allí un coche y el circuito
# sale y vuelve a esa estación. Un lugar es estación de la página si tiene una de Renfe a menos de
# MAX_ESTACION km con trenes directos a Madrid (al menos dos cada día) y el tren más rápido, sumada
# la recogida del coche, le gana al coche desde Madrid por GANANCIA min o más. El coche se cuenta como en la
# página, con aparcar y descansos: sin ellos se quedaban fuera Oviedo y Granada, que ganan más de una hora.
RENFE = "https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip"
MAX_ESTACION = 9    # km de la estación al centro del lugar. Con 12, Cambados se quedaba la de Vilagarcía y
                    # Cádiz la de El Puerto de Santa María; Camp de Tarragona está a 8,5
RECOGER = 30        # min, el mismo que RECOGER en docs/app.js
GANANCIA = 45       # min
APARCAR, DESCANSO = 15, 15   # los de docs/app.js
def finde_horarios():
    """El primer sábado a 3 días o más de hoy: los horarios de esta semana ya están cerrados."""
    d = datetime.date.today() + datetime.timedelta(days=3)
    while d.weekday() != 5:
        d += datetime.timedelta(days=1)
    return d, d + datetime.timedelta(days=1)

def gtfs_renfe():
    f = CACHE / f"renfe-{time.strftime('%Y-%m-%d')}.zip"
    if not f.exists():
        req = urllib.request.Request(RENFE, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            f.write_bytes(r.read())
    return zipfile.ZipFile(f)

def trenes(coords, desde_madrid):
    sab, dom = finde_horarios()
    dias = {sab.strftime("%Y%m%d"): "saturday", dom.strftime("%Y%m%d"): "sunday"}
    z = gtfs_renfe()
    def filas(nombre):  # el fichero de Renfe rellena cada línea con espacios hasta 350 columnas
        with z.open(nombre) as fh:
            for r in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
                yield {k.strip(): (v or "").strip() for k, v in r.items()}
    estaciones = {r["stop_id"]: (r["stop_name"], float(r["stop_lon"]), float(r["stop_lat"])) for r in filas("stops.txt")}
    madrid = {s for s, (n, *_) in estaciones.items() if n.startswith("Madrid-")}
    activos = defaultdict(set)   # fecha → service_id
    for r in filas("calendar.txt"):
        for f, col in dias.items():
            if r["start_date"] <= f <= r["end_date"] and r[col] == "1":
                activos[f].add(r["service_id"])
    for r in filas("calendar_dates.txt"):
        if r["date"] in dias:
            (activos[r["date"]].add if r["exception_type"] == "1" else activos[r["date"]].discard)(r["service_id"])
    tipo = {r["route_id"]: r["route_short_name"] for r in filas("routes.txt")}
    viajes = {}   # trip_id → (fechas en que circula, tipo de tren). Un tren puede circular los dos días.
    for r in filas("trips.txt"):
        f = {d for d in dias if r["service_id"] in activos[d]}
        if f:
            viajes[r["trip_id"]] = (f, tipo.get(r["route_id"], ""))
    paradas = defaultdict(list)
    for r in filas("stop_times.txt"):
        if r["trip_id"] in viajes:
            paradas[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], r["arrival_time"], r["departure_time"],
                                          r["pickup_type"] != "1", r["drop_off_type"] != "1"))
    if len(paradas) < 500:   # guarda del cero: un fichero vacío o de otras fechas no es «no hay trenes»
        sys.exit(f"GTFS de Renfe: solo {len(paradas)} trenes el {sab} y el {dom}")
    hm = lambda t: int(t.split(":")[0]) * 60 + int(t.split(":")[1])
    corto = lambda s: estaciones[s][0].removeprefix("Madrid-").split("-")[0]   # «Chamartín», «Puerta de Atocha»
    ida, vuelta = defaultdict(dict), defaultdict(dict)   # estación → (sale, llega) → fila
    sab_f, dom_f = sab.strftime("%Y%m%d"), dom.strftime("%Y%m%d")
    for t, seq in paradas.items():
        f, tt = viajes[t]
        seq.sort()
        # Ida: se sube en la última parada de Madrid antes del destino (Atocha y luego Chamartín: Chamartín).
        # Vuelta, al revés: se baja en la primera de Madrid. Se respetan las paradas solo de subida o de bajada.
        if sab_f in f:
            sube = None
            for _, s, llega, sale, puede_subir, puede_bajar in seq:
                if s in madrid:
                    if puede_subir:
                        sube = (s, sale)
                elif sube and puede_bajar:
                    ida[s][(hm(sube[1]), hm(llega))] = [hm(sube[1]), hm(llega), tt, corto(sube[0])]
        if dom_f in f:
            baja = None
            for _, s, llega, sale, puede_subir, puede_bajar in reversed(seq):
                if s in madrid:
                    if puede_bajar:
                        baja = (s, llega)
                elif baja and puede_subir:
                    vuelta[s][(hm(sale), hm(baja[1]))] = [hm(sale), hm(baja[1]), tt, corto(baja[0])]
    # Cada estación con servicio se asigna al lugar más cercano (Reus y Tarragona no comparten Camp de Tarragona),
    # y si a un lugar le tocan dos, se queda la más cercana.
    servidas = [s for s in ida if len(ida[s]) >= 2 and len(vuelta[s]) >= 2]
    asignada = {}
    for s in servidas:
        n, lon, lat = estaciones[s]
        km, lugar = min((math.dist((lat, lon * COSL), (coords[c][1], coords[c][0] * COSL)) * 111.2, c)
                        for c in coords if c != "Madrid")
        if km <= MAX_ESTACION and (lugar not in asignada or km < asignada[lugar][1]):
            asignada[lugar] = (s, km)
    out = {}
    for lugar, (s, km) in sorted(asignada.items()):
        mejor = min(b - a for a, b in ida[s])
        coche = desde_madrid[lugar]["min"]
        if mejor + RECOGER + GANANCIA > coche + APARCAR + coche // 120 * DESCANSO:
            continue
        nombre, lon, lat = estaciones[s]
        # Estación fuera del casco (Camp de Tarragona, Cuenca-Fernando Zóbel): el trayecto hasta él se suma.
        acceso = 0
        if km > 4:
            acceso = tramo(f"estación {nombre}", lugar, {**coords, f"estación {nombre}": (lon, lat)})["min"]
        out[lugar] = {"estacion": nombre, "acceso": acceso,
                      "ida": sorted(ida[s].values()), "vuelta": sorted(vuelta[s].values())}
        print(f"  {lugar:24} {nombre:34} {km:4.1f} km +{acceso:2d} min · mejor {mejor // 60}:{mejor % 60:02d}"
              f" (coche {coche // 60}:{coche % 60:02d}) · sáb {len(ida[s])}, dom {len(vuelta[s])}")
    if not out:
        sys.exit("Trenes: ninguna estación útil (¿cambió el formato del GTFS?)")
    return {"sabado": sab.isoformat(), "domingo": dom.isoformat(),
            "fuente": "Renfe, horarios de alta velocidad, larga y media distancia (data.renfe.com, GTFS)",
            "estaciones": out}

# «Tu recorrido»: cualquier lugar de ciudades.json a menos de LIMITE_MADRID de Madrid, con rutas
# reales entre los pares que pueden caer en el mismo fin de semana (a menos de MAX_PAR km en línea
# recta). La matriz de Valhalla no sirve: el servidor público la corta en 150 km de ruta.
LIMITE_MADRID = 315   # min sin paradas: ~5 h 15
MAX_PAR = 300         # km en línea recta
def recta(a, b, coords):
    (lo1, la1), (lo2, la2) = coords[a], coords[b]
    return math.dist((la1, lo1 * COSL), (la2, lo2 * COSL)) * 111.2

def compacto(t):
    """[min, km, km de peaje, vías, vías de peaje, trazado]; el trazado va más simplificado que en los circuitos."""
    return [t["min"], t["km"], t["peaje_km"], t["vias"], t["peaje_vias"], t["trazado"]]

def madrid_a(coords, nombres):
    print("Catálogo: Madrid → cada lugar")
    return {c: tramo(*sorted(("Madrid", c)), coords, tol=2.5) for c in nombres if c != "Madrid"}

# Lo que queda lejos de Madrid entra si está a menos de LIMITE_ESTACION de una estación con tren.
LIMITE_ESTACION = 150  # min sin paradas
def catalogo(coords, nombres, desde_madrid, estaciones):
    cerca = lambda c: any(c == e or (recta(c, e, coords) <= MAX_PAR and
                                     tramo(*sorted((c, e)), coords, tol=2.5)["min"] <= LIMITE_ESTACION)
                          for e in estaciones)
    dentro = ["Madrid"] + [c for c in nombres if c != "Madrid" and (desde_madrid[c]["min"] <= LIMITE_MADRID or cerca(c))]
    fuera = sorted(c for c in desde_madrid if c not in dentro)
    print(f"  {len(dentro) - 1} lugares a menos de {LIMITE_MADRID} min o de {LIMITE_ESTACION} min de una estación;"
          f" fuera: {', '.join(fuera) or 'ninguno'}")
    pares = [(a, b) for i, a in enumerate(dentro) for b in dentro[i + 1:]
             if "Madrid" in (a, b) or recta(a, b, coords) <= MAX_PAR]
    print(f"  {len(pares)} pares (con Madrid, o a menos de {MAX_PAR} km en línea recta)")
    tramos = {}
    for k, (a, b) in enumerate(sorted(tuple(sorted(x)) for x in pares)):
        t = desde_madrid[b if a == "Madrid" else a] if "Madrid" in (a, b) else tramo(a, b, coords, tol=2.5)
        fila = compacto(t)
        if t["peaje_km"]:
            fila.append(compacto(tramo(a, b, coords, sin_peajes=True, tol=2.5)))
        tramos[f"{a}|{b}"] = fila
        if k % 250 == 0:
            print(f"  {k}/{len(pares)}", flush=True)
    return {"lugares": dentro, "fuera": fuera, "tramos": tramos, "max_par": MAX_PAR}

def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    ciudades = {k: v for k, v in json.loads((RAIZ / "datos/ciudades.json").read_text()).items() if not k.startswith("_")}
    circuitos = json.loads((RAIZ / "datos/circuitos.json").read_text())["circuitos"]
    for c in circuitos:
        for n in c["ciudades"] + c["por_defecto"]:
            if n not in ciudades:
                sys.exit(f"{c['id']}: «{n}» no está en ciudades.json")

    print("Coordenadas:")
    coords = geocodificar(ciudades)
    nombres = list(ciudades)

    print("Tramos:")
    pares = set()
    for c in circuitos:
        nodos = ["Madrid"] + c["ciudades"]
        for i, a in enumerate(nodos):
            for b in nodos[i + 1:]:
                pares.add(tuple(sorted((a, b))))
    tramos = {}
    for a, b in sorted(pares):
        t = tramo(a, b, coords)
        if t["peaje_km"]:  # la alternativa sin peajes, solo donde hay peaje que evitar
            t["libre"] = tramo(a, b, coords, sin_peajes=True)
        tramos[f"{a}|{b}"] = t
        extra = f" · sin peajes {t['libre']['min'] - t['min']:+d} min, quedan {t['libre']['peaje_km']} km" if t["peaje_km"] else ""
        print(f"  {a} – {b}: {t['min']} min, {', '.join(t['vias']) or '—'}  peaje {t['peaje_km']} km{extra}")

    desde_madrid = madrid_a(coords, nombres)
    print(f"Trenes (Renfe, {' y '.join(d.isoformat() for d in finde_horarios())}):")
    est = trenes(coords, desde_madrid)
    for c in circuitos:
        e = c.get("tren", {}).get("estacion")
        if e and (e not in est["estaciones"] or e not in c["ciudades"]):
            sys.exit(f"{c['id']}: la estación «{e}» no tiene trenes útiles o no está entre sus ciudades")

    salida = {
        "fuente": "Valhalla (valhalla1.openstreetmap.de, FOSSGIS) sobre OpenStreetMap; contorno de Natural Earth",
        "generado": time.strftime("%Y-%m-%d"),
        "mapa": {"ancho": ANCHO, "alto": ALTO, "paises": contorno()},
        "precios": precios(),
        "trenes": est,
        "catalogo": catalogo(coords, nombres, desde_madrid, est["estaciones"]),
        "nombres": nombres,
        "xy": {n: proyectar(*coords[n]) for n in nombres},
        "tramos": tramos,
    }
    (RAIZ / "datos/generado.json").write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")))
    print(f"datos/generado.json: {len(pares)} tramos, {(RAIZ / 'datos/generado.json').stat().st_size // 1024} KB")

if __name__ == "__main__":
    main()
