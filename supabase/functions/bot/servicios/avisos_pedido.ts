// Mensajes del ciclo de vida del pedido que se reutilizan en varios flujos.
import { InlineKeyboard } from "npm:grammy@^1";
import { armar, P } from "../datos_callback.ts";
import { formatearPesos, numeroPedido } from "../logica/calculos.ts";
import { escaparHtml } from "../logica/formato.ts";
import type { Rol } from "../logica/permisos.ts";
import { obtenerRol } from "../middleware/rol.ts";
import {
  type InfoTarjeta,
  tecladoPedidoNuevo,
  tecladoTarjeta,
  textoPedidoNuevo,
  textoTarjeta,
} from "../menus/tarjeta_pedido.ts";
import { leerConfiguracion } from "./configuracion.ts";
import { destinatariosTienda, ETIQUETA_VISTA, notificarCliente, notificarTienda, registrarMensaje, superAdminEnPruebas } from "./notificaciones.ts";
import { domiciliariosActivos, type PedidoDetalle } from "./pedidos.ts";
import { enviarTexto } from "./telegram.ts";
import { type MedioPagoTienda, mediosDe, nombreVisible, obtenerUsuario } from "./tiendas.ts";

export async function infoTarjeta(
  p: PedidoDetalle,
  telegramId: number,
  rol: Rol,
  enPruebas: boolean,
  conVolver = false,
): Promise<InfoTarjeta> {
  const hayDomiciliarios = enPruebas || (await domiciliariosActivos(p.tienda_id)).length > 0;
  const domiciliario = p.domiciliario_telegram_id ? await obtenerUsuario(p.domiciliario_telegram_id) : null;
  return {
    rol,
    hayDomiciliarios,
    esAsignado: p.domiciliario_telegram_id !== null && p.domiciliario_telegram_id === telegramId,
    nombreDomiciliario: domiciliario ? nombreVisible(domiciliario) : null,
    conVolver,
  };
}

export async function notificarPedidoNuevo(p: PedidoDetalle) {
  const config = await leerConfiguracion();
  await notificarTienda(p.tienda_id, "pedido_nuevo", textoPedidoNuevo(p, config.minutos_cancelacion_tienda), {
    teclado: tecladoPedidoNuevo(p.id),
    pedidoId: p.id,
  });
}

// Tarjeta de seguimiento para el personal, con los botones según el rol de cada uno
export async function enviarSeguimiento(p: PedidoDetalle, encabezado: string, excluir: number[] = []) {
  const sa = await superAdminEnPruebas(p.tienda_id);
  for (const d of await destinatariosTienda(p.tienda_id, "seguimiento")) {
    if (excluir.includes(d.telegram_id)) continue;
    const rol: Rol = d.vista || d.telegram_id === sa ? "dueno" : await obtenerRol(d.telegram_id, p.tienda_id);
    const info = await infoTarjeta(p, d.telegram_id, rol, sa !== null);
    const texto = `${d.vista ? ETIQUETA_VISTA.tienda : ""}${encabezado}\n\n${textoTarjeta(p, info)}`;
    const enviado = await enviarTexto(d.telegram_id, texto, tecladoTarjeta(p, info));
    await registrarMensaje(p.id, enviado, "seguimiento");
  }
}

// deno-lint-ignore no-explicit-any
export function textoDatosPago(tipo: string, datos: Record<string, any>): string {
  switch (tipo) {
    case "llave_breb":
      return `Llave Bre-B: <b>${escaparHtml(datos.llave)}</b>`;
    case "nequi":
      return `Nequi: <b>${escaparHtml(datos.numero)}</b> (titular: ${escaparHtml(datos.titular)})`;
    case "bancolombia":
      return `Bancolombia ${escaparHtml(datos.tipo_cuenta)} N.° <b>${escaparHtml(datos.numero_cuenta)}</b> (${escaparHtml(datos.titular)})`;
    default:
      return "Contra entrega";
  }
}

export async function enviarInstruccionesPago(p: PedidoDetalle) {
  const config = await leerConfiguracion();
  const medios = await mediosDe(p.tienda_id, false);
  const medio = medios.find((m: MedioPagoTienda) => m.tipo === p.medio_pago);
  const texto = [
    `💳 Para continuar con tu pedido ${numeroPedido(p.id)}, transfiere <b>${formatearPesos(p.total)}</b> a:`,
    `• ${textoDatosPago(p.medio_pago, medio?.datos ?? {})}`,
    "Después envía aquí la <b>foto del comprobante</b> 📸",
    "⚠️ OJO: cuando la tienda confirme tu pago, el pedido pasa a preparación y ya no podrás cancelarlo.",
    `⏱️ Tienes ${config.minutos_cancelacion_pago} minutos.`,
  ].join("\n");
  const teclado = new InlineKeyboard().text("❌ Cancelar pedido", armar(P.pedidoCliente, "x", p.id));
  await notificarCliente(p, texto, teclado, "pago_cliente");
}

// Mensaje de doble confirmación del domicilio (11.7)
export async function enviarConfirmacionDomicilio(p: PedidoDetalle) {
  const config = await leerConfiguracion();
  const texto = [
    `✅ ¡${escaparHtml(p.tienda.nombre)} aceptó tu pedido ${numeroPedido(p.id)}!`,
    `🛵 Domicilio a ${escaparHtml(p.barrio_nombre)}: <b>${formatearPesos(p.valor_domicilio)}</b>`,
    `Total: <b>${formatearPesos(p.total)}</b>`,
    p.medio_pago === "contra_entrega"
      ? "⚠️ OJO: al aceptar, tu pedido pasa a preparación y ya no podrás cancelarlo."
      : "⚠️ OJO: podrás cancelar hasta que la tienda confirme tu pago.",
    `⏱️ Tienes ${config.minutos_cancelacion_cliente} minutos para responder.`,
  ].join("\n");
  const teclado = new InlineKeyboard()
    .text("✅ Acepto", armar(P.pedidoCliente, "ac", p.id))
    .text("❌ Cancelar pedido", armar(P.pedidoCliente, "rt", p.id));
  await notificarCliente(p, texto, teclado, "confirmacion_cliente");
}
