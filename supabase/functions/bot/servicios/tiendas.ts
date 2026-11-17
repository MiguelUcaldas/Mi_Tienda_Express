// Acceso a datos de tiendas, horarios y medios de pago.
import { db } from "../../_compartido/supabase.ts";
import { generarSlug, slugDisponible } from "../logica/formato.ts";
import { estaAbierta, type Horario, proximaApertura, textoEstadoTienda, textoProximaApertura } from "../logica/horarios.ts";
import type { Rol } from "../logica/permisos.ts";

export interface Tienda {
  id: number;
  slug: string;
  nombre: string;
  descripcion: string | null;
  direccion: string;
  barrio_id: number | null;
  telefono_contacto: string | null;
  es_premium: boolean;
  activa: boolean;
}

export interface MedioPagoTienda {
  id: number;
  tienda_id: number;
  tipo: string;
  activo: boolean;
  // deno-lint-ignore no-explicit-any
  datos: Record<string, any>;
}

export async function obtenerTienda(id: number): Promise<Tienda | null> {
  if (!id) return null;
  const { data } = await db.from("tiendas").select("*").eq("id", id).maybeSingle();
  return (data as Tienda) ?? null;
}

export async function obtenerTiendaPorSlug(slug: string): Promise<Tienda | null> {
  const { data } = await db.from("tiendas").select("*").eq("slug", slug).maybeSingle();
  return (data as Tienda) ?? null;
}

export async function horariosDe(tiendaId: number): Promise<Horario[]> {
  const { data } = await db.from("horarios_tienda").select("dia_semana, hora_apertura, hora_cierre").eq("tienda_id", tiendaId);
  return (data ?? []) as Horario[];
}

export async function mediosDe(tiendaId: number, soloActivos = true): Promise<MedioPagoTienda[]> {
  let consulta = db.from("medios_pago_tienda").select("*").eq("tienda_id", tiendaId);
  if (soloActivos) consulta = consulta.eq("activo", true);
  const { data } = await consulta.order("id");
  return (data ?? []) as MedioPagoTienda[];
}

export interface EstadoApertura {
  abierta: boolean;
  texto: string; // "🟢 Abierta (cierra a las...)"
  textoAbre: string | null; // "mañana a las 7:00 a. m."
}

export async function estadoApertura(tiendaId: number, ahora = new Date()): Promise<EstadoApertura> {
  const horarios = await horariosDe(tiendaId);
  const prox = proximaApertura(horarios, ahora);
  return {
    abierta: estaAbierta(horarios, ahora),
    texto: textoEstadoTienda(horarios, ahora),
    textoAbre: prox ? textoProximaApertura(prox) : null,
  };
}

export async function buscarTiendas(texto: string): Promise<Tienda[]> {
  const { data } = await db.rpc("buscar_tiendas", { p_texto: texto });
  return (data ?? []) as Tienda[];
}

export async function tiendasRecomendadas(): Promise<Tienda[]> {
  const { data } = await db.from("tiendas").select("*").eq("es_premium", true).eq("activa", true).order("nombre").limit(10);
  return (data ?? []) as Tienda[];
}

export async function misTiendas(telegramId: number): Promise<{ tienda: Tienda; rol: Rol }[]> {
  const { data } = await db.from("miembros_tienda")
    .select("rol, tiendas(*)")
    .eq("telegram_id", telegramId)
    .eq("activo", true);
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[]).map((f) => ({ tienda: f.tiendas as Tienda, rol: f.rol as Rol }))
    .sort((a, b) => a.tienda.nombre.localeCompare(b.tienda.nombre));
}

export async function tieneMembresias(telegramId: number): Promise<boolean> {
  const { count } = await db.from("miembros_tienda")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramId)
    .eq("activo", true);
  return (count ?? 0) > 0;
}

export async function generarSlugUnico(nombre: string): Promise<string> {
  const base = generarSlug(nombre);
  const { data } = await db.from("tiendas").select("slug").like("slug", `${base}%`);
  return slugDisponible(base, (data ?? []).map((f) => f.slug as string));
}

export async function actualizarTienda(tiendaId: number, cambios: Partial<Tienda>) {
  const { error } = await db.from("tiendas").update(cambios).eq("id", tiendaId);
  if (error) throw new Error(`No se pudo actualizar la tienda: ${error.message}`);
}

export async function guardarHorarios(tiendaId: number, horarios: Horario[]) {
  await db.from("horarios_tienda").delete().eq("tienda_id", tiendaId);
  if (horarios.length === 0) return;
  const { error } = await db.from("horarios_tienda").insert(horarios.map((h) => ({ ...h, tienda_id: tiendaId })));
  if (error) throw new Error(`No se pudieron guardar los horarios: ${error.message}`);
}

// deno-lint-ignore no-explicit-any
export async function guardarMedioPago(tiendaId: number, tipo: string, activo: boolean, datos?: Record<string, any>) {
  // deno-lint-ignore no-explicit-any
  const fila: Record<string, any> = { tienda_id: tiendaId, tipo, activo };
  if (datos) fila.datos = datos;
  const { error } = await db.from("medios_pago_tienda").upsert(fila, { onConflict: "tienda_id,tipo" });
  if (error) throw new Error(`No se pudo guardar el medio de pago: ${error.message}`);
}

export async function duenoDe(tiendaId: number): Promise<number | null> {
  const { data } = await db.from("miembros_tienda")
    .select("telegram_id")
    .eq("tienda_id", tiendaId)
    .eq("rol", "dueno")
    .eq("activo", true)
    .maybeSingle();
  return data?.telegram_id ?? null;
}

export interface UsuarioBasico {
  telegram_id: number;
  nombre_telegram: string | null;
  username: string | null;
  nombre_entrega: string | null;
  telefono: string | null;
  ultimo_barrio_id: number | null;
  ultima_direccion: string | null;
}

export async function obtenerUsuario(telegramId: number): Promise<UsuarioBasico | null> {
  const { data } = await db.from("usuarios").select("*").eq("telegram_id", telegramId).maybeSingle();
  return (data as UsuarioBasico) ?? null;
}

export function nombreVisible(u: UsuarioBasico | null | undefined): string {
  if (!u) return "Alguien";
  return u.nombre_telegram || (u.username ? `@${u.username}` : `Usuario ${u.telegram_id}`);
}
