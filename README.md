# Finde

**Escapadas de fin de semana desde Madrid, en coche o en tren y coche de alquiler** → <https://finde.jirulabs.com>

Diecinueve circuitos de sábado a domingo, uno por región, que entre todos cubren la península sin
repetir ciudad: salida el sábado por la mañana, una noche fuera y vuelta a Madrid el domingo por la
noche. Cada uno va en lo que más rinde: en coche desde Madrid, o en tren hasta una estación y en coche
de alquiler desde allí (los que en coche no caben o pierden muchas horas al volante). «Tu recorrido»
deja elegir las dos cosas. En cada circuito eliges qué ciudades ver (solo las que pillan de
camino), ajustas el tiempo en cada una y la página te dice si llegas a casa a tu hora, con el plan
hora a hora, los kilómetros de peaje y lo que cuesta evitarlos. Un plan se comparte con un enlace.

Es una página estática: no tiene servidor, cookies ni analítica, y no llama a ningún sitio externo.

## Cómo está hecho

| Ruta | Qué es |
|---|---|
| `datos/ciudades.json` | **Editorial.** Ciudades, región, horas estándar de visita y qué ver. |
| `datos/circuitos.json` | **Editorial.** Un circuito por región, sin ciudades repetidas: ciudades en orden de recorrido, las marcadas por defecto y, si va en tren, la estación (`tren`). |
| `datos/coches.json` | **Editorial.** Consumo en autovía de un coche de gasolina, uno diésel y un híbrido no enchufable. |
| `datos/en.json` | **Editorial, inglés.** Qué ver, regiones, nombres de circuitos. Si falta una entrada, `construir.py` no genera nada. |
| `datos/textos.json` | Textos fijos de la página en los dos idiomas (los que cambian con el plan están en `docs/app.js`, objeto `T`). |
| `datos/generado.json` | Derivado por `herramientas/descargar.py`: coordenadas, tramos, mapa, precios del combustible y trenes. No se edita. |
| `herramientas/descargar.py` | Pide coordenadas, rutas, precios y horarios de tren a servicios abiertos (ver abajo). |
| `herramientas/plantilla.html` | El HTML de la página, con un hueco `{{clave}}` por cada texto. |
| `herramientas/construir.py` | Genera `docs/datos.json`, `docs/index.html` (es), `docs/en/index.html` (en) y el sitemap. Sin red. |
| `docs/` | El sitio publicado (GitHub Pages sirve esta carpeta). `index.html` y `en/index.html` son generados: no se editan a mano. |

```bash
python3 herramientas/descargar.py   # si cambian ciudades/circuitos, o para actualizar precios y horarios (rutas cacheadas)
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

- **Tren**: solo la duración típica (mediana) de los trenes directos Madrid ↔ cada estación, sacada
  del GTFS de Renfe de alta velocidad, larga y media distancia ([data.renfe.com](https://data.renfe.com))
  del primer sábado y domingo a 3 días o más de la descarga. La página no usa horarios. Se refresca a
  mano, volviendo a correr `descargar.py`. Una ciudad es estación
  de la página si tiene una de Renfe a menos de 9 km, al menos dos trenes directos cada día, y la
  duración típica, con la media hora de recoger el coche, gana 45 min o más al coche (contado como en la
  página, con aparcar y descansos). Ouigo e Iryo están
  en el [Punto de Acceso Nacional](https://nap.transportes.gob.es), que pide registrarse: no entran.
  El precio del billete y del alquiler no se calcula.

### Reglas del plan

- A cada tramo se suman 15 min para entrar en la ciudad y aparcar, más 15 min por cada 2 h de
  conducción seguida, que es el descanso que recomienda la DGT.
- En tren, el tren es un tramo más: sale a la hora de salida del sábado, y se suman 30 min para
  recoger el coche y 30 para devolverlo el domingo antes del tren de vuelta. Si la estación está a
  más de 4 km del centro, se suma el trayecto en coche hasta ella.
- Las horas de cada ciudad son lo que suele llevar ver lo esencial a pie, con la comida incluida.
  Son una estimación editorial y se pueden cambiar en la página.
- Si no se elige dónde dormir, la página prueba cada ciudad y cada reparto de horas entre la tarde
  del sábado y la mañana del domingo. Se queda con el que deja más margen en el peor de los dos
  días (el sábado contra las 21:30 y el domingo contra la hora de vuelta).

## Licencias

Código bajo MIT (`LICENSE`). Los datos de carreteras derivan de OpenStreetMap
(© colaboradores de OpenStreetMap, [ODbL](https://www.openstreetmap.org/copyright)). Las fuentes
Barlow se distribuyen bajo SIL Open Font License (`docs/fuentes/OFL.txt`).
