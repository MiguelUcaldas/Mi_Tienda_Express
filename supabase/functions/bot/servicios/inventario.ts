// Agotados y reabastecimiento (RN-10 y RN-11).
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import { armar, P } from "../datos_callback.ts";
import { escaparHtml } from "../logica/formato.ts";
import { obtenerProducto } from "./catalogo.ts";
import { notificarTienda } from "./notificaciones.ts";
import { enviarTexto } from "./telegram.ts";
import { obtenerTienda } from "./tiendas.ts";

// Pregunta a dueño y administradores cuándo vuelve el producto
export async function preguntarReabastecimiento(productoId: number) {
  const producto = await obtenerProducto(productoId);
  if (!producto || producto.eliminado) return;
  const tienda = await obtenerTienda(producto.tienda_id);
  const teclado = new InlineKeyboard()
    .text("Mañana", armar(P.reabastecer, productoId, 1)).text("En 2-3 días", armar(P.reabastecer, productoId, 3)).row()
    .text("Esta semana", armar(P.reabastecer, productoId, 7)).text("No sé aún", armar(P.reabastecer, productoId, 0));
  await notificarTienda(producto.tienda_id, "agotado",
    `⚠️ Se agotó <b>${escaparHtml(producto.nombre)}</b> en ${escaparHtml(tienda?.nombre)}. ¿Cuándo vuelves a tener?`,
    { teclado });
}

// Avisa a los clientes suscritos que el producto volvió y borra los avisos
export async function avisarProductosRepuestos(productoIds: number[]) {
  for (const id of productoIds) {
    const producto = await obtenerProducto(id);
    if (!producto || producto.eliminado) continue;
    const tienda = await obtenerTienda(producto.tienda_id);
    const { data } = await db.from("avisos_reabastecimiento").select("telegram_id").eq("producto_id", id);
    for (const aviso of data ?? []) {
      await enviarTexto(aviso.telegram_id,
        `🔔 ¡Volvió <b>${escaparHtml(producto.nombre)}</b> a ${escaparHtml(tienda?.nombre)}!`,
        new InlineKeyboard().text("Ver producto", armar(P.producto, id)));
    }
    await db.from("avisos_reabastecimiento").delete().eq("producto_id", id);
    await db.from("productos").update({ fecha_reabastecimiento: null }).eq("id", id);
  }
}

// Ajuste manual de stock con sus efectos (RN-10 y RN-11)
export async function ajustarStock(productoId: number, nuevoStock: number): Promise<{ antes: number; despues: number }> {
  const { data, error } = await db.rpc("ajustar_stock", { p_producto: productoId, p_nuevo_stock: nuevoStock });
  if (error) throw new Error(`ajustar_stock: ${error.message}`);
  const resultado = data as { antes: number; despues: number };
  if (resultado.antes > 0 && resultado.despues === 0) await preguntarReabastecimiento(productoId);
  if (resultado.antes === 0 && resultado.despues > 0) await avisarProductosRepuestos([productoId]);
  return resultado;
}
