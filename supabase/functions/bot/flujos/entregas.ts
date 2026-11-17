// Domiciliario ("🛵 Mis entregas", "Salí con el pedido") y entrega con código (11.9, RN-32, RN-33).
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { numeroPedido } from "../logica/calculos.ts";
import { codigoCorrecto, debeAlertarCodigo } from "../logica/codigo_entrega.ts";
import type { EstadoPedido } from "../logica/estados.ts";
import { escaparHtml } from "../logica/formato.ts";
import { puede } from "../logica/permisos.ts";
import { tecladoCancelar } from "../menus/comunes.ts";
import { enPruebasEn, rolDe, rolParaPedidos } from "../middleware/rol.ts";
import { leerConfiguracion } from "../servicios/configuracion.ts";
import { iniciarFlujo, terminarFlujo } from "../servicios/conversacion.ts";
import { cerrarMensajes, notificarCliente, notificarTienda } from "../servicios/notificaciones.ts";
import { cambiarEstado, obtenerPedido, type PedidoDetalle, pedidosDeDomiciliario } from "../servicios/pedidos.ts";
import { avisar, mostrar, responder } from "../ui.ts";
import { mostrarTarjeta } from "./pedidos_comun.ts";
import { despachar } from "./pedidos_despacho.ts";

function estadoParaEntregar(p: PedidoDetalle): EstadoPedido {
  return p.modalidad === "domicilio" ? "despachado" : "listo";
}

// ¿Quien escribe puede entregar este pedido? El domiciliario solo los suyos.
async function puedeEntregar(ctx: MiContexto, p: PedidoDetalle): Promise<boolean> {
  if (enPruebasEn(ctx, p.tienda_id)) return true;
  const rol = await rolParaPedidos(ctx, p.tienda_id);
  if (rol === "domiciliario") return p.domiciliario_telegram_id === ctx.from!.id;
  return puede(rol, "entregar_pedido");
}

async function misEntregas(ctx: MiContexto, tiendaId: number) {
  const rol = await rolDe(ctx, tiendaId);
  if (rol !== "domiciliario" && !enPruebasEn(ctx, tiendaId)) {
    await avisar(ctx, "⛔ Esta opción es para domiciliarios.");
    return;
  }
  const pedidos = await pedidosDeDomiciliario(tiendaId, ctx.from!.id);
  const teclado = new InlineKeyboard();
  for (const p of pedidos) {
    teclado.text(`${p.estado === "despachado" ? "🛵" : "📦"} ${numeroPedido(p.id)} · ${p.nombre_cliente}`, armar(P.entrega, "v", p.id)).row();
  }
  teclado.text("⬅️ Volver", armar(P.menu, "t", tiendaId));
  await mostrar(ctx, pedidos.length ? "🛵 <b>Mis entregas</b>" : "No tienes entregas pendientes por ahora 🙌", teclado);
}

async function sali(ctx: MiContexto, pedidoId: number) {
  const p = await obtenerPedido(pedidoId);
  if (!p) return;
  const rol = await rolParaPedidos(ctx, p.tienda_id);
  const esSuyo = p.domiciliario_telegram_id === ctx.from!.id;
  if (!esSuyo || !(rol === "domiciliario" || enPruebasEn(ctx, p.tienda_id))) {
    await avisar(ctx, "⛔ Este pedido no está asignado a ti.", true);
    return;
  }
  if (await despachar(ctx, p)) {
    await mostrarTarjeta(ctx, p.id, "🛵 ¡Buen viaje! Al entregar, pídele el código al cliente.");
  }
}

async function empezarEntrega(ctx: MiContexto, pedidoId: number) {
  const p = await obtenerPedido(pedidoId);
  if (!p) return;
  if (!await puedeEntregar(ctx, p)) {
    await avisar(ctx, "⛔ No puedes entregar este pedido.", true);
    return;
  }
  if (p.estado !== estadoParaEntregar(p)) {
    await avisar(ctx, "Este pedido no está pendiente de entrega.", true);
    return;
  }
  await iniciarFlujo(ctx, "codigo_entrega", "codigo", { pedido_id: p.id });
  await responder(ctx, `🔑 Pedido ${numeroPedido(p.id)}: escribe el código de 4 dígitos que te dice el cliente:`, tecladoCancelar());
}

async function flujoCodigo(ctx: MiContexto) {
  const texto = ctx.message?.text?.trim() ?? "";
  const p = await obtenerPedido(ctx.estado.datos.pedido_id as number);
  if (!p || p.estado !== estadoParaEntregar(p)) {
    await terminarFlujo(ctx);
    await responder(ctx, "Este pedido ya no está pendiente de entrega.");
    return;
  }
  if (codigoCorrecto(p.codigo_entrega, texto)) {
    await terminarFlujo(ctx);
    const ok = await cambiarEstado(p.id, [estadoParaEntregar(p)], "entregado", ctx.from!.id, {});
    if (!ok) {
      await responder(ctx, "Este pedido ya no está pendiente de entrega.");
      return;
    }
    await notificarCliente(p, `✅ Pedido entregado. ¡Gracias por comprar en ${escaparHtml(p.tienda.nombre)}! 💙`);
    await cerrarMensajes(p.id, `✅ Pedido ${numeroPedido(p.id)} entregado.`);
    await responder(ctx, `✅ Pedido ${numeroPedido(p.id)} entregado.`,
      new InlineKeyboard().text("⬅️ Menú de la tienda", armar(P.menu, "t", p.tienda_id)));
    return;
  }

  // Código incorrecto: se suma el intento y se alerta una sola vez (RN-33)
  const intentos = p.intentos_codigo_fallidos + 1;
  await db.from("pedidos").update({ intentos_codigo_fallidos: intentos }).eq("id", p.id);
  const config = await leerConfiguracion();
  if (debeAlertarCodigo(intentos, config.intentos_maximos_codigo_entrega, p.alerta_codigo_enviada)) {
    const { data } = await db.from("pedidos").update({ alerta_codigo_enviada: true })
      .eq("id", p.id).eq("alerta_codigo_enviada", false).select("id");
    if (data?.length) {
      await notificarTienda(p.tienda_id, "alerta_codigo",
        `⚠️ Ojo: en el pedido ${numeroPedido(p.id)} se ha escrito mal el código de entrega ${intentos} veces. Verifica con el cliente.`);
    }
  }
  await responder(ctx, "❌ Código incorrecto. Intenta de nuevo.", tecladoCancelar());
}

async function manejarEntrega(ctx: MiContexto, partes: string[]) {
  const id = num(partes, 2);
  switch (partes[1]) {
    case "l": return await misEntregas(ctx, id);
    case "v": return await mostrarTarjeta(ctx, id, "", false);
    case "sal": return await sali(ctx, id);
    case "e": return await empezarEntrega(ctx, id);
  }
}

registrarCallback(P.entrega, manejarEntrega);
registrarFlujo("codigo_entrega", flujoCodigo);
