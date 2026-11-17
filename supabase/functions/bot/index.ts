// Edge Function "bot": enruta /tareas (pg_cron), /configurar (despliegue) y el webhook de Telegram.
import { webhookCallback } from "npm:grammy@^1";
import { entorno, secretosIguales } from "../_compartido/entorno.ts";
import { db } from "../_compartido/supabase.ts";
import { crearBot } from "./bot.ts";
import { fijarUsernameBot } from "./servicios/telegram.ts";
import { ejecutarTareas } from "./tareas/temporizadores.ts";

const bot = crearBot();
const manejarWebhook = webhookCallback(bot, "std/http", { secretToken: entorno.secretoWebhook });

const SLUGS_SEMILLA = ["mercaldas", "minimercado_la_esquina"];

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

function autorizado(req: Request): boolean {
  return secretosIguales(req.headers.get("x-secreto-tareas"), entorno.secretoWebhook);
}

async function prepararBot() {
  if (!bot.isInited()) await bot.init();
  fijarUsernameBot(bot.botInfo.username);
}

// Las tiendas semilla sin dueño quedan a nombre del Super Admin
async function asignarDuenosSemilla(): Promise<string> {
  const superId = parseInt(entorno.superAdminId, 10);
  await db.from("usuarios").upsert({ telegram_id: superId }, { onConflict: "telegram_id", ignoreDuplicates: true });
  const { data: tiendas } = await db.from("tiendas").select("id").in("slug", SLUGS_SEMILLA);
  let asignadas = 0;
  for (const t of tiendas ?? []) {
    const { count } = await db.from("miembros_tienda").select("id", { count: "exact", head: true })
      .eq("tienda_id", t.id).eq("rol", "dueno").eq("activo", true);
    if ((count ?? 0) > 0) continue;
    // Si ya era miembro con otro rol, esa membresía se cierra para dejarlo como dueño
    await db.from("miembros_tienda").update({ activo: false }).eq("tienda_id", t.id).eq("telegram_id", superId).eq("activo", true);
    const { error } = await db.from("miembros_tienda").insert({ tienda_id: t.id, telegram_id: superId, rol: "dueno" });
    if (!error) asignadas++;
  }
  return `${asignadas} tienda(s) semilla asignadas al Super Admin`;
}

async function configurar(): Promise<Record<string, string>> {
  const resultado: Record<string, string> = {};
  const urlBot = `${entorno.supabaseUrl}/functions/v1/bot`;
  try {
    await bot.api.setWebhook(urlBot, {
      secret_token: entorno.secretoWebhook,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
    resultado.webhook = "ok";
  } catch (e) {
    resultado.webhook = `error: ${e}`;
  }
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Inicio" },
      { command: "menu", description: "Menú" },
      { command: "cancelar", description: "Cancelar lo que estoy haciendo" },
      { command: "ayuda", description: "Ayuda" },
    ]);
    resultado.comandos = "ok";
  } catch (e) {
    resultado.comandos = `error: ${e}`;
  }
  try {
    const { error } = await db.rpc("programar_tareas", { p_url: `${urlBot}/tareas`, p_secreto: entorno.secretoWebhook });
    resultado.tareas = error ? `error: ${error.message}` : "ok";
  } catch (e) {
    resultado.tareas = `error: ${e}`;
  }
  try {
    resultado.duenos = await asignarDuenosSemilla();
  } catch (e) {
    resultado.duenos = `error: ${e}`;
  }
  return resultado;
}

Deno.serve(async (req: Request) => {
  const ruta = new URL(req.url).pathname.replace(/\/+$/, "");
  try {
    if (req.method === "POST" && ruta.endsWith("/tareas")) {
      if (!autorizado(req)) return json({ ok: false }, 401);
      await prepararBot();
      const detalle = await ejecutarTareas();
      console.log("tareas:", JSON.stringify(detalle));
      return json({ ok: true });
    }
    if (req.method === "POST" && ruta.endsWith("/configurar")) {
      if (!autorizado(req)) return json({ ok: false }, 401);
      await prepararBot();
      return json({ ok: true, ...(await configurar()) });
    }
    if (req.method === "POST" && ruta.endsWith("/bot")) {
      return await manejarWebhook(req);
    }
    return json({ ok: false, error: "No encontrado" }, 404);
  } catch (e) {
    console.error("Error en la función bot:", e);
    return json({ ok: false }, 500);
  }
});
