// Catálogo del cliente (11.3): categorías, lista, detalle con cantidad, búsqueda, ofertas y "Avísame".
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, NADA, num, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { formatearPesos } from "../logica/calculos.ts";
import { escaparHtml, NOMBRES_UNIDAD, paginar } from "../logica/formato.ts";
import { formatearFechaLarga } from "../logica/horarios.ts";
import { porcentajeDescuento } from "../logica/promociones.ts";
import { agregarPaginacion, TAMANO_PAGINA, tecladoCancelar } from "../menus/comunes.ts";
import { agregarAlCarrito } from "../servicios/carrito.ts";
import {
  buscarProductos,
  categoriasConProductos,
  obtenerCategoria,
  productoConPrecio,
  type ProductoConPrecio,
  productosEnOferta,
  productosVisibles,
} from "../servicios/catalogo.ts";
import { fijarTiendaActiva, iniciarFlujo, terminarFlujo } from "../servicios/conversacion.ts";
import { obtenerTienda } from "../servicios/tiendas.ts";
import { avisar, banner, mostrar, responder } from "../ui.ts";

export function etiquetaProducto(p: ProductoConPrecio): string {
  if (p.stock <= 0) return `${p.nombre} (Agotado)`;
  return `${p.promocion ? "🔥 " : ""}${p.nombre} — ${formatearPesos(p.precioFinal)}`;
}

export function lineaPrecio(p: ProductoConPrecio): string {
  if (!p.promocion) return `💲 <b>${formatearPesos(p.precio)}</b>`;
  const descuento = porcentajeDescuento(p.precio, p.precioFinal);
  return `🔥 <s>${formatearPesos(p.precio)}</s> → <b>${formatearPesos(p.precioFinal)}</b> (‑${descuento}% hasta el ${formatearFechaLarga(p.promocion.termina_en)})`;
}

// Lista de productos con un botón por producto y paginación
async function mostrarLista(
  ctx: MiContexto,
  titulo: string,
  productos: ProductoConPrecio[],
  pagina: number,
  datoPagina: ((p: number) => string) | null,
  tiendaId: number,
) {
  const pag = datoPagina ? paginar(productos, pagina, TAMANO_PAGINA) : { items: productos, pagina: 1, totalPaginas: 1 };
  const teclado = new InlineKeyboard();
  for (const p of pag.items) teclado.text(etiquetaProducto(p), armar(P.producto, p.id)).row();
  if (datoPagina) agregarPaginacion(teclado, pag, datoPagina);
  teclado.text("🛒 Mi carrito", armar(P.carrito, "v", tiendaId)).text("⬅️ Volver", armar(P.menu, "t", tiendaId));
  await mostrar(ctx, titulo, teclado);
}

async function manejarCategorias(ctx: MiContexto, partes: string[]) {
  const accion = partes[1];
  const tiendaId = num(partes, 2);
  if (accion === "l") {
    const categorias = await categoriasConProductos(tiendaId);
    const teclado = new InlineKeyboard();
    categorias.forEach(({ categoria, cantidad }, i) => {
      teclado.text(`${categoria.nombre} (${cantidad})`, armar(P.categoria, "p", tiendaId, categoria.id, 1));
      if (i % 2 === 1) teclado.row();
    });
    teclado.row().text("⬅️ Volver", armar(P.menu, "t", tiendaId));
    await mostrar(ctx, categorias.length ? "📂 <b>Categorías</b>\nElige una:" : "Esta tienda aún no tiene productos 🙈", teclado);
    return;
  }
  if (accion === "p") {
    const categoriaId = num(partes, 3);
    const [categoria, productos] = await Promise.all([obtenerCategoria(categoriaId), productosVisibles(tiendaId, categoriaId)]);
    await mostrarLista(ctx, `📂 <b>${escaparHtml(categoria?.nombre ?? "Productos")}</b>`, productos, num(partes, 4),
      (p) => armar(P.categoria, "p", tiendaId, categoriaId, p), tiendaId);
  }
}

async function avisoPedido(tiendaId: number, productoId: number, telegramId: number): Promise<boolean> {
  const { count } = await db.from("avisos_reabastecimiento").select("producto_id", { count: "exact", head: true })
    .eq("producto_id", productoId).eq("telegram_id", telegramId);
  return (count ?? 0) > 0 && tiendaId > 0;
}

export async function mostrarDetalle(ctx: MiContexto, p: ProductoConPrecio, cantidad: number) {
  const agotado = p.stock <= 0;
  const lineas = [
    `🛍️ <b>${escaparHtml(p.nombre)}</b>`,
    lineaPrecio(p),
    agotado
      ? (p.fecha_reabastecimiento ? `⛔ Agotado – vuelve aprox. el ${formatearFechaLarga(p.fecha_reabastecimiento)}` : "⛔ Agotado")
      : `${NOMBRES_UNIDAD[p.unidad] ?? p.unidad} · Disponibles: ${p.stock}`,
    p.descripcion ? escaparHtml(p.descripcion) : "",
  ].filter(Boolean);
  const teclado = new InlineKeyboard();
  if (agotado) {
    if (await avisoPedido(p.tienda_id, p.id, ctx.from!.id)) teclado.text("🔔 Ya te avisaremos", NADA).row();
    else teclado.text("🔔 Avísame cuando llegue", armar(P.avisame, p.id)).row();
  } else {
    const c = Math.min(Math.max(1, cantidad), p.stock);
    teclado
      .text("➖", armar(P.cantidad, p.id, Math.max(1, c - 1)))
      .text(String(c), NADA)
      .text("➕", armar(P.cantidad, p.id, Math.min(p.stock, c + 1))).row()
      .text("🛒 Agregar al carrito", armar(P.agregar, p.id, c)).row();
  }
  teclado.text("⬅️ Volver", armar(P.categoria, "p", p.tienda_id, p.categoria_id, 1));
  const texto = lineas.join("\n");

  if (!p.foto_file_id) {
    await mostrar(ctx, texto, teclado);
    return;
  }
  const mensaje = ctx.callbackQuery?.message;
  if (mensaje && "photo" in mensaje && mensaje.photo) {
    try {
      await ctx.editMessageCaption({ caption: banner(ctx) + texto, parse_mode: "HTML", reply_markup: teclado });
    } catch (_) {
      // Sin cambios
    }
    return;
  }
  await ctx.replyWithPhoto(p.foto_file_id, { caption: banner(ctx) + texto, parse_mode: "HTML", reply_markup: teclado });
}

async function manejarProducto(ctx: MiContexto, partes: string[]) {
  const p = await productoConPrecio(num(partes, 1));
  if (!p || p.eliminado || !p.activo) {
    await avisar(ctx, "Este producto ya no está disponible 😕");
    return;
  }
  await fijarTiendaActiva(ctx, p.tienda_id);
  await mostrarDetalle(ctx, p, partes[0] === P.cantidad ? num(partes, 2) : 1);
}

async function manejarAgregar(ctx: MiContexto, partes: string[]) {
  const p = await productoConPrecio(num(partes, 1));
  if (!p || p.eliminado || !p.activo || p.stock <= 0) {
    await avisar(ctx, "⛔ Este producto está agotado.", true);
    return;
  }
  const { final, limitado } = await agregarAlCarrito(p.tienda_id, ctx.from!.id, p, Math.max(1, num(partes, 2)));
  await avisar(ctx, limitado
    ? `Solo hay ${p.stock} disponibles. Tienes ${final} en el carrito 🛒`
    : `🛒 ¡Listo! Tienes ${final} × ${p.nombre} en el carrito.`);
}

async function manejarAvisame(ctx: MiContexto, partes: string[]) {
  const p = await productoConPrecio(num(partes, 1));
  if (!p) return;
  await db.from("avisos_reabastecimiento").upsert({ producto_id: p.id, telegram_id: ctx.from!.id });
  await avisar(ctx, "🔔 ¡Hecho! Te aviso cuando vuelva.");
  await mostrarDetalle(ctx, p, 1);
}

async function manejarOfertas(ctx: MiContexto, partes: string[]) {
  const tiendaId = num(partes, 1);
  const productos = await productosEnOferta(tiendaId);
  if (productos.length === 0) {
    await mostrar(ctx, "Por ahora no hay ofertas en esta tienda. ¡Vuelve pronto! 🔥",
      new InlineKeyboard().text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
    return;
  }
  await mostrarLista(ctx, "🔥 <b>Ofertas vigentes</b>", productos, num(partes, 2), (p) => armar(P.ofertas, tiendaId, p), tiendaId);
}

async function manejarBuscarProducto(ctx: MiContexto, partes: string[]) {
  const tiendaId = num(partes, 1);
  await fijarTiendaActiva(ctx, tiendaId);
  await iniciarFlujo(ctx, "buscar_producto", "texto", { tienda_id: tiendaId });
  await mostrar(ctx, "🔍 ¿Qué producto buscas? Escríbelo:", tecladoCancelar());
}

async function flujoBuscarProducto(ctx: MiContexto) {
  const texto = ctx.message?.text?.trim();
  const tiendaId = ctx.estado.datos.tienda_id as number;
  if (!texto) {
    await responder(ctx, "Escríbeme el nombre del producto 🙂", tecladoCancelar());
    return;
  }
  await terminarFlujo(ctx);
  const [tienda, productos] = await Promise.all([obtenerTienda(tiendaId), buscarProductos(tiendaId, texto)]);
  if (productos.length === 0) {
    await responder(ctx, `No encontré «${escaparHtml(texto)}» en ${escaparHtml(tienda?.nombre ?? "la tienda")}. Prueba con otra palabra.`,
      new InlineKeyboard().text("🔍 Buscar otra vez", armar("bp", tiendaId)).row().text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
    return;
  }
  await mostrarLista(ctx, `🔍 Resultados para «${escaparHtml(texto)}»`, productos, 1, null, tiendaId);
}

registrarCallback(P.categoria, manejarCategorias);
registrarCallback(P.producto, manejarProducto);
registrarCallback(P.cantidad, manejarProducto);
registrarCallback(P.agregar, manejarAgregar);
registrarCallback(P.avisame, manejarAvisame);
registrarCallback(P.ofertas, manejarOfertas);
registrarCallback("bp", manejarBuscarProducto);
registrarFlujo("buscar_producto", flujoBuscarProducto);
