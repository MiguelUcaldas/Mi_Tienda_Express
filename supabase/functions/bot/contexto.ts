// Tipo de contexto del bot: el de grammY más lo que cargan los middlewares.
import type { Context } from "npm:grammy@^1";
import type { Rol } from "./logica/permisos.ts";

// deno-lint-ignore no-explicit-any
export type DatosFlujo = Record<string, any>;

export interface EstadoConversacion {
  telegram_id: number;
  tienda_activa_id: number | null;
  flujo: string | null;
  paso: string | null;
  datos: DatosFlujo;
}

export interface ModoPruebasActivo {
  tienda_id: number;
  rol: Rol;
  tienda_nombre: string;
}

export interface ExtrasContexto {
  estado: EstadoConversacion;
  modoPruebas: ModoPruebasActivo | null;
  esSuperAdmin: boolean;
  callbackRespondido: boolean;
}

export type MiContexto = Context & ExtrasContexto;
