// Preparación, asignación de domiciliario, despacho y cancelación por la tienda (11.9 y 11.10).
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { armar, P } from "../datos_callback.ts";
import { formatearPesos, numeroPedido } from "../logica/calculos.ts";
import { generarCodigoEntrega } from "../logica/codigo_entrega.ts";
import { CANCELABLES_TIENDA, tiendaPuedeCancelar } from "../logica/estados.ts";
import { escaparHtml } from "../logica/formato.ts";
import { textoPedido } from "../menus/tarjeta_pedido.ts";
import { enPruebasEn } from "../middleware/rol.ts";
import { avisarProductosRepuestos } from "../servicios/inventario.ts";
import { cerrarMensajes, notificarCliente, notificarDomiciliario } from "../servicios/notificaciones.ts";
import { cambiarEstado, cancelarPedido, domiciliariosActivos, type PedidoDetalle } from "../servicios/pedidos.ts";
import { avisar, mostrar } from "../ui.ts";
import { cargarConPermiso, mensajeActual, mostrarTarjeta, nombreActor } from "./pedidos_comun.ts";

const d = (...partes: (string | number)[]) => armar(P.pedidoTienda, ...partes);

export async function marcarListo(ctx: MiContexto, pedidoId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "gestionar_pedidos");
  if (!c) return;
  const { p } = c;
  const codigo = p.modalidad === "recogida" ? generarCodigoEntrega() : null;
  const ok = await cambiarEstado(p.id, ["en_preparacion"], "listo", ctx.from!.id, codigo ? { codigo_entrega: codigo } : {});
  if (!ok) {
    await avisar(ctx, "Este pedido ya no está en preparación.");
    await mostrarTarjeta(ctx, p.id);
    return;
  }
  await cerrarMensajes(p.id, `${textoPedido(p)}\n\n📦 Marcado listo por ${escaparHtml(nombreActor(ctx))}`,
    { tipos: ["seguimiento"], excepto: mensajeActual(ctx) });
  if (codigo) {
    await notificarCliente(p,
      `📦 Tu pedido ${numeroPedido(p.id)} está listo para recoger en ${escaparHtml(p.tienda.direccion)}.\n🔑 Tu código es <b>${codigo}</b>. Dilo en el mostrador.`);
  }
  await mostrarTarjeta(ctx, p.id, "📦 ¡Pedido listo!");
}

export async function elegirDomiciliario(ctx: MiContexto, pedidoId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "asignar_domiciliario");
  if (!c) return;
  const { p } = c;
  if (p.estado !== "listo" || p.modalidad !== "domicilio") {
    await avisar(ctx, "Solo se asignan pedidos a domicilio que estén listos.");
    return;
  }
  const teclado = new InlineKeyboard();
  for (const dom of await domiciliariosActivos(p.tienda_id)) {
    const marca = dom.telegram_id === p.domiciliario_telegram_id ? " ✅" : "";
    teclado.text(`🛵 ${dom.nombre}${marca}`, d("asd", p.id, dom.telegram_id)).row();
  }
  if (enPruebasEn(ctx, p.tienda_id)) teclado.text("🧪 Yo (modo pruebas)", d("asd", p.id, ctx.from!.id)).row();
  teclado.text("⬅️ Volver", d("ver", p.id));
  await mostrar(ctx, `${textoPedido(p)}\n\n🛵 ¿Quién lleva este pedido?`, teclado);
}

export async function asignarDomiciliario(ctx: MiContexto, pedidoId: number, domiciliarioId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "asignar_domiciliario");
  if (!c) return;
  const { p } = c;
  const lista = await domiciliariosActivos(p.tienda_id);
  const valido = lista.find((x) => x.telegram_id === domiciliarioId) ??
    (enPruebasEn(ctx, p.tienda_id) && domiciliarioId === ctx.from!.id ? { telegram_id: domiciliarioId, nombre: nombreActor(ctx) } : null);
  if (!valido) {
    await avisar(ctx, "Esa persona ya no es domiciliario de la tienda.");
    return;
  }
  const anterior = p.domiciliario_telegram_id;
  const ok = await cambiarEstado(p.id, ["listo"], "listo", ctx.from!.id, { domiciliario_telegram_id: domiciliarioId });
  if (!ok) {
    await avisar(ctx, "Este pedido ya no está listo para asignar.");
    return;
  }
  if (anterior && anterior !== domiciliarioId) {
    await cerrarMensajes(p.id, `🔄 El pedido ${numeroPedido(p.id)} fue reasignado a otra persona.`, { tipos: ["asignacion"] });
  }
  const cobro = p.medio_pago === "contra_entrega" && !p.pago_confirmado
    ? `💵 Cobrar al entregar: <b>${formatearPesos(p.total)}</b>`
    : "✅ Ya pagado";
  const texto = [
    `🛵 Te asignaron el pedido ${numeroPedido(p.id)} – ${escaparHtml(p.tienda.nombre)}`,
    `📍 ${escaparHtml(p.direccion)}, ${escaparHtml(p.barrio_nombre)}`,
    `👤 ${escaparHtml(p.nombre_cliente)} · 📱 ${escaparHtml(p.telefono_cliente)}`,
    cobro,
  ].join("\n");
  await notificarDomiciliario(p, domiciliarioId, texto,
    new InlineKeyboard().text("🛵 Salí con el pedido", armar(P.entrega, "sal", p.id)), "asignacion");
  await mostrarTarjeta(ctx, p.id, `🛵 Asignado a ${escaparHtml(valido.nombre)}.`);
}

// Pasa a despachado y envía el código al cliente. Lo usan el personal y el domiciliario.
export async function despachar(ctx: MiContexto, p: PedidoDetalle): Promise<boolean> {
  const codigo = generarCodigoEntrega();
  const ok = await cambiarEstado(p.id, ["listo"], "despachado", ctx.from!.id, { codigo_entrega: codigo });
  if (!ok) {
    await avisar(ctx, "Este pedido ya no está listo para despachar.");
    return false;
  }
  await notificarCliente(p,
    `🛵 ¡Tu pedido ${numeroPedido(p.id)} va en camino!\n🔑 Tu código de entrega es <b>${codigo}</b>. Dáselo a quien te entregue el pedido.`);
  await cerrarMensajes(p.id, `${textoPedido(p)}\n\n🛵 Despachado por ${escaparHtml(nombreActor(ctx))}`,
    { tipos: ["seguimiento", "asignacion"], excepto: mensajeActual(ctx) });
  return true;
}

export async function despacharSinDomiciliario(ctx: MiContexto, pedidoId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "gestionar_pedidos");
  if (!c) return;
  if (c.p.domiciliario_telegram_id) {
    await avisar(ctx, "Este pedido tiene domiciliario: solo él puede marcarlo despachado.", true);
    return;
  }
  if (await despachar(ctx, c.p)) await mostrarTarjeta(ctx, pedidoId, "🛵 ¡Pedido en camino!");
}

export const MOTIVOS_CANCELACION: Record<string, string> = {
  "1": "Producto dañado o faltante",
  "2": "Sin domiciliario disponible",
};

export async function preguntarMotivoCancelacion(ctx: MiContexto, pedidoId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "cancelar_pedido_aceptado");
  if (!c) return;
  if (!tiendaPuedeCancelar(c.p.estado)) {
    await avisar(ctx, "Este pedido ya no se puede cancelar.", true);
    return;
  }
  await mostrar(ctx, `${textoPedido(c.p)}\n\n❌ ¿Por qué cancelas el pedido?`, new InlineKeyboard()
    .text(MOTIVOS_CANCELACION["1"], d("cm", pedidoId, 1)).row()
    .text(MOTIVOS_CANCELACION["2"], d("cm", pedidoId, 2)).row()
    .text("Otro", d("cm", pedidoId, 3)).row()
    .text("⬅️ Volver", d("ver", pedidoId)));
}

export async function cancelarPorTienda(ctx: MiContexto, pedidoId: number, detalle: string) {
  const c = await cargarConPermiso(ctx, pedidoId, "cancelar_pedido_aceptado");
  if (!c) return;
  const { p } = c;
  const r = await cancelarPedido(p.id, CANCELABLES_TIENDA, "cancelado_por_tienda", detalle, ctx.from!.id);
  if (!r.cancelado) {
    await avisar(ctx, "Este pedido ya no se puede cancelar.", true);
    return;
  }
  await notificarCliente(p, `😔 ${escaparHtml(p.tienda.nombre)} canceló tu pedido ${numeroPedido(p.id)}. Motivo: ${escaparHtml(detalle)}.` +
    (r.habia_pago ? "\n💸 La tienda se comunicará contigo para el reembolso." : ""));
  await cerrarMensajes(p.id, `❌ Pedido ${numeroPedido(p.id)} cancelado por ${escaparHtml(nombreActor(ctx))} (${escaparHtml(detalle)}).`);
  await avisarProductosRepuestos(r.repuestos ?? []);
  await mostrar(ctx, `❌ Cancelaste el pedido ${numeroPedido(p.id)}. Le avisamos al cliente.${r.habia_pago ? "\n💸 Ya había pagado: comunícate con el cliente para el reembolso." : ""}`,
    new InlineKeyboard().text("📋 Pedidos pendientes", armar("pl", "pend", p.tienda_id, 1)));
}
