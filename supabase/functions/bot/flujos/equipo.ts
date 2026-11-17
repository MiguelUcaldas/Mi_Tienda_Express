// "👥 Equipo" (11.15): invitar, cambiar rol, quitar y salir del equipo (RN-38 a RN-41).
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { escaparHtml, paginar } from "../logica/formato.ts";
import {
  esRolMiembro,
  NOMBRES_ROL,
  puedeCambiarRol,
  puedeGestionarMiembro,
  rolesAsignables,
  type RolMiembro,
} from "../logica/permisos.ts";
import { agregarPaginacion, TAMANO_PAGINA } from "../menus/comunes.ts";
import { mostrarMenuInicial } from "../menus/inicial.ts";
import { rolDe } from "../middleware/rol.ts";
import { fijarTiendaActiva } from "../servicios/conversacion.ts";
import { cambiarRol, crearInvitacion, miembro, miembrosActivos, quitarMiembro } from "../servicios/equipo.ts";
import { tienePedidosAsignados } from "../servicios/pedidos.ts";
import { enlaceBot, enviarTexto } from "../servicios/telegram.ts";
import { obtenerTienda } from "../servicios/tiendas.ts";
import { avisar, mostrar } from "../ui.ts";

const d = (...partes: (string | number)[]) => armar(P.equipo, ...partes);

async function listar(ctx: MiContexto, tiendaId: number, pagina: number) {
  const rol = await rolDe(ctx, tiendaId);
  if (rolesAsignables(rol).length === 0) return void await avisar(ctx, "⛔ No tienes permiso para gestionar el equipo.");
  const miembros = await miembrosActivos(tiendaId);
  const pag = paginar(miembros, pagina, TAMANO_PAGINA);
  const lineas = ["👥 <b>Equipo</b>", ""];
  const teclado = new InlineKeyboard();
  for (const m of pag.items) {
    lineas.push(`• ${escaparHtml(m.nombre)} — ${NOMBRES_ROL[m.rol]}`);
    if (m.telegram_id !== ctx.from!.id && puedeGestionarMiembro(rol, m.rol)) {
      teclado.text(`${m.nombre} · ${NOMBRES_ROL[m.rol]}`, d("mb", tiendaId, m.telegram_id)).row();
    }
  }
  agregarPaginacion(teclado, pag, (p) => d("l", tiendaId, p));
  teclado.text("➕ Invitar", d("inv", tiendaId)).row().text("⬅️ Volver", armar(P.menu, "t", tiendaId));
  await mostrar(ctx, lineas.join("\n"), teclado);
}

async function elegirRolInvitacion(ctx: MiContexto, tiendaId: number) {
  const roles = rolesAsignables(await rolDe(ctx, tiendaId));
  if (!roles.length) return void await avisar(ctx, "⛔ No tienes permiso para invitar.");
  const teclado = new InlineKeyboard();
  for (const r of roles) teclado.text(NOMBRES_ROL[r], d("ir", tiendaId, r)).row();
  teclado.text("⬅️ Volver", d("l", tiendaId, 1));
  await mostrar(ctx, "➕ ¿Con qué rol invitas a la persona?", teclado);
}

async function invitar(ctx: MiContexto, tiendaId: number, rolNuevo: string) {
  const rol = await rolDe(ctx, tiendaId);
  if (!esRolMiembro(rolNuevo) || !rolesAsignables(rol).includes(rolNuevo)) {
    return void await avisar(ctx, "⛔ No puedes invitar con ese rol.");
  }
  const codigo = await crearInvitacion(tiendaId, rolNuevo, ctx.from!.id);
  await mostrar(ctx, `✅ Invitación como <b>${NOMBRES_ROL[rolNuevo]}</b> lista.\n\nEnvía este enlace a la persona:\n${enlaceBot(`inv_${codigo}`)}\n\n⏱️ Vale 24 horas y sirve una sola vez.`,
    new InlineKeyboard().text("⬅️ Equipo", d("l", tiendaId, 1)));
}

// Carga al miembro y valida que el actor lo pueda gestionar
async function objetivo(ctx: MiContexto, tiendaId: number, telegramId: number) {
  const rol = await rolDe(ctx, tiendaId);
  const m = await miembro(tiendaId, telegramId);
  if (!m || m.telegram_id === ctx.from!.id || !puedeGestionarMiembro(rol, m.rol)) {
    await avisar(ctx, "⛔ No puedes modificar a esta persona.", true);
    return null;
  }
  return { rol, m };
}

async function detalleMiembro(ctx: MiContexto, tiendaId: number, telegramId: number) {
  const o = await objetivo(ctx, tiendaId, telegramId);
  if (!o) return;
  await mostrar(ctx, `👤 <b>${escaparHtml(o.m.nombre)}</b>\nRol: ${NOMBRES_ROL[o.m.rol]}`, new InlineKeyboard()
    .text("🔄 Cambiar rol", d("cr", tiendaId, telegramId)).text("🚫 Quitar de la tienda", d("q", tiendaId, telegramId)).row()
    .text("⬅️ Equipo", d("l", tiendaId, 1)));
}

async function opcionesRol(ctx: MiContexto, tiendaId: number, telegramId: number) {
  const o = await objetivo(ctx, tiendaId, telegramId);
  if (!o) return;
  const teclado = new InlineKeyboard();
  for (const r of rolesAsignables(o.rol).filter((r) => puedeCambiarRol(o.rol, o.m.rol, r))) {
    teclado.text(NOMBRES_ROL[r], d("rn", tiendaId, telegramId, r)).row();
  }
  teclado.text("⬅️ Volver", d("mb", tiendaId, telegramId));
  await mostrar(ctx, `🔄 ¿Qué rol tendrá ${escaparHtml(o.m.nombre)}?`, teclado);
}

// RN-40: un domiciliario con pedidos en listo o despachado no se puede quitar ni cambiar
async function bloqueadoPorEntregas(ctx: MiContexto, tiendaId: number, m: { telegram_id: number; rol: RolMiembro }) {
  if (m.rol === "domiciliario" && await tienePedidosAsignados(tiendaId, m.telegram_id)) {
    await avisar(ctx, "Tiene pedidos asignados por entregar. Primero reasígnalos 🛵", true);
    return true;
  }
  return false;
}

async function aplicarRol(ctx: MiContexto, tiendaId: number, telegramId: number, rolNuevo: string) {
  const o = await objetivo(ctx, tiendaId, telegramId);
  if (!o) return;
  if (!esRolMiembro(rolNuevo) || !puedeCambiarRol(o.rol, o.m.rol, rolNuevo)) return void await avisar(ctx, "⛔ No puedes asignar ese rol.", true);
  if (await bloqueadoPorEntregas(ctx, tiendaId, o.m)) return;
  await cambiarRol(tiendaId, telegramId, rolNuevo);
  const tienda = await obtenerTienda(tiendaId);
  await enviarTexto(telegramId, `🔄 Tu rol en <b>${escaparHtml(tienda?.nombre)}</b> ahora es <b>${NOMBRES_ROL[rolNuevo]}</b>.`);
  await avisar(ctx, "✅ Rol actualizado");
  await listar(ctx, tiendaId, 1);
}

async function confirmarQuitar(ctx: MiContexto, tiendaId: number, telegramId: number) {
  const o = await objetivo(ctx, tiendaId, telegramId);
  if (!o) return;
  await mostrar(ctx, `¿Seguro que quieres quitar a <b>${escaparHtml(o.m.nombre)}</b> de la tienda?`,
    new InlineKeyboard().text("Sí, quitar", d("qok", tiendaId, telegramId)).text("No", d("mb", tiendaId, telegramId)));
}

async function quitar(ctx: MiContexto, tiendaId: number, telegramId: number) {
  const o = await objetivo(ctx, tiendaId, telegramId);
  if (!o || await bloqueadoPorEntregas(ctx, tiendaId, o.m)) return;
  await quitarMiembro(tiendaId, telegramId);
  const tienda = await obtenerTienda(tiendaId);
  await enviarTexto(telegramId, `Ya no haces parte del equipo de <b>${escaparHtml(tienda?.nombre)}</b>.`);
  await avisar(ctx, "✅ Listo");
  await listar(ctx, tiendaId, 1);
}

async function salir(ctx: MiContexto, tiendaId: number, confirmado: boolean) {
  const rol = await rolDe(ctx, tiendaId);
  if (rol === "cliente") return;
  if (rol === "dueno") return void await avisar(ctx, "El dueño no puede salir del equipo. Primero transfiere la tienda.", true);
  if (!confirmado) {
    await mostrar(ctx, "🚪 ¿Seguro que quieres salir del equipo de esta tienda?",
      new InlineKeyboard().text("Sí, salir", d("sok", tiendaId)).text("No", armar(P.menu, "t", tiendaId)));
    return;
  }
  if (await bloqueadoPorEntregas(ctx, tiendaId, { telegram_id: ctx.from!.id, rol })) return;
  await quitarMiembro(tiendaId, ctx.from!.id);
  await fijarTiendaActiva(ctx, null);
  await avisar(ctx, "Saliste del equipo 👋");
  await mostrarMenuInicial(ctx);
}

async function manejarEquipo(ctx: MiContexto, partes: string[]) {
  const tiendaId = num(partes, 2);
  const tg = num(partes, 3);
  switch (partes[1]) {
    case "l": return await listar(ctx, tiendaId, num(partes, 3) || 1);
    case "inv": return await elegirRolInvitacion(ctx, tiendaId);
    case "ir": return await invitar(ctx, tiendaId, partes[3]);
    case "mb": return await detalleMiembro(ctx, tiendaId, tg);
    case "cr": return await opcionesRol(ctx, tiendaId, tg);
    case "rn": return await aplicarRol(ctx, tiendaId, tg, partes[4]);
    case "q": return await confirmarQuitar(ctx, tiendaId, tg);
    case "qok": return await quitar(ctx, tiendaId, tg);
    case "salir": return await salir(ctx, tiendaId, false);
    case "sok": return await salir(ctx, tiendaId, true);
  }
}

registrarCallback(P.equipo, manejarEquipo);
