// "📊 Inventario" (también empleados), respuesta de reabastecimiento (RN-10) y "📂 Categorías" de la tienda (RN-07).
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { parsearEntero } from "../logica/calculos.ts";
import { escaparHtml, paginar } from "../logica/formato.ts";
import { fechaHoyBogota, formatearFechaLarga, sumarDiasISO } from "../logica/horarios.ts";
import { agregarPaginacion, TAMANO_PAGINA, tecladoCancelar } from "../menus/comunes.ts";
import { exigir } from "../middleware/rol.ts";
import { obtenerProducto, productosDeTienda } from "../servicios/catalogo.ts";
import { leerConfiguracion } from "../servicios/configuracion.ts";
import { iniciarFlujo, terminarFlujo } from "../servicios/conversacion.ts";
import { ajustarStock } from "../servicios/inventario.ts";
import { avisar, mostrar, responder } from "../ui.ts";

const s = (...partes: (string | number)[]) => armar(P.inventario, ...partes);
const c = (...partes: (string | number)[]) => armar(P.categoriasAdmin, ...partes);

// ---------- Inventario ----------

async function listar(ctx: MiContexto, tiendaId: number, pagina: number) {
  if (!await exigir(ctx, tiendaId, "actualizar_stock")) return;
  const config = await leerConfiguracion();
  const pag = paginar(await productosDeTienda(tiendaId), pagina, TAMANO_PAGINA);
  const teclado = new InlineKeyboard();
  for (const p of pag.items) {
    const icono = p.stock === 0 ? "⛔ " : p.stock <= config.umbral_stock_bajo ? "⚠️ " : "";
    teclado.text(`${icono}${p.activo ? "" : "🙈 "}${p.nombre} — stock ${p.stock}`, s("p", p.id)).row();
  }
  agregarPaginacion(teclado, pag, (n) => s("l", tiendaId, n));
  teclado.text("⬅️ Volver", armar(P.menu, "t", tiendaId));
  await mostrar(ctx, "📊 <b>Inventario</b>\n⛔ agotado · ⚠️ stock bajo · 🙈 oculto", teclado);
}

async function detalle(ctx: MiContexto, productoId: number, aviso = "") {
  const p = await obtenerProducto(productoId);
  if (!p || p.eliminado || !await exigir(ctx, p.tienda_id, "actualizar_stock")) return;
  await mostrar(ctx, [
    aviso,
    `📦 <b>${escaparHtml(p.nombre)}</b>`,
    `Stock: <b>${p.stock}</b> · ${p.activo ? "👁️ Visible" : "🙈 Oculto"}`,
    p.stock === 0 && p.fecha_reabastecimiento ? `Vuelve aprox. el ${formatearFechaLarga(p.fecha_reabastecimiento)}` : "",
  ].filter(Boolean).join("\n"), new InlineKeyboard()
    .text("✏️ Cambiar stock", s("cs", p.id)).text(p.activo ? "👁️ Ocultar" : "👁️ Mostrar", s("vis", p.id)).row()
    .text("⬅️ Inventario", s("l", p.tienda_id, 1)));
}

async function manejarInventario(ctx: MiContexto, partes: string[]) {
  const accion = partes[1];
  if (accion === "l") return await listar(ctx, num(partes, 2), num(partes, 3));
  const p = await obtenerProducto(num(partes, 2));
  if (!p || !await exigir(ctx, p.tienda_id, "actualizar_stock")) return;
  if (accion === "p") return await detalle(ctx, p.id);
  if (accion === "vis") {
    await db.from("productos").update({ activo: !p.activo, actualizado_en: new Date().toISOString() }).eq("id", p.id);
    return await detalle(ctx, p.id, p.activo ? "🙈 Oculto del catálogo." : "👁️ Visible en el catálogo.");
  }
  if (accion === "cs") {
    await iniciarFlujo(ctx, "cambiar_stock", "cantidad", { producto_id: p.id });
    await responder(ctx, `✏️ ¿Cuántas unidades de <b>${escaparHtml(p.nombre)}</b> hay ahora? (stock actual: ${p.stock})`, tecladoCancelar());
  }
}

async function flujoCambiarStock(ctx: MiContexto) {
  const cantidad = parsearEntero(ctx.message?.text ?? "");
  if (cantidad === null) return void await responder(ctx, "Escribe un número entero (0 o más).", tecladoCancelar());
  const productoId = ctx.estado.datos.producto_id as number;
  const p = await obtenerProducto(productoId);
  await terminarFlujo(ctx);
  if (!p || !await exigir(ctx, p.tienda_id, "actualizar_stock")) return;
  const r = await ajustarStock(productoId, cantidad);
  await detalle(ctx, productoId, `✅ Stock actualizado: ${r.antes} → ${r.despues}`);
}

// Respuesta a "¿Cuándo vuelves a tener?" → fecha_reabastecimiento (RN-10)
async function manejarReabastecimiento(ctx: MiContexto, partes: string[]) {
  const p = await obtenerProducto(num(partes, 1));
  if (!p || !await exigir(ctx, p.tienda_id, "gestionar_productos")) return;
  const dias = num(partes, 2);
  const fecha = dias > 0 ? sumarDiasISO(fechaHoyBogota(), dias) : null;
  await db.from("productos").update({ fecha_reabastecimiento: fecha }).eq("id", p.id).eq("stock", 0);
  await mostrar(ctx, fecha
    ? `✅ Anotado: ${escaparHtml(p.nombre)} vuelve aprox. el ${formatearFechaLarga(fecha)}.`
    : `✅ Anotado. Tus clientes verán ${escaparHtml(p.nombre)} como «Agotado».`);
}

// ---------- Categorías ----------

async function listarCategorias(ctx: MiContexto, tiendaId: number) {
  if (!await exigir(ctx, tiendaId, "gestionar_productos")) return;
  const [{ data: cats }, { data: ocultas }] = await Promise.all([
    db.from("categorias").select("*").or(`tienda_id.is.null,tienda_id.eq.${tiendaId}`).order("nombre"),
    db.from("categorias_ocultas").select("categoria_id").eq("tienda_id", tiendaId),
  ]);
  const idsOcultas = new Set((ocultas ?? []).map((o) => o.categoria_id));
  const teclado = new InlineKeyboard();
  const lineas = ["📂 <b>Categorías</b>", "", "<b>Comunes</b>"];
  for (const cat of (cats ?? []).filter((x) => x.tienda_id === null)) {
    const oculta = idsOcultas.has(cat.id);
    lineas.push(`${oculta ? "🙈" : "✅"} ${escaparHtml(cat.nombre)}`);
    teclado.text(`${oculta ? "Mostrar" : "Ocultar"} ${cat.nombre}`, c("oc", tiendaId, cat.id)).row();
  }
  const propias = (cats ?? []).filter((x) => x.tienda_id !== null);
  if (propias.length) lineas.push("", "<b>Propias</b>");
  for (const cat of propias) {
    lineas.push(`${cat.activa ? "✅" : "🚫"} ${escaparHtml(cat.nombre)}`);
    teclado.text(`✏️ ${cat.nombre}`, c("ren", tiendaId, cat.id)).text(cat.activa ? "Desactivar" : "Activar", c("des", tiendaId, cat.id)).row();
  }
  teclado.text("➕ Nueva categoría", c("n", tiendaId)).row().text("⬅️ Productos", armar(P.productosAdmin, "menu", tiendaId));
  await mostrar(ctx, lineas.join("\n"), teclado);
}

async function manejarCategorias(ctx: MiContexto, partes: string[]) {
  const tiendaId = num(partes, 2);
  const categoriaId = num(partes, 3);
  if (!await exigir(ctx, tiendaId, "gestionar_productos")) return;
  switch (partes[1]) {
    case "l": return await listarCategorias(ctx, tiendaId);
    case "oc": {
      const { data } = await db.from("categorias_ocultas").select("categoria_id").eq("tienda_id", tiendaId).eq("categoria_id", categoriaId).maybeSingle();
      if (data) await db.from("categorias_ocultas").delete().eq("tienda_id", tiendaId).eq("categoria_id", categoriaId);
      else await db.from("categorias_ocultas").insert({ tienda_id: tiendaId, categoria_id: categoriaId });
      return await listarCategorias(ctx, tiendaId);
    }
    case "des": {
      const { data } = await db.from("categorias").select("activa").eq("id", categoriaId).eq("tienda_id", tiendaId).maybeSingle();
      if (data) await db.from("categorias").update({ activa: !data.activa }).eq("id", categoriaId).eq("tienda_id", tiendaId);
      return await listarCategorias(ctx, tiendaId);
    }
    case "ren":
      await iniciarFlujo(ctx, "categoria", "renombrar", { tienda_id: tiendaId, categoria_id: categoriaId });
      return void await responder(ctx, "✏️ Escribe el nuevo nombre de la categoría:", tecladoCancelar());
    case "n":
      await iniciarFlujo(ctx, "categoria", "nueva", { tienda_id: tiendaId });
      return void await responder(ctx, "📂 Escribe el nombre de la nueva categoría:", tecladoCancelar());
  }
}

async function flujoCategoria(ctx: MiContexto) {
  const texto = ctx.message?.text?.trim() ?? "";
  const { tienda_id, categoria_id } = ctx.estado.datos;
  if (texto.length < 2 || texto.length > 40) return void await responder(ctx, "Escribe un nombre de 2 a 40 caracteres.", tecladoCancelar());
  if (!await exigir(ctx, tienda_id, "gestionar_productos")) return void await terminarFlujo(ctx);
  const { error } = ctx.estado.paso === "renombrar"
    ? await db.from("categorias").update({ nombre: texto }).eq("id", categoria_id).eq("tienda_id", tienda_id)
    : await db.from("categorias").insert({ tienda_id, nombre: texto });
  if (error) return void await responder(ctx, "Ya existe una categoría con ese nombre. Prueba otro.", tecladoCancelar());
  await terminarFlujo(ctx);
  await avisar(ctx, "✅ Listo");
  await listarCategorias(ctx, tienda_id);
}

registrarCallback(P.inventario, manejarInventario);
registrarCallback(P.reabastecer, manejarReabastecimiento);
registrarCallback(P.categoriasAdmin, manejarCategorias);
registrarFlujo("cambiar_stock", flujoCambiarStock);
registrarFlujo("categoria", flujoCategoria);
