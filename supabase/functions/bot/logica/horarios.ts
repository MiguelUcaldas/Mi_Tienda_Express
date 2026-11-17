// Horarios y fechas en hora de Bogotá (UTC-5, sin horario de verano). Funciones puras.

export interface Horario {
  dia_semana: number; // 0 = domingo ... 6 = sábado
  hora_apertura: string; // "07:00" o "07:00:00"
  hora_cierre: string;
}

export interface MomentoBogota {
  anio: number;
  mes: number; // 1..12
  dia: number;
  diaSemana: number;
  minutos: number; // minutos desde la medianoche
  fechaISO: string; // "AAAA-MM-DD"
}

const DESFASE_MS = 5 * 60 * 60 * 1000;

export const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
// Orden para mostrar la semana: lunes a domingo
export const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

export function aBogota(fecha: Date): MomentoBogota {
  const d = new Date(fecha.getTime() - DESFASE_MS);
  const anio = d.getUTCFullYear();
  const mes = d.getUTCMonth() + 1;
  const dia = d.getUTCDate();
  return {
    anio,
    mes,
    dia,
    diaSemana: d.getUTCDay(),
    minutos: d.getUTCHours() * 60 + d.getUTCMinutes(),
    fechaISO: `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
  };
}

export function fechaHoyBogota(ahora: Date = new Date()): string {
  return aBogota(ahora).fechaISO;
}

export function horaAMinutos(hora: string): number {
  const [h, m] = hora.split(":").map((x) => parseInt(x, 10));
  return h * 60 + (m || 0);
}

// "21:00" → "9:00 p. m."
export function formatearHora(hora: string): string {
  const total = horaAMinutos(hora);
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const sufijo = h24 < 12 ? "a. m." : "p. m.";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${sufijo}`;
}

function horarioDelDia(horarios: Horario[], dia: number): Horario | undefined {
  return horarios.find((h) => h.dia_semana === dia);
}

export function estaAbierta(horarios: Horario[], ahora: Date): boolean {
  const m = aBogota(ahora);
  const hoy = horarioDelDia(horarios, m.diaSemana);
  if (!hoy) return false;
  return m.minutos >= horaAMinutos(hoy.hora_apertura) && m.minutos < horaAMinutos(hoy.hora_cierre);
}

export interface ProximaApertura {
  diasAdelante: number;
  diaSemana: number;
  hora: string;
}

export function proximaApertura(horarios: Horario[], ahora: Date): ProximaApertura | null {
  const m = aBogota(ahora);
  const hoy = horarioDelDia(horarios, m.diaSemana);
  if (hoy && m.minutos < horaAMinutos(hoy.hora_apertura)) {
    return { diasAdelante: 0, diaSemana: m.diaSemana, hora: hoy.hora_apertura };
  }
  for (let i = 1; i <= 7; i++) {
    const dia = (m.diaSemana + i) % 7;
    const h = horarioDelDia(horarios, dia);
    if (h) return { diasAdelante: i, diaSemana: dia, hora: h.hora_apertura };
  }
  return null;
}

// "mañana a las 7:00 a. m.", "hoy a las...", "el lunes a las..."
export function textoProximaApertura(prox: ProximaApertura): string {
  const cuando = prox.diasAdelante === 0
    ? "hoy"
    : prox.diasAdelante === 1
    ? "mañana"
    : `el ${NOMBRES_DIA[prox.diaSemana]}`;
  return `${cuando} a las ${formatearHora(prox.hora)}`;
}

export function textoEstadoTienda(horarios: Horario[], ahora: Date): string {
  if (estaAbierta(horarios, ahora)) {
    const hoy = horarioDelDia(horarios, aBogota(ahora).diaSemana)!;
    return `🟢 Abierta (cierra a las ${formatearHora(hoy.hora_cierre)})`;
  }
  const prox = proximaApertura(horarios, ahora);
  return prox ? `🔴 Cerrada (abre ${textoProximaApertura(prox)})` : "🔴 Cerrada";
}

export function textoHorarioSemana(horarios: Horario[]): string {
  return ORDEN_SEMANA.map((dia) => {
    const h = horarioDelDia(horarios, dia);
    const nombre = NOMBRES_DIA[dia][0].toUpperCase() + NOMBRES_DIA[dia].slice(1);
    return h
      ? `${nombre}: ${formatearHora(h.hora_apertura)} – ${formatearHora(h.hora_cierre)}`
      : `${nombre}: Cerrado`;
  }).join("\n");
}

export function sumarDiasISO(fechaISO: string, dias: number): string {
  const [a, m, d] = fechaISO.split("-").map((x) => parseInt(x, 10));
  const f = new Date(Date.UTC(a, m - 1, d + dias));
  return f.toISOString().slice(0, 10);
}

// "2026-11-19" → "jueves 19 de noviembre"
export function formatearFechaLarga(fechaISO: string): string {
  const [a, m, d] = fechaISO.slice(0, 10).split("-").map((x) => parseInt(x, 10));
  const f = new Date(Date.UTC(a, m - 1, d));
  return `${NOMBRES_DIA[f.getUTCDay()]} ${d} de ${NOMBRES_MES[m - 1]}`;
}

// "19/11/2026" → "2026-11-19" o null si no es una fecha válida
export function parsearFechaDDMMAAAA(texto: string): string | null {
  const coincide = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!coincide) return null;
  const [d, m, a] = [parseInt(coincide[1], 10), parseInt(coincide[2], 10), parseInt(coincide[3], 10)];
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

// "07:00-21:00" (24 h) → { apertura, cierre } o null
export function parsearRangoHorario(texto: string): { apertura: string; cierre: string } | null {
  const coincide = texto.trim().match(/^(\d{1,2}):(\d{2})\s*[-–a]\s*(\d{1,2}):(\d{2})$/);
  if (!coincide) return null;
  const [h1, m1, h2, m2] = coincide.slice(1).map((x) => parseInt(x, 10));
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const apertura = `${String(h1).padStart(2, "0")}:${String(m1).padStart(2, "0")}`;
  const cierre = `${String(h2).padStart(2, "0")}:${String(m2).padStart(2, "0")}`;
  if (horaAMinutos(cierre) <= horaAMinutos(apertura)) return null;
  return { apertura, cierre };
}

export type Periodo = "hoy" | "7d" | "mes";

// Inicio del periodo (medianoche de Bogotá) como fecha UTC
export function inicioPeriodo(periodo: Periodo, ahora: Date): Date {
  const m = aBogota(ahora);
  let dia = m.dia;
  if (periodo === "7d") dia = m.dia - 6;
  if (periodo === "mes") dia = 1;
  return new Date(Date.UTC(m.anio, m.mes - 1, dia) + DESFASE_MS);
}

export const NOMBRES_PERIODO: Record<Periodo, string> = {
  hoy: "hoy",
  "7d": "últimos 7 días",
  mes: "este mes",
};
