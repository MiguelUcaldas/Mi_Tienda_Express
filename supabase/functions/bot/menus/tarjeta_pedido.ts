// Texto del pedido y botones de seguimiento según estado y rol (11.6 y 11.9).
import { InlineKeyboard } from "npm:grammy@^1";
import { armar, P } from "../datos_callback.ts";
import { formatearPesos, numeroPedido } from "../logica/calculos.ts";
import { tiendaPuedeCancelar } from "../logica/estados.ts";
import { escaparHtml, NOMBRES_MOTIVO, nombreMedioPago } from "../logica/formato.ts";
import { puede, type Rol } from "../logica/permisos.ts";
import type { PedidoDetalle } from "../servicios/pedidos.ts";

export const ESTADO_PARA_TIENDA: Record<string, string> = {
  esperando_tienda: "⏳ Esperando respuesta de la tienda",
  esperando_confirmacion_cliente: "🛵 Esperando que el cliente acepte el domicilio",
  esperando_pago: "💳 Esperando el pago del cliente",
  verificando_pago: "🧾 Comprobante por verificar",
  en_preparacion: "👩‍🍳 En preparación",
  listo: "📦 Listo",
  despachado: "🛵 Despachado",
  entregado: "✅ Entregado",
  cancelado: "❌ Cancelado",
};

export function textoPedido(p: PedidoDetalle): string {
  const lineas = [
    `🛒 <b>Pedido ${numeroPedido(p.id)}</b> – ${escaparHtml(p.tienda.nombre)}${p.es_prueba ? " 🧪" : ""}`,
    `👤 ${escaparHtml(p.nombre_cliente)} · 📱 ${escaparHtml(p.telefono_cliente)}`,
    p.modalidad === "domicilio"
      ? `🛵 Domicilio – ${escaparHtml(p.direccion)}, ${escaparHtml(p.barrio_nombre)}`
      : "🏪 Recoge en tienda",
    ...p.items.map((i) => `• ${i.cantidad} × ${escaparHtml(i.nombre_producto)} — ${formatearPesos(i.subtotal)}`),
    `Subtotal: ${formatearPesos(p.subtotal)}`,
  ];
  if (p.valor_domicilio > 0) lineas.push(`🛵 Domicilio: ${formatearPesos(p.valor_domicilio)}`);
  if (p.total !== p.subtotal) lineas.push(`Total: <b>${formatearPesos(p.total)}</b>`);
  lineas.push(`💳 Pago: ${nombreMedioPago(p.medio_pago, p.modalidad)}${p.pago_confirmado ? " ✅ confirmado" : ""}`);
  if (p.observaciones) lineas.push(`📝 "${escaparHtml(p.observaciones)}"`);
  return lineas.join("\n");
}

// Mensaje de "pedido nuevo" para la tienda
export function textoPedidoNuevo(p: PedidoDetalle, minutosCancelacion: number): string {
  return `${textoPedido(p)}\n⏱️ Si nadie responde en ${minutosCancelacion} minutos, el pedido se cancela solo.`;
}

export function tecladoPedidoNuevo(pedidoId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Aceptar", armar(P.pedidoTienda, "ac", pedidoId))
    .text("❌ Rechazar", armar(P.pedidoTienda, "re", pedidoId));
}

export interface InfoTarjeta {
  rol: Rol;
  hayDomiciliarios: boolean; // o modo pruebas activo
  esAsignado: boolean; // quien mira es el domiciliario asignado (o el Super Admin en pruebas)
  nombreDomiciliario?: string | null;
  conVolver?: boolean;
}

export function textoTarjeta(p: PedidoDetalle, info: InfoTarjeta): string {
  const lineas = [textoPedido(p), "", `Estado: <b>${ESTADO_PARA_TIENDA[p.estado]}</b>`];
  if (p.domiciliario_telegram_id && info.nombreDomiciliario) {
    lineas.push(`🛵 Domiciliario: ${escaparHtml(info.nombreDomiciliario)}`);
  }
  if (p.estado === "cancelado" && p.motivo_cancelacion) {
    lineas.push(`Motivo: ${NOMBRES_MOTIVO[p.motivo_cancelacion] ?? p.motivo_cancelacion}${p.detalle_cancelacion ? ` (${escaparHtml(p.detalle_cancelacion)})` : ""}`);
  }
  return lineas.join("\n");
}

export function tecladoTarjeta(p: PedidoDetalle, info: InfoTarjeta): InlineKeyboard {
  const t = new InlineKeyboard();
  const { rol } = info;
  const id = p.id;
  const esDomiciliario = rol === "domiciliario";

  switch (p.estado) {
    case "esperando_tienda":
      if (puede(rol, "gestionar_pedidos")) t.text("✅ Aceptar", armar(P.pedidoTienda, "ac", id)).text("❌ Rechazar", armar(P.pedidoTienda, "re", id)).row();
      break;
    case "verificando_pago":
      if (puede(rol, "confirmar_pagos")) t.text("🧾 Ver comprobante", armar(P.pago, "ver", id)).row();
      break;
    case "en_preparacion":
      if (puede(rol, "gestionar_pedidos")) t.text("📦 Marcar listo", armar(P.pedidoTienda, "lis", id)).row();
      break;
    case "listo":
      if (p.modalidad === "recogida") {
        if (puede(rol, "entregar_pedido") && !esDomiciliario) t.text("✅ Entregar", armar(P.entrega, "e", id)).row();
      } else {
        if (info.esAsignado) t.text("🛵 Salí con el pedido", armar(P.entrega, "sal", id)).row();
        if (info.hayDomiciliarios && puede(rol, "asignar_domiciliario")) {
          t.text(p.domiciliario_telegram_id ? "🔄 Reasignar domiciliario" : "🛵 Asignar domiciliario", armar(P.pedidoTienda, "asg", id)).row();
        }
        if (!info.hayDomiciliarios && !p.domiciliario_telegram_id && puede(rol, "gestionar_pedidos")) {
          t.text("🛵 Marcar despachado", armar(P.pedidoTienda, "des", id)).row();
        }
      }
      break;
    case "despachado":
      if (info.esAsignado || (puede(rol, "entregar_pedido") && !esDomiciliario)) {
        t.text("✅ Entregar", armar(P.entrega, "e", id)).row();
      }
      break;
  }
  if (tiendaPuedeCancelar(p.estado) && puede(rol, "cancelar_pedido_aceptado")) {
    t.text("❌ Cancelar pedido", armar(P.pedidoTienda, "can", id)).row();
  }
  if (info.conVolver) {
    t.text("⬅️ Pendientes", armar("pl", "pend", p.tienda_id, 1));
  }
  return t;
}
