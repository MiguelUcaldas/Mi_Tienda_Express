// Pedido nuevo en la tienda (11.6): aceptar, valor del domicilio con memoria, rechazar. Despacha el prefijo "ped".
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { formatearPesos, numeroPedido, parsearPrecio } from "../logica/calculos.ts";
import { estadoAlAceptar } from "../logica/estados.ts";
import { escaparHtml } from "../logica/formato.ts";
import { tecladoCancelar } from "../menus/comunes.ts";
import { textoPedido } from "../menus/tarjeta_pedido.ts";
import { rolParaPedidos } from "../middleware/rol.ts";
import { enviarConfirmacionDomicilio, enviarInstruccionesPago } from "../servicios/avisos_pedido.ts";
import { enMinutos, leerConfiguracion } from "../servicios/configuracion.ts";
import { iniciarFlujo, terminarFlujo } from "../servicios/conversacion.ts";
import { avisarProductosRepuestos } from "../servicios/inventario.ts";
import { cerrarMensajes, notificarCliente } from "../servicios/notificaciones.ts";
import { cambiarEstado, cancelarPedido, obtenerPedido, type PedidoDetalle } from "../servicios/pedidos.ts";
import { avisar, mostrar, responder } from "../ui.ts";
import { cargarConPermiso, mensajeActual, mostrarTarjeta, nombreActor } from "./pedidos_comun.ts";
import {
  asignarDomiciliario,
  cancelarPorTienda,
  despacharSinDomiciliario,
  elegirDomiciliario,
  marcarListo,
  MOTIVOS_CANCELACION,
  preguntarMotivoCancelacion,
} from "./pedidos_despacho.ts";

const d = (...partes: (string | number)[]) => armar(P.pedidoTienda, ...partes);
const TARIFAS_RAPIDAS = [2000, 3000, 4000, 5000, 6000];
const MOTIVOS_RECHAZO: Record<string, string> = {
  "1": "Sin producto",
  "2": "Fuera de horario",
  "3": "No llego a ese barrio",
};

async function yaAtendido(ctx: MiContexto, pedidoId: number) {
  await avisar(ctx, "Este pedido ya fue atendido por alguien más.", true);
  await mostrarTarjeta(ctx, pedidoId);
}

async function aceptar(ctx: MiContexto, pedidoId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "gestionar_pedidos");
  if (!c) return;
  const { p } = c;
  if (p.estado !== "esperando_tienda") return await yaAtendido(ctx, p.id);
  const nombre = escaparHtml(nombreActor(ctx));

  if (p.modalidad === "recogida") {
    const nuevo = estadoAlAceptar("recogida", p.medio_pago);
    const config = await leerConfiguracion();
    const cambios = nuevo === "esperando_pago"
      ? { recordatorio_en: enMinutos(config.minutos_recordatorio_pago), vence_en: enMinutos(config.minutos_cancelacion_pago), recordatorio_enviado: false }
      : { recordatorio_en: null, vence_en: null };
    if (!await cambiarEstado(p.id, ["esperando_tienda"], nuevo, ctx.from!.id, cambios)) return await yaAtendido(ctx, p.id);
    await cerrarMensajes(p.id, `${textoPedido(p)}\n\n✅ Aceptado por ${nombre}`, { tipos: ["pedido_nuevo"], excepto: mensajeActual(ctx) });
    if (nuevo === "en_preparacion") {
      await notificarCliente(p, `✅ ¡${escaparHtml(p.tienda.nombre)} aceptó tu pedido ${numeroPedido(p.id)}! Ya lo están preparando. Te avisamos cuando esté listo para recoger 📦`);
    } else {
      const actualizado = await obtenerPedido(p.id);
      if (actualizado) await enviarInstruccionesPago(actualizado);
    }
    await mostrarTarjeta(ctx, p.id, "✅ Aceptaste el pedido.");
    return;
  }

  // Domicilio: los demás ven que alguien lo está atendiendo; el estado cambia al elegir el valor
  await cerrarMensajes(p.id, `${textoPedido(p)}\n\n⏳ ${nombre} está atendiendo este pedido`, { tipos: ["pedido_nuevo"], excepto: mensajeActual(ctx) });
  await preguntarTarifa(ctx, p);
}

async function preguntarTarifa(ctx: MiContexto, p: PedidoDetalle) {
  const { data } = await db.from("tarifas_domicilio").select("tarifa")
    .eq("tienda_id", p.tienda_id).eq("barrio_id", p.barrio_id ?? 0).maybeSingle();
  const teclado = new InlineKeyboard();
  if (data?.tarifa !== null && data?.tarifa !== undefined) {
    teclado.text(`Usar ${formatearPesos(data.tarifa)} (última vez)`, d("tf", p.id, data.tarifa)).row();
  }
  TARIFAS_RAPIDAS.forEach((v, i) => {
    teclado.text(formatearPesos(v), d("tf", p.id, v));
    if (i === 2) teclado.row();
  });
  teclado.text("✏️ Otro valor", d("tfo", p.id));
  await mostrar(ctx, `${textoPedido(p)}\n\n🛵 ¿Cuánto cobras de domicilio a <b>${escaparHtml(p.barrio_nombre)}</b>?`, teclado);
}

async function aplicarTarifa(ctx: MiContexto, pedidoId: number, valor: number) {
  if (!Number.isInteger(valor) || valor < 0) return;
  const c = await cargarConPermiso(ctx, pedidoId, "gestionar_pedidos");
  if (!c) return;
  const { p } = c;
  if (p.estado !== "esperando_tienda") return await yaAtendido(ctx, p.id);
  const config = await leerConfiguracion();
  const ok = await cambiarEstado(p.id, ["esperando_tienda"], "esperando_confirmacion_cliente", ctx.from!.id, {
    valor_domicilio: valor,
    total: p.subtotal + valor,
    recordatorio_en: enMinutos(config.minutos_recordatorio_cliente),
    vence_en: enMinutos(config.minutos_cancelacion_cliente),
    recordatorio_enviado: false,
  });
  if (!ok) return await yaAtendido(ctx, p.id);

  // Memoria de tarifas (RN-27)
  if (p.barrio_id) {
    await db.from("tarifas_domicilio").upsert({
      tienda_id: p.tienda_id,
      barrio_id: p.barrio_id,
      tarifa: valor,
      entrega: true,
      actualizado_en: new Date().toISOString(),
    }, { onConflict: "tienda_id,barrio_id" });
  }
  await cerrarMensajes(p.id, `${textoPedido(p)}\n\n✅ Aceptado por ${escaparHtml(nombreActor(ctx))}`, { tipos: ["pedido_nuevo"], excepto: mensajeActual(ctx) });
  const actualizado = await obtenerPedido(p.id);
  if (actualizado) await enviarConfirmacionDomicilio(actualizado);
  await mostrarTarjeta(ctx, p.id, `✅ Le enviamos al cliente el domicilio de ${formatearPesos(valor)}. Esperamos su respuesta.`);
}

async function preguntarMotivoRechazo(ctx: MiContexto, pedidoId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "gestionar_pedidos");
  if (!c) return;
  if (c.p.estado !== "esperando_tienda") return await yaAtendido(ctx, pedidoId);
  await mostrar(ctx, `${textoPedido(c.p)}\n\n❌ ¿Por qué rechazas el pedido?`, new InlineKeyboard()
    .text(MOTIVOS_RECHAZO["1"], d("rm", pedidoId, 1)).text(MOTIVOS_RECHAZO["2"], d("rm", pedidoId, 2)).row()
    .text(MOTIVOS_RECHAZO["3"], d("rm", pedidoId, 3)).text("Otro", d("rm", pedidoId, 4)).row()
    .text("⬅️ Volver", d("ver", pedidoId)));
}

async function rechazar(ctx: MiContexto, pedidoId: number, detalle: string, motivo: string) {
  const c = await cargarConPermiso(ctx, pedidoId, "gestionar_pedidos");
  if (!c) return;
  const { p } = c;
  const r = await cancelarPedido(p.id, ["esperando_tienda"], "rechazado_por_tienda", detalle, ctx.from!.id);
  if (!r.cancelado) return await yaAtendido(ctx, p.id);
  await notificarCliente(p, `😔 ${escaparHtml(p.tienda.nombre)} no pudo tomar tu pedido ${numeroPedido(p.id)}. Motivo: ${escaparHtml(detalle)}.`);
  await cerrarMensajes(p.id, `${textoPedido(p)}\n\n❌ Rechazado por ${escaparHtml(nombreActor(ctx))} (${escaparHtml(detalle)})`);
  await avisarProductosRepuestos(r.repuestos ?? []);
  if (motivo === "3" && p.modalidad === "domicilio" && p.barrio_id) {
    await mostrar(ctx, `❌ Rechazaste el pedido ${numeroPedido(p.id)}.\n¿Marcar ${escaparHtml(p.barrio_nombre)} como "No entrego" para próximos pedidos?`,
      new InlineKeyboard().text("Sí", d("ne", p.id)).text("No", d("nen", p.id)));
    return;
  }
  await mostrar(ctx, `❌ Rechazaste el pedido ${numeroPedido(p.id)}. Ya le avisamos al cliente.`);
}

async function marcarNoEntrego(ctx: MiContexto, pedidoId: number) {
  const c = await cargarConPermiso(ctx, pedidoId, "gestionar_pedidos");
  if (!c || !c.p.barrio_id) return;
  await db.from("tarifas_domicilio").upsert({
    tienda_id: c.p.tienda_id,
    barrio_id: c.p.barrio_id,
    entrega: false,
    actualizado_en: new Date().toISOString(),
  }, { onConflict: "tienda_id,barrio_id" });
  await mostrar(ctx, `🚫 Listo: ${escaparHtml(c.p.barrio_nombre)} quedó como "No entrego". Puedes cambiarlo en 🛵 Domicilios.`);
}

async function verPedido(ctx: MiContexto, pedidoId: number, conVolver: boolean) {
  const p = await obtenerPedido(pedidoId);
  if (!p) return;
  const rol = await rolParaPedidos(ctx, p.tienda_id);
  if (rol === "cliente") {
    await avisar(ctx, "⛔ No tienes permiso para ver este pedido.");
    return;
  }
  await mostrarTarjeta(ctx, pedidoId, "", conVolver);
}

async function manejarPedidoTienda(ctx: MiContexto, partes: string[]) {
  const accion = partes[1];
  const id = num(partes, 2);
  switch (accion) {
    case "ver": return await verPedido(ctx, id, partes[3] === "v");
    case "ac": return await aceptar(ctx, id);
    case "tf": return await aplicarTarifa(ctx, id, num(partes, 3));
    case "tfo":
      if (!await cargarConPermiso(ctx, id, "gestionar_pedidos")) return;
      await iniciarFlujo(ctx, "motivo_tienda", "tarifa", { pedido_id: id });
      await responder(ctx, `✏️ Escribe el valor del domicilio para el pedido ${numeroPedido(id)} (ej. 4500):`, tecladoCancelar());
      return;
    case "re": return await preguntarMotivoRechazo(ctx, id);
    case "rm":
      if (partes[3] === "4") {
        if (!await cargarConPermiso(ctx, id, "gestionar_pedidos")) return;
        await iniciarFlujo(ctx, "motivo_tienda", "rechazo", { pedido_id: id });
        await responder(ctx, "✏️ Escribe el motivo del rechazo:", tecladoCancelar());
        return;
      }
      return await rechazar(ctx, id, MOTIVOS_RECHAZO[partes[3]] ?? "Otro", partes[3]);
    case "ne": return await marcarNoEntrego(ctx, id);
    case "nen": return await mostrar(ctx, "👍 Listo.");
    case "lis": return await marcarListo(ctx, id);
    case "asg": return await elegirDomiciliario(ctx, id);
    case "asd": return await asignarDomiciliario(ctx, id, num(partes, 3));
    case "des": return await despacharSinDomiciliario(ctx, id);
    case "can": return await preguntarMotivoCancelacion(ctx, id);
    case "cm":
      if (partes[3] === "3") {
        if (!await cargarConPermiso(ctx, id, "cancelar_pedido_aceptado")) return;
        await iniciarFlujo(ctx, "motivo_tienda", "cancelacion", { pedido_id: id });
        await responder(ctx, "✏️ Escribe el motivo de la cancelación:", tecladoCancelar());
        return;
      }
      return await cancelarPorTienda(ctx, id, MOTIVOS_CANCELACION[partes[3]] ?? "Otro");
  }
}

// Textos libres del personal: valor de domicilio, motivo de rechazo o de cancelación
async function flujoMotivoTienda(ctx: MiContexto) {
  const texto = ctx.message?.text?.trim() ?? "";
  const pedidoId = ctx.estado.datos.pedido_id as number;
  const paso = ctx.estado.paso;
  if (paso === "tarifa") {
    const valor = parsearPrecio(texto);
    if (valor === null || valor > 200000) {
      await responder(ctx, "Escribe solo el número, por ejemplo 4500 💵", tecladoCancelar());
      return;
    }
    await terminarFlujo(ctx);
    await aplicarTarifa(ctx, pedidoId, valor);
    return;
  }
  if (texto.length < 3 || texto.length > 150) {
    await responder(ctx, "Escribe un motivo corto (3 a 150 caracteres).", tecladoCancelar());
    return;
  }
  await terminarFlujo(ctx);
  if (paso === "rechazo") await rechazar(ctx, pedidoId, texto, "4");
  else await cancelarPorTienda(ctx, pedidoId, texto);
}

registrarCallback(P.pedidoTienda, manejarPedidoTienda);
registrarFlujo("motivo_tienda", flujoMotivoTienda);
