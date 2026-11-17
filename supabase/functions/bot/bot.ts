// Instancia de grammY, middlewares y registro de manejadores.
import { Bot } from "npm:grammy@^1";
import { entorno } from "../_compartido/entorno.ts";
import { comandoAyuda, comandoCancelar, comandoMenu, comandoStart } from "./comandos.ts";
import type { MiContexto } from "./contexto.ts";
import { leer } from "./datos_callback.ts";
import { manejadorCallback, manejadorFlujo } from "./enrutador.ts";
import { middlewareUsuario } from "./middleware/usuario.ts";
import { terminarFlujo } from "./servicios/conversacion.ts";
import { responder } from "./ui.ts";

// Cada módulo registra sus botones y flujos al importarse
import "./menus/inicial.ts";
import "./menus/cliente.ts";
import "./menus/personal.ts";
import "./flujos/catalogo.ts";
import "./flujos/carrito.ts";
import "./flujos/checkout.ts";
import "./flujos/pedidos_tienda.ts";
import "./flujos/pedidos_listas.ts";
import "./flujos/pedidos_cliente.ts";
import "./flujos/pagos.ts";
import "./flujos/entregas.ts";
import "./flujos/comun_tienda.ts";
import "./flujos/registro_tienda.ts";
import "./flujos/mi_tienda.ts";
import "./flujos/equipo.ts";
import "./flujos/invitacion.ts";
import "./flujos/productos.ts";
import "./flujos/inventario.ts";
import "./flujos/promociones.ts";
import "./flujos/domicilios.ts";
import "./flujos/reportes.ts";
import "./flujos/super_admin.ts";
import "./flujos/modo_pruebas.ts";
import { recibirComprobante } from "./flujos/pagos.ts";

// Flujos que esperan una foto (si no, la foto puede ser un comprobante de pago)
const FLUJOS_CON_FOTO = ["crear_producto", "editar_producto"];

async function despacharCallback(ctx: MiContexto) {
  const partes = leer(ctx.callbackQuery?.data ?? "");
  try {
    const manejador = manejadorCallback(partes[0]);
    if (manejador) await manejador(ctx, partes);
  } finally {
    if (!ctx.callbackRespondido) {
      ctx.callbackRespondido = true;
      try {
        await ctx.answerCallbackQuery();
      } catch (_) {
        // El botón pudo haber vencido
      }
    }
  }
}

async function despacharMensaje(ctx: MiContexto) {
  const flujo = ctx.estado.flujo;
  const esFoto = !!ctx.message?.photo;
  if (esFoto && !(flujo && FLUJOS_CON_FOTO.includes(flujo))) {
    if (await recibirComprobante(ctx)) return;
  }
  if (flujo) {
    const manejador = manejadorFlujo(flujo);
    if (manejador) return await manejador(ctx);
    await terminarFlujo(ctx);
  }
  await responder(ctx, esFoto
    ? "📸 No estaba esperando una foto. Usa /menu para ver las opciones."
    : "🤔 No te entendí. Usa /menu para ver las opciones o /ayuda si necesitas una mano.");
}

export function crearBot(): Bot<MiContexto> {
  const bot = new Bot<MiContexto>(entorno.tokenBot);

  bot.use(middlewareUsuario);
  bot.command("start", comandoStart);
  bot.command("menu", comandoMenu);
  bot.command("cancelar", comandoCancelar);
  bot.command("ayuda", comandoAyuda);
  bot.on("callback_query:data", despacharCallback);
  bot.on(["message:text", "message:photo", "message:contact"], despacharMensaje);

  bot.catch(async (err) => {
    console.error("Error atendiendo la actualización:", err.error);
    try {
      await err.ctx.reply("😕 Algo salió mal. Intenta de nuevo con /menu");
    } catch (_) {
      // Si tampoco se puede responder, solo queda el registro
    }
  });
  return bot;
}
