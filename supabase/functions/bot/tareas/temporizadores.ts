// Tareas que corren cada minuto (11.18): recordatorios, vencimientos, carritos viejos e invitaciones vencidas.
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import { armar, P } from "../datos_callback.ts";
import { numeroPedido } from "../logica/calculos.ts";
import { ESTADOS_CON_TEMPORIZADOR, MOTIVO_POR_VENCIMIENTO } from "../logica/estados.ts";
import { escaparHtml } from "../logica/formato.ts";
import { leerConfiguracion } from "../servicios/configuracion.ts";
import { avisarProductosRepuestos } from "../servicios/inventario.ts";
import { cerrarMensajes, notificarCliente, notificarTienda } from "../servicios/notificaciones.ts";
import { cancelarPedido, obtenerPedido, type Pedido } from "../servicios/pedidos.ts";

function minutosRestantes(venceEn: string | null): number {
  if (!venceEn) return 0;
  return Math.max(1, Math.ceil((new Date(venceEn).getTime() - Date.now()) / 60_000));
}

function plural(n: number): string {
  return `${n} minuto${n === 1 ? "" : "s"}`;
}

async function enviarRecordatorios(): Promise<number> {
  const ahora = new Date().toISOString();
  const { data } = await db.from("pedidos").select("*")
    .in("estado", ESTADOS_CON_TEMPORIZADOR).eq("recordatorio_enviado", false).lte("recordatorio_en", ahora);
  let enviados = 0;
  for (const p of (data ?? []) as Pedido[]) {
    // UPDATE condicionado: si otra ejecución ya lo marcó, no se repite
    const { data: marcado } = await db.from("pedidos").update({ recordatorio_enviado: true })
      .eq("id", p.id).eq("estado", p.estado).eq("recordatorio_enviado", false).select("id");
    if (!marcado?.length) continue;
    const resta = plural(minutosRestantes(p.vence_en));
    const transcurridos = Math.max(1, Math.round((Date.now() - new Date(p.creado_en).getTime()) / 60_000));
    if (p.estado === "esperando_tienda") {
      await notificarTienda(p.tienda_id, "recordatorio",
        `⏰ El pedido ${numeroPedido(p.id)} lleva ${plural(transcurridos)} sin respuesta. Se cancelará automáticamente en ${resta}.`,
        { teclado: new InlineKeyboard().text("Ver pedido", armar(P.pedidoTienda, "ver", p.id)) });
    } else if (p.estado === "esperando_confirmacion_cliente") {
      await notificarCliente(p, `⏰ Tu pedido ${numeroPedido(p.id)} espera que aceptes el valor del domicilio. Se cancelará en ${resta}.`,
        new InlineKeyboard().text("Ver pedido", armar(P.pedidoCliente, "v", p.id)));
    } else {
      await notificarCliente(p, `⏰ Aún no recibimos tu comprobante del pedido ${numeroPedido(p.id)}. Se cancelará en ${resta}.`);
    }
    enviados++;
  }
  return enviados;
}

const RAZON_CLIENTE: Record<string, string> = {
  esperando_tienda: "la tienda no respondió a tiempo",
  esperando_confirmacion_cliente: "no aceptaste el valor del domicilio a tiempo",
  esperando_pago: "no recibimos el comprobante de pago a tiempo",
};

const RAZON_TIENDA: Record<string, string> = {
  esperando_tienda: "nadie lo aceptó a tiempo",
  esperando_confirmacion_cliente: "el cliente no aceptó el domicilio a tiempo",
  esperando_pago: "el cliente no envió el comprobante a tiempo",
};

async function cancelarVencidos(): Promise<number> {
  const { data } = await db.from("pedidos").select("id, estado")
    .in("estado", ESTADOS_CON_TEMPORIZADOR).lte("vence_en", new Date().toISOString());
  let cancelados = 0;
  for (const fila of data ?? []) {
    const r = await cancelarPedido(fila.id, [fila.estado], MOTIVO_POR_VENCIMIENTO[fila.estado], null, null);
    if (!r.cancelado) continue;
    cancelados++;
    const p = await obtenerPedido(fila.id);
    if (!p) continue;
    const num = numeroPedido(p.id);
    await cerrarMensajes(p.id, `⌛ Pedido ${num} cancelado automáticamente: ${RAZON_TIENDA[fila.estado]}.`);
    await notificarCliente(p, `⌛ Tu pedido ${num} en ${escaparHtml(p.tienda.nombre)} se canceló porque ${RAZON_CLIENTE[fila.estado]}.` +
      (r.habia_pago ? "\n💸 La tienda se comunicará contigo para el reembolso." : ""));
    await notificarTienda(p.tienda_id, "cancelacion", `⌛ El pedido ${num} se canceló automáticamente: ${RAZON_TIENDA[fila.estado]}.`);
    await avisarProductosRepuestos(r.repuestos ?? []);
  }
  return cancelados;
}

async function vaciarCarritosViejos(horas: number) {
  const limite = new Date(Date.now() - horas * 3_600_000).toISOString();
  await db.from("carritos").delete().lt("actualizado_en", limite);
}

async function limpiarInvitaciones() {
  const limite = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  await db.from("invitaciones").delete().is("usada_por", null).lt("expira_en", limite);
}

// Cada bloque con su propio try/catch para que un error no detenga los demás
export async function ejecutarTareas(): Promise<Record<string, unknown>> {
  const resultado: Record<string, unknown> = {};
  try {
    resultado.recordatorios = await enviarRecordatorios();
  } catch (e) {
    console.error("tareas/recordatorios:", e);
    resultado.recordatorios = "error";
  }
  try {
    resultado.cancelados = await cancelarVencidos();
  } catch (e) {
    console.error("tareas/vencimientos:", e);
    resultado.cancelados = "error";
  }
  try {
    const config = await leerConfiguracion();
    await vaciarCarritosViejos(config.horas_vencimiento_carrito);
    resultado.carritos = "ok";
  } catch (e) {
    console.error("tareas/carritos:", e);
    resultado.carritos = "error";
  }
  try {
    await limpiarInvitaciones();
    resultado.invitaciones = "ok";
  } catch (e) {
    console.error("tareas/invitaciones:", e);
    resultado.invitaciones = "error";
  }
  return resultado;
}
