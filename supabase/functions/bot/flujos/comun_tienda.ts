// Piezas compartidas por el registro de tienda y "⚙️ Mi tienda": horarios y datos de medios de pago.
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { escaparHtml, NOMBRES_MEDIO_PAGO, normalizarTelefono } from "../logica/formato.ts";
import { type Horario, NOMBRES_DIA, ORDEN_SEMANA, parsearRangoHorario } from "../logica/horarios.ts";
import { tecladoCancelar } from "../menus/comunes.ts";
import { cambiarFlujo, irAPaso } from "../servicios/conversacion.ts";
import { mostrar, responder } from "../ui.ts";

// ---------- Horarios ----------

export function horarioPredefinido(opcion: "ls" | "td"): Horario[] {
  const dias = opcion === "ls" ? [1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6];
  return dias.map((dia) => ({ dia_semana: dia, hora_apertura: "07:00", hora_cierre: "21:00" }));
}

export function tecladoOpcionesHorario(dato: (opcion: string) => string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Lun–Sáb 7:00 a. m.–9:00 p. m.", dato("ls")).row()
    .text("Todos los días 7:00 a. m.–9:00 p. m.", dato("td")).row()
    .text("✏️ Personalizar", dato("per")).row()
    .text("❌ Cancelar", "m:cx");
}

// Pregunta el horario del día en la posición `indice` de ORDEN_SEMANA (lunes a domingo)
export async function preguntarDia(ctx: MiContexto, indice: number, datoCerrado: string) {
  const dia = NOMBRES_DIA[ORDEN_SEMANA[indice]];
  await mostrar(ctx, `🕒 Horario del <b>${dia}</b> en formato 24 h, por ejemplo <code>07:00-21:00</code>.\nSi ese día no abres, toca «Cerrado».`,
    new InlineKeyboard().text("Cerrado", datoCerrado).row().text("❌ Cancelar", "m:cx"));
}

// Procesa la respuesta de un día. Devuelve null si el texto no es válido.
export function horarioDelTexto(texto: string, indice: number): Horario | null {
  const rango = parsearRangoHorario(texto);
  if (!rango) return null;
  return { dia_semana: ORDEN_SEMANA[indice], hora_apertura: rango.apertura, hora_cierre: rango.cierre };
}

// ---------- Medios de pago ----------

export const TEXTO_RECOMENDACION_CONTRA_ENTREGA =
  "💡 <b>Recomendación:</b> activar el pago contra entrega facilita la compra a tus clientes, pero te expone a " +
  "<b>pedidos falsos o de broma</b>, porque nadie paga por adelantado. Si prefieres evitarlo, deja solo los medios " +
  "de transferencia (Bre-B, Nequi o Bancolombia): así todo pedido se paga antes de prepararse.\n" +
  "Puedes cambiar esto cuando quieras en ⚙️ Mi tienda → Medios de pago.";

interface CampoMedio {
  campo: string;
  pregunta: string;
}

export const CAMPOS_MEDIO: Record<string, CampoMedio[]> = {
  llave_breb: [{ campo: "llave", pregunta: "🔑 Escribe tu llave Bre-B (ej. @mitienda o tu celular):" }],
  nequi: [
    { campo: "numero", pregunta: "📱 Escribe el número de Nequi:" },
    { campo: "titular", pregunta: "👤 ¿A nombre de quién está la cuenta Nequi?" },
  ],
  bancolombia: [
    { campo: "tipo_cuenta", pregunta: "🏦 ¿Qué tipo de cuenta Bancolombia es?" },
    { campo: "numero_cuenta", pregunta: "🏦 Escribe el número de cuenta:" },
    { campo: "titular", pregunta: "👤 ¿A nombre de quién está la cuenta?" },
  ],
};

// Al terminar de pedir los datos de un medio, cada flujo dueño continúa a su manera
type Continuacion = (ctx: MiContexto, tipo: string, valores: Record<string, string>) => Promise<void>;
const continuaciones = new Map<string, Continuacion>();

export function registrarContinuacionMedio(flujoOrigen: string, fn: Continuacion) {
  continuaciones.set(flujoOrigen, fn);
}

// Inicia el sub-flujo "datos_medio" conservando los datos del flujo que lo llama
export async function pedirDatosMedio(ctx: MiContexto, tipo: string) {
  const origen = ctx.estado.flujo ?? "";
  await cambiarFlujo(ctx, "datos_medio", "campo", { dm_origen: origen, dm_tipo: tipo, dm_indice: 0, dm_valores: {} });
  await preguntarCampo(ctx);
}

async function preguntarCampo(ctx: MiContexto) {
  const { dm_tipo, dm_indice } = ctx.estado.datos;
  const campo = CAMPOS_MEDIO[dm_tipo][dm_indice];
  const titulo = `💳 <b>${NOMBRES_MEDIO_PAGO[dm_tipo]}</b>\n`;
  if (campo.campo === "tipo_cuenta") {
    await mostrar(ctx, titulo + campo.pregunta, new InlineKeyboard()
      .text("Ahorros", "dm:ahorros").text("Corriente", "dm:corriente").row().text("❌ Cancelar", "m:cx"));
    return;
  }
  await responder(ctx, titulo + campo.pregunta, tecladoCancelar());
}

function validarCampo(campo: string, texto: string): string | null {
  if (campo === "numero") return normalizarTelefono(texto);
  if (campo === "numero_cuenta") return /^[\d\s-]{6,20}$/.test(texto) ? texto.replace(/[\s-]/g, "") : null;
  if (campo === "tipo_cuenta") return ["ahorros", "corriente"].includes(texto.toLowerCase()) ? texto.toLowerCase() : null;
  return texto.length >= 2 && texto.length <= 60 ? texto : null;
}

async function recibirValor(ctx: MiContexto, texto: string) {
  const datos = ctx.estado.datos;
  const campo = CAMPOS_MEDIO[datos.dm_tipo][datos.dm_indice];
  const valor = validarCampo(campo.campo, texto.trim());
  if (!valor) {
    await responder(ctx, `Ese dato no parece válido 🤔. ${campo.pregunta}`, tecladoCancelar());
    return;
  }
  const valores = { ...datos.dm_valores, [campo.campo]: valor };
  const siguiente = datos.dm_indice + 1;
  if (siguiente < CAMPOS_MEDIO[datos.dm_tipo].length) {
    await irAPaso(ctx, "campo", { dm_indice: siguiente, dm_valores: valores });
    await preguntarCampo(ctx);
    return;
  }
  const origen = datos.dm_origen as string;
  const tipo = datos.dm_tipo as string;
  await cambiarFlujo(ctx, origen, "medios", { dm_origen: null, dm_tipo: null, dm_indice: null, dm_valores: null });
  const continuar = continuaciones.get(origen);
  if (continuar) await continuar(ctx, tipo, valores);
}

registrarFlujo("datos_medio", async (ctx) => {
  await recibirValor(ctx, ctx.message?.text ?? "");
});

registrarCallback("dm", async (ctx, partes) => {
  if (ctx.estado.flujo !== "datos_medio") return;
  await recibirValor(ctx, partes[1]);
});

// Texto de un medio con sus datos, para resúmenes
// deno-lint-ignore no-explicit-any
export function describirMedio(tipo: string, datos: Record<string, any> = {}): string {
  const nombre = NOMBRES_MEDIO_PAGO[tipo];
  if (tipo === "llave_breb") return `${nombre}: ${escaparHtml(datos.llave)}`;
  if (tipo === "nequi") return `${nombre}: ${escaparHtml(datos.numero)} (${escaparHtml(datos.titular)})`;
  if (tipo === "bancolombia") return `${nombre} ${escaparHtml(datos.tipo_cuenta)} N.° ${escaparHtml(datos.numero_cuenta)} (${escaparHtml(datos.titular)})`;
  return nombre;
}
