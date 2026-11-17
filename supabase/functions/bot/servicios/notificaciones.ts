// Notificaciones a la tienda, al cliente y al domiciliario, con las reglas de destinatarios (3.3)
// y el modo pruebas (11.17). Los mensajes con botones se guardan para editarlos ("gana el primero").
import type { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import { entorno } from "../../_compartido/entorno.ts";
import type { RolMiembro } from "../logica/permisos.ts";
import { editarMensaje, enviarFoto, enviarTexto, type MensajeEnviado } from "./telegram.ts";

export type TipoAviso =
  | "pedido_nuevo"
  | "recordatorio"
  | "cancelacion"
  | "seguimiento"
  | "comprobante"
  | "agotado"
  | "alerta_codigo";

const ROLES_POR_TIPO: Record<TipoAviso, RolMiembro[]> = {
  pedido_nuevo: ["dueno", "administrador", "empleado"],
  recordatorio: ["dueno", "administrador", "empleado"],
  cancelacion: ["dueno", "administrador", "empleado"],
  seguimiento: ["dueno", "administrador", "empleado"],
  comprobante: ["dueno", "administrador"],
  agotado: ["dueno", "administrador"],
  alerta_codigo: ["dueno", "administrador"],
};

export const ETIQUETA_VISTA = {
  tienda: "🧪 [Vista tienda]\n",
  cliente: "🧪 [Vista cliente]\n",
  domiciliario: "🧪 [Vista domiciliario]\n",
};

// telegram_id del Super Admin si tiene el modo pruebas activo en esa tienda
export async function superAdminEnPruebas(tiendaId: number): Promise<number | null> {
  const id = parseInt(entorno.superAdminId, 10);
  if (Number.isNaN(id)) return null;
  const { data } = await db.from("modo_pruebas").select("telegram_id").eq("telegram_id", id).eq("tienda_id", tiendaId).maybeSingle();
  return data ? id : null;
}

interface Destinatario {
  telegram_id: number;
  vista: boolean; // true = lo recibe solo por el modo pruebas
}

export async function destinatariosTienda(tiendaId: number, tipo: TipoAviso): Promise<Destinatario[]> {
  const { data } = await db.from("miembros_tienda").select("telegram_id")
    .eq("tienda_id", tiendaId).eq("activo", true).in("rol", ROLES_POR_TIPO[tipo]);
  const lista: Destinatario[] = [];
  const vistos = new Set<number>();
  for (const f of data ?? []) {
    if (vistos.has(f.telegram_id)) continue;
    vistos.add(f.telegram_id);
    lista.push({ telegram_id: f.telegram_id, vista: false });
  }
  const sa = await superAdminEnPruebas(tiendaId);
  if (sa !== null && !vistos.has(sa)) lista.push({ telegram_id: sa, vista: true });
  return lista;
}

export async function registrarMensaje(pedidoId: number, enviado: MensajeEnviado | null, tipo: string) {
  if (!enviado) return;
  await db.from("mensajes_notificacion").insert({
    pedido_id: pedidoId,
    chat_id: enviado.chat_id,
    message_id: enviado.message_id,
    tipo,
    es_foto: enviado.es_foto,
  });
}

interface OpcionesTienda {
  teclado?: InlineKeyboard;
  pedidoId?: number; // si viene con teclado, se guarda el mensaje
  tipoRegistro?: string;
  excluir?: number[]; // telegram_ids que no deben recibirlo (ej. quien hizo la acción)
}

export async function notificarTienda(tiendaId: number, tipo: TipoAviso, texto: string, op: OpcionesTienda = {}) {
  const destinatarios = await destinatariosTienda(tiendaId, tipo);
  for (const d of destinatarios) {
    if (op.excluir?.includes(d.telegram_id)) continue;
    const enviado = await enviarTexto(d.telegram_id, (d.vista ? ETIQUETA_VISTA.tienda : "") + texto, op.teclado);
    if (op.pedidoId && op.teclado) await registrarMensaje(op.pedidoId, enviado, op.tipoRegistro ?? tipo);
  }
}

export async function notificarTiendaFoto(
  tiendaId: number,
  tipo: TipoAviso,
  fileId: string,
  pie: string,
  teclado: InlineKeyboard,
  pedidoId: number,
) {
  for (const d of await destinatariosTienda(tiendaId, tipo)) {
    const enviado = await enviarFoto(d.telegram_id, fileId, (d.vista ? ETIQUETA_VISTA.tienda : "") + pie, teclado);
    await registrarMensaje(pedidoId, enviado, tipo);
  }
}

interface PedidoMinimo {
  id: number;
  tienda_id: number;
  cliente_telegram_id: number;
}

// Al cliente; si el Super Admin está en pruebas en esa tienda y no es el cliente, también lo ve
export async function notificarCliente(p: PedidoMinimo, texto: string, teclado?: InlineKeyboard, tipoRegistro?: string) {
  const enviado = await enviarTexto(p.cliente_telegram_id, texto, teclado);
  if (tipoRegistro) await registrarMensaje(p.id, enviado, tipoRegistro);
  const sa = await superAdminEnPruebas(p.tienda_id);
  if (sa !== null && sa !== p.cliente_telegram_id) {
    const copia = await enviarTexto(sa, ETIQUETA_VISTA.cliente + texto, teclado);
    if (tipoRegistro) await registrarMensaje(p.id, copia, tipoRegistro);
  }
}

export async function notificarDomiciliario(
  p: PedidoMinimo,
  domiciliarioId: number,
  texto: string,
  teclado?: InlineKeyboard,
  tipoRegistro?: string,
) {
  const enviado = await enviarTexto(domiciliarioId, texto, teclado);
  if (tipoRegistro) await registrarMensaje(p.id, enviado, tipoRegistro);
  const sa = await superAdminEnPruebas(p.tienda_id);
  if (sa !== null && sa !== domiciliarioId) {
    const copia = await enviarTexto(sa, ETIQUETA_VISTA.domiciliario + texto, teclado);
    if (tipoRegistro) await registrarMensaje(p.id, copia, tipoRegistro);
  }
}

interface OpcionesCierre {
  tipos?: string[]; // solo estos tipos; sin valor = todos
  excepto?: { chat_id: number; message_id: number };
}

// Edita los mensajes guardados de un pedido con un texto final y les quita los botones
export async function cerrarMensajes(pedidoId: number, texto: string, op: OpcionesCierre = {}) {
  let consulta = db.from("mensajes_notificacion").select("*").eq("pedido_id", pedidoId);
  if (op.tipos) consulta = consulta.in("tipo", op.tipos);
  const { data } = await consulta;
  const cerrados: number[] = [];
  for (const m of data ?? []) {
    if (op.excepto && m.chat_id === op.excepto.chat_id && m.message_id === op.excepto.message_id) continue;
    await editarMensaje(m.chat_id, m.message_id, m.es_foto, texto);
    cerrados.push(m.id);
  }
  if (cerrados.length) await db.from("mensajes_notificacion").delete().in("id", cerrados);
}

// Asegura que el mensaje donde actúa alguien quede guardado con el tipo indicado
export async function guardarMensajeActual(pedidoId: number, chatId: number, messageId: number, esFoto: boolean, tipo: string) {
  await db.from("mensajes_notificacion").delete().eq("pedido_id", pedidoId).eq("chat_id", chatId).eq("message_id", messageId);
  await registrarMensaje(pedidoId, { chat_id: chatId, message_id: messageId, es_foto: esFoto }, tipo);
}
