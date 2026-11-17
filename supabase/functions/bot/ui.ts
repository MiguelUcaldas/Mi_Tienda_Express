// Respuestas al usuario dentro de una actualización.
import type { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "./contexto.ts";
import { escaparHtml } from "./logica/formato.ts";
import { NOMBRES_ROL } from "./logica/permisos.ts";

// 🧪 Encabezado del modo pruebas cuando el Super Admin está "parado" en esa tienda (11.17)
export function banner(ctx: MiContexto): string {
  const mp = ctx.modoPruebas;
  if (!mp || ctx.estado?.tienda_activa_id !== mp.tienda_id) return "";
  return `🧪 <i>Probando como ${NOMBRES_ROL[mp.rol]} – ${escaparHtml(mp.tienda_nombre)}</i>\n\n`;
}

const OPCIONES_BASE = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

// Si viene de un botón, edita ese mensaje; si no se puede, envía uno nuevo
export async function mostrar(ctx: MiContexto, texto: string, teclado?: InlineKeyboard) {
  const completo = banner(ctx) + texto;
  const mensaje = ctx.callbackQuery?.message;
  if (mensaje && !("photo" in mensaje && mensaje.photo)) {
    try {
      await ctx.editMessageText(completo, { ...OPCIONES_BASE, reply_markup: teclado });
      return;
    } catch (e) {
      if (String(e).includes("not modified")) return;
    }
  }
  await ctx.reply(completo, { ...OPCIONES_BASE, reply_markup: teclado });
}

// Siempre envía un mensaje nuevo
export async function responder(ctx: MiContexto, texto: string, teclado?: InlineKeyboard) {
  await ctx.reply(banner(ctx) + texto, { ...OPCIONES_BASE, reply_markup: teclado });
}

// Aviso corto: en botones se muestra como notificación; en mensajes, como respuesta
export async function avisar(ctx: MiContexto, texto: string, alerta = false) {
  if (ctx.callbackQuery) {
    if (ctx.callbackRespondido) return;
    ctx.callbackRespondido = true;
    try {
      await ctx.answerCallbackQuery({ text: texto, show_alert: alerta });
    } catch (_) {
      // El botón pudo haber vencido; no es grave
    }
    return;
  }
  await responder(ctx, texto);
}

// Quita los botones del mensaje del botón tocado (sin cambiar el texto)
export async function quitarBotones(ctx: MiContexto) {
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (_) {
    // Nada que hacer
  }
}
