#!/usr/bin/env python3
"""Deriva los datos de carretera a partir de los editoriales y los deja en datos/generado.json.

Se corre a mano cuando cambian ciudades o circuitos; la página no llama a nadie.
  - Coordenadas: Nominatim (OpenStreetMap), 1 consulta/s.
  - Tiempo, km, trazado, kilómetros con peaje y carreteras de cada tramo: Valhalla
    (valhalla1.openstreetmap.de, el de openstreetmap.org), 1 consulta/s. Se probó antes OSRM
    (router.project-osrm.org) y daba un ~17 % más de tiempo que lo habitual (Madrid–Sevilla 5 h 48)
    y sin marca de peaje; Valhalla da 4 h 54 y marca el peaje en cada maniobra.
  - Contorno de la península: Natural Earth 1:50m.
Todo se cachea en herramientas/cache/; borra un fichero para volver a pedirlo.
"""
import json, math, sys, time, urllib.parse, urllib.request
from collections import Counter
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
    with urllib.request.urlopen(req, timeout=90) as r:
        datos = json.loads(r.read())
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
        tipos = [None] if c.get("punto_exacto") else ["city", "town", "village"]
        for tipo in tipos:
            params = {"q": q, "format": "json", "limit": 1, "countrycodes": "es", "extratags": 1}
            if tipo:
                params["featureType"] = tipo
            url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
            res = pedir(url, CACHE / f"geo-{nombre}{'-' + tipo if tipo else ''}.json")
            if res and (not tipo or res[0].get("addresstype") in ("city", "town", "village", "municipality")):
                break
        else:
            sys.exit(f"Nominatim no da un núcleo urbano para «{q}»: afina 'busqueda'")
        lat, lon = float(res[0]["lat"]), float(res[0]["lon"])
        # Nominatim devuelve el municipio, y su punto puede ser el centro del TÉRMINO (Valladolid
        # a 3,5 km de la Plaza Mayor). Wikidata marca el centro urbano: se usa ese.
        qid = (res[0].get("extratags") or {}).get("wikidata")
        if qid and not c.get("punto_exacto"):
            wd = pedir(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json", CACHE / f"wd-{qid}.json")
            v = wd["entities"][qid]["claims"]["P625"][0]["mainsnak"]["datavalue"]["value"]
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

def tramo(a, b, coords, sin_peajes=False):
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
    geo = simplificar([proyectar(*p) for p in polilinea6(pierna["shape"])])
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

    salida = {
        "fuente": "Valhalla (valhalla1.openstreetmap.de, FOSSGIS) sobre OpenStreetMap; contorno de Natural Earth",
        "generado": time.strftime("%Y-%m-%d"),
        "mapa": {"ancho": ANCHO, "alto": ALTO, "paises": contorno()},
        "nombres": nombres,
        "xy": {n: proyectar(*coords[n]) for n in nombres},
        "tramos": tramos,
    }
    (RAIZ / "datos/generado.json").write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")))
    print(f"datos/generado.json: {len(pares)} tramos, {(RAIZ / 'datos/generado.json').stat().st_size // 1024} KB")

if __name__ == "__main__":
    main()
