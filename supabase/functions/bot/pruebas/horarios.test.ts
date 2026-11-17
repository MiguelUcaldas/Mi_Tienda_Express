import { assertEquals } from "jsr:@std/assert@1";
import {
  aBogota,
  estaAbierta,
  formatearFechaLarga,
  formatearHora,
  type Horario,
  inicioPeriodo,
  parsearFechaDDMMAAAA,
  parsearRangoHorario,
  proximaApertura,
  textoEstadoTienda,
} from "../logica/horarios.ts";

// La Esquina: lunes a sábado 7:00–21:00, domingo cerrado
const esquina: Horario[] = [1, 2, 3, 4, 5, 6].map((d) => ({
  dia_semana: d,
  hora_apertura: "07:00:00",
  hora_cierre: "21:00:00",
}));

// 2026-11-16 es lunes. 12:00 UTC = 7:00 a. m. en Bogotá.
const lunes = (horaUtc: string) => new Date(`2026-11-16T${horaUtc}Z`);

Deno.test("conversión UTC → Bogotá", () => {
  const m = aBogota(new Date("2026-11-16T03:30:00Z")); // domingo 15, 10:30 p. m. en Bogotá
  assertEquals(m.fechaISO, "2026-11-15");
  assertEquals(m.diaSemana, 0);
  assertEquals(m.minutos, 22 * 60 + 30);
});

Deno.test("abierto y cerrado según la hora de Bogotá", () => {
  assertEquals(estaAbierta(esquina, lunes("11:59:00")), false); // 6:59 a. m.
  assertEquals(estaAbierta(esquina, lunes("12:00:00")), true); // 7:00 a. m.
  assertEquals(estaAbierta(esquina, lunes("23:00:00")), true); // 6:00 p. m.
  assertEquals(estaAbierta(esquina, new Date("2026-11-17T02:00:00Z")), false); // lunes 9:00 p. m.
});

Deno.test("día sin horario = cerrado", () => {
  const domingoMediodia = new Date("2026-11-15T17:00:00Z");
  assertEquals(estaAbierta(esquina, domingoMediodia), false);
  assertEquals(estaAbierta([], domingoMediodia), false);
});

Deno.test("próxima apertura", () => {
  // Domingo al mediodía → abre mañana (lunes) a las 7
  const prox = proximaApertura(esquina, new Date("2026-11-15T17:00:00Z"));
  assertEquals(prox?.diasAdelante, 1);
  assertEquals(prox?.diaSemana, 1);
  // Lunes 5:00 a. m. → abre hoy
  assertEquals(proximaApertura(esquina, lunes("10:00:00"))?.diasAdelante, 0);
  // Sábado 10 p. m. → abre el lunes
  const sabadoNoche = new Date("2026-11-22T03:00:00Z");
  assertEquals(proximaApertura(esquina, sabadoNoche)?.diasAdelante, 2);
  assertEquals(proximaApertura([], sabadoNoche), null);
  assertEquals(textoEstadoTienda(esquina, new Date("2026-11-15T17:00:00Z")), "🔴 Cerrada (abre mañana a las 7:00 a. m.)");
  assertEquals(textoEstadoTienda(esquina, lunes("15:00:00")), "🟢 Abierta (cierra a las 9:00 p. m.)");
});

Deno.test("formatos de hora y fecha", () => {
  assertEquals(formatearHora("21:00"), "9:00 p. m.");
  assertEquals(formatearHora("07:00:00"), "7:00 a. m.");
  assertEquals(formatearHora("12:30"), "12:30 p. m.");
  assertEquals(formatearHora("00:15"), "12:15 a. m.");
  assertEquals(formatearFechaLarga("2026-11-19"), "jueves 19 de noviembre");
});

Deno.test("lectura de fechas y rangos", () => {
  assertEquals(parsearFechaDDMMAAAA("19/11/2026"), "2026-11-19");
  assertEquals(parsearFechaDDMMAAAA("31/02/2026"), null);
  assertEquals(parsearRangoHorario("7:00-21:00"), { apertura: "07:00", cierre: "21:00" });
  assertEquals(parsearRangoHorario("21:00-07:00"), null);
  assertEquals(parsearRangoHorario("hola"), null);
});

Deno.test("inicio de periodos en medianoche de Bogotá", () => {
  const ahora = new Date("2026-11-16T15:00:00Z"); // lunes 10:00 a. m. Bogotá
  assertEquals(inicioPeriodo("hoy", ahora).toISOString(), "2026-11-16T05:00:00.000Z");
  assertEquals(inicioPeriodo("7d", ahora).toISOString(), "2026-11-10T05:00:00.000Z");
  assertEquals(inicioPeriodo("mes", ahora).toISOString(), "2026-11-01T05:00:00.000Z");
});
