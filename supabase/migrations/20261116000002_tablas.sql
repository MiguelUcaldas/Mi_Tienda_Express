-- Tablas de Mi Tienda Express (sección 7.2 de la especificación)

create table configuracion (
  clave text primary key,
  valor text not null,
  descripcion text
);

create table barrios (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  comuna text not null,
  orden_comuna int not null
);

create table usuarios (
  telegram_id bigint primary key,
  nombre_telegram text,
  username text,
  nombre_entrega text,
  telefono text,
  ultimo_barrio_id bigint references barrios(id),
  ultima_direccion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table tiendas (
  id bigint generated always as identity primary key,
  slug text not null unique,
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

-- 0 = domingo ... 6 = sábado. Día sin fila = cerrado.
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
create unique index miembro_unico_activo on miembros_tienda (tienda_id, telegram_id) where activo;
create unique index dueno_unico_activo on miembros_tienda (tienda_id) where activo and rol = 'dueno';

-- El rol 'dueno' en invitaciones solo lo genera el Super Admin
create table invitaciones (
  codigo text primary key,
  tienda_id bigint not null references tiendas(id) on delete cascade,
  rol text not null check (rol in ('dueno','administrador','empleado','domiciliario')),
  creada_por bigint not null references usuarios(telegram_id),
  expira_en timestamptz not null,
  usada_por bigint references usuarios(telegram_id),
  usada_en timestamptz
);

create table categorias (
  id bigint generated always as identity primary key,
  tienda_id bigint references tiendas(id) on delete cascade,
  nombre text not null,
  activa boolean not null default true
);
create unique index categoria_comun_unica on categorias (nombre) where tienda_id is null;
create unique index categoria_tienda_unica on categorias (tienda_id, nombre) where tienda_id is not null;

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
  activo boolean not null default true,
  eliminado boolean not null default false,
  fecha_reabastecimiento date,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index productos_por_tienda on productos (tienda_id) where not eliminado;

create table promociones (
  id bigint generated always as identity primary key,
  tienda_id bigint not null references tiendas(id) on delete cascade,
  producto_id bigint not null references productos(id) on delete cascade,
  tipo text not null check (tipo in ('porcentaje','precio_especial')),
  valor integer not null check (valor > 0),
  inicia_en date not null,
  termina_en date not null check (termina_en >= inicia_en),
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

create table avisos_reabastecimiento (
  producto_id bigint not null references productos(id) on delete cascade,
  telegram_id bigint not null references usuarios(telegram_id),
  creado_en timestamptz not null default now(),
  primary key (producto_id, telegram_id)
);

create table tarifas_domicilio (
  tienda_id bigint not null references tiendas(id) on delete cascade,
  barrio_id bigint not null references barrios(id),
  tarifa integer check (tarifa >= 0),
  entrega boolean not null default true,
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
  cancelado_por bigint,
  recordatorio_en timestamptz,
  recordatorio_enviado boolean not null default false,
  vence_en timestamptz,
  es_prueba boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index pedidos_por_tienda_estado on pedidos (tienda_id, estado);
create index pedidos_por_cliente on pedidos (cliente_telegram_id, estado);
create index pedidos_vencimientos on pedidos (vence_en) where estado in ('esperando_tienda','esperando_confirmacion_cliente','esperando_pago');

create table pedido_items (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references pedidos(id) on delete cascade,
  producto_id bigint not null references productos(id),
  nombre_producto text not null,
  precio_unitario integer not null,
  cantidad integer not null check (cantidad > 0),
  subtotal integer not null
);

create table historial_estados_pedido (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references pedidos(id) on delete cascade,
  estado_anterior text,
  estado_nuevo text not null,
  hecho_por bigint,
  creado_en timestamptz not null default now()
);

-- Mensajes con botones enviados, para editarlos después ("gana el primero")
create table mensajes_notificacion (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references pedidos(id) on delete cascade,
  chat_id bigint not null,
  message_id bigint not null,
  tipo text not null,
  es_foto boolean not null default false,
  creado_en timestamptz not null default now()
);
create index mensajes_por_pedido on mensajes_notificacion (pedido_id);

create table estados_conversacion (
  telegram_id bigint primary key references usuarios(telegram_id),
  tienda_activa_id bigint references tiendas(id) on delete set null,
  flujo text,
  paso text,
  datos jsonb not null default '{}',
  actualizado_en timestamptz not null default now()
);

create table modo_pruebas (
  telegram_id bigint primary key,
  tienda_id bigint not null references tiendas(id) on delete cascade,
  rol text not null check (rol in ('cliente','dueno','administrador','empleado','domiciliario')),
  activado_en timestamptz not null default now()
);

-- RLS activado en todas; sin políticas: solo service_role entra
alter table configuracion enable row level security;
alter table barrios enable row level security;
alter table usuarios enable row level security;
alter table tiendas enable row level security;
alter table horarios_tienda enable row level security;
alter table medios_pago_tienda enable row level security;
alter table miembros_tienda enable row level security;
alter table invitaciones enable row level security;
alter table categorias enable row level security;
alter table categorias_ocultas enable row level security;
alter table productos enable row level security;
alter table promociones enable row level security;
alter table avisos_reabastecimiento enable row level security;
alter table tarifas_domicilio enable row level security;
alter table carritos enable row level security;
alter table carrito_items enable row level security;
alter table pedidos enable row level security;
alter table pedido_items enable row level security;
alter table historial_estados_pedido enable row level security;
alter table mensajes_notificacion enable row level security;
alter table estados_conversacion enable row level security;
alter table modo_pruebas enable row level security;
