// Máquina de estados del pedido (sección 6). Funciones puras.

export type EstadoPedido =
  | "esperando_tienda"
  | "esperando_confirmacion_cliente"
  | "esperando_pago"
  | "verificando_pago"
  | "en_preparacion"
  | "listo"
  | "despachado"
  | "entregado"
  | "cancelado";

export type Modalidad = "domicilio" | "recogida";
export type MedioPago = "llave_breb" | "nequi" | "bancolombia" | "contra_entrega";

export const MEDIOS_PAGO: MedioPago[] = ["llave_breb", "nequi", "bancolombia", "contra_entrega"];
export const MEDIOS_TRANSFERENCIA: MedioPago[] = ["llave_breb", "nequi", "bancolombia"];

export function esTransferencia(medio: string): boolean {
  return (MEDIOS_TRANSFERENCIA as string[]).includes(medio);
}

type Condicion = { modalidad?: Modalidad; pago?: "contra_entrega" | "transferencia" };
interface Transicion extends Condicion {
  desde: EstadoPedido;
  hacia: EstadoPedido;
}

export const TRANSICIONES: Transicion[] = [
  // Domicilio
  { desde: "esperando_tienda", hacia: "esperando_confirmacion_cliente", modalidad: "domicilio" },
  { desde: "esperando_confirmacion_cliente", hacia: "en_preparacion", modalidad: "domicilio", pago: "contra_entrega" },
  { desde: "esperando_confirmacion_cliente", hacia: "esperando_pago", modalidad: "domicilio", pago: "transferencia" },
  { desde: "listo", hacia: "despachado", modalidad: "domicilio" },
  { desde: "despachado", hacia: "entregado", modalidad: "domicilio" },
  // Recogida
  { desde: "esperando_tienda", hacia: "en_preparacion", modalidad: "recogida", pago: "contra_entrega" },
  { desde: "esperando_tienda", hacia: "esperando_pago", modalidad: "recogida", pago: "transferencia" },
  { desde: "listo", hacia: "entregado", modalidad: "recogida" },
  // Comunes
  { desde: "esperando_pago", hacia: "verificando_pago", pago: "transferencia" },
  { desde: "verificando_pago", hacia: "en_preparacion", pago: "transferencia" },
  { desde: "verificando_pago", hacia: "esperando_pago", pago: "transferencia" },
  { desde: "en_preparacion", hacia: "listo" },
];

// RN-29: estados en los que el cliente puede cancelar
export const CANCELABLES_CLIENTE: EstadoPedido[] = [
  "esperando_tienda",
  "esperando_confirmacion_cliente",
  "esperando_pago",
  "verificando_pago",
];

// RN-30: estados en los que dueño/administrador cancelan un pedido aceptado
export const CANCELABLES_TIENDA: EstadoPedido[] = [
  "esperando_confirmacion_cliente",
  "esperando_pago",
  "verificando_pago",
  "en_preparacion",
  "listo",
];

export const ESTADOS_FINALES: EstadoPedido[] = ["entregado", "cancelado"];

// Estados con temporizador (sección 5, tabla de temporizadores)
export const ESTADOS_CON_TEMPORIZADOR: EstadoPedido[] = [
  "esperando_tienda",
  "esperando_confirmacion_cliente",
  "esperando_pago",
];

export function esFinal(estado: EstadoPedido): boolean {
  return ESTADOS_FINALES.includes(estado);
}

export function transicionPermitida(
  estadoActual: EstadoPedido,
  estadoNuevo: EstadoPedido,
  modalidad: Modalidad,
  medioPago: MedioPago,
): boolean {
  if (estadoNuevo === "cancelado") {
    return CANCELABLES_CLIENTE.includes(estadoActual) || CANCELABLES_TIENDA.includes(estadoActual);
  }
  const tipoPago = medioPago === "contra_entrega" ? "contra_entrega" : "transferencia";
  return TRANSICIONES.some((t) =>
    t.desde === estadoActual &&
    t.hacia === estadoNuevo &&
    (t.modalidad === undefined || t.modalidad === modalidad) &&
    (t.pago === undefined || t.pago === tipoPago)
  );
}

export function clientePuedeCancelar(estado: EstadoPedido): boolean {
  return CANCELABLES_CLIENTE.includes(estado);
}

export function tiendaPuedeCancelar(estado: EstadoPedido): boolean {
  return CANCELABLES_TIENDA.includes(estado);
}

// Estado al que pasa un pedido cuando la tienda lo acepta (en domicilio, tras fijar la tarifa)
export function estadoAlAceptar(modalidad: Modalidad, medioPago: MedioPago): EstadoPedido {
  if (modalidad === "domicilio") return "esperando_confirmacion_cliente";
  return medioPago === "contra_entrega" ? "en_preparacion" : "esperando_pago";
}

// Estado al que pasa cuando el cliente acepta el valor del domicilio
export function estadoAlAceptarDomicilio(medioPago: MedioPago): EstadoPedido {
  return medioPago === "contra_entrega" ? "en_preparacion" : "esperando_pago";
}

export const MOTIVO_POR_VENCIMIENTO: Record<string, string> = {
  esperando_tienda: "sin_respuesta_tienda",
  esperando_confirmacion_cliente: "sin_respuesta_cliente",
  esperando_pago: "sin_comprobante",
};
