// Modo pruebas del Super Admin (11.17): simula un rol en una tienda sin crear membresías reales.
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { paginar } from "../logica/formato.ts";
import { NOMBRES_ROL, type Rol } from "../logica/permisos.ts";
import { agregarPaginacion, TAMANO_PAGINA } from "../menus/comunes.ts";
import { entrarTienda, mostrarMenuInicial } from "../menus/inicial.ts";
import { fijarTiendaActiva, terminarFlujo } from "../servicios/conversacion.ts";
import { obtenerTienda, type Tienda } from "../servicios/tiendas.ts";
import { avisar, mostrar } from "../ui.ts";

const d = (...partes: (string | number)[]) => armar(P.modoPruebas, ...partes);
const ROLES: Rol[] = ["cliente", "dueno", "administrador", "empleado", "domiciliario"];

async function elegirTienda(ctx: MiContexto, pagina: number) {
  const { data } = await db.from("tiendas").select("*").order("nombre");
  const pag = paginar((data ?? []) as Tienda[], pagina, TAMANO_PAGINA);
  const teclado = new InlineKeyboard();
  for (const t of pag.items) teclado.text(t.nombre, d("r", t.id)).row();
  agregarPaginacion(teclado, pag, (p) => d("t", p));
  teclado.text("⬅️ Panel", armar(P.superAdmin, "p"));
  await mostrar(ctx, "🧪 <b>Modo pruebas</b>\n¿En qué tienda quieres probar?", teclado);
}

async function elegirRol(ctx: MiContexto, tiendaId: number) {
  const tienda = await obtenerTienda(tiendaId);
  const teclado = new InlineKeyboard();
  ROLES.forEach((r, i) => {
    teclado.text(NOMBRES_ROL[r], d("ok", tiendaId, r));
    if (i % 2 === 0) teclado.row();
  });
  teclado.row().text("⬅️ Volver", d("t", 1));
  await mostrar(ctx, `🧪 ¿Con qué rol quieres probar ${tienda?.nombre ?? ""}?`, teclado);
}

async function activar(ctx: MiContexto, tiendaId: number, rol: string) {
  const tienda = await obtenerTienda(tiendaId);
  if (!tienda || !ROLES.includes(rol as Rol)) return;
  await db.from("modo_pruebas").upsert({
    telegram_id: ctx.from!.id,
    tienda_id: tiendaId,
    rol,
    activado_en: new Date().toISOString(),
  }, { onConflict: "telegram_id" });
  ctx.modoPruebas = { tienda_id: tiendaId, rol: rol as Rol, tienda_nombre: tienda.nombre };
  await terminarFlujo(ctx);
  await fijarTiendaActiva(ctx, tiendaId);
  await avisar(ctx, `🧪 Probando como ${NOMBRES_ROL[rol as Rol]}`);
  await entrarTienda(ctx, tiendaId);
}

async function salir(ctx: MiContexto) {
  await db.from("modo_pruebas").delete().eq("telegram_id", ctx.from!.id);
  ctx.modoPruebas = null;
  await terminarFlujo(ctx);
  await fijarTiendaActiva(ctx, null);
  await avisar(ctx, "🧪 Saliste del modo pruebas");
  await mostrarMenuInicial(ctx);
}

async function manejarModoPruebas(ctx: MiContexto, partes: string[]) {
  if (!ctx.esSuperAdmin) return void await avisar(ctx, "⛔ Solo para el Super Admin.");
  switch (partes[1]) {
    case "t": return await elegirTienda(ctx, num(partes, 2));
    case "r": return await elegirRol(ctx, num(partes, 2));
    case "ok": return await activar(ctx, num(partes, 2), partes[3]);
    case "salir": return await salir(ctx);
  }
}

registrarCallback(P.modoPruebas, manejarModoPruebas);
