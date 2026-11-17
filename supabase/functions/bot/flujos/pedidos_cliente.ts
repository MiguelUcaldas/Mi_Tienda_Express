// "🧾 Mis pedidos" del cliente, doble confirmación del domicilio y cancelaciones del cliente (11.7 y 11.10).
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { formatearPesos, numeroPedido } from "../logica/calculos.ts";
import { CANCELABLES_CLIENTE, clientePuedeCancelar, estadoAlAceptarDomicilio } from "../logica/estados.ts";
import { escaparHtml, NOMBRES_ESTADO, NOMBRES_MOTIVO, nombreMedioPago } from "../logica/formato.ts";
import { textoPedido } from "../menus/tarjeta_pedido.ts";
import { enPruebasEn } from "../middleware/rol.ts";
import { enviarInstruccionesPago, enviarSeguimiento } from "../servicios/avisos_pedido.ts";
import { enMinutos, leerConfiguracion } from "../servicios/configuracion.ts";
import { avisarProductosRepuestos } from "../servicios/inventario.ts";
import { cerrarMensajes, notificarTienda } from "../servicios/notificaciones.ts";
import { cambiarEstado, cancelarPedido, obtenerPedido, type PedidoDetalle, pedidosDeCliente } from "../servicios/pedidos.ts";
import { avisar, mostrar } from "../ui.ts";
import { mensajeActual } from "./pedidos_comun.ts";

const d = (...partes: (string | number)[]) => armar(P.pedidoCliente, ...partes);

async function cargarDelCliente(ctx: MiContexto, pedidoId: number): Promise<PedidoDetalle | null> {
  const p = await obtenerPedido(pedidoId);
  if (!p || (p.cliente_telegram_id !== ctx.from!.id && !enPruebasEn(ctx, p.tienda_id))) {
    await avisar(ctx, "No encontré ese pedido 🤔");
    return null;
  }
  return p;
}

async function listar(ctx: MiContexto) {
  const pedidos = await pedidosDeCliente(ctx.from!.id);
  const teclado = new InlineKeyboard();
  for (const p of pedidos) {
    const estado = NOMBRES_ESTADO[p.estado].split(" ")[0];
    teclado.text(`${estado} ${numeroPedido(p.id)} · ${p.tienda_nombre}${p.es_prueba ? " 🧪" : ""}`, d("v", p.id)).row();
  }
  teclado.text("⬅️ Volver", ctx.estado.tienda_activa_id ? armar(P.menu, "t", ctx.estado.tienda_activa_id) : armar(P.menu, "ini"));
  await mostrar(ctx, pedidos.length ? "🧾 <b>Mis pedidos</b>\nToca uno para ver el detalle:" : "Aún no tienes pedidos. ¡Anímate a hacer el primero! 🛒", teclado);
}

async function detalle(ctx: MiContexto, pedidoId: number) {
  const p = await cargarDelCliente(ctx, pedidoId);
  if (!p) return;
  const lineas = [
    `🧾 <b>Pedido ${numeroPedido(p.id)}</b> – ${escaparHtml(p.tienda.nombre)}${p.es_prueba ? " 🧪" : ""}`,
    `Estado: <b>${NOMBRES_ESTADO[p.estado]}</b>`,
    ...p.items.map((i) => `• ${i.cantidad} × ${escaparHtml(i.nombre_producto)} — ${formatearPesos(i.subtotal)}`),
    `Subtotal: ${formatearPesos(p.subtotal)}`,
    p.valor_domicilio > 0 ? `🛵 Domicilio: ${formatearPesos(p.valor_domicilio)}` : "",
    `Total: <b>${formatearPesos(p.total)}</b>`,
    `💳 Pago: ${nombreMedioPago(p.medio_pago, p.modalidad)}`,
    p.modalidad === "domicilio" ? `🛵 ${escaparHtml(p.direccion)}, ${escaparHtml(p.barrio_nombre)}` : `🏪 Recoges en ${escaparHtml(p.tienda.direccion)}`,
  ];
  if (p.codigo_entrega && (p.estado === "despachado" || p.estado === "listo")) lineas.push(`🔑 Tu código de entrega: <b>${p.codigo_entrega}</b>`);
  if (p.estado === "cancelado" && p.motivo_cancelacion) {
    lineas.push(`Motivo: ${NOMBRES_MOTIVO[p.motivo_cancelacion] ?? ""}${p.detalle_cancelacion ? ` (${escaparHtml(p.detalle_cancelacion)})` : ""}`);
  }
  const teclado = new InlineKeyboard();
  if (p.estado === "esperando_confirmacion_cliente") teclado.text("✅ Acepto el domicilio", d("ac", p.id)).row();
  if (clientePuedeCancelar(p.estado)) teclado.text("❌ Cancelar pedido", d("x", p.id)).row();
  teclado.text("⬅️ Mis pedidos", d("l"));
  await mostrar(ctx, lineas.filter(Boolean).join("\n"), teclado);
}

async function aceptarDomicilio(ctx: MiContexto, pedidoId: number) {
  const p = await cargarDelCliente(ctx, pedidoId);
  if (!p) return;
  if (p.estado !== "esperando_confirmacion_cliente") {
    await avisar(ctx, "Este pedido ya no está esperando tu respuesta.", true);
    return;
  }
  const nuevo = estadoAlAceptarDomicilio(p.medio_pago);
  const config = await leerConfiguracion();
  const cambios = nuevo === "en_preparacion"
    ? { recordatorio_en: null, vence_en: null }
    : { recordatorio_en: enMinutos(config.minutos_recordatorio_pago), vence_en: enMinutos(config.minutos_cancelacion_pago), recordatorio_enviado: false };
  if (!await cambiarEstado(p.id, ["esperando_confirmacion_cliente"], nuevo, ctx.from!.id, cambios)) {
    await avisar(ctx, "Este pedido ya no está esperando tu respuesta.", true);
    return;
  }
  await cerrarMensajes(p.id, `✅ Domicilio del pedido ${numeroPedido(p.id)} aceptado.`, { tipos: ["confirmacion_cliente"], excepto: mensajeActual(ctx) });
  const actualizado = await obtenerPedido(p.id);
  if (!actualizado) return;
  if (nuevo === "en_preparacion") {
    await mostrar(ctx, `👍 ¡Listo! Aceptaste el domicilio. Tu pedido ${numeroPedido(p.id)} ya se está preparando 👩‍🍳`);
    await cerrarMensajes(p.id, `${textoPedido(p)}\n\n👍 El cliente aceptó el domicilio`, { tipos: ["seguimiento"] });
    await enviarSeguimiento(actualizado, `👍 El cliente aceptó el domicilio del ${numeroPedido(p.id)}. ¡A preparar!`);
  } else {
    await mostrar(ctx, `👍 ¡Listo! Aceptaste el domicilio del pedido ${numeroPedido(p.id)}.`);
    await enviarInstruccionesPago(actualizado);
  }
}

async function rechazarTarifa(ctx: MiContexto, pedidoId: number) {
  const p = await cargarDelCliente(ctx, pedidoId);
  if (!p) return;
  const r = await cancelarPedido(p.id, ["esperando_confirmacion_cliente"], "rechazo_tarifa", null, ctx.from!.id);
  if (!r.cancelado) {
    await avisar(ctx, "Este pedido ya no está esperando tu respuesta.", true);
    return;
  }
  await mostrar(ctx, `Listo, cancelamos tu pedido ${numeroPedido(p.id)}. ¡Ojalá la próxima! 🙌`);
  await cerrarMensajes(p.id, `❌ Pedido ${numeroPedido(p.id)} cancelado: el cliente no aceptó el domicilio.`, { excepto: mensajeActual(ctx) });
  await notificarTienda(p.tienda_id, "cancelacion", `❌ El cliente no aceptó el domicilio del pedido ${numeroPedido(p.id)}. El pedido se canceló.`);
  await avisarProductosRepuestos(r.repuestos ?? []);
}

async function confirmarCancelacion(ctx: MiContexto, pedidoId: number) {
  const p = await cargarDelCliente(ctx, pedidoId);
  if (!p) return;
  if (!clientePuedeCancelar(p.estado)) {
    await avisar(ctx, "Tu pedido ya se está preparando, así que no se puede cancelar 🙏", true);
    return;
  }
  await mostrar(ctx, `¿Seguro que quieres cancelar el pedido ${numeroPedido(p.id)}?`,
    new InlineKeyboard().text("Sí, cancelar", d("xok", p.id)).text("No", d("v", p.id)));
}

async function cancelar(ctx: MiContexto, pedidoId: number) {
  const p = await cargarDelCliente(ctx, pedidoId);
  if (!p) return;
  const r = await cancelarPedido(p.id, CANCELABLES_CLIENTE, "cancelado_por_cliente", null, ctx.from!.id);
  if (!r.cancelado) {
    await avisar(ctx, "Tu pedido ya se está preparando, así que no se puede cancelar 🙏", true);
    return;
  }
  const reembolso = r.habia_pago ? "\n💸 La tienda se comunicará contigo para el reembolso." : "";
  await mostrar(ctx, `❌ Cancelaste tu pedido ${numeroPedido(p.id)}.${reembolso}`,
    new InlineKeyboard().text("🧾 Mis pedidos", d("l")));
  await cerrarMensajes(p.id, `❌ Pedido ${numeroPedido(p.id)} cancelado por el cliente.`, { excepto: mensajeActual(ctx) });
  await notificarTienda(p.tienda_id, "cancelacion", `❌ El cliente canceló el pedido ${numeroPedido(p.id)}.` +
    (r.habia_pago ? " Ya había enviado comprobante: comunícate con el cliente para el reembolso." : ""));
  await avisarProductosRepuestos(r.repuestos ?? []);
}

async function manejarCliente(ctx: MiContexto, partes: string[]) {
  const id = num(partes, 2);
  switch (partes[1]) {
    case "l": return await listar(ctx);
    case "v": return await detalle(ctx, id);
    case "ac": return await aceptarDomicilio(ctx, id);
    case "rt": return await rechazarTarifa(ctx, id);
    case "x": return await confirmarCancelacion(ctx, id);
    case "xok": return await cancelar(ctx, id);
  }
}

registrarCallback(P.pedidoCliente, manejarCliente);
