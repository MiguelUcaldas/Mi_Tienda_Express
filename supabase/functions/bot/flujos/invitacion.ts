// Aceptar invitación (/start inv_CODIGO), RN-38.
import { InlineKeyboard } from "npm:grammy@^1";
import { db, leerErrorSql } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { escaparHtml } from "../logica/formato.ts";
import { NOMBRES_ROL, type Rol } from "../logica/permisos.ts";
import { entrarTienda, mostrarMenuInicial } from "../menus/inicial.ts";
import { esSuperAdmin, obtenerRol } from "../middleware/rol.ts";
import { enviarTexto } from "../servicios/telegram.ts";
import { obtenerTienda } from "../servicios/tiendas.ts";
import { avisar, mostrar, responder } from "../ui.ts";
import { nombreActor } from "./pedidos_comun.ts";

const ERRORES: Record<string, string> = {
  INVITACION_NO_EXISTE: "😕 Esa invitación no existe. Pide un enlace nuevo.",
  INVITACION_USADA: "😕 Esa invitación ya fue usada. Pide un enlace nuevo.",
  INVITACION_VENCIDA: "⌛ Esa invitación ya venció. Pide un enlace nuevo.",
  YA_ES_MIEMBRO: "Ya haces parte de esta tienda 🙂",
  YA_ES_DUENO: "Ya eres el dueño de esta tienda 🙂",
};

export async function mostrarInvitacion(ctx: MiContexto, codigo: string) {
  const { data: inv } = await db.from("invitaciones").select("*").eq("codigo", codigo.toUpperCase()).maybeSingle();
  if (!inv) return void await responder(ctx, ERRORES.INVITACION_NO_EXISTE);
  if (inv.usada_por) return void await responder(ctx, ERRORES.INVITACION_USADA);
  if (new Date(inv.expira_en) < new Date()) return void await responder(ctx, ERRORES.INVITACION_VENCIDA);
  const tienda = await obtenerTienda(inv.tienda_id);
  const rolActual = await obtenerRol(ctx.from!.id, inv.tienda_id);
  if (rolActual !== "cliente" && (inv.rol !== "dueno" || rolActual === "dueno")) {
    await responder(ctx, `Ya haces parte de ${escaparHtml(tienda?.nombre)} como ${NOMBRES_ROL[rolActual]} 🙂`,
      new InlineKeyboard().text("Ir a la tienda", armar(P.menu, "t", inv.tienda_id)));
    return;
  }
  await responder(ctx, `📩 Te invitaron a <b>${escaparHtml(tienda?.nombre)}</b> como <b>${NOMBRES_ROL[inv.rol as Rol]}</b>.`,
    new InlineKeyboard().text("✅ Aceptar", armar(P.invitacion, "ok", inv.codigo)).text("❌ Rechazar", armar(P.invitacion, "no", inv.codigo)));
}

async function aceptar(ctx: MiContexto, codigo: string) {
  const { data, error } = await db.rpc("aceptar_invitacion", { p_codigo: codigo, p_telegram: ctx.from!.id });
  if (error) {
    await mostrar(ctx, ERRORES[leerErrorSql(error).codigo] ?? "😕 No pudimos aceptar la invitación. Intenta de nuevo.");
    return;
  }
  const r = data as { tienda_id: number; rol: Rol; creada_por: number; dueno_anterior: number | null };
  const tienda = await obtenerTienda(r.tienda_id);
  const nombreTienda = escaparHtml(tienda?.nombre);
  await mostrar(ctx, `🎉 ¡Bienvenido al equipo de <b>${nombreTienda}</b>! Tu rol es <b>${NOMBRES_ROL[r.rol]}</b>.`);
  await enviarTexto(r.creada_por, `✅ ${escaparHtml(nombreActor(ctx))} aceptó tu invitación como ${NOMBRES_ROL[r.rol]} en ${nombreTienda}.`);

  // Cambio de dueño por enlace: el anterior queda como administrador
  if (r.rol === "dueno" && r.dueno_anterior && r.dueno_anterior !== ctx.from!.id) {
    if (esSuperAdmin(r.dueno_anterior)) {
      await enviarTexto(r.dueno_anterior,
        `👑 ${nombreTienda} tiene nuevo dueño. Quedaste como administrador. ¿Qué prefieres?`,
        new InlineKeyboard()
          .text("Dejarme como administrador", armar(P.superAdmin, "qa", r.tienda_id))
          .text("Quitarme de la tienda", armar(P.superAdmin, "qd", r.tienda_id)));
    } else {
      await enviarTexto(r.dueno_anterior, `👑 ${nombreTienda} tiene nuevo dueño. Ahora eres administrador.`);
    }
  }
  await entrarTienda(ctx, r.tienda_id, true);
}

async function manejarInvitacion(ctx: MiContexto, partes: string[]) {
  if (partes[1] === "ok") return await aceptar(ctx, partes[2]);
  if (partes[1] === "no") {
    await avisar(ctx, "Invitación rechazada");
    await mostrar(ctx, "Listo, rechazaste la invitación 👍");
    await mostrarMenuInicial(ctx, true);
  }
}

registrarCallback(P.invitacion, manejarInvitacion);
