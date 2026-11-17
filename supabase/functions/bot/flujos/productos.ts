// "📦 Productos" (11.13): crear con límite Premium (RN-03), ver, editar, ocultar y eliminar (RN-05).
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { formatearPesos, parsearEntero, parsearPrecio } from "../logica/calculos.ts";
import { escaparHtml, NOMBRES_UNIDAD, paginar } from "../logica/formato.ts";
import { puedeCrearProducto } from "../logica/limites.ts";
import { agregarPaginacion, DATO_CANCELAR, TAMANO_PAGINA, tecladoCancelar } from "../menus/comunes.ts";
import { exigir } from "../middleware/rol.ts";
import { categoriasDeTienda, obtenerCategoria, obtenerProducto, productosDeTienda } from "../servicios/catalogo.ts";
import { leerConfiguracion } from "../servicios/configuracion.ts";
import { iniciarFlujo, irAPaso, terminarFlujo } from "../servicios/conversacion.ts";
import { obtenerTienda } from "../servicios/tiendas.ts";
import { avisar, mostrar, responder } from "../ui.ts";

const d = (...partes: (string | number)[]) => armar(P.productosAdmin, ...partes);
const UNIDADES = ["unidad", "kg", "libra", "paquete"];

async function cupo(tiendaId: number) {
  const [tienda, config, { data: usados }] = await Promise.all([
    obtenerTienda(tiendaId),
    leerConfiguracion(),
    db.rpc("contar_productos_limite", { p_tienda: tiendaId }),
  ]);
  const esPremium = tienda?.es_premium ?? false;
  return { esPremium, usados: (usados as number) ?? 0, limite: config.limite_productos_gratis, puede: puedeCrearProducto(esPremium, (usados as number) ?? 0, config.limite_productos_gratis) };
}

async function menu(ctx: MiContexto, tiendaId: number) {
  const c = await cupo(tiendaId);
  await mostrar(ctx, `📦 <b>Productos</b>\n${c.esPremium ? "⭐ Premium: productos ilimitados" : `Plan gratuito: ${c.usados}/${c.limite} productos`}`,
    new InlineKeyboard()
      .text("➕ Nuevo producto", d("n", tiendaId)).text("📋 Ver productos", d("l", tiendaId, 1)).row()
      .text("📂 Categorías", armar(P.categoriasAdmin, "l", tiendaId)).row()
      .text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
}

async function tecladoCategorias(tiendaId: number, dato: (id: number) => string): Promise<InlineKeyboard> {
  const teclado = new InlineKeyboard();
  (await categoriasDeTienda(tiendaId)).forEach((c, i) => {
    teclado.text(c.nombre, dato(c.id));
    if (i % 2 === 1) teclado.row();
  });
  return teclado.row();
}

function tecladoUnidades(dato: (u: string) => string): InlineKeyboard {
  const t = new InlineKeyboard();
  UNIDADES.forEach((u) => t.text(NOMBRES_UNIDAD[u], dato(u)));
  return t.row();
}

async function iniciarNuevo(ctx: MiContexto, tiendaId: number) {
  const c = await cupo(tiendaId);
  if (!c.puede) {
    await mostrar(ctx, `🚀 ¡Tu tienda está creciendo! Llegaste al límite de ${c.limite} productos del plan gratuito.\n` +
      "Pásate a ⭐ <b>Mi Tienda Express Premium</b> y ten productos ilimitados, aparece en las recomendaciones y accede a tu dashboard de ventas.",
      new InlineKeyboard().text("⭐ Quiero Premium", d("prem")).row().text("⬅️ Volver", d("menu", tiendaId)));
    return;
  }
  await iniciarFlujo(ctx, "crear_producto", "nombre", { tienda_id: tiendaId });
  await mostrar(ctx, "🆕 ¿Cómo se llama el producto? (ej. «Leche entera 1L»)", tecladoCancelar());
}

async function preguntarSiguiente(ctx: MiContexto) {
  const datos = ctx.estado.datos;
  switch (ctx.estado.paso) {
    case "categoria":
      await mostrar(ctx, "📂 ¿En qué categoría va?", (await tecladoCategorias(datos.tienda_id, (id) => d("cat", id)))
        .text("➕ Nueva categoría", d("ncat")).row().text("❌ Cancelar", DATO_CANCELAR));
      return;
    case "precio":
      return await responder(ctx, "💲 ¿Cuál es el precio? (ej. 4500 o 4.500)", tecladoCancelar());
    case "unidad":
      return await mostrar(ctx, "📏 ¿Cómo se vende?", tecladoUnidades((u) => d("un", u)).text("❌ Cancelar", DATO_CANCELAR));
    case "foto":
      return await mostrar(ctx, "📸 Envía una foto del producto o toca «Omitir».", new InlineKeyboard().text("Omitir", d("omf")).text("❌ Cancelar", DATO_CANCELAR));
    case "descripcion":
      return await mostrar(ctx, "📝 Escribe una descripción corta (máx. 300) o toca «Omitir».", new InlineKeyboard().text("Omitir", d("omd")).text("❌ Cancelar", DATO_CANCELAR));
    case "stock":
      return await mostrar(ctx, "📦 ¿Cuántas unidades tienes disponibles? (número entero)", tecladoCancelar());
    case "resumen": {
      const cat = await obtenerCategoria(datos.categoria_id);
      await mostrar(ctx, [
        "🧾 <b>Nuevo producto</b>",
        `Nombre: ${escaparHtml(datos.nombre)}`,
        `Categoría: ${escaparHtml(cat?.nombre)}`,
        `Precio: ${formatearPesos(datos.precio)} · ${NOMBRES_UNIDAD[datos.unidad]}`,
        `Stock: ${datos.stock}`,
        `Foto: ${datos.foto ? "sí" : "no"}`,
        datos.descripcion ? `Descripción: ${escaparHtml(datos.descripcion)}` : "",
      ].filter(Boolean).join("\n"), new InlineKeyboard().text("✅ Guardar", d("ok")).text("❌ Cancelar", DATO_CANCELAR));
    }
  }
}

async function avanzar(ctx: MiContexto, paso: string, datos: Record<string, unknown> = {}) {
  await irAPaso(ctx, paso, datos);
  await preguntarSiguiente(ctx);
}

async function guardarNuevo(ctx: MiContexto) {
  const datos = ctx.estado.datos;
  const c = await cupo(datos.tienda_id);
  if (!c.puede) return await iniciarNuevo(ctx, datos.tienda_id);
  const { error } = await db.from("productos").insert({
    tienda_id: datos.tienda_id,
    categoria_id: datos.categoria_id,
    nombre: datos.nombre,
    precio: datos.precio,
    unidad: datos.unidad,
    stock: datos.stock,
    foto_file_id: datos.foto ?? null,
    descripcion: datos.descripcion ?? null,
  });
  await terminarFlujo(ctx);
  if (error) {
    console.error("crear producto:", error.message);
    return void await mostrar(ctx, "😕 No pudimos guardar el producto. Intenta de nuevo.");
  }
  await mostrar(ctx, `✅ ¡${escaparHtml(datos.nombre)} quedó en tu catálogo!`,
    new InlineKeyboard().text("➕ Otro producto", d("n", datos.tienda_id)).text("📦 Productos", d("menu", datos.tienda_id)));
}

async function listar(ctx: MiContexto, tiendaId: number, pagina: number) {
  const pag = paginar(await productosDeTienda(tiendaId), pagina, TAMANO_PAGINA);
  const teclado = new InlineKeyboard();
  for (const p of pag.items) teclado.text(`${p.activo ? "" : "🙈 "}${p.nombre} — ${formatearPesos(p.precio)}`, d("v", p.id)).row();
  agregarPaginacion(teclado, pag, (n) => d("l", tiendaId, n));
  teclado.text("⬅️ Volver", d("menu", tiendaId));
  await mostrar(ctx, pag.items.length ? "📋 <b>Tus productos</b> (🙈 = oculto)" : "Aún no tienes productos. ¡Crea el primero! 🆕", teclado);
}

async function detalle(ctx: MiContexto, productoId: number, aviso = "") {
  const p = await obtenerProducto(productoId);
  if (!p || p.eliminado) return;
  const cat = await obtenerCategoria(p.categoria_id);
  await mostrar(ctx, [
    aviso,
    `🛍️ <b>${escaparHtml(p.nombre)}</b>${p.activo ? "" : " (oculto)"}`,
    `${formatearPesos(p.precio)} · ${NOMBRES_UNIDAD[p.unidad]} · ${escaparHtml(cat?.nombre)}`,
    `Stock: ${p.stock} · Foto: ${p.foto_file_id ? "sí" : "no"}`,
    p.descripcion ? escaparHtml(p.descripcion) : "",
  ].filter(Boolean).join("\n"), new InlineKeyboard()
    .text("✏️ Nombre", d("e", p.id, "nombre")).text("✏️ Precio", d("e", p.id, "precio")).text("✏️ Categoría", d("e", p.id, "categoria")).row()
    .text("✏️ Unidad", d("e", p.id, "unidad")).text("✏️ Foto", d("e", p.id, "foto")).text("✏️ Descripción", d("e", p.id, "descripcion")).row()
    .text(p.activo ? "👁️ Ocultar" : "👁️ Mostrar", d("vis", p.id)).text("🗑️ Eliminar", d("del", p.id)).row()
    .text("⬅️ Productos", d("l", p.tienda_id, 1)));
}

async function actualizarProducto(productoId: number, cambios: Record<string, unknown>) {
  await db.from("productos").update({ ...cambios, actualizado_en: new Date().toISOString() }).eq("id", productoId);
}

async function eliminar(ctx: MiContexto, productoId: number) {
  const p = await obtenerProducto(productoId);
  if (!p) return;
  await actualizarProducto(p.id, { eliminado: true, activo: false });
  await db.from("carrito_items").delete().eq("producto_id", p.id);
  await db.from("promociones").update({ activa: false }).eq("producto_id", p.id);
  await db.from("avisos_reabastecimiento").delete().eq("producto_id", p.id);
  await avisar(ctx, "🗑️ Producto eliminado");
  await listar(ctx, p.tienda_id, 1);
}

async function manejarProductos(ctx: MiContexto, partes: string[]) {
  const accion = partes[1];
  if (accion === "prem") {
    return void await mostrar(ctx, "😎 ¡Excelente decisión! Habla con el administrador de la plataforma para activarlo. (Aceptamos pago en tintos ☕)");
  }
  // Acciones dentro del flujo de creación
  if (["cat", "ncat", "un", "omf", "omd", "ok"].includes(accion)) {
    if (ctx.estado.flujo !== "crear_producto") return void await avisar(ctx, "Este paso ya venció.");
    if (!await exigir(ctx, ctx.estado.datos.tienda_id, "gestionar_productos")) return;
    if (accion === "cat") return await avanzar(ctx, "precio", { categoria_id: num(partes, 2) });
    if (accion === "ncat") {
      await irAPaso(ctx, "nueva_categoria");
      return void await mostrar(ctx, "📂 Escribe el nombre de la nueva categoría:", tecladoCancelar());
    }
    if (accion === "un") return await avanzar(ctx, "foto", { unidad: partes[2] });
    if (accion === "omf") return await avanzar(ctx, "descripcion", { foto: null });
    if (accion === "omd") return await avanzar(ctx, "stock", { descripcion: null });
    return await guardarNuevo(ctx);
  }

  const esTienda = accion === "menu" || accion === "n" || accion === "l";
  const producto = esTienda ? null : await obtenerProducto(num(partes, 2));
  const tiendaId = esTienda ? num(partes, 2) : producto?.tienda_id ?? 0;
  if (!tiendaId || !await exigir(ctx, tiendaId, "gestionar_productos")) return;

  switch (accion) {
    case "menu": return await menu(ctx, tiendaId);
    case "n": return await iniciarNuevo(ctx, tiendaId);
    case "l": return await listar(ctx, tiendaId, num(partes, 3));
    case "v": return await detalle(ctx, producto!.id);
    case "vis":
      await actualizarProducto(producto!.id, { activo: !producto!.activo });
      return await detalle(ctx, producto!.id, producto!.activo ? "🙈 Producto oculto del catálogo." : "👁️ Producto visible en el catálogo.");
    case "del":
      return void await mostrar(ctx, `🗑️ ¿Seguro que quieres eliminar <b>${escaparHtml(producto!.nombre)}</b>? Se quitará del catálogo y de los carritos.`,
        new InlineKeyboard().text("Sí, eliminar", d("delok", producto!.id)).text("No", d("v", producto!.id)));
    case "delok": return await eliminar(ctx, producto!.id);
    case "e": {
      const campo = partes[3];
      if (campo === "categoria") {
        return void await mostrar(ctx, "📂 Elige la nueva categoría:", (await tecladoCategorias(tiendaId, (id) => d("ec", producto!.id, id))).text("⬅️ Volver", d("v", producto!.id)));
      }
      if (campo === "unidad") return void await mostrar(ctx, "📏 Elige la unidad:", tecladoUnidades((u) => d("eu", producto!.id, u)).text("⬅️ Volver", d("v", producto!.id)));
      await iniciarFlujo(ctx, "editar_producto", campo, { producto_id: producto!.id });
      const preguntas: Record<string, string> = {
        nombre: "✏️ Escribe el nuevo nombre:",
        precio: "💲 Escribe el nuevo precio:",
        foto: "📸 Envía la nueva foto:",
        descripcion: "📝 Escribe la nueva descripción (máx. 300):",
      };
      return void await responder(ctx, preguntas[campo] ?? "✏️ Escribe el nuevo valor:", tecladoCancelar());
    }
    case "ec":
      await actualizarProducto(producto!.id, { categoria_id: num(partes, 3) });
      return await detalle(ctx, producto!.id, "✅ Categoría actualizada.");
    case "eu":
      if (UNIDADES.includes(partes[3])) await actualizarProducto(producto!.id, { unidad: partes[3] });
      return await detalle(ctx, producto!.id, "✅ Unidad actualizada.");
  }
}

async function flujoCrearProducto(ctx: MiContexto) {
  const texto = ctx.message?.text?.trim() ?? "";
  const datos = ctx.estado.datos;
  switch (ctx.estado.paso) {
    case "nombre":
      if (texto.length < 2 || texto.length > 60) return void await responder(ctx, "El nombre debe tener de 2 a 60 caracteres.", tecladoCancelar());
      return await avanzar(ctx, "categoria", { nombre: texto });
    case "nueva_categoria": {
      if (texto.length < 2 || texto.length > 40) return void await responder(ctx, "Escribe un nombre de 2 a 40 caracteres.", tecladoCancelar());
      const { data, error } = await db.from("categorias").insert({ tienda_id: datos.tienda_id, nombre: texto }).select("id").single();
      if (error) return void await responder(ctx, "Ya existe una categoría con ese nombre. Elige otro.", tecladoCancelar());
      return await avanzar(ctx, "precio", { categoria_id: data.id });
    }
    case "precio": {
      const precio = parsearPrecio(texto);
      if (!precio || precio <= 0) return void await responder(ctx, "Escribe un precio válido mayor que cero (ej. 4500).", tecladoCancelar());
      return await avanzar(ctx, "unidad", { precio });
    }
    case "foto": {
      const fotos = ctx.message?.photo;
      if (!fotos?.length) return void await responder(ctx, "Envía una foto o toca «Omitir» 📸");
      return await avanzar(ctx, "descripcion", { foto: fotos[fotos.length - 1].file_id });
    }
    case "descripcion":
      if (!texto || texto.length > 300) return void await responder(ctx, "Máximo 300 caracteres ✂️");
      return await avanzar(ctx, "stock", { descripcion: texto });
    case "stock": {
      const stock = parsearEntero(texto);
      if (stock === null) return void await responder(ctx, "Escribe un número entero (0 o más).", tecladoCancelar());
      return await avanzar(ctx, "resumen", { stock });
    }
    default:
      await responder(ctx, "Usa los botones de arriba para continuar 👆, o escribe /cancelar para salir.");
  }
}

async function flujoEditarProducto(ctx: MiContexto) {
  const texto = ctx.message?.text?.trim() ?? "";
  const productoId = ctx.estado.datos.producto_id as number;
  const p = await obtenerProducto(productoId);
  if (!p || !await exigir(ctx, p.tienda_id, "gestionar_productos")) return void await terminarFlujo(ctx);
  let cambios: Record<string, unknown> | null = null;
  switch (ctx.estado.paso) {
    case "nombre":
      if (texto.length >= 2 && texto.length <= 60) cambios = { nombre: texto };
      break;
    case "precio": {
      const precio = parsearPrecio(texto);
      if (precio && precio > 0) cambios = { precio };
      break;
    }
    case "foto": {
      const fotos = ctx.message?.photo;
      if (fotos?.length) cambios = { foto_file_id: fotos[fotos.length - 1].file_id };
      break;
    }
    case "descripcion":
      if (texto && texto.length <= 300) cambios = { descripcion: texto };
      break;
  }
  if (!cambios) return void await responder(ctx, "Ese valor no es válido 🤔. Intenta de nuevo.", tecladoCancelar());
  await actualizarProducto(productoId, cambios);
  await terminarFlujo(ctx);
  await detalle(ctx, productoId, "✅ ¡Actualizado!");
}

registrarCallback(P.productosAdmin, manejarProductos);
registrarFlujo("crear_producto", flujoCrearProducto);
registrarFlujo("editar_producto", flujoEditarProducto);
