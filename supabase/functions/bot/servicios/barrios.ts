// Catálogo de barrios de Manizales agrupados por comuna.
import { db } from "../../_compartido/supabase.ts";

export interface Barrio {
  id: number;
  nombre: string;
  comuna: string;
  orden_comuna: number;
}

export interface Comuna {
  comuna: string;
  orden_comuna: number;
}

export async function listarComunas(): Promise<Comuna[]> {
  const { data } = await db.from("barrios").select("comuna, orden_comuna").order("orden_comuna");
  const vistas = new Map<number, Comuna>();
  for (const fila of (data ?? []) as Comuna[]) {
    if (!vistas.has(fila.orden_comuna)) vistas.set(fila.orden_comuna, fila);
  }
  return [...vistas.values()];
}

export async function barriosDeComuna(orden: number): Promise<Barrio[]> {
  const { data } = await db.from("barrios").select("*").eq("orden_comuna", orden).order("nombre");
  return (data ?? []) as Barrio[];
}

export async function obtenerBarrio(id: number | null | undefined): Promise<Barrio | null> {
  if (!id) return null;
  const { data } = await db.from("barrios").select("*").eq("id", id).maybeSingle();
  return (data as Barrio) ?? null;
}
