// Estado de conversación en la tabla estados_conversacion (el bot no guarda nada en memoria).
import { db } from "../../_compartido/supabase.ts";
import type { DatosFlujo, EstadoConversacion, MiContexto } from "../contexto.ts";

export async function cargarEstado(telegramId: number): Promise<EstadoConversacion> {
  const { data } = await db.from("estados_conversacion").select("*").eq("telegram_id", telegramId).maybeSingle();
  if (data) return { ...data, datos: data.datos ?? {} } as EstadoConversacion;
  const nuevo: EstadoConversacion = { telegram_id: telegramId, tienda_activa_id: null, flujo: null, paso: null, datos: {} };
  await db.from("estados_conversacion").upsert(nuevo);
  return nuevo;
}

async function guardar(ctx: MiContexto) {
  const e = ctx.estado;
  const { error } = await db.from("estados_conversacion").update({
    tienda_activa_id: e.tienda_activa_id,
    flujo: e.flujo,
    paso: e.paso,
    datos: e.datos,
    actualizado_en: new Date().toISOString(),
  }).eq("telegram_id", e.telegram_id);
  if (error) throw new Error(`No se pudo guardar el estado: ${error.message}`);
}

export async function iniciarFlujo(ctx: MiContexto, flujo: string, paso: string, datos: DatosFlujo = {}) {
  ctx.estado.flujo = flujo;
  ctx.estado.paso = paso;
  ctx.estado.datos = datos;
  await guardar(ctx);
}

// Cambia de paso y mezcla datos nuevos con los que ya había
export async function irAPaso(ctx: MiContexto, paso: string, datosNuevos: DatosFlujo = {}) {
  ctx.estado.paso = paso;
  ctx.estado.datos = { ...ctx.estado.datos, ...datosNuevos };
  await guardar(ctx);
}

// Pasa a otro flujo conservando los datos acumulados (para sub-flujos)
export async function cambiarFlujo(ctx: MiContexto, flujo: string, paso: string, datosNuevos: DatosFlujo = {}) {
  ctx.estado.flujo = flujo;
  await irAPaso(ctx, paso, datosNuevos);
}

export async function terminarFlujo(ctx: MiContexto) {
  ctx.estado.flujo = null;
  ctx.estado.paso = null;
  ctx.estado.datos = {};
  await guardar(ctx);
}

export async function fijarTiendaActiva(ctx: MiContexto, tiendaId: number | null) {
  ctx.estado.tienda_activa_id = tiendaId;
  await guardar(ctx);
}

export function enFlujo(ctx: MiContexto, flujo: string): boolean {
  return ctx.estado.flujo === flujo;
}
