// Envío de mensajes fuera del contexto de una actualización (notificaciones y tareas).
import { Api, type InlineKeyboard } from "npm:grammy@^1";
import { entorno } from "../../_compartido/entorno.ts";

export const api = new Api(entorno.tokenBot);

let usernameBot = "Mi_Tienda_Express_Bot";

export function fijarUsernameBot(username?: string) {
  if (username) usernameBot = username;
}

export function enlaceBot(carga: string): string {
  return `https://t.me/${usernameBot}?start=${carga}`;
}

export interface MensajeEnviado {
  chat_id: number;
  message_id: number;
  es_foto: boolean;
}

function registrarFallo(accion: string, chatId: number, error: unknown) {
  const texto = String(error);
  if (texto.includes("403")) {
    console.warn(`${accion}: el usuario ${chatId} bloqueó el bot`);
  } else {
    console.error(`${accion} a ${chatId} falló:`, texto);
  }
}

export async function enviarTexto(
  chatId: number,
  texto: string,
  teclado?: InlineKeyboard,
): Promise<MensajeEnviado | null> {
  try {
    const m = await api.sendMessage(chatId, texto, {
      parse_mode: "HTML",
      reply_markup: teclado,
      link_preview_options: { is_disabled: true },
    });
    return { chat_id: chatId, message_id: m.message_id, es_foto: false };
  } catch (e) {
    registrarFallo("sendMessage", chatId, e);
    return null;
  }
}

export async function enviarFoto(
  chatId: number,
  fileId: string,
  pie: string,
  teclado?: InlineKeyboard,
): Promise<MensajeEnviado | null> {
  try {
    const m = await api.sendPhoto(chatId, fileId, { caption: pie, parse_mode: "HTML", reply_markup: teclado });
    return { chat_id: chatId, message_id: m.message_id, es_foto: true };
  } catch (e) {
    registrarFallo("sendPhoto", chatId, e);
    return null;
  }
}

// Edita texto o pie de foto. Sin teclado = se quitan los botones.
export async function editarMensaje(
  chatId: number,
  messageId: number,
  esFoto: boolean,
  texto: string,
  teclado?: InlineKeyboard,
): Promise<boolean> {
  try {
    if (esFoto) {
      await api.editMessageCaption(chatId, messageId, { caption: texto, parse_mode: "HTML", reply_markup: teclado });
    } else {
      await api.editMessageText(chatId, messageId, texto, {
        parse_mode: "HTML",
        reply_markup: teclado,
        link_preview_options: { is_disabled: true },
      });
    }
    return true;
  } catch (e) {
    if (!String(e).includes("not modified")) registrarFallo("editMessage", chatId, e);
    return false;
  }
}
