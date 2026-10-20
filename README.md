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
| `datos/coches.json` | **Editorial.** Consumo en autovía de un coche de gasolina, uno diésel y un híbrido no enchufable. |
| `datos/en.json` | **Editorial, inglés.** Qué ver, regiones, nombres de circuitos. Si falta una entrada, `construir.py` no genera nada. |
| `datos/textos.json` | Textos fijos de la página en los dos idiomas (los que cambian con el plan están en `docs/app.js`, objeto `T`). |
| `datos/generado.json` | Derivado por `herramientas/descargar.py`: coordenadas, tramos, mapa y precios del combustible. No se edita. |
| `herramientas/descargar.py` | Pide coordenadas, rutas y precios a servicios abiertos (ver abajo). |
| `herramientas/plantilla.html` | El HTML de la página, con un hueco `{{clave}}` por cada texto. |
| `herramientas/construir.py` | Genera `docs/datos.json`, `docs/index.html` (es), `docs/en/index.html` (en) y el sitemap. Sin red. |
| `docs/` | El sitio publicado (GitHub Pages sirve esta carpeta). `index.html` y `en/index.html` son generados: no se editan a mano. |

```bash
python3 herramientas/descargar.py   # si cambian ciudades/circuitos o para actualizar precios (rutas cacheadas)
python3 herramientas/construir.py
python3 -m http.server -d docs 8000 # y abrir http://localhost:8000
```

### Imagen para compartir

`docs/og-es.png` y `docs/og-en.png` (1200×630, la vista previa en WhatsApp y redes) salen de
`herramientas/og.html`, que dibuja el mapa con `docs/datos.json`. Se regeneran tras `construir.py`
sirviendo la raíz del repo y fotografiándola con cualquier Chrome sin interfaz:

```bash
python3 -m http.server 8767 &
chrome --headless --window-size=1200,630 --virtual-time-budget=5000 \
  --screenshot=docs/og-es.png "http://127.0.0.1:8767/herramientas/og.html?lang=es"   # y lang=en
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
- **Precio del combustible**: mediana nacional del día de gasolina 95 y gasóleo A, de las ~11.000
  gasolineras del Geoportal de carburantes del Ministerio. Por defecto el gasto es la media de los
  tres tipos de coche de `coches.json`; en la página se puede elegir uno y cambiar consumo y precio.

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
