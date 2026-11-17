// Carrito del cliente (11.4).
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { formatearPesos } from "../logica/calculos.ts";
import { escaparHtml } from "../logica/formato.ts";
import { cantidadEnCarrito, fijarCantidad, type ItemCarrito, itemsCarrito, vaciarCarrito } from "../servicios/carrito.ts";
import { obtenerProducto } from "../servicios/catalogo.ts";
import { fijarTiendaActiva } from "../servicios/conversacion.ts";
import { obtenerTienda } from "../servicios/tiendas.ts";
import { avisar, mostrar } from "../ui.ts";

export function lineasItems(items: ItemCarrito[]): string[] {
  return items.map((i) => `• ${i.cantidad} × ${escaparHtml(i.producto.nombre)} — ${formatearPesos(i.producto.precioFinal * i.cantidad)}`);
}

export function subtotalItems(items: ItemCarrito[]): number {
  return items.reduce((s, i) => s + i.producto.precioFinal * i.cantidad, 0);
}

function corto(nombre: string): string {
  return nombre.length > 12 ? `${nombre.slice(0, 11)}…` : nombre;
}

export async function mostrarCarrito(ctx: MiContexto, tiendaId: number) {
  await fijarTiendaActiva(ctx, tiendaId);
  const [tienda, items] = await Promise.all([obtenerTienda(tiendaId), itemsCarrito(tiendaId, ctx.from!.id)]);
  const nombre = escaparHtml(tienda?.nombre ?? "la tienda");
  if (items.length === 0) {
    await mostrar(ctx, `🛒 Tu carrito en ${nombre} está vacío.\n¡Date una vuelta por las categorías!`,
      new InlineKeyboard()
        .text("📂 Categorías", armar(P.categoria, "l", tiendaId)).row()
        .text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
    return;
  }
  const texto = [
    `🛒 <b>Tu carrito en ${nombre}</b>`,
    ...lineasItems(items),
    `Subtotal: <b>${formatearPesos(subtotalItems(items))}</b>`,
  ].join("\n");
  const teclado = new InlineKeyboard();
  for (const i of items) {
    const n = corto(i.producto.nombre);
    teclado
      .text(`➖ ${n}`, armar(P.carrito, "m", i.producto.id))
      .text(`➕ ${n}`, armar(P.carrito, "s", i.producto.id))
      .text(`🗑️ ${n}`, armar(P.carrito, "q", i.producto.id)).row();
  }
  teclado.text("🗑️ Vaciar carrito", armar(P.carrito, "vac", tiendaId)).row()
    .text("✅ Hacer pedido", armar(P.checkout, "ini", tiendaId))
    .text("⬅️ Seguir comprando", armar(P.menu, "t", tiendaId));
  await mostrar(ctx, texto, teclado);
}

async function manejarCarrito(ctx: MiContexto, partes: string[]) {
  const accion = partes[1];
  if (accion === "v") {
    await mostrarCarrito(ctx, num(partes, 2));
    return;
  }
  if (accion === "vac") {
    const tiendaId = num(partes, 2);
    await vaciarCarrito(tiendaId, ctx.from!.id);
    await avisar(ctx, "🗑️ Carrito vacío");
    await mostrarCarrito(ctx, tiendaId);
    return;
  }
  const producto = await obtenerProducto(num(partes, 2));
  if (!producto) return;
  const actual = await cantidadEnCarrito(producto.tienda_id, ctx.from!.id, producto.id);
  if (accion === "m") await fijarCantidad(producto.tienda_id, ctx.from!.id, producto, actual - 1);
  if (accion === "q") await fijarCantidad(producto.tienda_id, ctx.from!.id, producto, 0);
  if (accion === "s") {
    if (actual >= producto.stock) {
      await avisar(ctx, `Solo hay ${producto.stock} disponibles 😅`);
    } else {
      await fijarCantidad(producto.tienda_id, ctx.from!.id, producto, actual + 1);
    }
  }
  await mostrarCarrito(ctx, producto.tienda_id);
}

registrarCallback(P.carrito, manejarCarrito);
