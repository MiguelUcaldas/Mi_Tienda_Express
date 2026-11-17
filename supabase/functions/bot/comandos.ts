// Comandos /start (con enlaces profundos), /menu, /cancelar y /ayuda.
import type { MiContexto } from "./contexto.ts";
import { mostrarInvitacion } from "./flujos/invitacion.ts";
import { entrarTienda, mostrarMenuInicial, volverAlMenu } from "./menus/inicial.ts";
import { terminarFlujo } from "./servicios/conversacion.ts";
import { obtenerTiendaPorSlug } from "./servicios/tiendas.ts";
import { responder } from "./ui.ts";

export async function comandoStart(ctx: MiContexto) {
  const carga = typeof ctx.match === "string" ? ctx.match.trim() : "";
  await terminarFlujo(ctx);
  if (carga.startsWith("t_")) {
    const tienda = await obtenerTiendaPorSlug(carga.slice(2));
    if (tienda) return await entrarTienda(ctx, tienda.id, true);
    await responder(ctx, "😕 No encontré esa tienda. Búscala por nombre 🔍");
  } else if (carga.startsWith("inv_")) {
    return await mostrarInvitacion(ctx, carga.slice(4));
  }
  await mostrarMenuInicial(ctx, true);
}

export async function comandoMenu(ctx: MiContexto) {
  await terminarFlujo(ctx);
  await volverAlMenu(ctx, true);
}

export async function comandoCancelar(ctx: MiContexto) {
  await terminarFlujo(ctx);
  await ctx.reply("Listo, cancelado 👍", { reply_markup: { remove_keyboard: true } });
  await volverAlMenu(ctx, true);
}

export async function comandoAyuda(ctx: MiContexto) {
  await responder(ctx, [
    "ℹ️ <b>Mi Tienda Express</b>",
    "Compra en las tiendas de tu barrio desde Telegram, sin crear cuenta.",
    "",
    "🛒 <b>Para comprar:</b> entra a una tienda (por su enlace, con 🔍 Buscar tienda o ⭐ Recomiéndame tiendas), " +
    "arma tu carrito y toca ✅ Hacer pedido. Te pediremos tus datos al confirmar y te avisaremos cada paso.",
    "",
    "🏪 <b>¿Tienes una tienda?</b> Toca ➕ Registrar mi tienda en el /menu, sube tus productos y comparte tu enlace.",
    "",
    "❌ Escribe /cancelar para salir de cualquier paso.",
    "📋 Escribe /menu para volver al inicio.",
  ].join("\n"));
}
