// Pago por transferencia (11.8): comprobante del cliente y verificación de la tienda.
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { formatearPesos, numeroPedido } from "../logica/calculos.ts";
import { escaparHtml, nombreMedioPago } from "../logica/formato.ts";
import { textoPedido } from "../menus/tarjeta_pedido.ts";
import { enviarSeguimiento } from "../servicios/avisos_pedido.ts";
import { enMinutos, leerConfiguracion } from "../servicios/configuracion.ts";
import { cerrarMensajes, notificarCliente, notificarTiendaFoto, registrarMensaje } from "../servicios/notificaciones.ts";
import { cambiarEstado, obtenerPedido, pedidoEsperandoPago, type PedidoDetalle } from "../servicios/pedidos.ts";
import { enviarFoto } from "../servicios/telegram.ts";
import { avisar, quitarBotones, responder } from "../ui.ts";
import { cargarConPermiso, nombreActor } from "./pedidos_comun.ts";

function pieComprobante(p: PedidoDetalle): string {
  return `🧾 Comprobante del pedido ${numeroPedido(p.id)} – ${formatearPesos(p.total)} (${nombreMedioPago(p.medio_pago)})`;
}

function tecladoComprobante(pedidoId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Pago recibido", armar(P.pago, "ok", pedidoId))
    .text("❌ No me llegó", armar(P.pago, "no", pedidoId));
}

// La siguiente foto del cliente con un pedido en esperando_pago es su comprobante. Devuelve true si la tomó.
export async function recibirComprobante(ctx: MiContexto): Promise<boolean> {
  const fotos = ctx.message?.photo;
  if (!fotos?.length) return false;
  const pedidoId = await pedidoEsperandoPago(ctx.from!.id);
  if (!pedidoId) return false;
  const fileId = fotos[fotos.length - 1].file_id; // la de mayor tamaño
  const ok = await cambiarEstado(pedidoId, ["esperando_pago"], "verificando_pago", ctx.from!.id, {
    comprobante_file_id: fileId,
    recordatorio_en: null,
    vence_en: null,
  });
  if (!ok) return false;
  const p = await obtenerPedido(pedidoId);
  if (!p) return true;
  await responder(ctx, "🧾 Recibimos tu comprobante. La tienda lo está verificando.");
  await notificarTiendaFoto(p.tienda_id, "comprobante", fileId, pieComprobante(p), tecladoComprobante(p.id), p.id);
  return true;
}

async function pagoRecibido(ctx: MiContexto, pedidoId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "confirmar_pagos");
  if (!c) return;
  const { p } = c;
  const ok = await cambiarEstado(p.id, ["verificando_pago"], "en_preparacion", ctx.from!.id, { pago_confirmado: true });
  if (!ok) {
    await avisar(ctx, "Este pago ya fue revisado.", true);
    await quitarBotones(ctx);
    return;
  }
  const nombre = escaparHtml(nombreActor(ctx));
  await notificarCliente(p, "✅ Pago confirmado. Tu pedido ya se está preparando.");
  await cerrarMensajes(p.id, `${pieComprobante(p)}\n✅ Pago confirmado por ${nombre}`, { tipos: ["comprobante"] });
  await cerrarMensajes(p.id, `💳 Pago del pedido ${numeroPedido(p.id)} confirmado ✅`, { tipos: ["pago_cliente"] });
  await cerrarMensajes(p.id, `${textoPedido(p)}\n\n✅ Pago confirmado por ${nombre}`, { tipos: ["seguimiento"] });
  await avisar(ctx, "✅ Pago confirmado");
  const actualizado = await obtenerPedido(p.id);
  if (actualizado) await enviarSeguimiento(actualizado, `💰 Pago confirmado del pedido ${numeroPedido(p.id)}. ¡A preparar!`);
}

async function pagoNoRecibido(ctx: MiContexto, pedidoId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "confirmar_pagos");
  if (!c) return;
  const { p } = c;
  const config = await leerConfiguracion();
  const ok = await cambiarEstado(p.id, ["verificando_pago"], "esperando_pago", ctx.from!.id, {
    comprobante_file_id: null,
    recordatorio_en: enMinutos(config.minutos_recordatorio_pago),
    vence_en: enMinutos(config.minutos_cancelacion_pago),
    recordatorio_enviado: false,
  });
  if (!ok) {
    await avisar(ctx, "Este pago ya fue revisado.", true);
    await quitarBotones(ctx);
    return;
  }
  await notificarCliente(p,
    `⚠️ La tienda no ve tu pago del pedido ${numeroPedido(p.id)}. Revisa la transferencia y envía de nuevo el comprobante 📸\n⏱️ Tienes ${config.minutos_cancelacion_pago} minutos.`);
  await cerrarMensajes(p.id, `${pieComprobante(p)}\n❌ Marcado como no recibido por ${escaparHtml(nombreActor(ctx))}`, { tipos: ["comprobante"] });
  await avisar(ctx, "Le avisamos al cliente 👍");
}

async function verComprobante(ctx: MiContexto, pedidoId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "confirmar_pagos");
  if (!c) return;
  const { p } = c;
  if (p.estado !== "verificando_pago" || !p.comprobante_file_id) {
    await avisar(ctx, "Este pedido no tiene un comprobante por revisar.");
    return;
  }
  const enviado = await enviarFoto(ctx.chat!.id, p.comprobante_file_id, pieComprobante(p), tecladoComprobante(p.id));
  await registrarMensaje(p.id, enviado, "comprobante");
}

async function manejarPago(ctx: MiContexto, partes: string[]) {
  const id = num(partes, 2);
  if (partes[1] === "ok") await pagoRecibido(ctx, id);
  if (partes[1] === "no") await pagoNoRecibido(ctx, id);
  if (partes[1] === "ver") await verComprobante(ctx, id);
}

registrarCallback(P.pago, manejarPago);
