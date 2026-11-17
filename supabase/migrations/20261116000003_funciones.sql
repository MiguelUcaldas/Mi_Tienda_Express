-- Funciones SQL (sección 7.3). Los errores empiezan con un código legible
-- (ej. 'STOCK_INSUFICIENTE:15') que el bot traduce a un mensaje amable.

-- Lee un entero de la tabla configuracion con valor por defecto
create or replace function config_int(p_clave text, p_defecto int) returns int
language sql stable as $$
  select coalesce((select valor::int from configuracion where clave = p_clave), p_defecto);
$$;

-- RN-15: precio con la promoción vigente hoy (hora de Bogotá)
create or replace function precio_vigente(p_producto_id bigint) returns integer
language plpgsql stable as $$
declare
  v_precio int;
  v_tipo text;
  v_valor int;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  select precio into v_precio from productos where id = p_producto_id;
  if v_precio is null then
    raise exception 'PRODUCTO_NO_EXISTE:%', p_producto_id;
  end if;
  select tipo, valor into v_tipo, v_valor
    from promociones
   where producto_id = p_producto_id and activa and inicia_en <= v_hoy and termina_en >= v_hoy
   order by creado_en desc
   limit 1;
  if v_tipo = 'porcentaje' then
    return round(v_precio * (100 - v_valor) / 100.0)::int;
  elsif v_tipo = 'precio_especial' then
    return v_valor;
  end if;
  return v_precio;
end $$;

create or replace function crear_pedido(
  p_cliente bigint, p_tienda bigint, p_modalidad text, p_barrio_id bigint, p_direccion text,
  p_nombre text, p_telefono text, p_observaciones text, p_medio_pago text, p_es_prueba boolean
) returns jsonb
language plpgsql as $$
declare
  v_carrito bigint;
  v_pedido bigint;
  v_item record;
  v_precio int;
  v_stock int;
  v_subtotal int := 0;
  v_agotados bigint[] := '{}';
  v_activos int;
  v_max int := config_int('max_pedidos_activos_por_tienda', 1);
  v_min_rec int := config_int('minutos_recordatorio_tienda', 3);
  v_min_canc int := config_int('minutos_cancelacion_tienda', 5);
begin
  if not exists (select 1 from tiendas where id = p_tienda and activa) then
    raise exception 'TIENDA_INACTIVA';
  end if;
  if p_modalidad not in ('domicilio', 'recogida') then
    raise exception 'MODALIDAD_INVALIDA';
  end if;
  if not exists (select 1 from medios_pago_tienda where tienda_id = p_tienda and tipo = p_medio_pago and activo) then
    raise exception 'MEDIO_PAGO_INVALIDO';
  end if;

  -- Bloquear el carrito serializa dos confirmaciones simultáneas del mismo cliente
  select id into v_carrito from carritos where tienda_id = p_tienda and telegram_id = p_cliente for update;

  select count(*) into v_activos from pedidos
   where tienda_id = p_tienda and cliente_telegram_id = p_cliente and estado not in ('entregado', 'cancelado');
  if v_activos >= v_max then
    raise exception 'PEDIDO_ACTIVO_EXISTE';
  end if;

  if v_carrito is null or not exists (select 1 from carrito_items where carrito_id = v_carrito) then
    raise exception 'CARRITO_VACIO';
  end if;

  for v_item in
    select ci.producto_id, ci.cantidad, p.stock, p.activo, p.eliminado, p.tienda_id
      from carrito_items ci join productos p on p.id = ci.producto_id
     where ci.carrito_id = v_carrito
     order by p.id
       for update of p
  loop
    if not v_item.activo or v_item.eliminado or v_item.tienda_id <> p_tienda then
      raise exception 'PRODUCTO_NO_DISPONIBLE:%', v_item.producto_id;
    end if;
    if v_item.stock < v_item.cantidad then
      raise exception 'STOCK_INSUFICIENTE:%', v_item.producto_id;
    end if;
  end loop;

  insert into pedidos (tienda_id, cliente_telegram_id, estado, modalidad, barrio_id, direccion, nombre_cliente,
                       telefono_cliente, observaciones, medio_pago, subtotal, total, recordatorio_en, vence_en, es_prueba)
  values (p_tienda, p_cliente, 'esperando_tienda', p_modalidad,
          case when p_modalidad = 'domicilio' then p_barrio_id end,
          case when p_modalidad = 'domicilio' then p_direccion end,
          p_nombre, p_telefono, nullif(trim(coalesce(p_observaciones, '')), ''), p_medio_pago, 0, 0,
          now() + make_interval(mins => v_min_rec), now() + make_interval(mins => v_min_canc), coalesce(p_es_prueba, false))
  returning id into v_pedido;

  for v_item in
    select ci.producto_id, ci.cantidad, p.nombre
      from carrito_items ci join productos p on p.id = ci.producto_id
     where ci.carrito_id = v_carrito
     order by p.id
  loop
    v_precio := precio_vigente(v_item.producto_id);
    insert into pedido_items (pedido_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal)
    values (v_pedido, v_item.producto_id, v_item.nombre, v_precio, v_item.cantidad, v_precio * v_item.cantidad);
    v_subtotal := v_subtotal + v_precio * v_item.cantidad;

    update productos set stock = stock - v_item.cantidad, actualizado_en = now()
     where id = v_item.producto_id
    returning stock into v_stock;
    if v_stock = 0 then
      v_agotados := v_agotados || v_item.producto_id;
    end if;
  end loop;

  update pedidos set subtotal = v_subtotal, total = v_subtotal where id = v_pedido;
  delete from carritos where id = v_carrito;
  insert into historial_estados_pedido (pedido_id, estado_anterior, estado_nuevo, hecho_por)
  values (v_pedido, null, 'esperando_tienda', p_cliente);

  return jsonb_build_object('pedido_id', v_pedido, 'agotados', to_jsonb(v_agotados));
end $$;

-- "Gana el primero": solo cambia si el pedido sigue en uno de los estados esperados
create or replace function cambiar_estado_pedido(
  p_pedido bigint, p_estados_esperados text[], p_estado_nuevo text, p_actor bigint, p_cambios jsonb default '{}'
) returns boolean
language plpgsql as $$
declare
  v_anterior text;
  c jsonb := coalesce(p_cambios, '{}'::jsonb);
begin
  select estado into v_anterior from pedidos
   where id = p_pedido and estado = any(p_estados_esperados)
     for update;
  if not found then
    return false;
  end if;

  update pedidos set
    estado = p_estado_nuevo,
    valor_domicilio = case when c ? 'valor_domicilio' then (c->>'valor_domicilio')::int else valor_domicilio end,
    total = case when c ? 'total' then (c->>'total')::int else total end,
    comprobante_file_id = case when c ? 'comprobante_file_id' then c->>'comprobante_file_id' else comprobante_file_id end,
    pago_confirmado = case when c ? 'pago_confirmado' then (c->>'pago_confirmado')::boolean else pago_confirmado end,
    codigo_entrega = case when c ? 'codigo_entrega' then c->>'codigo_entrega' else codigo_entrega end,
    domiciliario_telegram_id = case when c ? 'domiciliario_telegram_id' then (c->>'domiciliario_telegram_id')::bigint else domiciliario_telegram_id end,
    recordatorio_en = case when c ? 'recordatorio_en' then (c->>'recordatorio_en')::timestamptz else recordatorio_en end,
    recordatorio_enviado = case when c ? 'recordatorio_enviado' then (c->>'recordatorio_enviado')::boolean else recordatorio_enviado end,
    vence_en = case when c ? 'vence_en' then (c->>'vence_en')::timestamptz else vence_en end,
    actualizado_en = now()
  where id = p_pedido;

  if p_estado_nuevo <> v_anterior then
    insert into historial_estados_pedido (pedido_id, estado_anterior, estado_nuevo, hecho_por)
    values (p_pedido, v_anterior, p_estado_nuevo, p_actor);
  end if;
  return true;
end $$;

-- Cancela y devuelve las unidades al stock (RN-23)
create or replace function cancelar_pedido(
  p_pedido bigint, p_estados_permitidos text[], p_motivo text, p_detalle text, p_actor bigint
) returns jsonb
language plpgsql as $$
declare
  v_pedido record;
  v_item record;
  v_antes int;
  v_eliminado boolean;
  v_repuestos bigint[] := '{}';
begin
  select * into v_pedido from pedidos
   where id = p_pedido and estado = any(p_estados_permitidos)
     for update;
  if not found then
    return jsonb_build_object('cancelado', false, 'repuestos', '[]'::jsonb, 'habia_pago', false);
  end if;

  update pedidos set estado = 'cancelado', motivo_cancelacion = p_motivo, detalle_cancelacion = p_detalle,
         cancelado_por = p_actor, recordatorio_en = null, vence_en = null, actualizado_en = now()
   where id = p_pedido;

  for v_item in
    select producto_id, sum(cantidad)::int as cantidad from pedido_items
     where pedido_id = p_pedido group by producto_id order by producto_id
  loop
    select stock, eliminado into v_antes, v_eliminado from productos where id = v_item.producto_id for update;
    update productos set
      stock = stock + v_item.cantidad,
      fecha_reabastecimiento = case when v_antes = 0 then null else fecha_reabastecimiento end,
      actualizado_en = now()
     where id = v_item.producto_id;
    if v_antes = 0 and not v_eliminado then
      v_repuestos := v_repuestos || v_item.producto_id;
    end if;
  end loop;

  insert into historial_estados_pedido (pedido_id, estado_anterior, estado_nuevo, hecho_por)
  values (p_pedido, v_pedido.estado, 'cancelado', p_actor);

  return jsonb_build_object(
    'cancelado', true,
    'repuestos', to_jsonb(v_repuestos),
    'habia_pago', (v_pedido.comprobante_file_id is not null or v_pedido.pago_confirmado)
  );
end $$;

create or replace function ajustar_stock(p_producto bigint, p_nuevo_stock integer) returns jsonb
language plpgsql as $$
declare
  v_antes int;
begin
  if p_nuevo_stock is null or p_nuevo_stock < 0 then
    raise exception 'STOCK_INVALIDO';
  end if;
  select stock into v_antes from productos where id = p_producto and not eliminado for update;
  if not found then
    raise exception 'PRODUCTO_NO_EXISTE:%', p_producto;
  end if;
  update productos set
    stock = p_nuevo_stock,
    fecha_reabastecimiento = case when v_antes = 0 and p_nuevo_stock > 0 then null else fecha_reabastecimiento end,
    actualizado_en = now()
   where id = p_producto;
  return jsonb_build_object('antes', v_antes, 'despues', p_nuevo_stock);
end $$;

create or replace function buscar_productos(p_tienda bigint, p_texto text) returns setof productos
language sql stable as $$
  select * from productos
   where tienda_id = p_tienda and activo and not eliminado
     and extensions.unaccent(lower(nombre || ' ' || coalesce(descripcion, '')))
         like '%' || extensions.unaccent(lower(trim(p_texto))) || '%'
   order by nombre
   limit 20;
$$;

create or replace function buscar_tiendas(p_texto text) returns setof tiendas
language sql stable as $$
  select * from tiendas
   where activa
     and extensions.unaccent(lower(nombre)) like '%' || extensions.unaccent(lower(trim(p_texto))) || '%'
   order by nombre
   limit 10;
$$;

create or replace function contar_productos_limite(p_tienda bigint) returns integer
language sql stable as $$
  select count(*)::int from productos where tienda_id = p_tienda and not eliminado;
$$;

-- Reporte de la tienda (sección 11.15). Ventas = solo pedidos entregados; incluye pedidos de prueba.
create or replace function reporte_tienda(p_tienda bigint, p_desde timestamptz, p_hasta timestamptz) returns jsonb
language plpgsql stable as $$
declare
  v_umbral int := config_int('umbral_stock_bajo', 3);
  v_resultado jsonb;
begin
  with p as (
    select * from pedidos where tienda_id = p_tienda and creado_en >= p_desde and creado_en < p_hasta
  ), e as (
    select * from p where estado = 'entregado'
  )
  select jsonb_build_object(
    'pedidos', (select count(*) from p),
    'entregados', (select count(*) from e),
    'cancelados', (select count(*) from p where estado = 'cancelado'),
    'en_curso', (select count(*) from p where estado not in ('entregado', 'cancelado')),
    'ventas', (select coalesce(sum(total), 0) from e),
    'ticket_promedio', (select coalesce(round(avg(total)), 0) from e),
    'domicilio', (select count(*) from e where modalidad = 'domicilio'),
    'recogida', (select count(*) from e where modalidad = 'recogida'),
    'medios', (select coalesce(jsonb_object_agg(medio_pago, n), '{}'::jsonb)
                 from (select medio_pago, count(*) n from e group by medio_pago) m),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'unidades', unidades) order by unidades desc, nombre), '[]'::jsonb)
              from (select pi.nombre_producto as nombre, sum(pi.cantidad) as unidades
                      from pedido_items pi join e on e.id = pi.pedido_id
                     group by pi.nombre_producto
                     order by sum(pi.cantidad) desc, pi.nombre_producto
                     limit 5) t),
    'agotados', (select coalesce(jsonb_agg(nombre order by nombre), '[]'::jsonb)
                   from productos where tienda_id = p_tienda and not eliminado and activo and stock = 0),
    'stock_bajo', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'stock', stock) order by stock, nombre), '[]'::jsonb)
                     from productos where tienda_id = p_tienda and not eliminado and activo and stock between 1 and v_umbral)
  ) into v_resultado;
  return v_resultado;
end $$;

-- Resumen para el panel del Super Admin (sección 11.16)
create or replace function resumen_global() returns jsonb
language plpgsql stable as $$
declare
  v_hoy timestamptz := date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota';
  v_semana timestamptz := v_hoy - interval '6 days';
  v_mes timestamptz := date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota';
begin
  return jsonb_build_object(
    'tiendas', (select count(*) from tiendas),
    'premium', (select count(*) from tiendas where es_premium),
    'activas', (select count(*) from tiendas where activa),
    'hoy', (select jsonb_build_object('pedidos', count(*), 'ventas', coalesce(sum(total) filter (where estado = 'entregado'), 0))
              from pedidos where creado_en >= v_hoy),
    'semana', (select jsonb_build_object('pedidos', count(*), 'ventas', coalesce(sum(total) filter (where estado = 'entregado'), 0))
                 from pedidos where creado_en >= v_semana),
    'mes', (select jsonb_build_object('pedidos', count(*), 'ventas', coalesce(sum(total) filter (where estado = 'entregado'), 0))
              from pedidos where creado_en >= v_mes),
    'top_tiendas', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'ventas', ventas) order by ventas desc), '[]'::jsonb)
                      from (select t.nombre, sum(p.total) as ventas
                              from pedidos p join tiendas t on t.id = p.tienda_id
                             where p.estado = 'entregado' and p.creado_en >= v_mes
                             group by t.nombre
                             order by sum(p.total) desc
                             limit 5) x)
  );
end $$;

-- RN-42: el viejo dueño pasa a administrador y luego el nuevo a dueño. Devuelve el telegram_id del dueño anterior.
create or replace function transferir_tienda(p_tienda bigint, p_nuevo_dueno bigint) returns bigint
language plpgsql as $$
declare
  v_anterior bigint;
begin
  select telegram_id into v_anterior from miembros_tienda
   where tienda_id = p_tienda and rol = 'dueno' and activo
     for update;
  if v_anterior = p_nuevo_dueno then
    raise exception 'YA_ES_DUENO';
  end if;
  if v_anterior is not null then
    update miembros_tienda set rol = 'administrador', actualizado_en = now()
     where tienda_id = p_tienda and telegram_id = v_anterior and activo;
  end if;
  update miembros_tienda set rol = 'dueno', actualizado_en = now()
   where tienda_id = p_tienda and telegram_id = p_nuevo_dueno and activo;
  if not found then
    insert into miembros_tienda (tienda_id, telegram_id, rol) values (p_tienda, p_nuevo_dueno, 'dueno');
  end if;
  return v_anterior;
end $$;

-- RN-38: invitación de un solo uso y con vencimiento
create or replace function aceptar_invitacion(p_codigo text, p_telegram bigint) returns jsonb
language plpgsql as $$
declare
  v_inv record;
  v_anterior bigint;
begin
  select * into v_inv from invitaciones where codigo = p_codigo for update;
  if not found then
    raise exception 'INVITACION_NO_EXISTE';
  end if;
  if v_inv.usada_por is not null then
    raise exception 'INVITACION_USADA';
  end if;
  if v_inv.expira_en < now() then
    raise exception 'INVITACION_VENCIDA';
  end if;

  if v_inv.rol = 'dueno' then
    v_anterior := transferir_tienda(v_inv.tienda_id, p_telegram);
  else
    if exists (select 1 from miembros_tienda where tienda_id = v_inv.tienda_id and telegram_id = p_telegram and activo) then
      raise exception 'YA_ES_MIEMBRO';
    end if;
    insert into miembros_tienda (tienda_id, telegram_id, rol) values (v_inv.tienda_id, p_telegram, v_inv.rol);
  end if;

  update invitaciones set usada_por = p_telegram, usada_en = now() where codigo = p_codigo;
  return jsonb_build_object('tienda_id', v_inv.tienda_id, 'rol', v_inv.rol,
                            'creada_por', v_inv.creada_por, 'dueno_anterior', v_anterior);
end $$;

-- Programa el llamado a /bot/tareas cada minuto con pg_cron + pg_net
create or replace function programar_tareas(p_url text, p_secreto text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from cron.job where jobname = 'mte_tareas_cada_minuto') then
    perform cron.unschedule('mte_tareas_cada_minuto');
  end if;
  perform cron.schedule(
    'mte_tareas_cada_minuto',
    '* * * * *',
    format(
      $f$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-secreto-tareas', %L), body := '{}'::jsonb)$f$,
      p_url, p_secreto
    )
  );
end $$;
