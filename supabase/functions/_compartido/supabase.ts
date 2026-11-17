// Cliente de Supabase con la llave secreta (salta RLS; solo se usa en el servidor).
import { createClient } from "npm:@supabase/supabase-js@2";
import { entorno } from "./entorno.ts";

function obtenerLlaveSecreta(): string {
  const llaves = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (llaves) {
    const valor = JSON.parse(llaves)["default"];
    if (valor) return valor;
  }
  const heredada = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (heredada) return heredada;
  throw new Error("No se encontró la llave secreta de Supabase en el entorno de la función.");
}

export const db = createClient(entorno.supabaseUrl, obtenerLlaveSecreta(), {
  auth: { persistSession: false },
});

// Convierte "STOCK_INSUFICIENTE:15" en { codigo: "STOCK_INSUFICIENTE", dato: "15" }
export function leerErrorSql(error: { message?: string } | null): { codigo: string; dato: string | null } {
  const mensaje = error?.message ?? "";
  const [codigo, dato] = mensaje.split(":");
  return { codigo: codigo.trim(), dato: dato?.trim() ?? null };
}
