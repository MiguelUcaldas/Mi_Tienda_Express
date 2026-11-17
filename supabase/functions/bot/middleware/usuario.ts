// Middleware: registra al usuario, carga su estado de conversación y su modo pruebas.
import type { NextFunction } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { nombreCompleto } from "../logica/formato.ts";
import { cargarEstado } from "../servicios/conversacion.ts";
import { fijarUsernameBot } from "../servicios/telegram.ts";
import { cargarModoPruebas, esSuperAdmin } from "./rol.ts";

export async function middlewareUsuario(ctx: MiContexto, next: NextFunction) {
  const de = ctx.from;
  if (!de || de.is_bot) return;
  fijarUsernameBot(ctx.me?.username);

  await db.from("usuarios").upsert({
    telegram_id: de.id,
    nombre_telegram: nombreCompleto(de.first_name, de.last_name) || null,
    username: de.username ?? null,
    actualizado_en: new Date().toISOString(),
  }, { onConflict: "telegram_id" });

  ctx.estado = await cargarEstado(de.id);
  ctx.esSuperAdmin = esSuperAdmin(de.id);
  ctx.modoPruebas = ctx.esSuperAdmin ? await cargarModoPruebas(de.id) : null;
  ctx.callbackRespondido = false;
  await next();
}
