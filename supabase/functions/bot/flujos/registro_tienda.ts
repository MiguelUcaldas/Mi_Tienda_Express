// Registro de tienda (11.11). Quien la registra queda como dueño (RN-01).
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { esTransferencia, MEDIOS_PAGO } from "../logica/estados.ts";
import { escaparHtml, NOMBRES_MEDIO_PAGO, normalizarTelefono } from "../logica/formato.ts";
import { type Horario, textoHorarioSemana } from "../logica/horarios.ts";
import { DATO_CANCELAR, tecladoBarrios, tecladoCancelar, tecladoComunas } from "../menus/comunes.ts";
import { entrarTienda } from "../menus/inicial.ts";
import { barriosDeComuna, listarComunas, obtenerBarrio } from "../servicios/barrios.ts";
import { iniciarFlujo, irAPaso, terminarFlujo } from "../servicios/conversacion.ts";
import { enlaceBot } from "../servicios/telegram.ts";
import { generarSlugUnico, guardarHorarios } from "../servicios/tiendas.ts";
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

const FLUJO = "registro_tienda";
const d = (...partes: (string | number)[]) => armar(P.registro, ...partes);

async function preguntarMedios(ctx: MiContexto) {
  const seleccion: string[] = ctx.estado.datos.medios_sel ?? [];
  const teclado = new InlineKeyboard();
  for (const tipo of MEDIOS_PAGO) {
    teclado.text(`${seleccion.includes(tipo) ? "☑️" : "☐"} ${NOMBRES_MEDIO_PAGO[tipo]}`, d("mp", tipo)).row();
  }
  teclado.text("✅ Listo", d("mpok")).row().text("❌ Cancelar", DATO_CANCELAR);
  await irAPaso(ctx, "medios");
  await mostrar(ctx, "💳 ¿Qué medios de pago aceptas? Marca uno o varios y toca «Listo».", teclado);
}

// Pide los datos del siguiente medio de transferencia marcado que aún no los tenga
async function siguienteMedioOResumen(ctx: MiContexto) {
  const datos = ctx.estado.datos;
  const pendiente = (datos.medios_sel as string[]).find((t) => esTransferencia(t) && !datos.medios_datos?.[t]);
  if (pendiente) {
    await pedirDatosMedio(ctx, pendiente);
    return;
  }
  await mostrarResumen(ctx);
}

async function mostrarResumen(ctx: MiContexto) {
  const datos = ctx.estado.datos;
  await irAPaso(ctx, "resumen");
  const barrio = await obtenerBarrio(datos.barrio_id);
  const texto = [
    "🏪 <b>Resumen de tu tienda</b>",
    `Nombre: ${escaparHtml(datos.nombre)}`,
    `Descripción: ${escaparHtml(datos.descripcion)}`,
    `Dirección: ${escaparHtml(datos.direccion)}, ${escaparHtml(barrio?.nombre)}`,
    `Teléfono: ${escaparHtml(datos.telefono)}`,
    "",
    "🕒 <b>Horario</b>",
    textoHorarioSemana(datos.horarios as Horario[]),
    "",
    "💳 <b>Medios de pago</b>",
    ...(datos.medios_sel as string[]).map((t) => `• ${describirMedio(t, datos.medios_datos?.[t])}`),
  ].join("\n");
  await mostrar(ctx, texto, new InlineKeyboard().text("✅ Crear tienda", d("ok")).text("❌ Cancelar", DATO_CANCELAR));
}

async function crearTienda(ctx: MiContexto) {
  const datos = ctx.estado.datos;
  const slug = await generarSlugUnico(datos.nombre);
  const { data: tienda, error } = await db.from("tiendas").insert({
    slug,
    nombre: datos.nombre,
    descripcion: datos.descripcion,
    direccion: datos.direccion,
    barrio_id: datos.barrio_id,
    telefono_contacto: datos.telefono,
    creada_por: ctx.from!.id,
  }).select("*").single();
  if (error || !tienda) {
    console.error("crear tienda:", error?.message);
    await mostrar(ctx, "😕 No pudimos crear la tienda. Intenta de nuevo con /menu");
    return;
  }
  try {
    await guardarHorarios(tienda.id, datos.horarios);
    const medios = (datos.medios_sel as string[]).map((tipo) => ({
      tienda_id: tienda.id,
      tipo,
      activo: true,
      datos: datos.medios_datos?.[tipo] ?? {},
    }));
    const r1 = await db.from("medios_pago_tienda").insert(medios);
    const r2 = await db.from("miembros_tienda").insert({ tienda_id: tienda.id, telegram_id: ctx.from!.id, rol: "dueno" });
    if (r1.error || r2.error) throw new Error(r1.error?.message ?? r2.error?.message);
  } catch (e) {
    console.error("crear tienda (detalles):", e);
    await db.from("tiendas").delete().eq("id", tienda.id);
    await mostrar(ctx, "😕 No pudimos crear la tienda. Intenta de nuevo con /menu");
    return;
  }
  await terminarFlujo(ctx);
  await mostrar(ctx, `🎉 ¡Listo! <b>${escaparHtml(tienda.nombre)}</b> ya está en Mi Tienda Express y tú eres su dueño.\n` +
    `🔗 Comparte este enlace con tus clientes:\n${enlaceBot(`t_${slug}`)}\n\nAhora agrega tus productos en 📦 Productos.`);
  await entrarTienda(ctx, tienda.id, true);
}

async function manejarRegistro(ctx: MiContexto, partes: string[]) {
  const accion = partes[1];
  if (accion === "ini") {
    await iniciarFlujo(ctx, FLUJO, "nombre", { medios_sel: [], medios_datos: {} });
    await mostrar(ctx, "🏪 ¡Vamos a registrar tu tienda!\n¿Cómo se llama? (3 a 60 caracteres)", tecladoCancelar());
    return;
  }
  if (ctx.estado.flujo !== FLUJO) {
    await avisar(ctx, "Este paso ya venció. Empieza de nuevo con /menu");
    return;
  }
  const datos = ctx.estado.datos;
  switch (accion) {
    case "com":
    case "bpg": {
      const orden = num(partes, 2);
      const teclado = tecladoBarrios(await barriosDeComuna(orden), accion === "bpg" ? num(partes, 3) : 1,
        (id) => d("bar", id), (p) => d("bpg", orden, p)).text("❌ Cancelar", DATO_CANCELAR);
      await mostrar(ctx, "📍 Elige el barrio de la tienda:", teclado);
      return;
    }
    case "bar":
      await irAPaso(ctx, "telefono", { barrio_id: num(partes, 2) });
      await mostrar(ctx, "📱 Escribe el teléfono de contacto de la tienda (7 a 13 dígitos):", tecladoCancelar());
      return;
    case "h": {
      const opcion = partes[2];
      if (opcion === "per") {
        await irAPaso(ctx, "horario_dia", { horarios: [], dia_idx: 0 });
        await preguntarDia(ctx, 0, d("hc"));
        return;
      }
      datos.horarios = horarioPredefinido(opcion === "ls" ? "ls" : "td");
      await preguntarMedios(ctx);
      return;
    }
    case "hc":
      await avanzarDia(ctx, null);
      return;
    case "mp": {
      const tipo = partes[2];
      const sel: string[] = datos.medios_sel ?? [];
      if (sel.includes(tipo)) {
        datos.medios_sel = sel.filter((t) => t !== tipo);
      } else if (tipo === "contra_entrega") {
        await mostrar(ctx, TEXTO_RECOMENDACION_CONTRA_ENTREGA,
          new InlineKeyboard().text("✅ Activarlo igual", d("ce", "si")).text("❌ No activarlo", d("ce", "no")));
        return;
      } else {
        datos.medios_sel = [...sel, tipo];
      }
      await preguntarMedios(ctx);
      return;
    }
    case "ce":
      if (partes[2] === "si") datos.medios_sel = [...(datos.medios_sel ?? []), "contra_entrega"];
      await preguntarMedios(ctx);
      return;
    case "mpok":
      if (!(datos.medios_sel ?? []).length) {
        await avisar(ctx, "Marca al menos un medio de pago 🙂", true);
        return;
      }
      await siguienteMedioOResumen(ctx);
      return;
    case "ok":
      await crearTienda(ctx);
      return;
  }
}

async function avanzarDia(ctx: MiContexto, horario: Horario | null) {
  const datos = ctx.estado.datos;
  const horarios: Horario[] = [...(datos.horarios ?? []), ...(horario ? [horario] : [])];
  const siguiente = (datos.dia_idx ?? 0) + 1;
  if (siguiente < 7) {
    await irAPaso(ctx, "horario_dia", { horarios, dia_idx: siguiente });
    await preguntarDia(ctx, siguiente, d("hc"));
    return;
  }
  if (horarios.length === 0) {
    await irAPaso(ctx, "horario_dia", { horarios: [], dia_idx: 0 });
    await responder(ctx, "Tu tienda debe abrir al menos un día 🙂. Empecemos de nuevo con el lunes.");
    await preguntarDia(ctx, 0, d("hc"));
    return;
  }
  datos.horarios = horarios;
  await preguntarMedios(ctx);
}

async function flujoRegistro(ctx: MiContexto) {
  const texto = ctx.message?.text?.trim() ?? "";
  switch (ctx.estado.paso) {
    case "nombre":
      if (texto.length < 3 || texto.length > 60) return void await responder(ctx, "El nombre debe tener de 3 a 60 caracteres.", tecladoCancelar());
      await irAPaso(ctx, "descripcion", { nombre: texto });
      await responder(ctx, "✍️ Cuéntale a tus clientes qué hace especial a tu tienda (máx. 150 caracteres):", tecladoCancelar());
      return;
    case "descripcion":
      if (texto.length < 3 || texto.length > 150) return void await responder(ctx, "Escribe una descripción de 3 a 150 caracteres.", tecladoCancelar());
      await irAPaso(ctx, "direccion", { descripcion: texto });
      await responder(ctx, "📍 ¿Cuál es la dirección de la tienda?", tecladoCancelar());
      return;
    case "direccion":
      if (texto.length < 5 || texto.length > 150) return void await responder(ctx, "Escribe la dirección completa (mínimo 5 caracteres).", tecladoCancelar());
      await irAPaso(ctx, "barrio", { direccion: texto });
      await responder(ctx, "📍 ¿En qué comuna queda la tienda?",
        tecladoComunas(await listarComunas(), (o) => d("com", o)).text("❌ Cancelar", DATO_CANCELAR));
      return;
    case "telefono": {
      const telefono = normalizarTelefono(texto);
      if (!telefono) return void await responder(ctx, "Ese número no parece válido. Escribe de 7 a 13 dígitos.", tecladoCancelar());
      await irAPaso(ctx, "horario", { telefono });
      await responder(ctx, "🕒 ¿Cuál es el horario de atención?", tecladoOpcionesHorario((o) => d("h", o)));
      return;
    }
    case "horario_dia": {
      const horario = horarioDelTexto(texto, ctx.estado.datos.dia_idx ?? 0);
      if (!horario) return void await responder(ctx, "Usa el formato 24 h, por ejemplo <code>07:00-21:00</code>, o toca «Cerrado».");
      await avanzarDia(ctx, horario);
      return;
    }
    default:
      await responder(ctx, "Usa los botones de arriba para continuar 👆, o escribe /cancelar para salir.");
  }
}

registrarCallback(P.registro, manejarRegistro);
registrarFlujo(FLUJO, flujoRegistro);
registrarContinuacionMedio(FLUJO, async (ctx, tipo, valores) => {
  ctx.estado.datos.medios_datos = { ...(ctx.estado.datos.medios_datos ?? {}), [tipo]: valores };
  await siguienteMedioOResumen(ctx);
});
