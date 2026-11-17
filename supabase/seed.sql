-- Datos semilla de Mi Tienda Express (sección 13). Idempotente: se puede ejecutar varias veces.
-- Datos de contacto y pago FICTICIOS.

-- 13.1 Configuración
do $$ begin
  insert into configuracion (clave, valor, descripcion)
  select v.clave, v.valor, v.descripcion
    from (values
      ('minutos_recordatorio_tienda', '3', 'Recordatorio a la tienda por pedido sin responder'),
      ('minutos_cancelacion_tienda', '5', 'Cancelación si la tienda no responde'),
      ('minutos_recordatorio_cliente', '3', 'Recordatorio al cliente para aceptar el domicilio'),
      ('minutos_cancelacion_cliente', '5', 'Cancelación si el cliente no acepta el domicilio'),
      ('minutos_recordatorio_pago', '5', 'Recordatorio para enviar comprobante'),
      ('minutos_cancelacion_pago', '10', 'Cancelación si no llega el comprobante'),
      ('horas_vencimiento_carrito', '24', 'Vaciado de carritos inactivos'),
      ('limite_productos_gratis', '10', 'Productos máximos sin Premium'),
      ('max_pedidos_activos_por_tienda', '1', 'Pedidos simultáneos por cliente en una tienda'),
      ('umbral_stock_bajo', '3', 'Stock considerado bajo'),
      ('horas_vencimiento_invitacion', '24', 'Vigencia de enlaces de invitación'),
      ('intentos_maximos_codigo_entrega', '3', 'Intentos antes de alertar')
    ) as v(clave, valor, descripcion)
   where not exists (select 1 from configuracion c where c.clave = v.clave);
end $$;

-- 13.2 Categorías comunes
do $$ begin
  insert into categorias (tienda_id, nombre)
  select null, v.nombre
    from (values ('Lácteos'), ('Panadería'), ('Bebidas'), ('Aseo'), ('Granos'), ('Mecato'), ('Carnes'), ('Frutas y verduras')) as v(nombre)
   where not exists (select 1 from categorias c where c.tienda_id is null and c.nombre = v.nombre);
end $$;

-- 13.3 Barrios de Manizales (118) con la zona de domicilio de Mercaldas
drop table if exists tmp_barrios;
create temporary table tmp_barrios (orden_comuna int, comuna text, nombre text, zona int);
insert into tmp_barrios (orden_comuna, comuna, nombre, zona) values
  (1, 'Atardeceres', 'La Quinta', 4), (1, 'Atardeceres', 'La Linda', 5), (1, 'Atardeceres', 'Sacatín Viejo', 4),
  (1, 'Atardeceres', 'Villa Pilar', 3), (1, 'Atardeceres', 'Chipre Viejo', 3), (1, 'Atardeceres', 'Chipre', 3),
  (1, 'Atardeceres', 'Campohermoso', 3), (1, 'Atardeceres', 'Morrogacho', 4), (1, 'Atardeceres', 'La Francia', 3),
  (1, 'Atardeceres', 'Los Alcázares', 3), (1, 'Atardeceres', 'Bella Montaña', 5),
  (2, 'San José', 'Asís', 3), (2, 'San José', 'Avanzada', 3), (2, 'San José', 'San Ignacio', 3), (2, 'San José', 'Galán', 3),
  (2, 'San José', 'Estrada', 3), (2, 'San José', 'Las Delicias', 3), (2, 'San José', 'San José', 3), (2, 'San José', 'Colón', 3),
  (3, 'Cumanday', 'Las Américas', 3), (3, 'Cumanday', 'Los Agustinos', 3), (3, 'Cumanday', 'Centro', 3),
  (3, 'Cumanday', 'San Joaquín', 3), (3, 'Cumanday', 'Campoamor', 3), (3, 'Cumanday', 'Fundadores', 3),
  (4, 'La Estación', 'Santa Helena', 2), (4, 'La Estación', 'San Jorge', 2), (4, 'La Estación', 'El Sol', 2),
  (4, 'La Estación', 'La Argentina', 2), (4, 'La Estación', 'La Asunción', 2), (4, 'La Estación', 'Versalles', 2),
  (4, 'La Estación', 'Lleras', 2), (4, 'La Estación', 'Los Cedros', 2), (4, 'La Estación', 'El Campín', 2),
  (5, 'Ciudadela del Norte', 'Corinto', 4), (5, 'Ciudadela del Norte', 'Peralonso', 4), (5, 'Ciudadela del Norte', 'El Caribe', 4),
  (5, 'Ciudadela del Norte', 'San Cayetano', 4), (5, 'Ciudadela del Norte', 'Ofelia y Borneo', 4),
  (5, 'Ciudadela del Norte', 'Sierra Morena', 4), (5, 'Ciudadela del Norte', 'Fanny González', 4),
  (5, 'Ciudadela del Norte', 'San Sebastián', 4), (5, 'Ciudadela del Norte', 'Solferino', 5),
  (5, 'Ciudadela del Norte', 'El Porvenir', 5), (5, 'Ciudadela del Norte', 'La Carola', 5),
  (5, 'Ciudadela del Norte', 'La Carolita', 5), (5, 'Ciudadela del Norte', 'Villahermosa', 5),
  (5, 'Ciudadela del Norte', 'Comuneros', 5), (5, 'Ciudadela del Norte', 'Bosques del Norte', 5),
  (5, 'Ciudadela del Norte', 'Puertas del Sol', 5), (5, 'Ciudadela del Norte', 'Samaria', 5), (5, 'Ciudadela del Norte', 'Sinaí', 5),
  (6, 'Ecoturístico Cerro de Oro', 'Laureles', 1), (6, 'Ecoturístico Cerro de Oro', 'Viveros', 2),
  (6, 'Ecoturístico Cerro de Oro', 'La Cumbre Minitas', 2), (6, 'Ecoturístico Cerro de Oro', 'La Sultana', 2),
  (6, 'Ecoturístico Cerro de Oro', 'Escuela de Carabineros', 2), (6, 'Ecoturístico Cerro de Oro', 'Baja Suiza', 2),
  (6, 'Ecoturístico Cerro de Oro', 'Alta Suiza', 2), (6, 'Ecoturístico Cerro de Oro', 'Colseguros', 2),
  (6, 'Ecoturístico Cerro de Oro', 'Residencias Manizales', 2), (6, 'Ecoturístico Cerro de Oro', 'Cerro de Oro', 2),
  (7, 'Tesorito', 'San Marcel', 5), (7, 'Tesorito', 'La Alhambra', 5), (7, 'Tesorito', 'Cerros de La Alhambra', 5),
  (7, 'Tesorito', 'Juanchito', 5), (7, 'Tesorito', 'Caserío La Enea', 5), (7, 'Tesorito', 'Los Pinos', 5),
  (7, 'Tesorito', 'La Enea', 5), (7, 'Tesorito', 'Lusitania', 5), (7, 'Tesorito', 'La Nubia', 5),
  (8, 'Palogrande', 'La Leonora', 1), (8, 'Palogrande', 'Los Rosales', 1), (8, 'Palogrande', 'La Rambla', 1),
  (8, 'Palogrande', 'Palogrande', 1), (8, 'Palogrande', 'La Estrella', 1), (8, 'Palogrande', 'Belén', 1),
  (8, 'Palogrande', 'Arboleda', 1), (8, 'Palogrande', 'Palermo', 1), (8, 'Palogrande', 'Sancancio', 1),
  (8, 'Palogrande', 'Universidad', 2), (8, 'Palogrande', 'Milán', 2), (8, 'Palogrande', 'El Trébol', 2), (8, 'Palogrande', 'Batallón', 2),
  (9, 'Universitaria', 'Betania', 3), (9, 'Universitaria', 'Fátima', 3), (9, 'Universitaria', 'Pío XII', 3),
  (9, 'Universitaria', 'San Fernando', 3), (9, 'Universitaria', 'Camilo Torres', 3), (9, 'Universitaria', 'Las Colinas', 3),
  (9, 'Universitaria', 'Malhabar', 3), (9, 'Universitaria', 'Aranjuez', 3), (9, 'Universitaria', 'La Playa', 3),
  (9, 'Universitaria', 'Vivienda Popular', 4),
  (10, 'La Fuente', 'Uribe', 3), (10, 'La Fuente', 'Vélez', 3), (10, 'La Fuente', 'Colombia', 3), (10, 'La Fuente', 'González', 3),
  (10, 'La Fuente', 'Persia', 3), (10, 'La Fuente', 'Guamal', 3), (10, 'La Fuente', 'Arrayanes', 3), (10, 'La Fuente', 'Marmato', 3),
  (10, 'La Fuente', 'Cervantes', 3), (10, 'La Fuente', 'Nevado', 3), (10, 'La Fuente', 'Panamericana', 3),
  (11, 'La Macarena', 'San Antonio', 4), (11, 'La Macarena', '20 de Julio', 4), (11, 'La Macarena', 'El Carmen', 4),
  (11, 'La Macarena', 'La Castellana', 4), (11, 'La Macarena', 'El Bosque', 4), (11, 'La Macarena', 'Buena Esperanza', 4),
  (11, 'La Macarena', 'Centenario', 4), (11, 'La Macarena', 'Estambul', 4),
  (12, 'Otros sectores', 'Altos de Capri', 4), (12, 'Otros sectores', 'Villa Julia', 4), (12, 'Otros sectores', 'Villa Café', 5),
  (12, 'Otros sectores', 'Portón del Guamo', 5), (12, 'Otros sectores', 'Altos de Granada', 5);

do $$ begin
  insert into barrios (nombre, comuna, orden_comuna)
  select t.nombre, t.comuna, t.orden_comuna from tmp_barrios t
   where not exists (select 1 from barrios b where b.nombre = t.nombre);
  raise notice 'Barrios cargados: % (deben ser 118)', (select count(*) from barrios);
end $$;

-- 13.4 Tiendas de demostración (sin dueño: /configurar asigna al Super Admin)
do $$ begin
  if not exists (select 1 from tiendas where slug = 'mercaldas') then
    insert into tiendas (slug, nombre, descripcion, direccion, barrio_id, telefono_contacto, es_premium)
    values ('mercaldas', 'Mercaldas',
            'Tu supermercado de confianza en La Leonora. Lácteos, granos, aseo y más, con domicilio a toda Manizales 🛵',
            'Calle de prueba #00-00, La Leonora', (select id from barrios where nombre = 'La Leonora'),
            '300 000 0000', true);
  end if;
  if not exists (select 1 from tiendas where slug = 'minimercado_la_esquina') then
    insert into tiendas (slug, nombre, descripcion, direccion, barrio_id, telefono_contacto, es_premium)
    values ('minimercado_la_esquina', 'Minimercado La Esquina',
            'La tienda del barrio en Chipre. Huevos frescos, verduras y lo de todos los días.',
            'Carrera de prueba #00-00, Chipre', (select id from barrios where nombre = 'Chipre'),
            '300 000 0001', false);
  end if;
end $$;

-- Horarios: Mercaldas todos los días 6:00–23:00; La Esquina lunes a sábado 7:00–21:00
do $$ declare
  v_mercaldas bigint := (select id from tiendas where slug = 'mercaldas');
  v_esquina bigint := (select id from tiendas where slug = 'minimercado_la_esquina');
begin
  insert into horarios_tienda (tienda_id, dia_semana, hora_apertura, hora_cierre)
  select v_mercaldas, d, '06:00', '23:00' from generate_series(0, 6) d
   where not exists (select 1 from horarios_tienda h where h.tienda_id = v_mercaldas and h.dia_semana = d);
  insert into horarios_tienda (tienda_id, dia_semana, hora_apertura, hora_cierre)
  select v_esquina, d, '07:00', '21:00' from generate_series(1, 6) d
   where not exists (select 1 from horarios_tienda h where h.tienda_id = v_esquina and h.dia_semana = d);

  insert into medios_pago_tienda (tienda_id, tipo, datos)
  select v.tienda_id, v.tipo, v.datos::jsonb
    from (values
      (v_mercaldas, 'nequi', '{"numero":"3000000000","titular":"Mercaldas Demo"}'),
      (v_mercaldas, 'llave_breb', '{"llave":"@mercaldasdemo"}'),
      (v_mercaldas, 'contra_entrega', '{}'),
      (v_esquina, 'bancolombia', '{"tipo_cuenta":"ahorros","numero_cuenta":"00000000000","titular":"La Esquina Demo"}'),
      (v_esquina, 'nequi', '{"numero":"3000000001","titular":"La Esquina Demo"}')
    ) as v(tienda_id, tipo, datos)
   where not exists (select 1 from medios_pago_tienda m where m.tienda_id = v.tienda_id and m.tipo = v.tipo);

  -- Tarifas de Mercaldas por zona: 1=$2.000 · 2=$3.000 · 3=$4.000 · 4=$5.000 · 5=$6.000
  insert into tarifas_domicilio (tienda_id, barrio_id, tarifa, entrega)
  select v_mercaldas, b.id, 1000 + t.zona * 1000, true
    from tmp_barrios t join barrios b on b.nombre = t.nombre
   where not exists (select 1 from tarifas_domicilio x where x.tienda_id = v_mercaldas and x.barrio_id = b.id);

  if not exists (select 1 from categorias where tienda_id = v_esquina and nombre = 'Huevos') then
    insert into categorias (tienda_id, nombre) values (v_esquina, 'Huevos');
  end if;
end $$;

-- Productos (sin foto, precios ficticios)
do $$ declare
  v_mercaldas bigint := (select id from tiendas where slug = 'mercaldas');
  v_esquina bigint := (select id from tiendas where slug = 'minimercado_la_esquina');
begin
  insert into productos (tienda_id, categoria_id, nombre, precio, unidad, stock)
  select v.tienda_id,
         coalesce((select id from categorias c where c.tienda_id = v.tienda_id and c.nombre = v.categoria),
                  (select id from categorias c where c.tienda_id is null and c.nombre = v.categoria)),
         v.nombre, v.precio, v.unidad, v.stock
    from (values
      (v_mercaldas, 'Lácteos', 'Leche entera 1L', 4800, 'unidad', 24),
      (v_mercaldas, 'Lácteos', 'Yogur de fresa 1L', 7900, 'unidad', 10),
      (v_mercaldas, 'Lácteos', 'Queso campesino 500 g', 12500, 'unidad', 2),
      (v_mercaldas, 'Panadería', 'Pan tajado', 6200, 'paquete', 15),
      (v_mercaldas, 'Panadería', 'Arepas de maíz x5', 3500, 'paquete', 20),
      (v_mercaldas, 'Bebidas', 'Gaseosa 1,5 L', 5500, 'unidad', 18),
      (v_mercaldas, 'Bebidas', 'Agua 600 ml', 2000, 'unidad', 30),
      (v_mercaldas, 'Bebidas', 'Jugo de caja 1L', 4900, 'unidad', 12),
      (v_mercaldas, 'Aseo', 'Jabón en barra', 3200, 'unidad', 25),
      (v_mercaldas, 'Aseo', 'Papel higiénico x4', 8900, 'paquete', 14),
      (v_mercaldas, 'Aseo', 'Detergente 1 kg', 11500, 'unidad', 9),
      (v_mercaldas, 'Granos', 'Arroz 1 kg', 4600, 'unidad', 40),
      (v_mercaldas, 'Granos', 'Fríjol 500 g', 6800, 'unidad', 16),
      (v_mercaldas, 'Mecato', 'Papas fritas', 2800, 'unidad', 22),
      (v_mercaldas, 'Mecato', 'Chocolatina', 2500, 'unidad', 0),
      (v_esquina, 'Huevos', 'Huevos AA x12', 14500, 'paquete', 10),
      (v_esquina, 'Lácteos', 'Leche en bolsa 1L', 4500, 'unidad', 12),
      (v_esquina, 'Panadería', 'Pan francés x5', 3000, 'paquete', 8),
      (v_esquina, 'Bebidas', 'Gaseosa 400 ml', 2500, 'unidad', 20),
      (v_esquina, 'Granos', 'Panela', 3500, 'unidad', 15),
      (v_esquina, 'Granos', 'Café molido 250 g', 9800, 'unidad', 6),
      (v_esquina, 'Frutas y verduras', 'Plátano verde', 1200, 'unidad', 30),
      (v_esquina, 'Frutas y verduras', 'Tomate', 2800, 'libra', 3),
      (v_esquina, 'Carnes', 'Salchichón 450 g', 8900, 'unidad', 7)
    ) as v(tienda_id, categoria, nombre, precio, unidad, stock)
   where not exists (select 1 from productos p where p.tienda_id = v.tienda_id and p.nombre = v.nombre);

  -- Promoción: 20% en Leche entera 1L de Mercaldas, desde hoy hasta hoy + 30 días
  if not exists (select 1 from promociones pr join productos p on p.id = pr.producto_id
                  where p.tienda_id = v_mercaldas and p.nombre = 'Leche entera 1L') then
    insert into promociones (tienda_id, producto_id, tipo, valor, inicia_en, termina_en)
    select v_mercaldas, p.id, 'porcentaje', 20,
           (now() at time zone 'America/Bogota')::date,
           (now() at time zone 'America/Bogota')::date + 30
      from productos p where p.tienda_id = v_mercaldas and p.nombre = 'Leche entera 1L';
  end if;

  raise notice 'Semilla: % barrios, % categorías comunes, % tiendas, % productos, % claves de configuración',
    (select count(*) from barrios), (select count(*) from categorias where tienda_id is null),
    (select count(*) from tiendas), (select count(*) from productos), (select count(*) from configuracion);
end $$;

drop table if exists tmp_barrios;
