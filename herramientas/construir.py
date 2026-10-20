#!/usr/bin/env python3
"""Genera el sitio a partir de los datos. Sin llamadas de red.

  docs/datos.json        lo editorial (datos/*.json) + lo derivado (datos/generado.json)
  docs/index.html        español, desde herramientas/plantilla.html + datos/textos.json
  docs/en/index.html     inglés, ídem
  docs/sitemap.xml

Se corre tras editar cualquier fichero de datos/ o la plantilla. Si falta una traducción
inglesa de algo que la página enseña, se para sin escribir nada."""
import html, json, re, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
leer = lambda p: json.loads((RAIZ / p).read_text())
sin_nota = lambda d: {k: v for k, v in d.items() if not k.startswith("_")}

ciudades = sin_nota(leer("datos/ciudades.json"))
circ = leer("datos/circuitos.json")
coches = sin_nota(leer("datos/coches.json"))
en = leer("datos/en.json")
textos = leer("datos/textos.json")
gen = leer("datos/generado.json")
correcciones = sin_nota(leer("datos/correcciones.json"))["tramos"]

errores = []
faltan = [n for n in ciudades if n not in gen["nombres"]]
if faltan:
    errores.append(f"sin datos de carretera para {faltan}: corre herramientas/descargar.py")
for c in circ["circuitos"]:
    nodos = ["Madrid"] + c["ciudades"]
    for i, a in enumerate(nodos):
        for b in nodos[i + 1:]:
            if "|".join(sorted((a, b))) not in gen["tramos"]:
                errores.append(f"{c['id']}: falta el tramo {a} – {b}: corre herramientas/descargar.py")
    if c["id"] not in en["circuitos"]:
        errores.append(f"datos/en.json: falta el nombre del circuito {c['id']}")
for n, c in ciudades.items():
    if n not in en["ciudades"]:
        errores.append(f"datos/en.json: falta la ciudad {n}")
    if c["region"] not in en["regiones"]:
        errores.append(f"datos/en.json: falta la región {c['region']}")
if "precios" not in gen:
    errores.append("datos/generado.json sin precios de combustible: corre herramientas/descargar.py")
for c in coches.values():
    if c["combustible"] not in gen.get("precios", {}):
        errores.append(f"datos/coches.json: combustible desconocido {c['combustible']}")
claves_es, claves_en = set(sin_nota(textos["es"])), set(sin_nota(textos["en"]))
if claves_es != claves_en:
    errores.append(f"datos/textos.json: claves distintas entre idiomas: {sorted(claves_es ^ claves_en)}")
plantilla = (RAIZ / "herramientas/plantilla.html").read_text()
huecos = set(re.findall(r"\{\{(\w+)\}\}", plantilla))
if huecos - claves_es:
    errores.append(f"plantilla.html usa textos que no existen: {sorted(huecos - claves_es)}")
cat = gen.get("catalogo")
if not cat:
    errores.append("datos/generado.json sin catálogo: corre herramientas/descargar.py")
for k in correcciones:
    if k not in gen["tramos"] and k not in (cat or {}).get("tramos", {}):
        errores.append(f"datos/correcciones.json: el tramo {k} no existe")
if errores:
    sys.exit("No se genera nada:\n  " + "\n  ".join(errores))

# Correcciones medidas: solo cambian el tiempo de la ruta con peajes (la que se midió).
for k, c in correcciones.items():
    if k in gen["tramos"]:
        gen["tramos"][k]["min"] = c["min"]
    if k in cat["tramos"]:
        cat["tramos"][k][0] = c["min"]

salida = {
    "generado": gen["generado"],
    "fuente": gen["fuente"],
    "mapa": gen["mapa"],
    "precios": gen["precios"],
    "coches": coches,
    "ciudades": {n: {"region": c["region"], "horas": c["horas"], "ver": c["ver"], "xy": gen["xy"][n],
                     "en": {"nombre": en["ciudades"][n].get("nombre", n), "ver": en["ciudades"][n]["ver"],
                            "region": en["regiones"][c["region"]]}}
                 for n, c in ciudades.items()},
    "tramos": gen["tramos"],
    "circuitos": [{**c, "nombre_en": en["circuitos"][c["id"]]} for c in circ["circuitos"]],
    "fuera": circ["fuera"],
    "fuera_en": en["fuera"],
}
salida["catalogo_n"] = len(cat["lugares"]) - 1
salida["catalogo_regiones"] = len({ciudades[c]["region"] for c in cat["lugares"] if c != "Madrid"})
(RAIZ / "docs/datos.json").write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")))
# «Tu recorrido» carga esto solo cuando se abre: [min, km, km peaje, vías, vías de peaje, trazado, (sin peajes)].
# El trazado va plano y en diferencias de medio punto del mapa ([x0, y0, dx1, dy1, …] ×2): pesa un tercio.
def plano(trazado):
    out, px, py = [], 0, 0
    for x, y in trazado:
        qx, qy = round(x * 2), round(y * 2)
        out += [qx - px, qy - py]
        px, py = qx, qy
    return out

def compacta(v):
    return v[:5] + [plano(v[5])] + ([compacta(v[6])] if len(v) > 6 else [])

(RAIZ / "docs/catalogo.json").write_text(json.dumps(
    {"lugares": cat["lugares"], "max_par": cat["max_par"],
     "tramos": {k: compacta(v) for k, v in cat["tramos"].items()}},
    ensure_ascii=False, separators=(",", ":")))

# Los textos con HTML a propósito (llevan etiquetas) van tal cual; el resto se escapa.
CON_HTML = {"pie_calculo", "pie_peajes", "creditos"}
for idioma, destino in (("es", "docs/index.html"), ("en", "docs/en/index.html")):
    t = textos[idioma]
    pagina = re.sub(r"\{\{(\w+)\}\}",
                    lambda m: t[m[1]] if m[1] in CON_HTML else html.escape(t[m[1]]), plantilla)
    (RAIZ / destino).parent.mkdir(parents=True, exist_ok=True)
    (RAIZ / destino).write_text(pagina)

(RAIZ / "docs/sitemap.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
    + "".join(f'  <url><loc>{u}</loc>'
              '<xhtml:link rel="alternate" hreflang="es" href="https://finde.jirulabs.com/"/>'
              '<xhtml:link rel="alternate" hreflang="en" href="https://finde.jirulabs.com/en/"/></url>\n'
              for u in ("https://finde.jirulabs.com/", "https://finde.jirulabs.com/en/"))
    + "</urlset>\n")
print(f"docs/: datos.json ({(RAIZ / 'docs/datos.json').stat().st_size // 1024} KB), "
      f"catalogo.json ({(RAIZ / 'docs/catalogo.json').stat().st_size // 1024} KB), index.html, en/index.html, sitemap.xml · "
      f"{len(salida['circuitos'])} circuitos, {len(cat['lugares']) - 1} lugares en el catálogo, {len(correcciones)} correcciones")
