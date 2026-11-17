// Códigos de entrega (RN-32, RN-33) e invitación (RN-38). Funciones puras.

export type Aleatorio = () => number; // número en [0, 1)

export function aleatorioSeguro(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

// 4 dígitos, con ceros a la izquierda ("0042")
export function generarCodigoEntrega(aleatorio: Aleatorio = aleatorioSeguro): string {
  return String(Math.floor(aleatorio() * 10000) % 10000).padStart(4, "0");
}

export function codigoCorrecto(esperado: string | null | undefined, ingresado: string): boolean {
  if (!esperado) return false;
  return ingresado.trim() === esperado.trim();
}

// Se alerta una sola vez, cuando los intentos fallidos llegan al máximo
export function debeAlertarCodigo(intentosFallidos: number, maximo: number, alertaEnviada: boolean): boolean {
  return !alertaEnviada && intentosFallidos >= maximo;
}

// 8 caracteres A-Z y 2-9, sin O, 0, I ni 1
export const ALFABETO_INVITACION = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generarCodigoInvitacion(aleatorio: Aleatorio = aleatorioSeguro): string {
  let codigo = "";
  for (let i = 0; i < 8; i++) {
    codigo += ALFABETO_INVITACION[Math.floor(aleatorio() * ALFABETO_INVITACION.length) % ALFABETO_INVITACION.length];
  }
  return codigo;
}
