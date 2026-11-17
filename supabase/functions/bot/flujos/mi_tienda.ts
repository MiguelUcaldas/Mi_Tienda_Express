// "⚙️ Mi tienda" (11.12): datos, barrio, horario, medios de pago y transferir tienda.
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { esTransferencia, MEDIOS_PAGO } from "../logica/estados.ts";
import { escaparHtml, NOMBRES_MEDIO_PAGO, normalizarTelefono } from "../logica/formato.ts";
import { type Horario, textoHorarioSemana } from "../logica/horarios.ts";
import { NOMBRES_ROL, puede } from "../logica/permisos.ts";
import { tecladoBarrios, tecladoCancelar, tecladoComunas } from "../menus/comunes.ts";
import { entrarTienda } from "../menus/inicial.ts";
import { exigir, exigirConfiguracion, rolDe } from "../middleware/rol.ts";
import { barriosDeComuna, listarComunas, obtenerBarrio } from "../servicios/barrios.ts";
import { iniciarFlujo, irAPaso, terminarFlujo } from "../servicios/conversacion.ts";
import { miembro, miembrosActivos, transferirTienda } from "../servicios/equipo.ts";
import { enviarTexto } from "../servicios/telegram.ts";
import {
  actualizarTienda,
  guardarHorarios,
  guardarMedioPago,
  horariosDe,
  mediosDe,
  obtenerTienda,
  type Tienda,
} from "../servicios/tiendas.ts";
import { avisar, mostrar, responder } from "../ui.ts";
import {
  describirMedio,
  horarioDelTexto,
  horarioPredefinido,
  pedirDatosMedio,
  preguntarDia,
  registrarContinuacionMedio,
  tecladoOpcionesHorario,
  TEXTO_RECOMENDACION_CONTRA_ENTREGA,
} from "./comun_tienda.ts";

const FLUJO = "editar_tienda";
const d = (...partes: (string | number)[]) => armar(P.miTienda, ...partes);

const CAMPOS: Record<string, string> = {
  nombre: "✏️ Escribe el nuevo nombre (3 a 60 caracteres):",
  descripcion: "✏️ Escribe la nueva descripción (máx. 150 caracteres):",
  direccion: "✏️ Escribe la nueva dirección:",
  contacto: "✏️ Escribe el nuevo teléfono de contacto (7 a 13 dígitos):",
};

export async function mostrarMiTienda(ctx: MiContexto, tiendaId: number) {
  const tienda = await obtenerTienda(tiendaId);
  if (!tienda) return;
  const [barrio, horarios] = await Promise.all([obtenerBarrio(tienda.barrio_id), horariosDe(tiendaId)]);
  const rol = await rolDe(ctx, tiendaId);
  const texto = [
    `⚙️ <b>${escaparHtml(tienda.nombre)}</b>`,
    escaparHtml(tienda.descripcion),
    `📍 ${escaparHtml(tienda.direccion)}, ${escaparHtml(barrio?.nombre)}`,
    `📱 ${escaparHtml(tienda.telefono_contacto)}`,
    "",
    textoHorarioSemana(horarios),
  ].join("\n");
  const teclado = new InlineKeyboard()
    .text("✏️ Nombre", d("e", tiendaId, "nombre")).text("✏️ Descripción", d("e", tiendaId, "descripcion")).row()
    .text("✏️ Dirección", d("e", tiendaId, "direccion")).text("📍 Barrio", d("bar", tiendaId)).row()
    .text("📱 Contacto", d("e", tiendaId, "contacto")).text("🕒 Horario", d("h", tiendaId)).row()
    .text("💳 Medios de pago", d("mp", tiendaId)).row();
  if (puede(rol, "transferir_tienda")) teclado.text("🔄 Transferir tienda", d("tr", tiendaId)).row();
  teclado.text("⬅️ Volver", ctx.esSuperAdmin && rol === "cliente" ? armar(P.superAdmin, "v", tiendaId) : armar(P.menu, "t", tiendaId));
  await mostrar(ctx, texto, teclado);
}

async function mostrarMedios(ctx: MiContexto, tiendaId: number) {
  const medios = await mediosDe(tiendaId, false);
  const lineas = ["💳 <b>Medios de pago</b>", "Toca un medio para activarlo o desactivarlo.", ""];
  const teclado = new InlineKeyboard();
  for (const tipo of MEDIOS_PAGO) {
    const m = medios.find((x) => x.tipo === tipo);
    const activo = m?.activo ?? false;
    lineas.push(`${activo ? "✅" : "⬜"} ${m && esTransferencia(tipo) && m.datos && Object.keys(m.datos).length ? describirMedio(tipo, m.datos) : NOMBRES_MEDIO_PAGO[tipo]}`);
    teclado.text(`${activo ? "✅" : "⬜"} ${NOMBRES_MEDIO_PAGO[tipo]}`, d("mt", tiendaId, tipo));
    if (esTransferencia(tipo)) teclado.text("✏️ Datos", d("md", tiendaId, tipo));
    teclado.row();
  }
  teclado.text("⬅️ Volver", d("menu", tiendaId));
  await mostrar(ctx, lineas.join("\n"), teclado);
}

async function alternarMedio(ctx: MiContexto, tiendaId: number, tipo: string, confirmado = false) {
  const medios = await mediosDe(tiendaId, false);
  const m = medios.find((x) => x.tipo === tipo);
  if (m?.activo) {
    if (medios.filter((x) => x.activo).length <= 1) {
      await avisar(ctx, "Debes tener al menos un medio de pago activo 🙂", true);
      return;
    }
    await guardarMedioPago(tiendaId, tipo, false);
    await mostrarMedios(ctx, tiendaId);
    return;
  }
  if (tipo === "contra_entrega" && !confirmado) {
    await mostrar(ctx, TEXTO_RECOMENDACION_CONTRA_ENTREGA,
      new InlineKeyboard().text("✅ Activarlo igual", d("ce", tiendaId, "si")).text("❌ No activarlo", d("ce", tiendaId, "no")));
    return;
  }
  if (esTransferencia(tipo) && (!m?.datos || Object.keys(m.datos).length === 0)) {
    await iniciarFlujo(ctx, FLUJO, "medios", { tienda_id: tiendaId });
    await pedirDatosMedio(ctx, tipo);
    return;
  }
  await guardarMedioPago(tiendaId, tipo, true);
  await mostrarMedios(ctx, tiendaId);
}

async function manejarMiTienda(ctx: MiContexto, partes: string[]) {
  const accion = partes[1];
  const tiendaId = num(partes, 2);
  if (!await exigirConfiguracion(ctx, tiendaId)) return;
  switch (accion) {
    case "menu": return await mostrarMiTienda(ctx, tiendaId);
    case "e":
      await iniciarFlujo(ctx, FLUJO, partes[3], { tienda_id: tiendaId });
      await mostrar(ctx, CAMPOS[partes[3]], tecladoCancelar());
      return;
    case "bar":
      await mostrar(ctx, "📍 ¿En qué comuna queda la tienda?",
        tecladoComunas(await listarComunas(), (o) => d("com", tiendaId, o)).text("⬅️ Volver", d("menu", tiendaId)));
      return;
    case "com":
    case "bpg": {
      const orden = num(partes, 3);
      await mostrar(ctx, "📍 Elige el barrio:", tecladoBarrios(await barriosDeComuna(orden), accion === "bpg" ? num(partes, 4) : 1,
        (id) => d("sb", tiendaId, id), (p) => d("bpg", tiendaId, orden, p)).text("⬅️ Volver", d("menu", tiendaId)));
      return;
    }
    case "sb":
      await actualizarTienda(tiendaId, { barrio_id: num(partes, 3) });
      await avisar(ctx, "✅ Barrio actualizado");
      return await mostrarMiTienda(ctx, tiendaId);
    case "h":
      await mostrar(ctx, "🕒 Elige el nuevo horario:", tecladoOpcionesHorario((o) => d("hp", tiendaId, o)));
      return;
    case "hp":
      if (partes[3] === "per") {
        await iniciarFlujo(ctx, FLUJO, "horario_dia", { tienda_id: tiendaId, horarios: [], dia_idx: 0 });
        await preguntarDia(ctx, 0, d("hc", tiendaId));
        return;
      }
      await guardarHorarios(tiendaId, horarioPredefinido(partes[3] === "ls" ? "ls" : "td"));
      await avisar(ctx, "✅ Horario actualizado");
      return await mostrarMiTienda(ctx, tiendaId);
    case "hc":
      return await avanzarDia(ctx, null);
    case "mp": return await mostrarMedios(ctx, tiendaId);
    case "mt": return await alternarMedio(ctx, tiendaId, partes[3]);
    case "ce":
      if (partes[3] === "si") return await alternarMedio(ctx, tiendaId, "contra_entrega", true);
      return await mostrarMedios(ctx, tiendaId);
    case "md":
      await iniciarFlujo(ctx, FLUJO, "medios", { tienda_id: tiendaId });
      await pedirDatosMedio(ctx, partes[3]);
      return;
    case "tr": return await elegirNuevoDueno(ctx, tiendaId);
    case "trm": return await confirmarTransferencia(ctx, tiendaId, num(partes, 3));
    case "trok": return await transferir(ctx, tiendaId, num(partes, 3));
  }
}

async function elegirNuevoDueno(ctx: MiContexto, tiendaId: number) {
  if (!await exigir(ctx, tiendaId, "transferir_tienda")) return;
  const candidatos = (await miembrosActivos(tiendaId)).filter((m) => m.rol !== "dueno");
  const teclado = new InlineKeyboard();
  for (const m of candidatos) teclado.text(`${m.nombre} · ${NOMBRES_ROL[m.rol]}`, d("trm", tiendaId, m.telegram_id)).row();
  teclado.text("⬅️ Volver", d("menu", tiendaId));
  await mostrar(ctx, candidatos.length
    ? "🔄 ¿A quién le transfieres la tienda? Debe ser alguien de tu equipo."
    : "Para transferir la tienda primero invita a alguien a tu equipo (👥 Equipo).", teclado);
}

async function confirmarTransferencia(ctx: MiContexto, tiendaId: number, telegramId: number) {
  if (!await exigir(ctx, tiendaId, "transferir_tienda")) return;
  const m = await miembro(tiendaId, telegramId);
  if (!m) return void await avisar(ctx, "Esa persona ya no está en el equipo.", true);
  await mostrar(ctx, `⚠️ ¿Seguro? <b>${escaparHtml(m.nombre)}</b> será el nuevo dueño y tú quedarás como administrador.`,
    new InlineKeyboard().text("✅ Sí, transferir", d("trok", tiendaId, telegramId)).text("❌ No", d("menu", tiendaId)));
}

async function transferir(ctx: MiContexto, tiendaId: number, telegramId: number) {
  if (!await exigir(ctx, tiendaId, "transferir_tienda")) return;
  if (!await miembro(tiendaId, telegramId)) return void await avisar(ctx, "Esa persona ya no está en el equipo.", true);
  const { error } = await transferirTienda(tiendaId, telegramId);
  if (error) return void await avisar(ctx, "😕 No se pudo transferir la tienda.", true);
  const tienda = await obtenerTienda(tiendaId);
  await enviarTexto(telegramId, `👑 ¡Ahora eres el dueño de <b>${escaparHtml(tienda?.nombre)}</b>!`);
  await mostrar(ctx, "✅ Listo, transferiste la tienda. Ahora eres administrador.");
  await entrarTienda(ctx, tiendaId, true);
}

async function avanzarDia(ctx: MiContexto, horario: Horario | null) {
  const datos = ctx.estado.datos;
  if (ctx.estado.flujo !== FLUJO) return;
  const horarios: Horario[] = [...(datos.horarios ?? []), ...(horario ? [horario] : [])];
  const siguiente = (datos.dia_idx ?? 0) + 1;
  if (siguiente < 7) {
    await irAPaso(ctx, "horario_dia", { horarios, dia_idx: siguiente });
    await preguntarDia(ctx, siguiente, d("hc", datos.tienda_id));
    return;
  }
  if (horarios.length === 0) {
    await irAPaso(ctx, "horario_dia", { horarios: [], dia_idx: 0 });
    await responder(ctx, "La tienda debe abrir al menos un día 🙂. Empecemos de nuevo con el lunes.");
    await preguntarDia(ctx, 0, d("hc", datos.tienda_id));
    return;
  }
  await guardarHorarios(datos.tienda_id, horarios);
  await terminarFlujo(ctx);
  await responder(ctx, "✅ Horario actualizado.");
  await mostrarMiTienda(ctx, datos.tienda_id);
}

async function flujoEditarTienda(ctx: MiContexto) {
  const texto = ctx.message?.text?.trim() ?? "";
  const tiendaId = ctx.estado.datos.tienda_id as number;
  const paso = ctx.estado.paso;
  if (paso === "horario_dia") {
    const horario = horarioDelTexto(texto, ctx.estado.datos.dia_idx ?? 0);
    if (!horario) return void await responder(ctx, "Usa el formato 24 h, por ejemplo <code>07:00-21:00</code>, o toca «Cerrado».");
    return await avanzarDia(ctx, horario);
  }
  let cambios: Partial<Tienda> | null = null;
  if (paso === "nombre" && texto.length >= 3 && texto.length <= 60) cambios = { nombre: texto };
  if (paso === "descripcion" && texto.length >= 3 && texto.length <= 150) cambios = { descripcion: texto };
  if (paso === "direccion" && texto.length >= 5 && texto.length <= 150) cambios = { direccion: texto };
  if (paso === "contacto" && normalizarTelefono(texto)) cambios = { telefono_contacto: normalizarTelefono(texto)! };
  if (!cambios) return void await responder(ctx, `Ese dato no es válido 🤔. ${CAMPOS[paso ?? ""] ?? ""}`, tecladoCancelar());
  await actualizarTienda(tiendaId, cambios);
  await terminarFlujo(ctx);
  await responder(ctx, "✅ ¡Actualizado!");
  await mostrarMiTienda(ctx, tiendaId);
}

registrarCallback(P.miTienda, manejarMiTienda);
registrarFlujo(FLUJO, flujoEditarTienda);
registrarContinuacionMedio(FLUJO, async (ctx, tipo, valores) => {
  const tiendaId = ctx.estado.datos.tienda_id as number;
  await guardarMedioPago(tiendaId, tipo, true, valores);
  await terminarFlujo(ctx);
  await responder(ctx, `✅ ${NOMBRES_MEDIO_PAGO[tipo]} quedó activo con sus datos.`);
  await mostrarMedios(ctx, tiendaId);
});
