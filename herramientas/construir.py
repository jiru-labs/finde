#!/usr/bin/env python3
"""Junta lo editorial (datos/ciudades.json, datos/circuitos.json) con lo derivado
(datos/generado.json) en docs/datos.json, que es lo único que lee la página.
Se corre tras editar cualquiera de los tres; no hace llamadas de red."""
import json, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
leer = lambda p: json.loads((RAIZ / p).read_text())

ciudades = {k: v for k, v in leer("datos/ciudades.json").items() if not k.startswith("_")}
circ = leer("datos/circuitos.json")
gen = leer("datos/generado.json")

faltan = [n for n in ciudades if n not in gen["nombres"]]
if faltan:
    sys.exit(f"Sin datos de carretera para {faltan}: corre herramientas/descargar.py")
for c in circ["circuitos"]:
    nodos = ["Madrid"] + c["ciudades"]
    for i, a in enumerate(nodos):
        for b in nodos[i + 1:]:
            if "|".join(sorted((a, b))) not in gen["tramos"]:
                sys.exit(f"{c['id']}: falta el tramo {a} – {b}: corre herramientas/descargar.py")

salida = {
    "generado": gen["generado"],
    "fuente": gen["fuente"],
    "mapa": gen["mapa"],
    "ciudades": {n: {"region": c["region"], "horas": c["horas"], "ver": c["ver"],
                     "xy": gen["xy"][n]} for n, c in ciudades.items()},
    "tramos": gen["tramos"],
    "circuitos": circ["circuitos"],
    "fuera": circ["fuera"],
}
destino = RAIZ / "docs/datos.json"
destino.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")))
print(f"{destino.relative_to(RAIZ)}: {len(salida['circuitos'])} circuitos, {destino.stat().st_size // 1024} KB")
