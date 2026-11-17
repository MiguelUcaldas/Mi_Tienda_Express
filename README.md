# Mi Tienda Express 🛒

Bot de Telegram (**@Mi_Tienda_Express_Bot**) para que tiendas de barrio, minimercados y pequeños comercios de Manizales reciban pedidos. Es multitienda: cada tienda maneja su catálogo, precios, inventario, promociones, horarios, equipo y pedidos. El cliente compra sin crear cuenta.

Aplicativo 6 – Ingeniería de Software 3 · Ingeniería de Sistemas y Computación · Universidad de Caldas.

## Contenido

- [Tecnologías](#tecnologías)
- [Cómo funciona](#cómo-funciona)
- [Arquitectura](#arquitectura)
- [Requisitos e instalación](#requisitos)
- [Llaves](#llaves-un-solo-archivo) · [Despliegue](#despliegue)
- [Pruebas automáticas](#pruebas-automáticas)
- [Guía rápida de prueba](#guía-rápida-de-prueba)

## Tecnologías

| Pieza | Tecnología |
|---|---|
| Lenguaje | TypeScript sobre **Deno** (runtime de Supabase Edge Functions) |
| Bot | **grammY** en modo **webhook** |
| Base de datos | PostgreSQL de **Supabase** (plan gratuito) con `supabase-js` |
| Temporizadores | `pg_cron` + `pg_net` (llaman al bot cada minuto) |
| Búsqueda sin tildes | extensión `unaccent` |
| Fotos | se guardan en Telegram; en la BD solo el `file_id` |
| Pruebas | `deno test` sobre la lógica crítica |

Ciudad de referencia: Manizales · zona horaria `America/Bogota` · moneda COP en enteros (`$17.500`). La app no usa IA en su funcionamiento.

## Cómo funciona

### Roles

| Rol | Quién es | Qué puede hacer |
|---|---|---|
| **Cliente** | cualquiera, sin registro | explorar tiendas, catálogo y ofertas, carrito, hacer pedidos, enviar comprobante, seguir y cancelar sus pedidos |
| **Dueño** | quien registra la tienda (1 por tienda) | todo: datos, horarios y medios de pago, equipo, transferir la tienda, productos, promociones, pedidos, pagos, reportes |
| **Administrador** | invitado por el dueño | productos, promociones, tarifas, personal (empleados y domiciliarios), pedidos, pagos, reportes |
| **Empleado** | invitado | stock, aceptar y preparar pedidos, asignar domiciliario, entregar |
| **Domiciliario** | invitado | despachar y entregar los pedidos que le asignan (con código) |
| **Super Admin** | definido por `SUPER_ADMIN_TELEGRAM_ID` | panel global: ver y modificar tiendas, activar Premium, activar/desactivar, cambiar dueño, **modo pruebas** |

Una persona tiene un solo rol por tienda, pero puede tener roles distintos en tiendas distintas. La tienda nunca queda sin dueño. Los permisos son una matriz fija en `logica/permisos.ts`.

### Recorrido de un pedido

1. El cliente entra a una tienda (enlace `t.me/Mi_Tienda_Express_Bot?start=<tienda>`, buscador o recomendaciones), arma el carrito y elige **domicilio** o **recogida**, barrio, dirección, datos y medio de pago (transferencia o contra entrega).
2. El pedido llega al dueño, administradores y empleados. Uno lo **acepta** (en domicilio fija el valor, y el bot sugiere la tarifa guardada para ese barrio) o lo **rechaza** con un motivo.
3. En domicilio, el cliente hace la **doble confirmación**: acepta o rechaza el valor del domicilio.
4. Si paga por transferencia, recibe los datos de pago y envía la **foto del comprobante**; el dueño o un administrador marca **Pago recibido** o **No me llegó**.
5. La tienda lo pasa a **en preparación → listo** y asigna un domiciliario (o lo despacha ella misma).
6. El cliente recibe un **código de 4 dígitos**; quien entrega lo escribe en el bot y el pedido queda **entregado**. Tras 3 códigos errados se alerta a la tienda.

Las operaciones críticas (crear pedido, cambiar estado, cancelar, ajustar stock) son funciones SQL atómicas; al cancelar, el stock vuelve.

### Estados del pedido

```
DOMICILIO
esperando_tienda ─► esperando_confirmacion_cliente ─┬─(contra entrega)─► en_preparacion
                                                    └─(transferencia)──► esperando_pago ─► verificando_pago ─► en_preparacion
en_preparacion ─► listo ─► despachado ─(código)─► entregado

RECOGIDA
esperando_tienda ─┬─(pagar al recoger)─► en_preparacion
                  └─(transferencia)────► esperando_pago ─► verificando_pago ─► en_preparacion
en_preparacion ─► listo ─(código)─► entregado

Cualquier estado no final ─► cancelado (por la tienda, por el cliente o por tiempo)
```

### Tareas automáticas (cada minuto)

`pg_cron` llama a `POST /bot/tareas`, que envía **recordatorios** y luego **cancela** los pedidos sin respuesta de la tienda, sin confirmación del cliente o sin comprobante de pago; además vacía carritos viejos y limpia invitaciones vencidas. Los tiempos se cambian en la tabla `configuracion` (ver abajo).

### Otras funciones

- **Catálogo**: categorías comunes y propias, búsqueda sin tildes, fotos, ofertas, aviso de stock bajo y productos agotados con fecha de reabastecimiento y opción "avísame cuando vuelva".
- **Promociones** por porcentaje con fecha de inicio y fin (🔥).
- **Horarios** por día en hora de Bogotá; fuera de horario la tienda no recibe pedidos.
- **Tarifas de domicilio** por barrio (118 barrios de Manizales) que el bot recuerda.
- **Equipo** con enlaces de invitación de un solo uso que vencen; transferencia de la tienda.
- **Reportes** e historial para dueño y administradores.
- **Gratis vs Premium**: sin Premium, máximo 10 productos por tienda.
- **Modo pruebas** (Super Admin): simula cualquier rol en cualquier tienda para probar un pedido completo con una sola cuenta.

### Seguridad

- Telegram firma cada llamada al webhook con `TELEGRAM_WEBHOOK_SECRET`; las rutas `/tareas` y `/configurar` exigen el mismo secreto.
- Las llaves de Supabase las inyecta la plataforma en la función; no se copian a ningún archivo.
- `.env` y `supabase/.temp` están en `.gitignore`: **ninguna llave está en el repositorio**.

## Arquitectura

```
Celular (Telegram) ──► Servidores de Telegram ──► Edge Function "bot" (Deno + grammY) ──► PostgreSQL (Supabase)
                                                        ▲
                               pg_cron (cada minuto) ───┘  POST /bot/tareas
```

- **Edge Function `bot`** (`supabase/functions/bot`), modo webhook, sin estado en memoria: carritos, pasos de conversación y modo pruebas viven en tablas.
- Operaciones críticas (crear pedido, cambiar estado, cancelar, ajustar stock, transferir tienda, aceptar invitación) son **funciones SQL atómicas**.
- `pg_cron` + `pg_net` llaman a `/bot/tareas` cada minuto para recordatorios y cancelaciones automáticas.

### Estructura

```
.env.example              plantilla de llaves (copiar a .env)
desplegar.sh              despliegue completo
supabase/
  config.toml
  seed.sql                datos semilla idempotentes
  migrations/             extensiones, tablas, funciones SQL, permisos
  functions/
    _compartido/          entorno y cliente de Supabase
    bot/
      index.ts            rutas /tareas, /configurar y webhook
      bot.ts              grammY, middlewares y despacho de botones/flujos
      logica/             funciones puras (permisos, estados, cálculos, promociones, horarios, límites, códigos)
      pruebas/            deno test de la carpeta logica
      middleware/         registrar usuario, estado de conversación, rol
      menus/              menú inicial, cliente, personal, tarjeta del pedido
      flujos/             registro, catálogo, carrito, checkout, pedidos, pagos, entregas, equipo, ...
      servicios/          acceso a datos y notificaciones
      tareas/             temporizadores (cada minuto)
```

## Requisitos

- Una cuenta de Supabase con un proyecto creado (plan gratuito sirve).
- El bot creado en Telegram con @BotFather.
- **CLI de Supabase** (`supabase`), o Node.js para usarlo con `npx supabase`.
  - macOS: `brew install supabase/tap/supabase`
  - Windows: `scoop install supabase` (o `npm install -g supabase`)
- **Deno 2** (solo para revisar tipos y correr pruebas en tu equipo): <https://deno.com> → `irm https://deno.land/install.ps1 | iex` (Windows) o `curl -fsSL https://deno.land/install.sh | sh`.
- Git Bash, WSL, macOS o Linux para ejecutar `desplegar.sh`.

### Instalación

```bash
git clone https://github.com/MiguelUcaldas/Mi_Tienda_Express.git
cd Mi_Tienda_Express
```

## Llaves (un solo archivo)

1. Copia `.env.example` a `.env` en la raíz del proyecto.
2. Llena las 5 líneas:
   - `TELEGRAM_BOT_TOKEN` → el token de @BotFather
   - `TELEGRAM_WEBHOOK_SECRET` → el resultado de `openssl rand -hex 32`
   - `SUPER_ADMIN_TELEGRAM_ID` → tu "Id" de @userinfobot
   - `SUPABASE_PROJECT_ID` → Supabase → Project Settings → General
   - `SUPABASE_DB_PASSWORD` → la contraseña de la base de datos
3. No hace falta copiar la URL ni las llaves de API de Supabase: la función ya las tiene.

`.env` está en `.gitignore`. Nunca lo subas a GitHub.

## Despliegue

```bash
chmod +x desplegar.sh
./desplegar.sh
```

El script: valida el `.env`, inicia sesión en Supabase (abre el navegador la primera vez), vincula el proyecto, aplica migraciones y semilla, guarda los secretos, despliega la función `bot` y llama a `/bot/configurar`, que desde Supabase:

1. registra el webhook de Telegram,
2. registra los comandos `/start`, `/menu`, `/cancelar`, `/ayuda`,
3. programa la tarea `mte_tareas_cada_minuto` en `pg_cron`,
4. deja al Super Admin como dueño de las tiendas semilla que no tengan dueño.

Se puede ejecutar varias veces sin dañar nada.

### Si algo falla

- **Una extensión** (`unaccent`, `pg_net`, `pg_cron`): actívala en Supabase → Database → Extensions y vuelve a ejecutar.
- **Tu CLI no reconoce `--include-seed`**: ejecuta `supabase db push -p "<contraseña>"` y luego copia todo `supabase/seed.sql` en Supabase → SQL Editor → Run. Es idempotente.
- **El deploy pide Docker**: el script reintenta solo con `--use-api`.
- **Logs**: Supabase → Edge Functions → bot → Logs.

## Pruebas automáticas

```bash
deno test supabase/functions/bot/pruebas/
deno check supabase/functions/bot/index.ts
```

Cubren la lógica crítica: cálculos y formato de pesos, promociones, máquina de estados, matriz de permisos, límite de productos, código de entrega y horarios en hora de Bogotá.

## Cambiar los tiempos y límites

Supabase → Table Editor → tabla **`configuracion`**. Los cambios aplican de inmediato, sin redesplegar:

| clave | por defecto |
|---|---|
| `minutos_recordatorio_tienda` / `minutos_cancelacion_tienda` | 3 / 5 |
| `minutos_recordatorio_cliente` / `minutos_cancelacion_cliente` | 3 / 5 |
| `minutos_recordatorio_pago` / `minutos_cancelacion_pago` | 5 / 10 |
| `horas_vencimiento_carrito` | 24 |
| `limite_productos_gratis` | 10 |
| `max_pedidos_activos_por_tienda` | 1 |
| `umbral_stock_bajo` | 3 |
| `horas_vencimiento_invitacion` | 24 |
| `intentos_maximos_codigo_entrega` | 3 |

## Guía rápida de prueba

1. `/start` → **⭐ Recomiéndame tiendas** → entra a **Mercaldas** (Premium). La leche tiene 🔥 20 %.
2. Agrega productos al carrito → **✅ Hacer pedido** → Domicilio → barrio → Nequi → Confirmar.
3. Como dueño (tú, Super Admin) te llega el pedido: **Aceptar** → elige el valor del domicilio (sugiere el guardado).
4. Como cliente: **Acepto** → llegan los datos de Nequi → envía cualquier foto como comprobante.
5. Como dueño: **Pago recibido** → **Marcar listo** → **Asignar domiciliario** (o **Marcar despachado** si no hay).
6. El cliente recibe el código de 4 dígitos → **Entregar** → escribe el código → ✅ Entregado.
7. **Límite de 10**: en La Esquina (9 productos) crea 1 producto; el siguiente muestra el mensaje Premium.
8. **Modo pruebas**: Panel Super Admin → 🧪 Modo pruebas → tienda → rol. Recibes todas las notificaciones de esa tienda con su etiqueta 🧪 y puedes completar un pedido de principio a fin con una sola cuenta.
9. **Cancelación por tiempo**: haz un pedido y no lo aceptes; a los 3 min llega el recordatorio y a los 5 se cancela y el stock vuelve.

## Notas para la demostración en la universidad

- La red de la universidad **bloquea Telegram** pero **no Supabase**. El bot corre en Supabase y habla con Telegram desde la nube, así que funciona igual.
- Los celulares de la demo deben usar **datos móviles** para abrir Telegram (o compartir datos al portátil si se proyecta Telegram Desktop).
- `desplegar.sh` funciona desde la red de la universidad: el webhook lo registra Supabase, no el portátil.
- Revisa el horario de las tiendas semilla según la hora de la demo: Mercaldas abre de 6:00 a 23:00; La Esquina cierra a las 21:00 y los domingos.
- Reparto sugerido con 3 cuentas: A = Super Admin y dueño de Mercaldas; B = cliente en Mercaldas y dueño de La Esquina (con "Cambiar dueño"); C = domiciliario de Mercaldas y cliente de La Esquina. Sin celulares prestados, usa el **modo pruebas**.
- El proyecto gratuito de Supabase se pausa tras 7 días sin actividad; se reactiva con un clic en el panel.

## Decisiones tomadas por el agente

Cosas que la especificación no fijaba; se eligió la opción más simple que cumple las reglas:

1. **Carpeta raíz**: el proyecto vive directamente en esta carpeta (`Mi_tienda_express/`) en lugar de una subcarpeta `mi-tienda-express/`.
2. **Funciones SQL adicionales**: `config_int`, `resumen_global`, `transferir_tienda` y `aceptar_invitacion`, para que el panel global, la transferencia (RN-42) y el uso único de invitaciones (RN-38) sean atómicos.
3. **Prefijos extra de botones** además de los sugeridos: `rt` (registro), `cfg` (Mi tienda), `prd` (productos), `ctg` (categorías), `stk` (inventario), `rep` (reportes), `of` (ofertas), `pl` (listas de pedidos), `bp` (buscar producto), `inf` (info), `enl` (enlace), `inv` (invitación), `dm` (datos de un medio de pago).
4. **Seguimiento del pedido**: cuando un pedido entra a preparación (cliente acepta el domicilio con contra entrega o se confirma el pago), el personal recibe una tarjeta con los botones del siguiente paso. Quien actúa ve su mensaje actualizado; a los demás se les edita con "✅ {acción} por {nombre}" y se quitan los botones.
5. **Modo pruebas**: los botones de pedidos funcionan con permisos de dueño (vista tienda); los de cliente y domiciliario, si el Super Admin es el cliente o el domiciliario asignado. Menús y equipo usan el rol simulado.
6. **"No me llegó"** borra el comprobante anterior, así el cliente envía uno nuevo y la cancelación posterior no se marca como "ya había pagado".
7. **Tienda nueva**: la descripción es obligatoria (3–150 caracteres) y debe abrir al menos un día.
8. **Búsqueda de productos**: muestra hasta 20 resultados en una sola lista (la búsqueda ya está limitada a 20).
9. **"🧾 Mis pedidos" del cliente**: pedidos activos más los últimos 5 terminados, de todas las tiendas.
10. **Fin de la promoción** con "En 7/15/30 días" se cuenta desde la fecha de inicio elegida.
11. **Recogida lista**: al cliente se le avisa con su código; en domicilio el aviso llega al despachar (como dice 11.9).
12. **Cambio de dueño por enlace** cuando el dueño anterior es el Super Admin: queda como administrador y recibe los botones [Dejarme como administrador] [Quitarme de la tienda].
13. **Rechazo "No llego a ese barrio"**: marcar el barrio como "No entrego" lo puede hacer quien rechazó (permiso de gestionar pedidos).
14. **Alerta de código fallido**: se envía una vez al llegar a 3 intentos; los intentos siguientes no repiten la alerta.
