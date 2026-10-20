<p align="center">
  <img src="docs/img/logo.svg" alt="Logo de CloudBank" width="96" height="96" />
</p>

<h1 align="center">CloudBank</h1>

<p align="center">
  <strong>Tu dinero, en tu servidor.</strong><br />
  Un gestor de finanzas personales gratuito en la web: una versión para el navegador de <a href="https://www.gethomebank.org/">HomeBank</a>, reescrita desde cero.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <strong>Español</strong> · <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<p align="center">
  <a href="https://p01--cloudbank--7dcjw6mlmtky.code.run/"><img src="https://img.shields.io/badge/Probar_la_demo-2457D6?style=for-the-badge" alt="Probar la demo" height="34" /></a>
</p>

<p align="center">
  <sub>Datos inventados en una cuenta desechable, que se borra cuando dejas de usarla. <a href="docs/demo.md">Qué es la demo</a> (en inglés).</sub>
</p>

<p align="center">
  <a href="https://github.com/easly1989/cloudbank/actions/workflows/ci.yml"><img src="https://github.com/easly1989/cloudbank/actions/workflows/ci.yml/badge.svg" alt="Estado de la CI" /></a>
  <a href="https://github.com/easly1989/cloudbank/issues"><img src="https://img.shields.io/github/issues/easly1989/cloudbank" alt="Issues abiertas" /></a>
  <a href="https://github.com/easly1989/cloudbank/pkgs/container/cloudbank"><img src="https://img.shields.io/badge/ghcr.io-cloudbank-2496ED?logo=docker&logoColor=white" alt="Imagen del contenedor" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="Licencia: AGPL v3" /></a>
</p>

---

**CloudBank** es un gestor de finanzas personales gratuito, para alojar tú mismo y usar en el navegador: una versión web, reescrita desde cero, de la excelente aplicación de escritorio [HomeBank](https://www.gethomebank.org/). Quiere hacer todo lo que hace HomeBank, pero pensado para el navegador: un único contenedor Docker que gestionas tú, con los datos en una base SQLite en un volumen que controlas.

**Pruébalo primero:** la [demo](https://p01--cloudbank--7dcjw6mlmtky.code.run/) está a un clic, sin registro, con un año de datos inventados. Se borra tras dos horas sin uso, así que no queda nada de lo que introduzcas.

## Por qué

HomeBank es una aplicación de escritorio excelente, pero solo de escritorio. CloudBank lleva la misma forma de trabajar (cuentas, una lista completa de movimientos, movimientos programados, presupuestos, informes detallados y la importación desde muchos formatos, incluido el archivo `.xhb` de HomeBank, en **lectura y escritura**) a una interfaz web que puedes abrir desde cualquier dispositivo, mientras los datos se quedan en tu servidor.

CloudBank es una **reimplementación independiente, en sala limpia**. No copia ni usa código de HomeBank: del original solo mira el comportamiento documentado y los formatos de archivo, y sigue las versiones de HomeBank, las actuales y las futuras. CloudBank tiene licencia **AGPL-3.0** (HomeBank, GPL-2+).

## Capturas

|                 Resumen                |          Movimientos: acciones sobre varias filas seleccionadas          |
| :--------------------------------------: | :---------------------------------------------------------: |
| ![Resumen](docs/img/dashboard.png)     | ![Acciones sobre varias filas en los movimientos](docs/img/register-bulk.png) |

|        Programados: los recibos del mes en el calendario        |        Revisar: posibles duplicados de la conexión bancaria        |
| :------------------------------------------------------: | :---------------------------------------------------------: |
| ![Calendario de los movimientos programados](docs/img/schedules.png)  | ![Revisar](docs/img/review.png)                           |

|      Presupuesto: previsto y gastado, la respuesta primero      |      Categorías: cada lista se edita en un panel lateral      |
| :--------------------------------------------------------: | :----------------------------------------------------------: |
| ![Presupuesto](docs/img/budget.png)                              | ![Categorías](docs/img/categories.png)                         |

|                 Informes interactivos                  |            Apariencia: tema, color, barra lateral            |
| :-------------------------------------------------: | :------------------------------------------------: |
| ![Informes](docs/img/reports.png)                     | ![Ajustes](docs/img/settings.png)             |

|            Un resumen que organizas a tu gusto             |    Importar y exportar: `.xhb` de HomeBank, copia de seguridad y restauración    |
| :------------------------------------------------------: | :------------------------------------------------: |
| ![Personalizar el resumen](docs/img/dashboard-customize.png) | ![Exportar](docs/img/export.png)             |

<sub>Las capturas muestran los datos inventados de la demo, en inglés.</sub>

## Funciones

- **Cuentas y movimientos:** todos los tipos de cuenta de HomeBank, cada una en su moneda, con el saldo actual y el previsto. Los movimientos se marcan como verificados y conciliados, con divisiones, etiquetas y transferencias; la lista de movimientos tiene filtros, columnas a elegir, acciones sobre varias filas, búsqueda y conciliación con el extracto.
- **Movimientos programados y calendario:** lo que se repite se registra solo, hasta tres meses antes si quieres. Un calendario muestra los vencimientos del mes con su estado, lo que queda por pagar y lo que te espera; las plantillas y las reglas de asignación rellenan el resto. CloudBank también encuentra los pagos que se repiten sin un movimiento programado, muestra cuánto cuesta cada uno en un año y pone los vencimientos en el calendario del móvil.
- **Presupuesto e informes:** adónde fue el dinero, qué entró y qué salió, qué tienen y tendrán las cuentas, cuánto cuesta un coche; por mes, trimestre o año, con vistas guardadas y descargas en CSV y PNG.
- **Metas de ahorro y vehículos:** cuánto has reservado, cuánto reservar cada mes para llegar a tiempo, y cuánto queda disponible; para cada vehículo, el combustible, los kilómetros, el coste por kilómetro y el consumo.
- **Importar y exportar:** `.xhb` de HomeBank, QIF, OFX/QFX, CSV y CAMT.053 (ISO 20022) de entrada, con un asistente; `.xhb`, QIF y CSV de salida; copia de seguridad y restauración de la cartera.
- **Conexión bancaria:** los movimientos nuevos llegan del banco, pasan por tus reglas y se fusionan con los que ya existen en lugar de aparecer duplicados. Con tus propias credenciales, mediante [SimpleFIN](https://www.simplefin.org/), [Enable Banking](https://enablebanking.com/) (UE y Reino Unido) y, de forma experimental, [Pluggy](https://pluggy.ai/) (Latinoamérica).
- **Correos del banco:** CloudBank lee los avisos de pago de una carpeta de un buzón: Outlook.com, Hotmail o Live iniciando sesión en Microsoft, cualquier otro por IMAP con una contraseña de aplicación. Un patrón que creas resaltando un correo real convierte cada uno en un movimiento verificado, o lo lee la IA, tras ocultar los números de tarjeta y los IBAN. La conexión bancaria fusiona su propia fila con la del correo en lugar de duplicarla, y Revisar pregunta por los que el banco nunca registró. Solo lectura, a la escucha mientras llegan los correos, y solo de remitentes que el servidor de correo autenticó.
- **Varias monedas y usuarios:** tipos de cambio manuales o en línea (BCE), varios usuarios gestionados por el administrador, carteras compartidas; la app está en inglés e italiano, y en alemán, francés, español y portugués de Brasil (beta).
- **Un resumen a tu medida:** arriba, lo que te espera; debajo, widgets que colocas y redimensionas como quieras, tema claro y oscuro en tu color favorito, barra lateral y navegación que puedes reordenar.
- **Seguridad:** autenticación en dos pasos, inicio de sesión con SSO (OIDC), tokens de API revocables y secretos cifrados en la base de datos. Con un token, Home Assistant lee un resumen de la cartera como sensores: vencimientos, el presupuesto del mes, lo que espera en Revisar, y los saldos solo si los pides ([la guía](docs/home-assistant.md)).
- **App instalable:** CloudBank se instala en el móvil o el ordenador como una app, con notificaciones push de los vencimientos, y avisa cuando hay una versión nueva. Manteniendo pulsado el icono aparecen «Nuevo gasto» y «Nuevo ingreso»; en Android, compartir con CloudBank la notificación del banco abre el formulario con su texto.
- **Notificaciones donde las ves:** una campana en cada página y, si quieres, push, correo, Matrix, Telegram, Discord, Slack, ntfy, Gotify o un webhook para Home Assistant. Eliges qué eventos llegan adónde (vencimientos, seguridad, problemas, dinero, resúmenes) y cuándo, con un resumen diario y horas de silencio ([la guía](docs/notifications.md)).
- **IA opcional, con tu propia clave:** apagada hasta que la configuras, con un servicio compatible con OpenAI o un modelo en tu propia red. Escribe un informe de cada mes (y, si quieres, de cada semana y año), propone presupuestos a partir de lo que gastas de verdad, señala suscripciones más caras, categorías que han crecido, metas retrasadas y movimientos inusuales; sugiere categorías y rellena un movimiento escrito con tus palabras («café 3,50 ayer»). Las cifras las calcula CloudBank, nada se guarda sin ti, y cada función dice qué envía ([la guía](docs/ai.md)).

## Inicio rápido

<!-- quick-start -->

Necesitas [Docker](https://docs.docker.com/get-docker/) con el plugin Compose.
Crea un `docker-compose.yml` (o copia [el del repositorio](docker-compose.yml)):

```yaml
services:
  cloudbank:
    image: ghcr.io/easly1989/cloudbank:main # latest stable release (see tags below)
    container_name: cloudbank
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      # Set to "false" only for a plain-HTTP LAN install without TLS in front.
      CB_SECURE_COOKIES: "false"
    volumes:
      - cloudbank-data:/data

volumes:
  cloudbank-data:
```

Luego arráncalo y abre la app:

```bash
docker compose up -d
# open http://localhost:8080 and complete the first-run admin setup
```

Esa es toda la instalación: un contenedor, ninguna base de datos externa. Los datos
están en el volumen `cloudbank-data` (una base SQLite en `/data`). Para hacer una
copia, copia ese volumen, o usa la **copia de seguridad de la cartera** en la app
(Ajustes › Importar y exportar) y la **copia completa** del administrador:
[docs/backup.md](docs/backup.md) explica qué contiene cada una y cómo restaurarla.

Después sigue [Getting started](docs/getting-started.md): el administrador, una
cartera, las cuentas y las categorías, los primeros movimientos.

¿Lo pones detrás de HTTPS (recomendado para todo lo que vaya más allá de una red
doméstica de confianza)? Mira [docs/reverse-proxy.md](docs/reverse-proxy.md). ¿Vienes
de HomeBank en el escritorio? Mira [docs/migrate-from-homebank.md](docs/migrate-from-homebank.md).

<!-- /quick-start -->

## El resto, en inglés

La configuración (las variables `CB_*`), las imágenes del contenedor y el significado de las etiquetas, la instalación como app y todas las guías están en el [README en inglés](README.md) y en [docs/](docs/README.md). Ojo con las etiquetas: `:main` es la última versión estable, `:latest` la compilación nocturna.

## Licencia

CloudBank tiene licencia **GNU Affero General Public License v3.0**: mira [LICENSE](LICENSE). Si ofreces una versión modificada como servicio en red, la AGPL te pide que pongas su código fuente a disposición de sus usuarios.

## Apoyar el proyecto

CloudBank es un proyecto de código abierto hecho con pasión. Si te resulta útil,
piensa en hacer una donación: ayuda de verdad y se agradece mucho. ♥
Lo más sencillo es [**Buy Me a Coffee**](https://buymeacoffee.com/easly1989).
Si prefieres otra forma, la
[página de donaciones](https://easly1989.github.io/donate.html) las recoge todas:
[PayPal](https://paypal.me/carloruggiero),
[Stripe](https://buy.stripe.com/8x26oAeqA7h6dPk80hfbq00),
[Liberapay](https://liberapay.com/amon2126/donate) o
[GitHub Sponsors](https://github.com/sponsors/easly1989).

---

<sub>Alineado con el README de la v3.8.0.</sub>
