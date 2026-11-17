// Resolución de rol (sección 10.5) y validación de permisos en el servidor.
import { db } from "../../_compartido/supabase.ts";
import { entorno } from "../../_compartido/entorno.ts";
import type { MiContexto, ModoPruebasActivo } from "../contexto.ts";
import { type Accion, puede, type Rol } from "../logica/permisos.ts";
import { avisar } from "../ui.ts";

export function esSuperAdmin(telegramId: number | undefined): boolean {
  return telegramId !== undefined && String(telegramId) === entorno.superAdminId;
}

export async function cargarModoPruebas(telegramId: number): Promise<ModoPruebasActivo | null> {
  const { data } = await db.from("modo_pruebas")
    .select("tienda_id, rol, tiendas(nombre)")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const tienda = (data as any).tiendas;
  return { tienda_id: data.tienda_id, rol: data.rol as Rol, tienda_nombre: tienda?.nombre ?? "" };
}

// 1) modo pruebas en esa tienda → rol simulado; 2) membresía activa; 3) cliente
export async function obtenerRol(
  telegramId: number,
  tiendaId: number,
  modoPruebas: ModoPruebasActivo | null = null,
): Promise<Rol> {
  if (modoPruebas && modoPruebas.tienda_id === tiendaId) return modoPruebas.rol;
  const { data } = await db.from("miembros_tienda")
    .select("rol")
    .eq("tienda_id", tiendaId)
    .eq("telegram_id", telegramId)
    .eq("activo", true)
    .maybeSingle();
  return (data?.rol as Rol) ?? "cliente";
}

export function rolDe(ctx: MiContexto, tiendaId: number): Promise<Rol> {
  return obtenerRol(ctx.from!.id, tiendaId, ctx.modoPruebas);
}

// ¿El Super Admin está en modo pruebas en esta tienda?
export function enPruebasEn(ctx: MiContexto, tiendaId: number): boolean {
  return ctx.esSuperAdmin && ctx.modoPruebas?.tienda_id === tiendaId;
}

// En modo pruebas, los botones de pedidos funcionan con permisos de la vista tienda (11.17)
export async function rolParaPedidos(ctx: MiContexto, tiendaId: number): Promise<Rol> {
  if (enPruebasEn(ctx, tiendaId)) return "dueno";
  return await rolDe(ctx, tiendaId);
}

// Valida el permiso; si no lo tiene, avisa y devuelve null
export async function exigir(ctx: MiContexto, tiendaId: number, accion: Accion): Promise<Rol | null> {
  const rol = await rolDe(ctx, tiendaId);
  if (puede(rol, accion)) return rol;
  await avisar(ctx, "⛔ No tienes permiso para hacer eso.");
  return null;
}

// Igual que exigir, pero con los permisos de la vista tienda del modo pruebas
export async function exigirEnPedidos(ctx: MiContexto, tiendaId: number, accion: Accion): Promise<Rol | null> {
  const rol = await rolParaPedidos(ctx, tiendaId);
  if (puede(rol, accion)) return rol;
  await avisar(ctx, "⛔ No tienes permiso para hacer eso.");
  return null;
}

// Configurar la tienda: el dueño o el Super Admin
export async function exigirConfiguracion(ctx: MiContexto, tiendaId: number): Promise<boolean> {
  if (ctx.esSuperAdmin) return true;
  return (await exigir(ctx, tiendaId, "configurar_tienda")) !== null;
}
