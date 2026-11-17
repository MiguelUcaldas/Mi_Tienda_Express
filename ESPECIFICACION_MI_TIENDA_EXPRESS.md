# ESPECIFICACIÓN DE CONSTRUCCIÓN — MI TIENDA EXPRESS

**Proyecto:** Aplicativo 6 – Mi Tienda Express (Ingeniería de Software 3 · Ingeniería de Sistemas y Computación · Universidad de Caldas)
**Autor de las decisiones:** Miguel Ángel Rojas
**Destinatario:** agente local de construcción de código
**Fecha:** 15 de noviembre de 2026

---

## 0. INSTRUCCIONES PARA EL AGENTE (LEER PRIMERO, CUMPLIR SIEMPRE)

1. **Construye todo de corrido**, fase por fase (sección 17), sin detenerte a pedir confirmación entre fases.
2. **Detente solamente en dos momentos:**
   - Cuando hayas terminado las fases 1 a 13 y todas las pruebas automáticas pasen. Ahí entregas el **mensaje final de entrega** (sección 18) y esperas.
   - Antes de la Fase 14 (dashboard). **No la inicies** hasta que Miguel escriba textualmente: `Autorizo construir el dashboard`.
3. **Nunca escribas llaves, tokens, contraseñas ni IDs reales** en ningún archivo. Todo valor secreto se lee de variables de entorno. Miguel pondrá los valores a mano en un único archivo `.env` (sección 14).
4. **No ejecutes** `desplegar.sh`, `supabase link`, `supabase db push`, `supabase functions deploy` ni `supabase secrets set`. El despliegue lo hace Miguel. Sí puedes ejecutar `deno check` y `deno test`.
5. **No inventes funcionalidades** que no estén en este documento. Si algo no está especificado, elige la opción más simple que cumpla las reglas y anótala en la sección "Decisiones tomadas por el agente" del README.
6. **Nombres en español y legibles** para tablas, columnas, variables, funciones y archivos (`calcularTotalPedido`, `tarifas_domicilio`). Sin tildes ni ñ en identificadores de código (`dueno`, `anio`). Comentarios cortos y naturales; nada de bloques largos de comentarios genéricos.
7. **Todos los textos que ve el usuario** van en español de Colombia, tuteando, cercanos, claros y con emojis moderados (máximo 1–2 por mensaje, salvo en listas).
8. Si una tarea es muy grande, divídela en archivos pequeños (máximo ~300 líneas por archivo).
9. Antes de declarar terminada cada fase, revisa su **lista de verificación**. No pases a la siguiente con ítems pendientes.

---

## 1. CONTEXTO Y OBJETIVO

Mi Tienda Express ofrece a tiendas de barrio, minimercados y pequeños comercios un canal de consulta de productos y recepción de pedidos mediante **Telegram**. Es **multitienda**: cada tienda administra su propio catálogo, precios, inventario, promociones, horarios, equipo y pedidos. El cliente explora sin crear cuenta; sus datos se piden al confirmar el pedido.

La integración con "Domiciliarios Eje" **queda fuera del alcance**. La app no tiene IA en su funcionamiento.

**Bot de Telegram:** `@Mi_Tienda_Express_Bot`
**Ciudad de referencia:** Manizales, Colombia. **Zona horaria:** `America/Bogota` (UTC-5, sin horario de verano).
**Moneda:** pesos colombianos (COP), **siempre enteros**, sin decimales. Formato de visualización: `$17.500`.

---

## 2. ARQUITECTURA Y STACK (DECIDIDO, NO CAMBIAR)

```
 Celular (app Telegram) ──► Servidores de Telegram ──► Supabase Edge Function "bot" ──► Base de datos Supabase (PostgreSQL)
                         ◄──                        ◄── (TypeScript + grammY)       ◄──
                                                             ▲
                                     pg_cron (cada minuto) ──┘  (temporizadores)
```

| Pieza | Tecnología |
|---|---|
| Lenguaje | TypeScript sobre **Deno** (runtime de Supabase Edge Functions) |
| Librería del bot | **grammY** (`npm:grammy@^1`) en modo **webhook** |
| Cliente de base de datos | `npm:@supabase/supabase-js@2` con la **llave secreta** (bypass de RLS) |
| Base de datos | PostgreSQL de Supabase (plan gratuito) |
| Temporizadores | `pg_cron` + `pg_net` llamando a la ruta `/tareas` del bot cada minuto |
| Búsqueda sin tildes | extensión `unaccent` |
| Fotos | Se guardan en Telegram; en la BD solo el `file_id` |
| Pruebas | `deno test` (solo lógica crítica) |
| Dashboard (Fase 14) | HTML + JS estático en GitHub Pages + Edge Function `dashboard` + Chart.js |

**Principios:**
- El bot **no guarda nada en memoria** entre mensajes (cada invocación es independiente). Todo estado (carritos, pasos de conversación, rol simulado) vive en tablas.
- **No usar** el plugin `@grammyjs/conversations` ni sesiones en memoria. El estado de conversación se maneja con la tabla `estados_conversacion` (sección 10.4).
- Las operaciones críticas (crear pedido, cambiar estado, cancelar, ajustar stock) se hacen con **funciones SQL** (`rpc`) para que sean atómicas.
- El proyecto de Supabase tiene: Data API activa, **RLS automático activado** y **"exponer tablas automáticamente" desactivado**. Por eso las migraciones deben dar permisos explícitos a `service_role` (sección 7.3).

---

## 3. ROLES Y PERMISOS

### 3.1 Equivalencia con el enunciado

| Enunciado | Rol en el sistema | Cantidad |
|---|---|---|
| Administrador de tienda | **Dueño** (`dueno`) | 1 por tienda, siempre debe existir |
| Empleado o vendedor | **Administrador** (`administrador`) — un escalón arriba del empleado | Varios por tienda |
| Empleado o vendedor | **Empleado** (`empleado`) | Varios por tienda |
| Domiciliario | **Domiciliario** (`domiciliario`) | Varios por tienda |
| Cliente | **Cliente** (sin registro, rol por defecto) | Cualquiera |
| *(extra)* | **Super Admin** (global, por `SUPER_ADMIN_TELEGRAM_ID`) | Solo uno |

### 3.2 Reglas de roles

- **Un solo rol por persona dentro de cada tienda.** En otra tienda la misma persona puede tener otro rol o ser cliente.
- Quien **no** tiene membresía activa en una tienda es **cliente** de esa tienda.
- Quien registra una tienda queda como su **dueño**.
- **Nadie** (administradores, empleados, domiciliarios) puede modificar, quitar ni cambiar el rol del dueño. Solo el propio dueño ("Transferir tienda") o el Super Admin ("Cambiar dueño") cambian al dueño.
- Un administrador **no** puede modificar a otros administradores ni ascender a nadie a administrador.
- La tienda **nunca** queda sin dueño.
- El Super Admin no es miembro de las tiendas por ese hecho; tiene su propio panel. Puede además ser dueño o miembro de tiendas como cualquiera.

### 3.3 Matriz de permisos fijos

Implementar en `logica/permisos.ts` como una tabla constante y una función pura `puede(rol, accion): boolean`.

| Acción (`accion`) | dueno | administrador | empleado | domiciliario |
|---|:-:|:-:|:-:|:-:|
| `configurar_tienda` (datos, horarios, descripción, medios de pago) | ✅ | ❌ | ❌ | ❌ |
| `transferir_tienda` | ✅ | ❌ | ❌ | ❌ |
| `gestionar_administradores` (invitar, quitar, cambiar a/desde administrador) | ✅ | ❌ | ❌ | ❌ |
| `gestionar_personal` (invitar/quitar/cambiar entre empleado y domiciliario) | ✅ | ✅ | ❌ | ❌ |
| `gestionar_productos` (crear, editar, eliminar productos y categorías) | ✅ | ✅ | ❌ | ❌ |
| `gestionar_promociones` | ✅ | ✅ | ❌ | ❌ |
| `gestionar_tarifas` (tarifas de domicilio guardadas) | ✅ | ✅ | ❌ | ❌ |
| `actualizar_stock` (cantidades y activo/inactivo) | ✅ | ✅ | ✅ | ❌ |
| `gestionar_pedidos` (aceptar, rechazar, preparación, listo, despachar si no hay domiciliario) | ✅ | ✅ | ✅ | ❌ |
| `confirmar_pagos` | ✅ | ✅ | ❌ | ❌ |
| `asignar_domiciliario` | ✅ | ✅ | ✅ | ❌ |
| `entregar_pedido` (ingresar código de entrega) | ✅ | ✅ | ✅ | ✅ (solo pedidos asignados a él) |
| `despachar_asignado` (marcar despachado un pedido asignado a él) | ❌ | ❌ | ❌ | ✅ |
| `cancelar_pedido_aceptado` | ✅ | ✅ | ❌ | ❌ |
| `ver_reportes` | ✅ | ✅ | ❌ | ❌ |
| `ver_dashboard` (solo si la tienda es Premium) | ✅ | ❌ | ❌ | ❌ |

**Destinatarios de notificaciones por tipo:**

| Tipo de notificación | Destinatarios |
|---|---|
| Pedido nuevo, recordatorio por pedido sin respuesta | dueño, administradores y empleados activos |
| Comprobante de pago recibido | dueño y administradores |
| Producto agotado (pregunta de reabastecimiento) | dueño y administradores |
| Código de entrega fallido 3 veces | dueño y administradores |
| Cancelación por el cliente o por tiempo | dueño, administradores y empleados |
| Pedido asignado | el domiciliario asignado |

Si el Super Admin tiene **modo pruebas** activo en esa tienda, también recibe todas las notificaciones de esa tienda (sección 11.17). Nunca enviar dos veces el mismo mensaje a la misma persona.

---

## 4. CASOS DE USO

| ID | Caso de uso | Actor principal |
|---|---|---|
| CU-01 | Iniciar el bot y entrar a una tienda (enlace, buscador o recomendaciones) | Cliente |
| CU-02 | Explorar categorías, buscar productos y ver detalle | Cliente |
| CU-03 | Ver ofertas vigentes | Cliente |
| CU-04 | Pedir aviso cuando un producto agotado vuelva | Cliente |
| CU-05 | Gestionar carrito (agregar, cambiar cantidad, quitar, vaciar) | Cliente |
| CU-06 | Confirmar pedido (modalidad, barrio, dirección, datos, medio de pago) | Cliente |
| CU-07 | Aceptar o rechazar el valor del domicilio (doble confirmación) | Cliente |
| CU-08 | Enviar comprobante de pago | Cliente |
| CU-09 | Consultar estado de mis pedidos y cancelar dentro del tiempo permitido | Cliente |
| CU-10 | Registrar una tienda | Cualquier usuario |
| CU-11 | Configurar datos, horarios, descripción y medios de pago de la tienda | Dueño |
| CU-12 | Invitar, cambiar de rol y quitar miembros del equipo | Dueño / Administrador |
| CU-13 | Transferir la tienda | Dueño |
| CU-14 | Gestionar categorías y productos (límite de 10 sin Premium) | Dueño / Administrador |
| CU-15 | Actualizar stock y disponibilidad; responder fecha de reabastecimiento | Dueño / Administrador / Empleado |
| CU-16 | Gestionar promociones con vigencia | Dueño / Administrador |
| CU-17 | Gestionar tarifas de domicilio guardadas | Dueño / Administrador |
| CU-18 | Aceptar o rechazar pedidos y fijar el valor del domicilio | Dueño / Administrador / Empleado |
| CU-19 | Confirmar o rechazar pagos | Dueño / Administrador |
| CU-20 | Avanzar estados de preparación y asignar domiciliario | Dueño / Administrador / Empleado |
| CU-21 | Despachar y entregar con código | Domiciliario (o personal si no hay domiciliario) |
| CU-22 | Cancelar un pedido aceptado antes del despacho | Dueño / Administrador |
| CU-23 | Consultar reportes e historial | Dueño / Administrador |
| CU-24 | Listar, ver y modificar todas las tiendas; activar Premium; activar/desactivar; cambiar dueño | Super Admin |
| CU-25 | Usar el modo pruebas | Super Admin |
| CU-26 | Cancelaciones y recordatorios automáticos por tiempo | Sistema (pg_cron) |
| CU-27 | Ver dashboard gráfico (Fase 14) | Super Admin / Dueño de tienda Premium |

---

## 5. REGLAS DE NEGOCIO

Numeradas para referenciarlas en el código y en las pruebas.

**Tiendas y Premium**
- **RN-01** Cualquier usuario puede registrar una tienda y queda como su dueño.
- **RN-02** Cada tienda tiene `es_premium` (booleano, por defecto `false`). Solo el Super Admin lo cambia. No hay pagos ni pasarela.
- **RN-03** Tienda **no Premium**: máximo `limite_productos_gratis` (= 10) productos **no eliminados** (activos e inactivos cuentan). Al intentar crear el producto número 11 se muestra el mensaje de broma de Premium (sección 12) y no se crea.
- **RN-04** Tienda **Premium**: productos ilimitados, aparece en "⭐ Recomiéndame tiendas" y su dueño tiene acceso al dashboard (Fase 14).
- **RN-05** Para liberar cupo hay que **eliminar** el producto (borrado lógico `eliminado = true`; deja de contar y desaparece del catálogo y de los carritos; se conserva para el historial de pedidos).
- **RN-06** Una tienda desactivada por el Super Admin (`activa = false`) no aparece en búsquedas ni recomendaciones y no recibe pedidos nuevos. Sus pedidos en curso siguen su ciclo normal.

**Catálogo e inventario**
- **RN-07** Categorías comunes precargadas (`tienda_id IS NULL`): Lácteos, Panadería, Bebidas, Aseo, Granos, Mecato, Carnes, Frutas y verduras. Cada tienda puede crear categorías propias y ocultar las comunes que no use.
- **RN-08** Producto: obligatorios nombre, categoría, precio (> 0), unidad (`unidad`, `kg`, `libra`, `paquete`) y stock (≥ 0). Opcionales foto (`file_id`) y descripción (máx. 300 caracteres).
- **RN-09** El stock es cantidad entera. Un producto con stock 0 se muestra como **Agotado** y no se puede agregar al carrito.
- **RN-10** Cuando el stock de un producto llega a 0 (por pedido o por ajuste manual), el bot pregunta al dueño y administradores cuándo reabastecerán: `[Mañana] [En 2-3 días] [Esta semana] [No sé aún]` → `fecha_reabastecimiento` = hoy+1, hoy+3, hoy+7 o `NULL`. El cliente ve "Agotado – vuelve aprox. el {día} {fecha}" o "Agotado".
- **RN-11** El cliente puede tocar "🔔 Avísame cuando llegue" en un producto agotado. Cuando el stock pasa de 0 a más de 0, el bot avisa a esos clientes, borra los avisos y limpia `fecha_reabastecimiento`.
- **RN-12** "Stock bajo" = stock entre 1 y `umbral_stock_bajo` (= 3). Se usa en reportes.

**Promociones**
- **RN-13** Una promoción aplica a **un producto**, es de tipo `porcentaje` (1–90) o `precio_especial` (menor al precio normal), y tiene fecha de inicio y fin (inclusive, en hora de Bogotá).
- **RN-14** Un producto tiene **como máximo una promoción vigente o programada a la vez**. Si se crea otra, el bot pregunta si reemplazar la existente.
- **RN-15** Precio vigente = con promoción vigente: `porcentaje` → `round(precio * (100 - valor) / 100)`; `precio_especial` → `valor`. Sin promoción vigente → `precio`.
- **RN-16** El cliente ve el precio normal tachado (`<s>$4.800</s>`) y el precio con descuento, con la etiqueta 🔥.

**Carrito**
- **RN-17** Un carrito por cliente **por tienda**, conservado aunque el cliente cambie de tienda.
- **RN-18** El carrito **no aparta stock**. Al confirmar se valida el stock real; si no alcanza, se informa y se ajusta la cantidad.
- **RN-19** Los precios se calculan **al confirmar** (precio vigente en ese momento).
- **RN-20** Los carritos sin actividad durante `horas_vencimiento_carrito` (= 24) se vacían automáticamente.

**Pedidos**
- **RN-21** Máximo `max_pedidos_activos_por_tienda` (= 1) pedido activo por cliente en cada tienda. Pedido activo = cualquier estado distinto de `entregado` y `cancelado`.
- **RN-22** Con la tienda **cerrada** (según horario) el cliente puede ver el catálogo y llenar el carrito, pero **no confirmar**. Mensaje: "🔒 {Tienda} está cerrada. Abre {día} a las {hora}."
- **RN-23** Las unidades se **descuentan del stock al confirmar el pedido** (estado `esperando_tienda`). En cualquier cancelación las unidades **vuelven** al stock.
- **RN-24** Medios de pago posibles: `llave_breb`, `nequi`, `bancolombia`, `contra_entrega`. Cada tienda activa al menos uno. En recogida, `contra_entrega` se muestra como **"Pagar al recoger"**.
- **RN-25** El cliente elige el medio de pago al confirmar, entre los activos de la tienda. Con transferencia (`llave_breb`, `nequi`, `bancolombia`) debe enviar foto del comprobante y la tienda confirma antes de preparar. Con `contra_entrega` no hay comprobante.
- **RN-26** Domicilio: el cliente elige barrio (lista de 118 barrios agrupados por comuna) y escribe dirección exacta. Si la tienda tiene ese barrio marcado "No entrego", se le informa de inmediato y se le ofrece recoger en tienda. Si el barrio no aparece → "Mi barrio no aparece" → solo recogida.
- **RN-27** El valor del domicilio lo fija la tienda **al aceptar** el pedido (botones rápidos o valor sugerido por la memoria). Ese valor se guarda en `tarifas_domicilio` de la tienda (memoria). Luego el cliente acepta o rechaza (**doble confirmación**).
- **RN-28** Recogida en tienda: no hay valor de domicilio ni doble confirmación.
- **RN-29** El cliente puede cancelar mientras el pedido esté en `esperando_tienda`, `esperando_confirmacion_cliente`, `esperando_pago` o `verificando_pago`. Desde `en_preparacion` ya no.
- **RN-30** Dueño o administrador pueden cancelar un pedido aceptado (estados `esperando_confirmacion_cliente`, `esperando_pago`, `verificando_pago`, `en_preparacion`, `listo`) con motivo obligatorio. Nunca después de `despachado`.
- **RN-31** Si al cancelar el cliente ya había enviado comprobante (o el pago fue confirmado), el bot le informa: "La tienda se comunicará contigo para el reembolso".
- **RN-32** Código de entrega: 4 dígitos aleatorios por pedido. Se envía al cliente al pasar a `despachado` (domicilio) o a `listo` (recogida). **Solo** con ese código se puede marcar `entregado`. No existe botón "Recibí mi pedido" para el cliente.
- **RN-33** A los `intentos_maximos_codigo_entrega` (= 3) intentos fallidos, se alerta una vez al dueño y administradores. Se puede seguir intentando.
- **RN-34** Si la tienda no tiene domiciliarios activos, no aparece "Asignar domiciliario" y el personal con `gestionar_pedidos` marca `despachado`. Si hay domiciliario asignado, solo él marca `despachado`.
- **RN-35** Gana el primero: cuando varias personas reciben la misma notificación con botones, la primera acción válida gana (UPDATE atómico condicionado al estado). A los demás se les edita el mensaje con "✅ {acción} por {nombre}" y se quitan los botones.

**Temporizadores** (valores en la tabla `configuracion`, editables sin redesplegar)

| Estado | Recordatorio | Cancelación automática | Clave de configuración |
|---|---|---|---|
| `esperando_tienda` | 3 min (a la tienda) | 5 min | `minutos_recordatorio_tienda`, `minutos_cancelacion_tienda` |
| `esperando_confirmacion_cliente` | 3 min (al cliente) | 5 min | `minutos_recordatorio_cliente`, `minutos_cancelacion_cliente` |
| `esperando_pago` | 5 min (al cliente) | 10 min | `minutos_recordatorio_pago`, `minutos_cancelacion_pago` |

- **RN-36** `pg_cron` revisa cada minuto, así que la cancelación ocurre entre el minuto N y N+1. Es aceptable.
- **RN-37** `verificando_pago` **no** tiene temporizador (espera a la tienda). Aparece en "📋 Pedidos pendientes".

**Equipo**
- **RN-38** Invitaciones por enlace `t.me/<bot>?start=inv_<CODIGO>`, de un solo uso, válidas `horas_vencimiento_invitacion` (= 24) horas.
- **RN-39** Quitar a un miembro = `activo = false` (no se borra la fila). Efecto inmediato. Se le notifica.
- **RN-40** No se puede quitar a un domiciliario con pedidos asignados en `listo` o `despachado`; primero hay que reasignarlos.
- **RN-41** Cualquier miembro excepto el dueño puede usar "Salir del equipo".
- **RN-42** Transferir tienda: el dueño elige un miembro activo; ese miembro pasa a dueño y el antiguo dueño pasa a administrador. Requiere confirmación.

**Datos del cliente**
- **RN-43** Al confirmar se piden nombre, teléfono (botón nativo "📱 Compartir mi número" o escrito, 7–13 dígitos) y, si es domicilio, barrio y dirección con referencias. Se guardan en `usuarios` y en el siguiente pedido se ofrecen: "¿Enviamos a {dirección}, {barrio}, a nombre de {nombre}? [✅ Sí] [✏️ Cambiar datos]".

---

## 6. MÁQUINA DE ESTADOS DEL PEDIDO

### 6.1 Estados

| Estado (`estado`) | Significado | Equivalente en el enunciado |
|---|---|---|
| `esperando_tienda` | Pedido registrado, la tienda debe aceptar o rechazar | Registro |
| `esperando_confirmacion_cliente` | Tienda aceptó y fijó domicilio; el cliente debe aceptar el valor | Confirmación |
| `esperando_pago` | El cliente debe transferir y enviar comprobante | Confirmación |
| `verificando_pago` | Comprobante enviado; dueño/administrador debe confirmar | Confirmación |
| `en_preparacion` | La tienda está alistando | Preparación |
| `listo` | Listo para despachar o recoger | Listo para entregar |
| `despachado` | Va en camino (solo domicilio) | Despachado |
| `entregado` | Entregado con código | Entregado |
| `cancelado` | Cancelado (ver `motivo_cancelacion`) | Cancelado |

### 6.2 Transiciones permitidas

Implementar como tabla constante en `logica/estados.ts` con función pura `transicionPermitida(estadoActual, estadoNuevo, modalidad, medioPago): boolean`.

```
DOMICILIO
esperando_tienda ──aceptar+tarifa──► esperando_confirmacion_cliente
esperando_confirmacion_cliente ──cliente acepta, contra_entrega──► en_preparacion
esperando_confirmacion_cliente ──cliente acepta, transferencia──► esperando_pago
esperando_pago ──cliente envía foto──► verificando_pago
verificando_pago ──"Pago recibido"──► en_preparacion
verificando_pago ──"No me llegó"──► esperando_pago   (se reinician los tiempos de pago)
en_preparacion ──► listo ──► despachado ──código correcto──► entregado

RECOGIDA
esperando_tienda ──aceptar, contra_entrega("Pagar al recoger")──► en_preparacion
esperando_tienda ──aceptar, transferencia──► esperando_pago
esperando_pago ──► verificando_pago ──► en_preparacion   (igual que domicilio)
en_preparacion ──► listo ──código correcto──► entregado

CANCELACIÓN (desde cualquier estado no final, según RN-29 y RN-30) ──► cancelado
```

### 6.3 Motivos de cancelación (`motivo_cancelacion`)

| Valor | Cuándo |
|---|---|
| `rechazado_por_tienda` | La tienda rechazó en `esperando_tienda` (detalle en `detalle_cancelacion`: sin producto, fuera de horario, no llego a ese barrio, otro) |
| `sin_respuesta_tienda` | Venció `esperando_tienda` |
| `rechazo_tarifa` | El cliente rechazó el valor del domicilio |
| `sin_respuesta_cliente` | Venció `esperando_confirmacion_cliente` |
| `sin_comprobante` | Venció `esperando_pago` |
| `cancelado_por_cliente` | El cliente canceló |
| `cancelado_por_tienda` | Dueño/administrador canceló un pedido aceptado (detalle: producto dañado o faltante, sin domiciliario disponible, otro) |

---

## 7. MODELO DE DATOS

### 7.1 Convenciones

- Esquema `public`. Identificadores en español, minúsculas, `snake_case`, sin tildes.
- IDs de tablas propias: `bigint generated always as identity primary key`. IDs de Telegram: `bigint`.
- Fechas: `timestamptz` con `default now()`.
- Dinero: `integer` (COP).
- Cada tabla tiene RLS activado (lo hace el proyecto automáticamente; igual escribir `alter table ... enable row level security;`). **No crear políticas** para `anon` ni `authenticated`: solo `service_role` accede.

### 7.2 Tablas

```sql
-- Valores configurables sin redesplegar
create table configuracion (
  clave text primary key,
  valor text not null,
  descripcion text
);

-- Catálogo global de barrios de Manizales (118). Se crea antes que usuarios.
create table barrios (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  comuna text not null,                 -- nombre de la comuna o "Otros sectores"
  orden_comuna int not null             -- para ordenar los grupos (1..12)
);

-- Personas que han escrito al bot
create table usuarios (
  telegram_id bigint primary key,
  nombre_telegram text,                 -- first_name + last_name de Telegram
  username text,                        -- sin @, puede ser null
  nombre_entrega text,                  -- nombre que dio al pedir
  telefono text,
  ultimo_barrio_id bigint references barrios(id),
  ultima_direccion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table tiendas (
  id bigint generated always as identity primary key,
  slug text not null unique,            -- para el enlace t.me/<bot>?start=t_<slug>
  nombre text not null,
  descripcion text check (char_length(descripcion) <= 150),
  direccion text not null,
  barrio_id bigint references barrios(id),
  telefono_contacto text,
  es_premium boolean not null default false,
  activa boolean not null default true,
  creada_por bigint references usuarios(telegram_id),
  creado_en timestamptz not null default now()
);

-- Horario por día: 0=domingo ... 6=sábado. Día sin fila = cerrado.
create table horarios_tienda (
  id bigint generated always as identity primary key,
  tienda_id bigint not null references tiendas(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  hora_apertura time not null,
  hora_cierre time not null check (hora_cierre > hora_apertura),
  unique (tienda_id, dia_semana)
);

create table medios_pago_tienda (
  id bigint generated always as identity primary key,
  tienda_id bigint not null references tiendas(id) on delete cascade,
  tipo text not null check (tipo in ('llave_breb','nequi','bancolombia','contra_entrega')),
  activo boolean not null default true,
  datos jsonb not null default '{}',
  -- llave_breb: {"llave": "..."}
  -- nequi: {"numero": "...", "titular": "..."}
  -- bancolombia: {"tipo_cuenta": "ahorros|corriente", "numero_cuenta": "...", "titular": "..."}
  -- contra_entrega: {}
  unique (tienda_id, tipo)
);

create table miembros_tienda (
  id bigint generated always as identity primary key,
  tienda_id bigint not null references tiendas(id) on delete cascade,
  telegram_id bigint not null references usuarios(telegram_id),
  rol text not null check (rol in ('dueno','administrador','empleado','domiciliario')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
-- Un rol activo por persona por tienda
create unique index miembro_unico_activo on miembros_tienda (tienda_id, telegram_id) where activo;
-- Un solo dueño activo por tienda
create unique index dueno_unico_activo on miembros_tienda (tienda_id) where activo and rol = 'dueno';

create table invitaciones (
  codigo text primary key,              -- 8 caracteres A-Z y 2-9 (sin O, 0, I, 1)
  tienda_id bigint not null references tiendas(id) on delete cascade,
  rol text not null check (rol in ('dueno','administrador','empleado','domiciliario')),
  creada_por bigint not null references usuarios(telegram_id),
  expira_en timestamptz not null,
  usada_por bigint references usuarios(telegram_id),
  usada_en timestamptz
);
-- rol 'dueno' en invitaciones solo lo puede generar el Super Admin

create table categorias (
  id bigint generated always as identity primary key,
  tienda_id bigint references tiendas(id) on delete cascade,  -- null = común
  nombre text not null,
  activa boolean not null default true
);
create unique index categoria_comun_unica on categorias (nombre) where tienda_id is null;
create unique index categoria_tienda_unica on categorias (tienda_id, nombre) where tienda_id is not null;

-- Categorías comunes que una tienda decidió ocultar
create table categorias_ocultas (
  tienda_id bigint not null references tiendas(id) on delete cascade,
  categoria_id bigint not null references categorias(id) on delete cascade,
  primary key (tienda_id, categoria_id)
);

create table productos (
  id bigint generated always as identity primary key,
  tienda_id bigint not null references tiendas(id) on delete cascade,
  categoria_id bigint not null references categorias(id),
  nombre text not null,
  descripcion text check (char_length(descripcion) <= 300),
  precio integer not null check (precio > 0),
  unidad text not null check (unidad in ('unidad','kg','libra','paquete')),
  stock integer not null default 0 check (stock >= 0),
  foto_file_id text,
  activo boolean not null default true,        -- false = oculto del catálogo (cuenta para el límite)
  eliminado boolean not null default false,    -- true = borrado lógico (no cuenta)
  fecha_reabastecimiento date,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table promociones (
  id bigint generated always as identity primary key,
  tienda_id bigint not null references tiendas(id) on delete cascade,
  producto_id bigint not null references productos(id) on delete cascade,
  tipo text not null check (tipo in ('porcentaje','precio_especial')),
  valor integer not null check (valor > 0),
  inicia_en date not null,
  termina_en date not null check (termina_en >= inicia_en),
  activa boolean not null default true,        -- false = finalizada antes de tiempo
  creado_en timestamptz not null default now()
);

create table avisos_reabastecimiento (
  producto_id bigint not null references productos(id) on delete cascade,
  telegram_id bigint not null references usuarios(telegram_id),
  creado_en timestamptz not null default now(),
  primary key (producto_id, telegram_id)
);

-- Tarifas de domicilio por tienda y barrio (la "memoria")
create table tarifas_domicilio (
  tienda_id bigint not null references tiendas(id) on delete cascade,
  barrio_id bigint not null references barrios(id),
  tarifa integer check (tarifa >= 0),           -- última tarifa cobrada; null si nunca
  entrega boolean not null default true,        -- false = "No entrego"
  actualizado_en timestamptz not null default now(),
  primary key (tienda_id, barrio_id)
);

create table carritos (
  id bigint generated always as identity primary key,
  tienda_id bigint not null references tiendas(id) on delete cascade,
  telegram_id bigint not null references usuarios(telegram_id),
  actualizado_en timestamptz not null default now(),
  unique (tienda_id, telegram_id)
);

create table carrito_items (
  carrito_id bigint not null references carritos(id) on delete cascade,
  producto_id bigint not null references productos(id) on delete cascade,
  cantidad integer not null check (cantidad > 0),
  primary key (carrito_id, producto_id)
);

create table pedidos (
  id bigint generated always as identity primary key,
  tienda_id bigint not null references tiendas(id),
  cliente_telegram_id bigint not null references usuarios(telegram_id),
  estado text not null check (estado in ('esperando_tienda','esperando_confirmacion_cliente','esperando_pago',
                                         'verificando_pago','en_preparacion','listo','despachado','entregado','cancelado')),
  modalidad text not null check (modalidad in ('domicilio','recogida')),
  barrio_id bigint references barrios(id),
  direccion text,
  nombre_cliente text not null,
  telefono_cliente text not null,
  observaciones text,
  medio_pago text not null check (medio_pago in ('llave_breb','nequi','bancolombia','contra_entrega')),
  subtotal integer not null,
  valor_domicilio integer not null default 0,
  total integer not null,
  comprobante_file_id text,
  pago_confirmado boolean not null default false,
  codigo_entrega char(4),
  intentos_codigo_fallidos int not null default 0,
  alerta_codigo_enviada boolean not null default false,
  domiciliario_telegram_id bigint references usuarios(telegram_id),
  motivo_cancelacion text,
  detalle_cancelacion text,
  cancelado_por bigint,                         -- telegram_id o null si fue el sistema
  recordatorio_en timestamptz,
  recordatorio_enviado boolean not null default false,
  vence_en timestamptz,
  es_prueba boolean not null default false,     -- creado en modo pruebas (SÍ cuenta en reportes)
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index pedidos_por_tienda_estado on pedidos (tienda_id, estado);
create index pedidos_por_cliente on pedidos (cliente_telegram_id, estado);
create index pedidos_vencimientos on pedidos (vence_en) where estado in ('esperando_tienda','esperando_confirmacion_cliente','esperando_pago');

-- Copia de los productos al momento del pedido
create table pedido_items (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references pedidos(id) on delete cascade,
  producto_id bigint not null references productos(id),
  nombre_producto text not null,
  precio_unitario integer not null,             -- precio vigente al confirmar
  cantidad integer not null check (cantidad > 0),
  subtotal integer not null
);

create table historial_estados_pedido (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references pedidos(id) on delete cascade,
  estado_anterior text,
  estado_nuevo text not null,
  hecho_por bigint,                             -- telegram_id o null = sistema
  creado_en timestamptz not null default now()
);

-- Mensajes enviados con botones, para editarlos después ("gana el primero")
create table mensajes_notificacion (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references pedidos(id) on delete cascade,
  chat_id bigint not null,
  message_id bigint not null,
  tipo text not null,                           -- 'pedido_nuevo', 'comprobante', 'asignacion', ...
  es_foto boolean not null default false,       -- true → editar con editMessageCaption
  creado_en timestamptz not null default now()
);

-- Paso de conversación de cada usuario
create table estados_conversacion (
  telegram_id bigint primary key references usuarios(telegram_id),
  tienda_activa_id bigint references tiendas(id) on delete set null,
  flujo text,                                   -- ej. 'crear_producto', 'checkout', null = ninguno
  paso text,                                    -- ej. 'pedir_precio'
  datos jsonb not null default '{}',            -- datos parciales del flujo
  actualizado_en timestamptz not null default now()
);

-- Rol simulado del Super Admin
create table modo_pruebas (
  telegram_id bigint primary key,
  tienda_id bigint not null references tiendas(id) on delete cascade,
  rol text not null check (rol in ('cliente','dueno','administrador','empleado','domiciliario')),
  activado_en timestamptz not null default now()
);
```

**Fase 14 (solo cuando se autorice):** tablas `codigos_dashboard` y `sesiones_dashboard` (sección 16).

### 7.3 Extensiones, permisos y funciones SQL

**Migración de extensiones** (primera migración):
```sql
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
```
> Si `supabase db push` falla por una extensión, el README debe indicar: activarla en Supabase → Database → Extensions y repetir.

**Migración de permisos** (después de crear tablas y funciones), obligatoria porque "exponer tablas automáticamente" está desactivado:
```sql
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;
```

**Funciones SQL obligatorias** (`plpgsql`, llamadas con `supabase.rpc`). Todas validan y lanzan `raise exception` con un código legible al inicio del mensaje (ej. `'STOCK_INSUFICIENTE:15'`) que el bot traduce a un mensaje amable.

| Función | Qué hace |
|---|---|
| `precio_vigente(p_producto_id bigint) returns integer` | Aplica RN-15 con la fecha actual de Bogotá (`(now() at time zone 'America/Bogota')::date`). |
| `crear_pedido(p_cliente bigint, p_tienda bigint, p_modalidad text, p_barrio_id bigint, p_direccion text, p_nombre text, p_telefono text, p_observaciones text, p_medio_pago text, p_es_prueba boolean) returns jsonb` | En una transacción: valida tienda activa, RN-21 (`PEDIDO_ACTIVO_EXISTE`), carrito no vacío (`CARRITO_VACIO`); bloquea productos con `for update`; valida activo/no eliminado/stock (`STOCK_INSUFICIENTE:<id>`); calcula precios con `precio_vigente`; inserta `pedidos` (estado `esperando_tienda`, `recordatorio_en` y `vence_en` según configuración) y `pedido_items`; descuenta stock; borra el carrito; inserta historial. Devuelve `{"pedido_id": n, "agotados": [ids que quedaron en 0]}`. |
| `cambiar_estado_pedido(p_pedido bigint, p_estados_esperados text[], p_estado_nuevo text, p_actor bigint, p_cambios jsonb) returns boolean` | `UPDATE pedidos SET estado = p_estado_nuevo, ... WHERE id = p_pedido AND estado = ANY(p_estados_esperados)`. Aplica columnas de `p_cambios` (solo las permitidas: `valor_domicilio`, `total`, `comprobante_file_id`, `pago_confirmado`, `codigo_entrega`, `domiciliario_telegram_id`, `recordatorio_en`, `recordatorio_enviado`, `vence_en`). Inserta historial. Devuelve `false` si nadie cumplía el estado esperado (alguien ganó antes). |
| `cancelar_pedido(p_pedido bigint, p_estados_permitidos text[], p_motivo text, p_detalle text, p_actor bigint) returns jsonb` | Atómico: cambia a `cancelado`, devuelve las unidades al stock, inserta historial. Devuelve `{"cancelado": bool, "repuestos": [ids que pasaron de 0 a >0], "habia_pago": bool}`. |
| `ajustar_stock(p_producto bigint, p_nuevo_stock integer) returns jsonb` | Devuelve `{"antes": n, "despues": m}` para disparar RN-10 y RN-11. |
| `buscar_productos(p_tienda bigint, p_texto text) returns setof productos` | `extensions.unaccent(lower(nombre || ' ' || coalesce(descripcion,''))) like '%' \|\| extensions.unaccent(lower(p_texto)) \|\| '%'`, solo activos y no eliminados, máximo 20. |
| `buscar_tiendas(p_texto text) returns setof tiendas` | Igual, sobre `nombre`, solo `activa`, máximo 10. |
| `contar_productos_limite(p_tienda bigint) returns integer` | Cuenta productos con `eliminado = false`. |
| `reporte_tienda(p_tienda bigint, p_desde timestamptz, p_hasta timestamptz) returns jsonb` | Ver sección 11.15. |
| `programar_tareas(p_url text, p_secreto text) returns void` | `security definer`. Desprograma el job `mte_tareas_cada_minuto` si existe y lo vuelve a crear con `cron.schedule('mte_tareas_cada_minuto', '* * * * *', format($f$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-secreto-tareas', %L), body := '{}'::jsonb)$f$, p_url, p_secreto))`. Solo ejecutable por `service_role`. |

---

## 8. ESTRUCTURA DEL PROYECTO

```
mi-tienda-express/
├── .env.example                  # plantilla con los 5 campos vacíos y comentados
├── .gitignore                    # incluye .env, supabase/.temp, supabase/.branches
├── desplegar.sh                  # script de despliegue (sección 14.3)
├── README.md
├── supabase/
│   ├── config.toml
│   ├── seed.sql                  # datos semilla idempotentes (sección 13)
│   ├── migrations/
│   │   ├── 20261116000001_extensiones.sql
│   │   ├── 20261116000002_tablas.sql
│   │   ├── 20261116000003_funciones.sql
│   │   └── 20261116000004_permisos.sql
│   └── functions/
│       ├── _compartido/
│       │   ├── supabase.ts       # cliente con llave secreta (sección 10.2)
│       │   └── entorno.ts        # lectura y validación de variables
│       ├── bot/
│       │   ├── index.ts          # Deno.serve: enruta /tareas, /configurar y webhook de Telegram
│       │   ├── bot.ts            # instancia grammY, middlewares, registro de manejadores
│       │   ├── datos_callback.ts # constantes y armado/lectura de callback_data
│       │   ├── middleware/       # registrar usuario, cargar estado, resolver rol
│       │   ├── menus/            # menú inicial, cliente, dueño, administrador, empleado, domiciliario, super admin
│       │   ├── flujos/           # registro_tienda, crear_producto, editar_producto, promocion, checkout, invitacion, ...
│       │   ├── servicios/        # pedidos, carrito, inventario, notificaciones, equipo, tarifas, horarios, reportes, tiendas
│       │   ├── tareas/           # temporizadores.ts (lo que corre cada minuto)
│       │   ├── logica/           # SOLO funciones puras (sin BD ni Deno.env): permisos, estados, calculos,
│       │   │                     # promociones, horarios, limites, codigo_entrega, formato
│       │   └── pruebas/          # *.test.ts de la carpeta logica
│       └── dashboard/            # FASE 14
└── dashboard-web/                # FASE 14 (index.html, app.js, config.js, estilos.css)
```

---

## 9. ENRUTAMIENTO DE LA EDGE FUNCTION `bot`

`index.ts` usa `Deno.serve` y decide por la ruta:

| Ruta y método | Autenticación | Acción |
|---|---|---|
| `POST .../bot/tareas` | Encabezado `x-secreto-tareas` == `TELEGRAM_WEBHOOK_SECRET` | Ejecuta temporizadores (sección 11.18). Responde `200 {"ok":true}`. |
| `POST .../bot/configurar` | Encabezado `x-secreto-tareas` == `TELEGRAM_WEBHOOK_SECRET` | 1) `setWebhook` hacia `${SUPABASE_URL}/functions/v1/bot` con `secret_token = TELEGRAM_WEBHOOK_SECRET`, `allowed_updates = ["message","callback_query"]`, `drop_pending_updates = true`. 2) `setMyCommands`: `/start` (Inicio), `/menu` (Menú), `/cancelar` (Cancelar lo que estoy haciendo), `/ayuda` (Ayuda). 3) `rpc('programar_tareas', { p_url: SUPABASE_URL + '/functions/v1/bot/tareas', p_secreto })`. 4) Asigna al Super Admin como dueño de las tiendas semilla que no tengan dueño (crea su fila en `usuarios` si no existe). Responde un JSON con el resultado de cada paso. |
| `POST .../bot` (cualquier otra) | Encabezado `X-Telegram-Bot-Api-Secret-Token` == `TELEGRAM_WEBHOOK_SECRET` (lo valida grammY con `webhookCallback(bot, "std/http", { secretToken })`) | Procesa la actualización de Telegram. |
| Cualquier otro | — | `404` |

> Ventaja: `/configurar` llama a Telegram **desde Supabase**, así que el despliegue completo funciona incluso desde la red de la universidad (que bloquea Telegram).

La función se despliega con `verify_jwt = false` (Telegram y pg_cron no envían JWT); la seguridad la dan los secretos de los encabezados. Comparar secretos con comparación de tiempo constante.

---

## 10. DETALLES TÉCNICOS OBLIGATORIOS

### 10.1 Variables de entorno que lee el código

| Variable | Origen |
|---|---|
| `TELEGRAM_BOT_TOKEN` | La pone Miguel (`.env` → `supabase secrets set`) |
| `TELEGRAM_WEBHOOK_SECRET` | La pone Miguel |
| `SUPER_ADMIN_TELEGRAM_ID` | La pone Miguel (número) |
| `SUPABASE_URL` | La inyecta Supabase automáticamente |
| `SUPABASE_SECRET_KEYS` / `SUPABASE_SERVICE_ROLE_KEY` | Las inyecta Supabase automáticamente |

`_compartido/entorno.ts` valida al arrancar que existan las tres primeras y lanza un error claro si falta alguna: `Falta la variable TELEGRAM_BOT_TOKEN. Revisa el archivo .env y ejecuta ./desplegar.sh`.

### 10.2 Cliente de Supabase

```ts
function obtenerLlaveSecreta(): string {
  const llaves = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (llaves) {
    const valor = JSON.parse(llaves)["default"];
    if (valor) return valor;
  }
  const heredada = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (heredada) return heredada;
  throw new Error("No se encontró la llave secreta de Supabase en el entorno de la función.");
}
// createClient(Deno.env.get("SUPABASE_URL")!, obtenerLlaveSecreta(), { auth: { persistSession: false } })
```

### 10.3 grammY en modo webhook

- `import { Bot, InlineKeyboard, Keyboard, webhookCallback } from "npm:grammy@^1";`
- **Nunca** usar `bot.start()` (eso es polling).
- `bot.catch(...)`: registrar el error con `console.error` y responder al usuario: "😕 Algo salió mal. Intenta de nuevo con /menu".
- Toda respuesta a un `callback_query` debe llamar `ctx.answerCallbackQuery()` (con texto corto si aplica) para quitar el reloj del botón.
- Si enviar un mensaje falla con 403 (el usuario bloqueó el bot), registrar y continuar sin romper el flujo.
- **Formato:** usar siempre `parse_mode: "HTML"` y escapar `<`, `>`, `&` en todo texto que venga de usuarios (función `escaparHtml`). No usar MarkdownV2.

### 10.4 Estado de conversación

- Cada actualización: 1) `upsert` en `usuarios` (nombre_telegram, username, actualizado_en); 2) cargar `estados_conversacion` (crear si no existe).
- Si el mensaje es texto/foto/contacto y hay `flujo` activo → enviarlo al manejador de ese flujo y `paso`.
- `/cancelar` o el botón "❌ Cancelar" en cualquier flujo → `flujo = null`, `paso = null`, `datos = {}` y volver al menú.
- Los flujos guardan sus datos parciales en `datos` (jsonb) en cada paso.
- `tienda_activa_id` indica en qué tienda está "parado" el usuario. Al tocar un botón que trae un ID (producto, pedido, tienda), **resolver la tienda desde ese ID**, no confiar en `tienda_activa_id`.

### 10.5 Resolución de rol

`obtenerRol(telegramId, tiendaId)`:
1. Si existe fila en `modo_pruebas` para ese usuario con esa tienda → rol simulado.
2. Si existe membresía activa en `miembros_tienda` → ese rol.
3. Si no → `cliente`.

`esSuperAdmin(telegramId)` = `String(telegramId) === SUPER_ADMIN_TELEGRAM_ID`.

Cada acción vuelve a validar el permiso con `puede(rol, accion)` en el servidor, aunque el botón no se haya mostrado.

### 10.6 Datos de los botones (`callback_data`)

- **Máximo 64 bytes.** Formato `prefijo:accion:id[:extra]`. Todas las constantes en `datos_callback.ts`, con funciones `armar(...)` y `leer(...)`.
- La cantidad seleccionada en el detalle de producto viaja en el propio dato (ej. `pq:15:3` = producto 15, cantidad 3); no guardar eso en BD.
- Ejemplos de prefijos: `m` (menús), `cat` (categoría y página), `pr` (producto), `pq` (cantidad), `pa` (agregar al carrito), `car` (carrito), `chk` (checkout), `ped` (acciones de tienda sobre pedido), `cli` (acciones del cliente sobre pedido), `pag` (pago), `rea` (reabastecimiento), `avi` (avísame), `eq` (equipo), `prom` (promociones), `tar` (tarifas), `sa` (super admin), `mp` (modo pruebas).

### 10.7 Paginación

Listas largas (productos, barrios, tiendas, pedidos, equipo) en páginas de **5** elementos (barrios: **8**) con botones `[⬅️ Anterior] [Página 2/4] [Siguiente ➡️]`.

### 10.8 Hora de Bogotá

Las funciones Edge corren en UTC. Toda lógica de horarios, fechas de promociones y "hoy/mañana" usa `America/Bogota` mediante `Intl.DateTimeFormat` o restando 5 horas, en `logica/horarios.ts`. Las fechas se muestran en español: "jueves 19 de noviembre".

### 10.9 Enlaces profundos (`/start <carga>`)

| Carga | Acción |
|---|---|
| `t_<slug>` | Entrar a la tienda (menú según el rol en esa tienda) |
| `inv_<CODIGO>` | Flujo de aceptar invitación (11.11) |
| *(vacía)* | Menú inicial (11.1) |

Slug: nombre en minúsculas, sin tildes, espacios → `_`, solo `[a-z0-9_]`, máximo 40; si existe, agregar `_2`, `_3`…
El username del bot se obtiene con `bot.botInfo.username` (no se configura).

---

## 11. FLUJOS DEL BOT (PANTALLA POR PANTALLA)

Los textos son guía de tono y contenido; pueden ajustarse levemente pero deben conservar la información.

### 11.1 Menú inicial (`/start` sin carga o `/menu`)

```
👋 ¡Hola, {nombre}! Bienvenido a Mi Tienda Express.
¿Qué quieres hacer?
[🔍 Buscar tienda] [⭐ Recomiéndame tiendas]
[🧾 Mis pedidos]
[🏪 Mis tiendas]          ← solo si tiene membresías activas
[➕ Registrar mi tienda]
[👑 Panel Super Admin]    ← solo Super Admin
[🧪 Salir del modo pruebas] ← solo si está en modo pruebas
```
- **Buscar tienda:** pide texto → `buscar_tiendas` → lista con nombre, descripción y 🟢 Abierta / 🔴 Cerrada, botón [Entrar].
- **Recomiéndame tiendas:** solo tiendas `es_premium AND activa`, ordenadas por nombre, máximo 10, con "⭐ Destacada", descripción, abierta/cerrada y [Entrar]. Si no hay: "Aún no hay tiendas destacadas. Busca tu tienda por nombre 🔍".
- **Mis tiendas:** lista de tiendas donde tiene membresía activa, con su rol → al tocar, menú de ese rol.

### 11.2 Menú del cliente dentro de una tienda

```
🏪 {Tienda} · 🟢 Abierta (cierra a las 9:00 p. m.)   |   🔴 Cerrada (abre mañana a las 7:00 a. m.)
{descripción}
[📂 Categorías] [🔍 Buscar producto]
[🔥 Ofertas] [🛒 Mi carrito (3)]
[ℹ️ Info de la tienda] [🧾 Mis pedidos]
[⬅️ Cambiar de tienda]
```
- **Info de la tienda:** dirección, barrio, teléfono de contacto, horario de la semana, medios de pago aceptados y el enlace `t.me/<bot>?start=t_<slug>` para compartir.

### 11.3 Catálogo

1. **Categorías:** comunes no ocultas + propias activas, **que tengan al menos un producto visible**. Botones con nombre y cantidad.
2. **Lista de productos** (5 por página): `{nombre} — {precio vigente}` con 🔥 si tiene promo o `(Agotado)`.
3. **Detalle:** si tiene foto → `sendPhoto` con texto en el pie; si no, mensaje de texto:
   ```
   🥛 <b>Leche entera 1L</b>
   🔥 <s>$4.800</s> → <b>$3.840</b> (‑20% hasta el 15 de diciembre)
   Unidad · Disponibles: 24
   {descripción}
   [ ➖ ] [ 1 ] [ ➕ ]
   [🛒 Agregar al carrito]
   [⬅️ Volver]
   ```
   - ➕ no supera el stock. Si está agotado: "⛔ Agotado – vuelve aprox. el jueves 19 de noviembre" y botón [🔔 Avísame cuando llegue] (si ya lo pidió: "🔔 Ya te avisaremos").
4. **Buscar producto:** pide texto → `buscar_productos` → lista igual a la de categoría. Sin resultados: "No encontré «{texto}» en {Tienda}. Prueba con otra palabra."
5. **Ofertas:** productos con promoción vigente.

### 11.4 Carrito

```
🛒 Tu carrito en {Tienda}
• 2 × Leche entera 1L — $7.680
• 1 × Pan tajado — $6.200
Subtotal: $13.880
[➖ Leche] [➕ Leche] [🗑️ Leche]   ← una fila por producto
[🗑️ Vaciar carrito]
[✅ Hacer pedido] [⬅️ Seguir comprando]
```
- Agregar un producto que ya está suma la cantidad (sin pasar del stock).
- Cada cambio actualiza `carritos.actualizado_en`.

### 11.5 Hacer pedido (checkout) — flujo `checkout`

Validaciones previas, en orden: tienda activa → tienda abierta (RN-22) → sin pedido activo en esa tienda (RN-21) → carrito no vacío. Si alguna falla, mensaje claro y fin.

1. **Modalidad:** `[🛵 Domicilio] [🏪 Recoger en tienda]`.
2. **Datos guardados** (si existen, RN-43): "¿Enviamos a {dirección}, {barrio}, a nombre de {nombre} ({teléfono})?" `[✅ Sí] [✏️ Cambiar datos]`. En recogida solo nombre y teléfono.
3. Si no hay datos o eligió cambiar:
   - Nombre (texto).
   - Teléfono: teclado de respuesta con `[📱 Compartir mi número]` (`request_contact: true`); validar que el contacto sea del mismo usuario; también aceptar texto con 7–13 dígitos.
   - **Domicilio:** comuna (lista de 12 grupos) → barrio (8 por página, más `[🤷 Mi barrio no aparece]`) → dirección con referencias (texto, mínimo 5 caracteres).
     - Si `tarifas_domicilio.entrega = false` para ese barrio: "😕 {Tienda} no hace domicilios a {barrio}. ¿Quieres recogerlo en la tienda?" `[🏪 Recoger en tienda] [❌ Cancelar]`.
     - "Mi barrio no aparece" → mismo mensaje ofreciendo recogida.
4. **Observaciones:** "¿Alguna indicación para la tienda?" `[Sin observaciones]` o texto (máx. 200).
5. **Medio de pago:** botones con los medios activos de la tienda (`contra_entrega` se muestra "💵 Contra entrega" en domicilio y "💵 Pagar al recoger" en recogida).
6. **Resumen:**
   ```
   🧾 Resumen de tu pedido en {Tienda}
   • 2 × Leche entera 1L — $7.680
   • 1 × Pan tajado — $6.200
   Subtotal: $13.880
   🛵 Domicilio a {barrio}: la tienda te dirá el valor al aceptar
   💳 Pago: Nequi
   📝 "Que la leche esté fría"
   ⚠️ OJO: solo puedes cancelar mientras la tienda no haya empezado a preparar tu pedido.
   [✅ Confirmar pedido] [❌ Cancelar]
   ```
7. **Confirmar** → guardar datos en `usuarios` → `rpc('crear_pedido', ...)`.
   - Error `STOCK_INSUFICIENTE:<id>` → "Lo sentimos, de {producto} solo quedan {n}. Ajustamos tu carrito." (ajustar el carrito y volver al resumen).
   - Éxito → al cliente: "📝 ¡Listo! Tu pedido <b>#0042</b> fue enviado a {Tienda}. Te avisaremos cuando lo acepten." Notificar a la tienda (11.6). Para cada producto en `agotados` → RN-10.
   - Número visible del pedido: `#` + id con 4 dígitos mínimo (`#0042`).

### 11.6 Pedido nuevo en la tienda

Mensaje a los destinatarios de "pedido nuevo" (guardar cada `message_id` en `mensajes_notificacion`):
```
🛒 <b>Pedido #0042</b> – {Tienda}
👤 {nombre} · 📱 {teléfono}
🛵 Domicilio – {dirección}, {barrio}        |   🏪 Recoge en tienda
• 2 × Leche entera 1L — $7.680
• 1 × Pan tajado — $6.200
Subtotal: $13.880
💳 Pago: Nequi
📝 "{observaciones}"
⏱️ Si nadie responde en 5 minutos, el pedido se cancela solo.
[✅ Aceptar] [❌ Rechazar]
```

**Rechazar** → motivo: `[Sin producto] [Fuera de horario] [No llego a ese barrio] [Otro]` ("Otro" pide texto) → `cancelar_pedido` con `rechazado_por_tienda` → al cliente: "😔 {Tienda} no pudo tomar tu pedido #0042. Motivo: {motivo}." → editar los mensajes de los demás. Si el motivo es "No llego a ese barrio" en un domicilio, preguntar: "¿Marcar {barrio} como 'No entrego' para próximos pedidos?" `[Sí] [No]`.

**Aceptar – recogida:** si `contra_entrega` → `en_preparacion`; si transferencia → `esperando_pago` (11.8). Avisar al cliente. Editar los mensajes de los demás ("✅ Aceptado por {nombre}").

**Aceptar – domicilio:** preguntar al que aceptó el valor del domicilio:
```
🛵 ¿Cuánto cobras de domicilio a <b>{barrio}</b>?
[Usar $4.000 (última vez)]            ← solo si tarifas_domicilio.tarifa existe
[$2.000] [$3.000] [$4.000]
[$5.000] [$6.000] [✏️ Otro valor]
```
→ `upsert` en `tarifas_domicilio` (tarifa, entrega = true) → `cambiar_estado_pedido` a `esperando_confirmacion_cliente` con `valor_domicilio`, `total`, `recordatorio_en` (+3 min), `vence_en` (+5 min) → editar los demás mensajes → mensaje al cliente (11.7).

> "Aceptar" y el valor del domicilio son un solo paso para el estado: el pedido pasa de `esperando_tienda` a `esperando_confirmacion_cliente` cuando se elige el valor. Para que "gana el primero" funcione, al tocar "Aceptar" se edita el mensaje de los demás a "⏳ {nombre} está atendiendo este pedido" y quedan sin botones; si quien aceptó no elige valor y vence el tiempo, el temporizador cancela normalmente.

### 11.7 Doble confirmación (domicilio)

```
✅ ¡{Tienda} aceptó tu pedido #0042!
🛵 Domicilio a {barrio}: <b>$4.000</b>
Total: <b>$17.880</b>
⚠️ OJO: al aceptar, tu pedido pasa a preparación y ya no podrás cancelarlo.   ← si contra_entrega
⚠️ OJO: podrás cancelar hasta que la tienda confirme tu pago.                ← si transferencia
⏱️ Tienes 5 minutos para responder.
[✅ Acepto] [❌ Cancelar pedido]
```
- **Acepto** → `contra_entrega`: `en_preparacion` (avisar a la tienda: "👍 El cliente aceptó el domicilio del #0042. ¡A preparar!") · transferencia: `esperando_pago` (11.8).
- **Cancelar** → `cancelar_pedido` con `rechazo_tarifa` → avisar a la tienda.

### 11.8 Pago por transferencia

Al entrar a `esperando_pago` (`recordatorio_en` +5 min, `vence_en` +10 min), al cliente:
```
💳 Para continuar con tu pedido #0042, transfiere <b>$17.880</b> a:
• Nequi: 300 000 0000 (titular: Mercaldas Demo)        ← solo el medio que eligió
Después envía aquí la <b>foto del comprobante</b> 📸
⚠️ OJO: cuando la tienda confirme tu pago, el pedido pasa a preparación y ya no podrás cancelarlo.
⏱️ Tienes 10 minutos.
[❌ Cancelar pedido]
```
- Formato por medio: Bre-B → "Llave Bre-B: {llave}"; Nequi → "Nequi: {numero} ({titular})"; Bancolombia → "Bancolombia {tipo_cuenta} N.° {numero_cuenta} ({titular})".
- Mientras el pedido esté en `esperando_pago`, la **siguiente foto** que envíe ese cliente se toma como comprobante (usar el `file_id` de mayor tamaño) → `verificando_pago` con `comprobante_file_id`, sin temporizador → al cliente: "🧾 Recibimos tu comprobante. La tienda lo está verificando." → a dueño y administradores, `sendPhoto` con:
  ```
  🧾 Comprobante del pedido #0042 – $17.880 (Nequi)
  [✅ Pago recibido] [❌ No me llegó]
  ```
- **Pago recibido** → `en_preparacion`, `pago_confirmado = true` → al cliente: "✅ Pago confirmado. Tu pedido ya se está preparando." → editar los demás mensajes (`editMessageCaption`).
- **No me llegó** → `esperando_pago` con nuevos tiempos (+5/+10) → al cliente: "⚠️ La tienda no ve tu pago del pedido #0042. Revisa la transferencia y envía de nuevo el comprobante."

### 11.9 Preparación, despacho y entrega

Mensaje de seguimiento para el personal (editar el mismo mensaje en cada paso cuando sea posible):
- `en_preparacion`: `[📦 Marcar listo]` + `[❌ Cancelar pedido]` (solo dueño/admin).
- `listo` – **domicilio**:
  - Si hay domiciliarios activos: `[🛵 Asignar domiciliario]` → lista de domiciliarios activos → al elegido:
    ```
    🛵 Te asignaron el pedido #0042 – {Tienda}
    📍 {dirección}, {barrio}
    👤 {nombre} · 📱 {teléfono}
    💵 Cobrar al entregar: $17.880        |   ✅ Ya pagado
    [🛵 Salí con el pedido]
    ```
    Se puede reasignar mientras no esté despachado.
  - Si no hay domiciliarios: `[🛵 Marcar despachado]` para el personal con `gestionar_pedidos`.
  - Al pasar a `despachado`: generar `codigo_entrega` → al cliente: "🛵 ¡Tu pedido #0042 va en camino! 🔑 Tu código de entrega es <b>4827</b>. Dáselo a quien te entregue el pedido." → a quien entrega: `[✅ Entregar]`.
- `listo` – **recogida**: generar `codigo_entrega` → al cliente: "📦 Tu pedido #0042 está listo para recoger en {dirección}. 🔑 Tu código es <b>4827</b>. Dilo en el mostrador." → al personal: `[✅ Entregar]`.
- **Entregar** → flujo `codigo_entrega`: "Escribe el código de 4 dígitos que te dice el cliente:" → si coincide: `entregado` → al cliente: "✅ Pedido entregado. ¡Gracias por comprar en {Tienda}! 💙" → al personal: "✅ Pedido #0042 entregado." Si no coincide: "❌ Código incorrecto. Intenta de nuevo." (+1 intento; RN-33).

### 11.10 Cancelaciones

- **Cliente:** en "🧾 Mis pedidos", los pedidos en estados de RN-29 muestran `[❌ Cancelar pedido]` → confirmación "¿Seguro?" `[Sí, cancelar] [No]` → `cancelar_pedido` con `cancelado_por_cliente` → avisar a la tienda. Si `habia_pago` → RN-31.
- **Tienda (dueño/admin):** `[❌ Cancelar pedido]` en estados de RN-30 → motivo `[Producto dañado o faltante] [Sin domiciliario disponible] [Otro]` → al cliente: "😔 {Tienda} canceló tu pedido #0042. Motivo: {motivo}." + RN-31 si aplica.
- En toda cancelación, para cada producto en `repuestos` → RN-11.

### 11.11 Registro de tienda — flujo `registro_tienda`

1. Nombre (3–60 caracteres).
2. Descripción corta (máx. 150): "Cuéntale a tus clientes qué hace especial a tu tienda".
3. Dirección (texto).
4. Barrio de la tienda: comuna → barrio.
5. Teléfono de contacto (texto, 7–13 dígitos).
6. Horario: `[Lun–Sáb 7:00 a. m.–9:00 p. m.] [Todos los días 7:00 a. m.–9:00 p. m.] [✏️ Personalizar]`. Personalizar: por cada día `[Cerrado]` o texto `HH:MM-HH:MM` en formato 24 h (validar).
7. Medios de pago (selección múltiple con ☑️/☐ y `[Listo]`, mínimo uno). Por cada medio de transferencia marcado, pedir sus datos. Al marcar **contra entrega**, mostrar:
   > 💡 **Recomendación:** activar el pago contra entrega facilita la compra a tus clientes, pero te expone a **pedidos falsos o de broma**, porque nadie paga por adelantado. Si prefieres evitarlo, deja solo los medios de transferencia (Bre-B, Nequi o Bancolombia): así todo pedido se paga antes de prepararse.
   > Puedes cambiar esto cuando quieras en ⚙️ Mi tienda → Medios de pago.
   > `[✅ Activarlo igual] [❌ No activarlo]`
8. Resumen → `[✅ Crear tienda] [❌ Cancelar]` → insertar tienda, horarios, medios, membresía `dueno` → mensaje con el enlace de la tienda y el menú del dueño.

### 11.12 Menús del personal

| Rol | Botones |
|---|---|
| Dueño | `[📋 Pedidos] [📦 Productos] [📊 Inventario] [🏷️ Promociones] [🛵 Domicilios] [👥 Equipo] [📈 Reportes] [⚙️ Mi tienda] [🔗 Enlace de la tienda]` |
| Administrador | igual que el dueño **sin** `⚙️ Mi tienda` |
| Empleado | `[📋 Pedidos] [📊 Inventario]` |
| Domiciliario | `[🛵 Mis entregas]` |

Todos incluyen `[🚪 Salir del equipo]` (excepto el dueño) y `[⬅️ Menú inicial]`.

- **📋 Pedidos:** `[⏳ Pendientes]` (todos los no finales, agrupados por estado, con botón para abrir cada uno y sus acciones según el estado y el rol) `[📜 Historial]` (últimos 20 entregados o cancelados, con filtro `[Hoy] [7 días] [Este mes]`).
- **🛵 Mis entregas:** pedidos asignados al domiciliario en `listo` o `despachado`, con sus botones.
- **⚙️ Mi tienda:** editar nombre, descripción, dirección, barrio, contacto, horario, medios de pago (con la recomendación de 11.11 al activar contra entrega) y `[🔄 Transferir tienda]`.
- **🔗 Enlace de la tienda:** muestra `https://t.me/<bot>?start=t_<slug>` listo para compartir.

### 11.13 Productos, categorías e inventario

- **📦 Productos:** `[➕ Nuevo producto] [📋 Ver productos] [📂 Categorías]`.
  - **Nuevo producto** → verificar límite (RN-03). Si no hay cupo:
    > 🚀 ¡Tu tienda está creciendo! Llegaste al límite de 10 productos del plan gratuito.
    > Pásate a ⭐ <b>Mi Tienda Express Premium</b> y ten productos ilimitados, aparece en las recomendaciones y accede a tu dashboard de ventas.
    > `[⭐ Quiero Premium]`
    → al tocar: "😎 ¡Excelente decisión! Habla con el administrador de la plataforma para activarlo. (Aceptamos pago en tintos ☕)".
  - Flujo: nombre → categoría (botones + `[➕ Nueva categoría]`) → precio (entero > 0, aceptar "4.500" o "4500") → unidad `[Unidad] [Kg] [Libra] [Paquete]` → foto (`[Omitir]`) → descripción (`[Omitir]`) → stock (entero ≥ 0) → resumen → guardar.
  - **Ver productos:** lista paginada → producto → `[✏️ Editar nombre/precio/categoría/unidad/foto/descripción] [👁️ Ocultar/Mostrar] [🗑️ Eliminar]` (eliminar pide confirmación y borra el producto de todos los carritos).
  - **Categorías:** lista de comunes (con `[Ocultar]`/`[Mostrar]`) y propias (con `[Renombrar] [Desactivar]`), y `[➕ Nueva categoría]`.
- **📊 Inventario** (también empleados): lista paginada `{nombre} — stock {n}` (⚠️ si bajo, ⛔ si 0) → `[✏️ Cambiar stock]` (pide número) y `[👁️ Ocultar/Mostrar]` → `rpc('ajustar_stock')` → aplicar RN-10 y RN-11.
- **Pregunta de reabastecimiento (RN-10)** a dueño y administradores:
  ```
  ⚠️ Se agotó <b>{producto}</b> en {Tienda}. ¿Cuándo vuelves a tener?
  [Mañana] [En 2-3 días] [Esta semana] [No sé aún]
  ```
- **Aviso al cliente (RN-11):** "🔔 ¡Volvió <b>{producto}</b> a {Tienda}!" `[Ver producto]`.

### 11.14 Promociones y domicilios

- **🏷️ Promociones:** `[➕ Nueva promoción] [📋 Vigentes y programadas]`.
  - Nueva: producto (lista) → si ya tiene una vigente o programada: "Este producto ya tiene una promoción. ¿Reemplazarla?" → tipo `[% Descuento] [💲 Precio especial]` → valor (1–90 o menor al precio) → inicio `[Hoy] [Mañana] [Otra fecha]` (DD/MM/AAAA) → fin `[En 7 días] [En 15 días] [En 30 días] [Otra fecha]` → resumen con precio antes/después → guardar.
  - Lista: cada una con `[⏹️ Finalizar ahora]` (`activa = false`).
- **🛵 Domicilios:** `[📋 Tarifas guardadas]` (por comuna → barrio con tarifa o "No entrego") → barrio → `[✏️ Cambiar tarifa] [🚫 No entrego]`/`[✅ Sí entrego]`. Explicación arriba: "Estas tarifas se guardan solas cada vez que cobras un domicilio. Aquí puedes ajustarlas."

### 11.15 Equipo, invitaciones y reportes

- **👥 Equipo:** lista de miembros activos con su rol. El dueño aparece sin botones para los demás.
  - `[➕ Invitar]` → rol (dueño: administrador, empleado, domiciliario; administrador: empleado, domiciliario) → generar código → "Envía este enlace a la persona: https://t.me/<bot>?start=inv_X7K2M9QA (vale 24 horas, un solo uso)".
  - Miembro → `[🔄 Cambiar rol]` (según permisos) `[🚫 Quitar de la tienda]` (confirmación; RN-40) → notificar al afectado: "Ya no haces parte del equipo de {Tienda}" o "Tu rol en {Tienda} ahora es {rol}".
  - **Aceptar invitación** (`/start inv_CODIGO`): validar existencia, vigencia y no uso. Si la persona ya tiene rol activo en esa tienda: "Ya haces parte de {Tienda} como {rol}". Si no: "Te invitaron a {Tienda} como <b>{rol}</b>. [✅ Aceptar] [❌ Rechazar]" → insertar membresía, marcar usada, avisar a quien invitó.
  - **Transferir tienda** (dueño): elegir miembro activo → "¿Seguro? {nombre} será el nuevo dueño y tú quedarás como administrador." → confirmar → actualizar ambas membresías en una sola función SQL o en orden: primero el viejo dueño a administrador, luego el nuevo a dueño.
- **📈 Reportes:** periodo `[Hoy] [Últimos 7 días] [Este mes]` → `reporte_tienda` → mensaje:
  ```
  📈 Reporte de {Tienda} – últimos 7 días
  🧾 Pedidos: 23 (✅ 18 entregados · ❌ 4 cancelados · ⏳ 1 en curso)
  💰 Ventas (entregados): $412.300 · Ticket promedio: $22.906
  🛵 Domicilio: 15 · 🏪 Recogida: 3
  💳 Nequi 8 · Bre-B 3 · Bancolombia 2 · Contra entrega 5
  🏆 Más pedidos:
   1. Leche entera 1L — 31 und
   2. Pan tajado — 19 und
   ...(top 5)
  ⛔ Agotados: Chocolatina
  ⚠️ Stock bajo: Queso campesino (2)
  ```
  Ventas = suma de `total` de pedidos `entregado` en el periodo. Incluye pedidos `es_prueba`.

### 11.16 Panel Super Admin

```
👑 Panel Super Admin
[🏪 Tiendas] [📊 Resumen global] [🧪 Modo pruebas]
```
- **Tiendas:** filtros `[Todas] [⭐ Premium] [🚫 Desactivadas]` → lista paginada → detalle (datos, dueño, n.° productos, pedidos del mes, Premium sí/no, activa sí/no) con:
  - `[⭐ Activar Premium]`/`[Quitar Premium]` → notificar al dueño ("⭐ ¡Tu tienda ahora es Premium!" / "Tu tienda volvió al plan gratuito").
  - `[🚫 Desactivar tienda]`/`[✅ Activar tienda]`.
  - `[✏️ Editar datos]` → mismas opciones que "⚙️ Mi tienda".
  - `[👑 Cambiar dueño]` → `[Elegir entre los miembros]` o `[🔗 Generar enlace de dueño]` (invitación con rol `dueno`). El dueño anterior pasa a administrador; si el dueño anterior es el propio Super Admin, preguntar `[Dejarme como administrador] [Quitarme de la tienda]`.
- **Resumen global:** número de tiendas (Premium, activas), pedidos y ventas de hoy, 7 días y mes, top 5 tiendas por ventas.

### 11.17 Modo pruebas (solo Super Admin)

- `[🧪 Modo pruebas]` → elegir tienda → elegir rol `[Cliente] [Dueño] [Administrador] [Empleado] [Domiciliario]` → `upsert` en `modo_pruebas` → `tienda_activa_id` = esa tienda → mostrar el menú de ese rol.
- Mientras esté activo, cada mensaje que el bot le envíe en esa tienda empieza con `🧪 <i>Probando como {Rol} – {Tienda}</i>`.
- **Notificaciones cruzadas:** mientras el modo pruebas esté activo en una tienda, el Super Admin recibe **todas** las notificaciones de esa tienda (las de cliente, tienda y domiciliario) con la etiqueta `🧪 [Vista tienda]`, `🧪 [Vista cliente]` o `🧪 [Vista domiciliario]`, y sus botones funcionan **sin importar el rol simulado** (los permisos se validan como si tuviera el rol de la vista). Así puede completar un pedido de principio a fin con una sola cuenta.
- Para asignarse como domiciliario en una prueba, la lista de domiciliarios incluye `🧪 Yo (modo pruebas)` cuando el modo está activo.
- Los pedidos creados como cliente en modo pruebas llevan `es_prueba = true` y el ícono 🧪 en listas. **Cuentan** en reportes y dashboard.
- `[🧪 Salir del modo pruebas]` → borrar la fila de `modo_pruebas`.
- El modo pruebas **no** crea membresías reales.

### 11.18 Tareas programadas (`POST /bot/tareas`, cada minuto)

En este orden, cada bloque con su propio `try/catch` para que un error no detenga los demás:
1. **Recordatorios:** pedidos en `esperando_tienda`, `esperando_confirmacion_cliente` o `esperando_pago` con `recordatorio_enviado = false` y `recordatorio_en <= now()` → marcar `recordatorio_enviado = true` **con UPDATE condicionado** y enviar:
   - tienda: "⏰ El pedido #0042 lleva 3 minutos sin respuesta. Se cancelará automáticamente en 2 minutos."
   - cliente (confirmación): "⏰ Tu pedido #0042 espera que aceptes el valor del domicilio. Se cancelará en 2 minutos."
   - cliente (pago): "⏰ Aún no recibimos tu comprobante del pedido #0042. Se cancelará en 5 minutos."
2. **Vencimientos:** mismos estados con `vence_en <= now()` → `cancelar_pedido` con el motivo correspondiente → avisar al cliente y a la tienda; quitar botones de los mensajes guardados.
3. **Carritos:** borrar carritos con `actualizado_en` mayor a `horas_vencimiento_carrito`.
4. **Limpieza:** borrar invitaciones vencidas no usadas con más de 7 días.

---

## 12. TONO Y TEXTOS CLAVE

- Tutear, frases cortas, cercano y colombiano sin exagerar ("¡Listo!", "Dale", "Con gusto").
- Siempre decir **qué pasó** y **qué sigue**.
- Errores sin tecnicismos: nunca mostrar mensajes de excepción al usuario.
- Mensaje `/ayuda`: explicación breve de qué es la plataforma, cómo comprar, cómo registrar una tienda y que `/cancelar` sale de cualquier paso.

---

## 13. DATOS SEMILLA (`supabase/seed.sql`)

**Idempotente:** envolver cada bloque en `do $$ begin if not exists (...) then ... end if; end $$;` usando claves naturales (slug de tienda, nombre de barrio, nombre de categoría común, clave de configuración). Volver a ejecutarlo no debe duplicar nada.

### 13.1 Configuración

| clave | valor | descripción |
|---|---|---|
| `minutos_recordatorio_tienda` | 3 | Recordatorio a la tienda por pedido sin responder |
| `minutos_cancelacion_tienda` | 5 | Cancelación si la tienda no responde |
| `minutos_recordatorio_cliente` | 3 | Recordatorio al cliente para aceptar el domicilio |
| `minutos_cancelacion_cliente` | 5 | Cancelación si el cliente no acepta el domicilio |
| `minutos_recordatorio_pago` | 5 | Recordatorio para enviar comprobante |
| `minutos_cancelacion_pago` | 10 | Cancelación si no llega el comprobante |
| `horas_vencimiento_carrito` | 24 | Vaciado de carritos inactivos |
| `limite_productos_gratis` | 10 | Productos máximos sin Premium |
| `max_pedidos_activos_por_tienda` | 1 | Pedidos simultáneos por cliente en una tienda |
| `umbral_stock_bajo` | 3 | Stock considerado bajo |
| `horas_vencimiento_invitacion` | 24 | Vigencia de enlaces de invitación |
| `intentos_maximos_codigo_entrega` | 3 | Intentos antes de alertar |

### 13.2 Categorías comunes

Lácteos, Panadería, Bebidas, Aseo, Granos, Mecato, Carnes, Frutas y verduras.

### 13.3 Barrios de Manizales (118) y tarifas de Mercaldas

Las tarifas son **solo de la tienda Mercaldas** (ubicada en La Leonora): Zona 1 = $2.000 · Zona 2 = $3.000 · Zona 3 = $4.000 · Zona 4 = $5.000 · Zona 5 = $6.000. Las distancias son aproximadas, no medidas en mapa. Todas con `entrega = true`. La comuna de los barrios en "Otros sectores" no está en el listado oficial del Acuerdo 107 de 1995 y se agrupan aparte.

| orden_comuna | Comuna | Barrio (zona Mercaldas) |
|---|---|---|
| 1 | Atardeceres | La Quinta (4), La Linda (5), Sacatín Viejo (4), Villa Pilar (3), Chipre Viejo (3), Chipre (3), Campohermoso (3), Morrogacho (4), La Francia (3), Los Alcázares (3), Bella Montaña (5) |
| 2 | San José | Asís (3), Avanzada (3), San Ignacio (3), Galán (3), Estrada (3), Las Delicias (3), San José (3), Colón (3) |
| 3 | Cumanday | Las Américas (3), Los Agustinos (3), Centro (3), San Joaquín (3), Campoamor (3), Fundadores (3) |
| 4 | La Estación | Santa Helena (2), San Jorge (2), El Sol (2), La Argentina (2), La Asunción (2), Versalles (2), Lleras (2), Los Cedros (2), El Campín (2) |
| 5 | Ciudadela del Norte | Corinto (4), Peralonso (4), El Caribe (4), San Cayetano (4), Ofelia y Borneo (4), Sierra Morena (4), Fanny González (4), San Sebastián (4), Solferino (5), El Porvenir (5), La Carola (5), La Carolita (5), Villahermosa (5), Comuneros (5), Bosques del Norte (5), Puertas del Sol (5), Samaria (5), Sinaí (5) |
| 6 | Ecoturístico Cerro de Oro | Laureles (1), Viveros (2), La Cumbre Minitas (2), La Sultana (2), Escuela de Carabineros (2), Baja Suiza (2), Alta Suiza (2), Colseguros (2), Residencias Manizales (2), Cerro de Oro (2) |
| 7 | Tesorito | San Marcel (5), La Alhambra (5), Cerros de La Alhambra (5), Juanchito (5), Caserío La Enea (5), Los Pinos (5), La Enea (5), Lusitania (5), La Nubia (5) |
| 8 | Palogrande | La Leonora (1), Los Rosales (1), La Rambla (1), Palogrande (1), La Estrella (1), Belén (1), Arboleda (1), Palermo (1), Sancancio (1), Universidad (2), Milán (2), El Trébol (2), Batallón (2) |
| 9 | Universitaria | Betania (3), Fátima (3), Pío XII (3), San Fernando (3), Camilo Torres (3), Las Colinas (3), Malhabar (3), Aranjuez (3), La Playa (3), Vivienda Popular (4) |
| 10 | La Fuente | Uribe (3), Vélez (3), Colombia (3), González (3), Persia (3), Guamal (3), Arrayanes (3), Marmato (3), Cervantes (3), Nevado (3), Panamericana (3) |
| 11 | La Macarena | San Antonio (4), 20 de Julio (4), El Carmen (4), La Castellana (4), El Bosque (4), Buena Esperanza (4), Centenario (4), Estambul (4) |
| 12 | Otros sectores | Altos de Capri (4), Villa Julia (4), Villa Café (5), Portón del Guamo (5), Altos de Granada (5) |

**Total: 118 barrios.** El seed debe verificar el conteo con un `raise notice`.

### 13.4 Tiendas de demostración

Datos de contacto y pago **ficticios**. Ninguna tienda semilla tiene dueño en el seed: `/configurar` asigna al Super Admin como dueño (sección 9).

| Campo | Mercaldas | Minimercado La Esquina |
|---|---|---|
| slug | `mercaldas` | `minimercado_la_esquina` |
| Descripción | "Tu supermercado de confianza en La Leonora. Lácteos, granos, aseo y más, con domicilio a toda Manizales 🛵" | "La tienda del barrio en Chipre. Huevos frescos, verduras y lo de todos los días." |
| Dirección | "Calle de prueba #00-00, La Leonora" | "Carrera de prueba #00-00, Chipre" |
| Barrio | La Leonora | Chipre |
| Teléfono | 300 000 0000 | 300 000 0001 |
| Premium | **true** | false |
| Horario | Todos los días 6:00–23:00 | Lunes a sábado 7:00–21:00 (domingo cerrado) |
| Medios de pago | Nequi `{"numero":"3000000000","titular":"Mercaldas Demo"}`, Llave Bre-B `{"llave":"@mercaldasdemo"}`, contra entrega | Bancolombia `{"tipo_cuenta":"ahorros","numero_cuenta":"00000000000","titular":"La Esquina Demo"}`, Nequi `{"numero":"3000000001","titular":"La Esquina Demo"}` |
| Tarifas | Las 118 de la tabla 13.3 | Ninguna (la memoria arranca vacía) |
| Categorías propias | — | "Huevos" |
| Promoción | 20% en Leche entera 1L, desde hoy hasta hoy + 30 días | — |

**Productos de Mercaldas (15, sin foto; precios ficticios):**

| Producto | Categoría | Precio | Unidad | Stock |
|---|---|---|---|---|
| Leche entera 1L | Lácteos | 4.800 | unidad | 24 |
| Yogur de fresa 1L | Lácteos | 7.900 | unidad | 10 |
| Queso campesino 500 g | Lácteos | 12.500 | unidad | 2 |
| Pan tajado | Panadería | 6.200 | paquete | 15 |
| Arepas de maíz x5 | Panadería | 3.500 | paquete | 20 |
| Gaseosa 1,5 L | Bebidas | 5.500 | unidad | 18 |
| Agua 600 ml | Bebidas | 2.000 | unidad | 30 |
| Jugo de caja 1L | Bebidas | 4.900 | unidad | 12 |
| Jabón en barra | Aseo | 3.200 | unidad | 25 |
| Papel higiénico x4 | Aseo | 8.900 | paquete | 14 |
| Detergente 1 kg | Aseo | 11.500 | unidad | 9 |
| Arroz 1 kg | Granos | 4.600 | unidad | 40 |
| Fríjol 500 g | Granos | 6.800 | unidad | 16 |
| Papas fritas | Mecato | 2.800 | unidad | 22 |
| Chocolatina | Mecato | 2.500 | unidad | **0** (fecha_reabastecimiento null) |

**Productos de Minimercado La Esquina (9):**

| Producto | Categoría | Precio | Unidad | Stock |
|---|---|---|---|---|
| Huevos AA x12 | Huevos (propia) | 14.500 | paquete | 10 |
| Leche en bolsa 1L | Lácteos | 4.500 | unidad | 12 |
| Pan francés x5 | Panadería | 3.000 | paquete | 8 |
| Gaseosa 400 ml | Bebidas | 2.500 | unidad | 20 |
| Panela | Granos | 3.500 | unidad | 15 |
| Café molido 250 g | Granos | 9.800 | unidad | 6 |
| Plátano verde | Frutas y verduras | 1.200 | unidad | 30 |
| Tomate | Frutas y verduras | 2.800 | libra | 3 |
| Salchichón 450 g | Carnes | 8.900 | unidad | 7 |

**Historial de pedidos: vacío.** No sembrar pedidos.

---

## 14. LLAVES Y DESPLIEGUE

### 14.1 Archivo único de llaves: `.env` (raíz del proyecto)

El agente crea **`.env.example`** con este contenido exacto y agrega `.env` a `.gitignore`. Miguel copia `.env.example` a `.env` y llena los valores a mano.

```bash
# =====================================================================
#  MI TIENDA EXPRESS – LLAVES (llénalas tú. NUNCA subas este archivo a GitHub)
# =====================================================================

# === TELEGRAM ===
# Token que te dio @BotFather al crear @Mi_Tienda_Express_Bot
TELEGRAM_BOT_TOKEN=
# Texto aleatorio que inventas tú. Genéralo con:  openssl rand -hex 32
TELEGRAM_WEBHOOK_SECRET=
# Tu ID numérico de Telegram. Escríbele a @userinfobot y copia el número "Id"
SUPER_ADMIN_TELEGRAM_ID=

# === SUPABASE ===
# Project ID: Supabase → Project Settings → General (también está en la URL del panel)
SUPABASE_PROJECT_ID=
# Contraseña de la base de datos que guardaste al crear el proyecto
SUPABASE_DB_PASSWORD=
```

No hace falta copiar la URL ni las llaves de API de Supabase: las Edge Functions ya las tienen.

### 14.2 `supabase/config.toml`

Si el CLI de Supabase está disponible, generarlo con `supabase init` y editarlo. Si no, crear uno mínimo. Debe incluir:
```toml
[functions.bot]
verify_jwt = false

[db.seed]
enabled = true
sql_paths = ["./seed.sql"]
```
(En la Fase 14 se agrega `[functions.dashboard]` con `verify_jwt = false`.)

### 14.3 `desplegar.sh`

Script bash (`set -euo pipefail`), con mensajes en español en cada paso:
1. Verificar que exista `.env`; si no: "Copia .env.example a .env y llena las llaves".
2. Cargar `.env` y verificar que las 5 variables tengan valor; indicar cuál falta.
3. Verificar que exista el CLI (`supabase` o `npx supabase`); si no, indicar cómo instalarlo según el sistema.
4. `supabase login` (solo si no hay sesión; abre el navegador).
5. `supabase link --project-ref "$SUPABASE_PROJECT_ID" -p "$SUPABASE_DB_PASSWORD"`.
6. `supabase db push --include-seed -p "$SUPABASE_DB_PASSWORD"` (aplica migraciones y semilla). Si la versión del CLI no reconoce `--include-seed`, indicar en el README cómo ejecutar `seed.sql` desde el SQL Editor de Supabase.
7. `supabase secrets set TELEGRAM_BOT_TOKEN="..." TELEGRAM_WEBHOOK_SECRET="..." SUPER_ADMIN_TELEGRAM_ID="..."`. **No** enviar variables que empiecen por `SUPABASE_` (son reservadas y el CLI las rechaza).
8. `supabase functions deploy bot --no-verify-jwt` (si pide Docker, reintentar con `--use-api`).
9. `curl -sS -X POST "https://$SUPABASE_PROJECT_ID.supabase.co/functions/v1/bot/configurar" -H "x-secreto-tareas: $TELEGRAM_WEBHOOK_SECRET"` y mostrar la respuesta.
10. Mensaje final: "✅ Listo. Abre Telegram y escríbele /start a @Mi_Tienda_Express_Bot".

El script se puede ejecutar varias veces sin dañar nada (todo idempotente).

---

## 15. PRUEBAS AUTOMÁTICAS (SOLO LÓGICA CRÍTICA)

Archivos en `supabase/functions/bot/pruebas/`, ejecutables con `deno test supabase/functions/bot/pruebas/`. La carpeta `logica/` no debe importar Supabase, grammY ni `Deno.env`.

| Archivo | Qué prueba como mínimo |
|---|---|
| `calculos.test.ts` | Subtotal, total con domicilio, formato `$17.500`, número de pedido `#0042` |
| `promociones.test.ts` | Porcentaje con redondeo, precio especial, promoción antes del inicio / el día de inicio / el último día / después del fin, promoción finalizada (`activa = false`) |
| `estados.test.ts` | Todas las transiciones válidas de 6.2 por modalidad y medio de pago; transiciones inválidas (ej. `entregado → en_preparacion`, `esperando_tienda → despachado`); qué estados permite cancelar el cliente (RN-29) y la tienda (RN-30) |
| `permisos.test.ts` | Toda la matriz 3.3, más: administrador no puede tocar al dueño ni a otro administrador; empleado no puede confirmar pagos |
| `limites.test.ts` | Límite de 10 sin Premium (9 → permite, 10 → bloquea), Premium sin límite, eliminados no cuentan |
| `codigo_entrega.test.ts` | Genera 4 dígitos (incluye ceros a la izquierda), validación correcta/incorrecta, alerta en el intento 3 y no antes |
| `horarios.test.ts` | Abierto/cerrado en hora de Bogotá, día sin horario = cerrado, cálculo de "próxima apertura", conversión UTC → Bogotá |

**Todas deben pasar** antes del mensaje final de entrega. Además, `deno check` sin errores en `supabase/functions/**`.

---

## 16. FASE 14 – DASHBOARD (⛔ BLOQUEADA)

> ⛔ **ALTO.** No inicies esta fase aunque todo lo demás esté terminado. Debes detenerte, informar que las fases 1 a 13 están completas y esperar a que Miguel escriba textualmente: **`Autorizo construir el dashboard`**. Si no lo ha escrito, no escribas ningún archivo de esta fase.

**Objetivo:** página web **de solo lectura** con gráficas, publicada en GitHub Pages, con acceso por código temporal enviado por Telegram.

**Acceso:** Super Admin (ve todas las tiendas, con filtro por tienda) y **dueños de tiendas Premium** (solo su tienda). Si un dueño de tienda no Premium intenta entrar: "📊 El dashboard es exclusivo de Mi Tienda Express Premium ⭐".

**Arquitectura:**
```
GitHub Pages (dashboard-web/, sin llaves) ──► Edge Function "dashboard" ──► Base de datos
                                                    └──► Telegram (envía el código)
```

**Tablas nuevas** (migración nueva):
- `codigos_dashboard(id, telegram_id, alcance text check ('global','tienda'), tienda_id, codigo_hash text, expira_en, usado boolean, intentos int, creado_en)`
- `sesiones_dashboard(id, token_hash text unique, telegram_id, alcance, tienda_id, expira_en, creado_en)`

**Edge Function `dashboard`** (`verify_jwt = false`, CORS habilitado, respuestas JSON):
| Ruta | Qué hace |
|---|---|
| `POST /solicitar-codigo` `{ "identificador": "@usuario" o "nombre de tienda" }` | Busca a quién corresponde: el Super Admin (por su username), un dueño de tienda Premium (por username) o una tienda Premium por nombre/slug (→ su dueño). Genera un código de 6 dígitos, guarda su hash SHA-256, vence en 5 min, y el bot lo envía: "🔐 Tu código del dashboard es 583920. Vence en 5 minutos. Si no fuiste tú, ignora este mensaje." **Siempre** responde lo mismo: "Si tienes acceso, te llegó un código a Telegram" (no revelar si el usuario existe). Máximo 3 solicitudes cada 15 min por destinatario. |
| `POST /verificar` `{ "identificador", "codigo" }` | Máximo 5 intentos por código; un solo uso. Si es correcto, crea una sesión de 2 horas con un token aleatorio de 32 bytes (se guarda solo el hash) y lo devuelve. |
| `GET /metricas?tienda_id=&desde=&hasta=` con `Authorization: Bearer <token>` | Valida la sesión y, si el alcance es de tienda, que esa tienda **siga siendo Premium** y la persona **siga siendo su dueño** (si no, cierra la sesión). Devuelve solo datos agregados: pedidos por día, ventas por día, pedidos por estado, top 10 productos, modalidad, medios de pago; para el Super Admin además ventas por tienda y la lista de tiendas para el filtro. |

**`dashboard-web/`:** `index.html`, `estilos.css`, `app.js`, `config.js`. `config.js` contiene **solo** la URL pública de la función (`https://<PROJECT_ID>.supabase.co/functions/v1/dashboard`); `desplegar.sh` lo genera a partir del `.env`. Pantalla de acceso (identificador → código), luego gráficas con **Chart.js** (CDN): línea de pedidos por día, barras de ventas por día, dona de estados, barras horizontales de top productos, donas de modalidad y medio de pago; filtro de fechas (7 / 30 días) y, para el Super Admin, selector de tienda. Refresco cada 60 segundos. Botón "Cerrar sesión". Diseño limpio y responsive.

**Despliegue:** agregar a `desplegar.sh` el `functions deploy dashboard --no-verify-jwt` y la generación de `config.js`. En el README, los pasos para publicar `dashboard-web/` en GitHub Pages (Settings → Pages → rama y carpeta).

**Pruebas de esta fase:** hash y verificación del código, vencimiento, un solo uso, límite de intentos y validación de alcance (función pura).

---

## 17. FASES DE CONSTRUCCIÓN

Construir en orden, **de corrido**. Cada fase termina cuando su lista de verificación está completa.

### Fase 1 – Base del proyecto
- Estructura de carpetas (sección 8), `.gitignore`, `.env.example` (14.1), `config.toml` (14.2), `README.md` inicial.
- Migraciones: extensiones, tablas (7.2), funciones SQL (7.3), permisos.
- `seed.sql` completo (sección 13).
- `_compartido/entorno.ts`, `_compartido/supabase.ts`.
- `bot/index.ts` con enrutamiento (sección 9), incluidos `/configurar` y `/tareas` (vacía por ahora).
- `desplegar.sh` (14.3).
- ✅ Verificar: `deno check` sin errores; el seed tiene 118 barrios, 8 categorías comunes, 2 tiendas, 24 productos y 12 claves de configuración; ningún archivo contiene llaves reales.

### Fase 2 – Usuarios, roles y navegación
- Middlewares: registrar usuario, cargar estado de conversación, resolver rol (10.4, 10.5).
- `logica/permisos.ts` (3.3), `datos_callback.ts` (10.6), utilidades de formato HTML y paginación.
- `/start` con cargas (10.9), `/menu`, `/cancelar`, `/ayuda`, menú inicial (11.1), menú del cliente (11.2) y menús del personal (11.12), aún con acciones vacías donde haga falta.
- ✅ Verificar: un usuario nuevo ve el menú inicial; `/start t_mercaldas` lo lleva a Mercaldas como cliente; el Super Admin ve su botón.

### Fase 3 – Registro y configuración de tienda
- Flujo de registro (11.11), "⚙️ Mi tienda", horarios (`logica/horarios.ts`), medios de pago con la recomendación de contra entrega, enlace de la tienda.
- ✅ Verificar: crear tienda deja al usuario como dueño con horario y al menos un medio de pago.

### Fase 4 – Equipo
- Invitaciones, aceptación, cambio de rol, quitar, salir del equipo, transferir tienda (11.15), con todas las reglas de 3.2 y RN-38 a RN-42.
- ✅ Verificar: un administrador no ve botones sobre el dueño ni sobre otros administradores; una invitación usada no sirve dos veces.

### Fase 5 – Catálogo del lado de la tienda
- Categorías, productos, límite y broma Premium (RN-03 a RN-05), inventario, agotados, pregunta de reabastecimiento y avisos (RN-09 a RN-12).
- ✅ Verificar: La Esquina (9 productos) permite crear 1 más y bloquea el siguiente con el mensaje Premium; poner stock 0 dispara la pregunta; subir de 0 avisa a los suscritos.

### Fase 6 – Promociones
- Flujo completo (11.14), `logica/promociones.ts`, uso de `precio_vigente`.
- ✅ Verificar: la promoción semilla muestra precio tachado y 🔥.

### Fase 7 – Catálogo del cliente
- Buscar tienda, recomendaciones (solo Premium), info de la tienda, categorías, búsqueda sin tildes, detalle con cantidad, ofertas, avísame (11.1–11.3).
- ✅ Verificar: "leche" encuentra "Leche entera 1L"; las recomendaciones muestran solo Mercaldas.

### Fase 8 – Carrito y checkout
- Carrito (11.4) y flujo de pedido completo (11.5) con todas las validaciones, datos guardados, barrios por comuna, "No entrego", medios de pago y resumen con advertencia.
- ✅ Verificar: con la tienda cerrada no se puede confirmar; un segundo pedido en la misma tienda se bloquea; el stock baja al confirmar.

### Fase 9 – Ciclo de vida del pedido
- Notificación a la tienda, aceptar/rechazar, valor de domicilio con memoria, doble confirmación, pago por transferencia y comprobante, preparación, asignación de domiciliario, despacho, código de entrega, cancelaciones de cliente y tienda, "gana el primero", "🧾 Mis pedidos", "📋 Pedidos" y "🛵 Mis entregas" (11.6–11.10).
- ✅ Verificar: los recorridos de 6.2 completos para domicilio y recogida, con contra entrega y con transferencia; la memoria de tarifas sugiere el último valor; sin código no se puede entregar.

### Fase 10 – Temporizadores
- `tareas/temporizadores.ts` (11.18) y su conexión con `/tareas`.
- ✅ Verificar (con lógica y revisión de consultas): recordatorios una sola vez; cancelación devuelve stock y avisa a ambas partes; carritos viejos se borran.

### Fase 11 – Reportes e historial
- `reporte_tienda` y pantallas de 11.15 y "📜 Historial".
- ✅ Verificar: ventas solo cuentan pedidos entregados; los pedidos de prueba cuentan.

### Fase 12 – Super Admin y modo pruebas
- Panel completo (11.16) y modo pruebas con notificaciones cruzadas (11.17).
- ✅ Verificar: con una sola cuenta en modo pruebas se completa un pedido de principio a fin; activar Premium hace aparecer la tienda en recomendaciones.

### Fase 13 – Pruebas, revisión y entrega
- Pruebas automáticas (sección 15) pasando, `deno check` limpio.
- Revisar que ningún archivo tenga llaves y que `.env` esté en `.gitignore`.
- README completo: requisitos (CLI de Supabase, Deno), pasos de despliegue, notas de la demo (sección 19), cómo cambiar los tiempos en `configuracion`, y "Decisiones tomadas por el agente".
- Entregar el **mensaje final** (sección 18) y **detenerse**.

### Fase 14 – Dashboard
- ⛔ Solo tras la frase `Autorizo construir el dashboard` (sección 16).

---

## 18. MENSAJE FINAL QUE EL AGENTE DEBE ENTREGAR (AL TERMINAR LA FASE 13)

El agente debe mostrar a Miguel, como mínimo, esto (adaptado a lo que realmente construyó):

```
✅ Terminé las fases 1 a 13. Las pruebas automáticas pasan (X de X).

🔑 DÓNDE PONER TUS LLAVES (todas en un solo archivo)
1. En la raíz del proyecto, copia el archivo .env.example y renómbralo a .env
2. Abre .env y llena estas 5 líneas:
   • TELEGRAM_BOT_TOKEN       → el token de @BotFather
   • TELEGRAM_WEBHOOK_SECRET  → ejecuta  openssl rand -hex 32  y pega el resultado
   • SUPER_ADMIN_TELEGRAM_ID  → escríbele a @userinfobot y copia tu "Id"
   • SUPABASE_PROJECT_ID      → Supabase → Project Settings → General
   • SUPABASE_DB_PASSWORD     → la contraseña que guardaste al crear el proyecto
3. No necesitas copiar ninguna otra llave de Supabase.

🚀 CÓMO DESPLEGAR
   chmod +x desplegar.sh
   ./desplegar.sh
   (Te pedirá iniciar sesión en Supabase en el navegador la primera vez.)

🧪 CÓMO PROBAR
   [guía paso a paso: /start, entrar a Mercaldas, hacer un pedido a domicilio con Nequi,
    aceptarlo como dueño, confirmar pago, asignar, despachar, entregar con código;
    probar el límite de 10 en La Esquina; probar modo pruebas; probar cancelación por tiempo]

⏱️ Para cambiar los tiempos: Supabase → Table Editor → tabla "configuracion".

⛔ La Fase 14 (dashboard) está pendiente. Cuando hayas probado todo, escribe:
   "Autorizo construir el dashboard"
```

---

## 19. NOTAS PARA LA DEMOSTRACIÓN EN LA UNIVERSIDAD

- La red de la universidad **bloquea Telegram** pero **no Supabase**.
- El bot funciona igual porque corre en Supabase y habla con Telegram desde la nube.
- Los celulares de la demo deben usar **datos móviles** para abrir Telegram (o compartir datos al portátil si se proyecta Telegram Desktop).
- `desplegar.sh` funciona desde la red de la universidad: el registro del webhook lo hace Supabase, no el portátil.
- El dashboard (Fase 14) carga en la red de la universidad; el código de acceso llega por Telegram, así que el celular necesita datos.
- Revisar el horario de las tiendas semilla según la hora de la demo (Mercaldas abre de 6:00 a 23:00; La Esquina cierra a las 21:00 y los domingos).
- Reparto sugerido con 3 cuentas: A = Miguel (Super Admin y dueño de Mercaldas), B = cliente en Mercaldas y dueño de La Esquina (transferida con "Cambiar dueño"), C = domiciliario de Mercaldas y cliente de La Esquina. Si no hay celulares prestados, usar el **modo pruebas**.
- Proyecto gratuito de Supabase: se pausa tras 7 días sin actividad; si pasa, se reactiva con un clic en el panel.
