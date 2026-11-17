// Miembros de la tienda, invitaciones y transferencia.
import { db, leerErrorSql } from "../../_compartido/supabase.ts";
import { generarCodigoInvitacion } from "../logica/codigo_entrega.ts";
import type { RolMiembro } from "../logica/permisos.ts";
import { leerConfiguracion } from "./configuracion.ts";

export interface Miembro {
  telegram_id: number;
  rol: RolMiembro;
  nombre: string;
}

const ORDEN_ROL: Record<RolMiembro, number> = { dueno: 0, administrador: 1, empleado: 2, domiciliario: 3 };

export async function miembrosActivos(tiendaId: number): Promise<Miembro[]> {
  const { data } = await db.from("miembros_tienda").select("telegram_id, rol, usuarios(nombre_telegram, username)")
    .eq("tienda_id", tiendaId).eq("activo", true);
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[]).map((f) => ({
    telegram_id: f.telegram_id,
    rol: f.rol as RolMiembro,
    nombre: f.usuarios?.nombre_telegram || (f.usuarios?.username ? `@${f.usuarios.username}` : String(f.telegram_id)),
  })).sort((a, b) => ORDEN_ROL[a.rol] - ORDEN_ROL[b.rol] || a.nombre.localeCompare(b.nombre));
}

export async function miembro(tiendaId: number, telegramId: number): Promise<Miembro | null> {
  return (await miembrosActivos(tiendaId)).find((m) => m.telegram_id === telegramId) ?? null;
}

export async function crearInvitacion(tiendaId: number, rol: RolMiembro, creadaPor: number): Promise<string> {
  const config = await leerConfiguracion();
  const expira = new Date(Date.now() + config.horas_vencimiento_invitacion * 3_600_000).toISOString();
  for (let intento = 0; intento < 5; intento++) {
    const codigo = generarCodigoInvitacion();
    const { error } = await db.from("invitaciones").insert({ codigo, tienda_id: tiendaId, rol, creada_por: creadaPor, expira_en: expira });
    if (!error) return codigo;
  }
  throw new Error("No se pudo generar un código de invitación único");
}

export async function cambiarRol(tiendaId: number, telegramId: number, rol: RolMiembro) {
  const { error } = await db.from("miembros_tienda").update({ rol, actualizado_en: new Date().toISOString() })
    .eq("tienda_id", tiendaId).eq("telegram_id", telegramId).eq("activo", true).neq("rol", "dueno");
  if (error) throw new Error(`cambiar rol: ${error.message}`);
}

// RN-39: quitar = activo false (nunca al dueño)
export async function quitarMiembro(tiendaId: number, telegramId: number) {
  const { error } = await db.from("miembros_tienda").update({ activo: false, actualizado_en: new Date().toISOString() })
    .eq("tienda_id", tiendaId).eq("telegram_id", telegramId).eq("activo", true).neq("rol", "dueno");
  if (error) throw new Error(`quitar miembro: ${error.message}`);
}

// RN-42. Devuelve el telegram_id del dueño anterior o un código de error legible.
export async function transferirTienda(tiendaId: number, nuevoDueno: number): Promise<{ anterior: number | null; error: string | null }> {
  const { data, error } = await db.rpc("transferir_tienda", { p_tienda: tiendaId, p_nuevo_dueno: nuevoDueno });
  if (error) return { anterior: null, error: leerErrorSql(error).codigo };
  return { anterior: (data as number | null) ?? null, error: null };
}
