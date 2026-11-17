// Utilidades compartidas por los flujos de pedidos de la tienda, el cliente y el domiciliario.
import type { MiContexto } from "../contexto.ts";
import { esFinal } from "../logica/estados.ts";
import { nombreCompleto } from "../logica/formato.ts";
import type { Accion, Rol } from "../logica/permisos.ts";
import { tecladoTarjeta, textoTarjeta } from "../menus/tarjeta_pedido.ts";
import { enPruebasEn, exigirEnPedidos, rolParaPedidos } from "../middleware/rol.ts";
import { infoTarjeta } from "../servicios/avisos_pedido.ts";
import { guardarMensajeActual } from "../servicios/notificaciones.ts";
import { obtenerPedido, type PedidoDetalle } from "../servicios/pedidos.ts";
import { avisar, mostrar } from "../ui.ts";

export function nombreActor(ctx: MiContexto): string {
  return nombreCompleto(ctx.from?.first_name, ctx.from?.last_name) || "Alguien";
}

// Mensaje donde se tocó el botón (para no cerrarlo junto con los de los demás)
export function mensajeActual(ctx: MiContexto): { chat_id: number; message_id: number } | undefined {
  const m = ctx.callbackQuery?.message;
  return m ? { chat_id: m.chat.id, message_id: m.message_id } : undefined;
}

function mensajeActualEsFoto(ctx: MiContexto): boolean {
  const m = ctx.callbackQuery?.message;
  return !!m && "photo" in m && !!m.photo;
}

// Carga el pedido y valida el permiso (con la vista tienda del modo pruebas)
export async function cargarConPermiso(
  ctx: MiContexto,
  pedidoId: number,
  accion: Accion,
): Promise<{ p: PedidoDetalle; rol: Rol } | null> {
  const p = await obtenerPedido(pedidoId);
  if (!p) {
    await avisar(ctx, "No encontré ese pedido 🤔");
    return null;
  }
  const rol = await exigirEnPedidos(ctx, p.tienda_id, accion);
  if (!rol) return null;
  return { p, rol };
}

// Muestra la tarjeta del pedido en el mensaje actual y lo deja guardado como seguimiento
export async function mostrarTarjeta(ctx: MiContexto, pedidoId: number, encabezado = "", conVolver = false) {
  const p = await obtenerPedido(pedidoId);
  if (!p) return;
  const rol = await rolParaPedidos(ctx, p.tienda_id);
  const info = await infoTarjeta(p, ctx.from!.id, rol, enPruebasEn(ctx, p.tienda_id), conVolver);
  await mostrar(ctx, `${encabezado ? `${encabezado}\n\n` : ""}${textoTarjeta(p, info)}`, tecladoTarjeta(p, info));
  const actual = mensajeActual(ctx);
  if (actual && !mensajeActualEsFoto(ctx) && !esFinal(p.estado)) {
    await guardarMensajeActual(p.id, actual.chat_id, actual.message_id, false, "seguimiento");
  }
}
