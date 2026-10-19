# Finde

**Escapadas de fin de semana en coche desde Madrid** → <https://finde.jirulabs.com>

Doce circuitos de sábado a domingo, con salida el sábado por la mañana, una noche fuera y vuelta a
Madrid el domingo por la noche. En cada circuito eliges qué ciudades ver (solo las que pillan de
camino), ajustas el tiempo en cada una y la página te dice si llegas a casa a tu hora, con el plan
hora a hora, los kilómetros de peaje y lo que cuesta evitarlos. Un plan se comparte con un enlace.

Es una página estática: no tiene servidor, cookies ni analítica, y no llama a ningún sitio externo.

## Cómo está hecho

| Ruta | Qué es |
|---|---|
| `datos/ciudades.json` | **Editorial.** Ciudades, región, horas estándar de visita y qué ver. |
| `datos/circuitos.json` | **Editorial.** Circuitos: ciudades en orden de recorrido y las marcadas por defecto. |
| `datos/generado.json` | Derivado por `herramientas/descargar.py`: coordenadas, tramos, mapa. No se edita. |
| `herramientas/descargar.py` | Pide coordenadas y rutas a servicios abiertos (ver abajo). Se corre al cambiar ciudades o circuitos. |
| `herramientas/construir.py` | Junta lo editorial y lo derivado en `docs/datos.json`. Sin red. |
| `docs/` | El sitio publicado (GitHub Pages sirve esta carpeta). |

```bash
python3 herramientas/descargar.py   # solo si cambian ciudades/circuitos (~6 min, 1 consulta/s)
python3 herramientas/construir.py
python3 -m http.server -d docs 8000 # y abrir http://localhost:8000
```

### De dónde salen los datos

- **Coordenadas**: Nominatim identifica la ciudad y Wikidata da su centro urbano. Nominatim solo
  devolvía el centro del término municipal o, sin filtro, el de la provincia. Donde Wikidata
  tampoco acierta, `coord` en `ciudades.json` fija el punto a mano.
- **Tiempos, kilómetros, trazado y peajes**: [Valhalla](https://valhalla.github.io/valhalla/), en
  el servidor público de FOSSGIS, sobre OpenStreetMap. Cada tramo se pide dos veces, con y sin
  peajes. Se probó antes el servidor de demostración de OSRM, pero daba un ~17 % más de tiempo que
  lo habitual y no marcaba los peajes.
- **Contorno del mapa**: Natural Earth 1:50m.

### Reglas del plan

- A cada tramo se suman 15 min para entrar en la ciudad y aparcar, más 15 min por cada 2 h de
  conducción seguida, que es el descanso que recomienda la DGT.
- Las horas de cada ciudad son lo que suele llevar ver lo esencial a pie, con la comida incluida.
  Son una estimación editorial y se pueden cambiar en la página.
- Si no se elige dónde dormir, la página prueba cada ciudad y cada reparto de horas entre la tarde
  del sábado y la mañana del domingo. Se queda con el que deja más margen en el peor de los dos
  días (el sábado contra las 21:30 y el domingo contra la hora de vuelta).

## Licencias

Código bajo MIT (`LICENSE`). Los datos de carreteras derivan de OpenStreetMap
(© colaboradores de OpenStreetMap, [ODbL](https://www.openstreetmap.org/copyright)). Las fuentes
Barlow se distribuyen bajo SIL Open Font License (`docs/fuentes/OFL.txt`).
