// Menús del personal (11.12): dueño, administrador, empleado y domiciliario.
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { escaparHtml } from "../logica/formato.ts";
import { NOMBRES_ROL, puede, type Rol } from "../logica/permisos.ts";
import { rolDe } from "../middleware/rol.ts";
import { estadoApertura, obtenerTienda, type Tienda } from "../servicios/tiendas.ts";
import { mostrar, responder } from "../ui.ts";
import { mostrarEnlace } from "./cliente.ts";

export async function mostrarMenuPersonal(ctx: MiContexto, tienda: Tienda, rol: Rol, nuevo = false) {
  const apertura = await estadoApertura(tienda.id);
  const t = tienda.id;
  const teclado = new InlineKeyboard();

  if (rol === "domiciliario") {
    teclado.text("🛵 Mis entregas", armar(P.entrega, "l", t)).row();
  } else {
    teclado.text("📋 Pedidos", armar("pl", "menu", t));
    if (puede(rol, "gestionar_productos")) teclado.text("📦 Productos", armar(P.productosAdmin, "menu", t));
    teclado.row();
    teclado.text("📊 Inventario", armar(P.inventario, "l", t, 1));
    if (puede(rol, "gestionar_promociones")) teclado.text("🏷️ Promociones", armar(P.promocion, "menu", t));
    teclado.row();
    if (puede(rol, "gestionar_tarifas")) teclado.text("🛵 Domicilios", armar(P.tarifa, "menu", t));
    if (puede(rol, "gestionar_personal")) teclado.text("👥 Equipo", armar(P.equipo, "l", t, 1));
    teclado.row();
    if (puede(rol, "ver_reportes")) teclado.text("📈 Reportes", armar(P.reportes, "menu", t));
    if (puede(rol, "configurar_tienda")) teclado.text("⚙️ Mi tienda", armar(P.miTienda, "menu", t));
    teclado.row();
    if (puede(rol, "gestionar_productos")) teclado.text("🔗 Enlace de la tienda", armar("enl", t)).row();
  }
  if (rol !== "dueno") teclado.text("🚪 Salir del equipo", armar(P.equipo, "salir", t)).row();
  teclado.text("⬅️ Menú inicial", armar(P.menu, "ini"));

  const texto = [
    `🏪 <b>${escaparHtml(tienda.nombre)}</b> · ${apertura.texto}`,
    `Tu rol: <b>${NOMBRES_ROL[rol]}</b>${tienda.es_premium ? " · ⭐ Premium" : ""}${tienda.activa ? "" : " · 🚫 Desactivada"}`,
  ].join("\n");
  if (nuevo) await responder(ctx, texto, teclado);
  else await mostrar(ctx, texto, teclado);
}

async function manejarEnlace(ctx: MiContexto, partes: string[]) {
  const tienda = await obtenerTienda(num(partes, 1));
  if (!tienda) return;
  const rol = await rolDe(ctx, tienda.id);
  if (rol === "cliente" && !ctx.esSuperAdmin) return;
  await mostrarEnlace(ctx, tienda);
}

registrarCallback("enl", manejarEnlace);
