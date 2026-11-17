// Registro de manejadores: cada módulo de flujos/ y menus/ registra sus prefijos y flujos.
import type { MiContexto } from "./contexto.ts";

export type ManejadorCallback = (ctx: MiContexto, partes: string[]) => Promise<void>;
export type ManejadorFlujo = (ctx: MiContexto) => Promise<void>;

const callbacks = new Map<string, ManejadorCallback>();
const flujos = new Map<string, ManejadorFlujo>();

export function registrarCallback(prefijo: string, manejador: ManejadorCallback) {
  if (callbacks.has(prefijo)) throw new Error(`Prefijo repetido: ${prefijo}`);
  callbacks.set(prefijo, manejador);
}

export function registrarFlujo(nombre: string, manejador: ManejadorFlujo) {
  if (flujos.has(nombre)) throw new Error(`Flujo repetido: ${nombre}`);
  flujos.set(nombre, manejador);
}

export function manejadorCallback(prefijo: string): ManejadorCallback | undefined {
  return callbacks.get(prefijo);
}

export function manejadorFlujo(nombre: string): ManejadorFlujo | undefined {
  return flujos.get(nombre);
}
