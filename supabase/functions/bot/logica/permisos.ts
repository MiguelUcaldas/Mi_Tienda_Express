// Matriz de permisos fijos (sección 3.3). Funciones puras.

export type RolMiembro = "dueno" | "administrador" | "empleado" | "domiciliario";
export type Rol = RolMiembro | "cliente";

export type Accion =
  | "configurar_tienda"
  | "transferir_tienda"
  | "gestionar_administradores"
  | "gestionar_personal"
  | "gestionar_productos"
  | "gestionar_promociones"
  | "gestionar_tarifas"
  | "actualizar_stock"
  | "gestionar_pedidos"
  | "confirmar_pagos"
  | "asignar_domiciliario"
  | "entregar_pedido"
  | "despachar_asignado"
  | "cancelar_pedido_aceptado"
  | "ver_reportes"
  | "ver_dashboard";

export const ROLES_MIEMBRO: RolMiembro[] = ["dueno", "administrador", "empleado", "domiciliario"];

export const MATRIZ_PERMISOS: Record<Accion, RolMiembro[]> = {
  configurar_tienda: ["dueno"],
  transferir_tienda: ["dueno"],
  gestionar_administradores: ["dueno"],
  gestionar_personal: ["dueno", "administrador"],
  gestionar_productos: ["dueno", "administrador"],
  gestionar_promociones: ["dueno", "administrador"],
  gestionar_tarifas: ["dueno", "administrador"],
  actualizar_stock: ["dueno", "administrador", "empleado"],
  gestionar_pedidos: ["dueno", "administrador", "empleado"],
  confirmar_pagos: ["dueno", "administrador"],
  asignar_domiciliario: ["dueno", "administrador", "empleado"],
  entregar_pedido: ["dueno", "administrador", "empleado", "domiciliario"],
  despachar_asignado: ["domiciliario"],
  cancelar_pedido_aceptado: ["dueno", "administrador"],
  ver_reportes: ["dueno", "administrador"],
  ver_dashboard: ["dueno"],
};

export function puede(rol: Rol, accion: Accion): boolean {
  if (rol === "cliente") return false;
  return MATRIZ_PERMISOS[accion].includes(rol);
}

export function esRolMiembro(valor: string): valor is RolMiembro {
  return (ROLES_MIEMBRO as string[]).includes(valor);
}

// Roles que un actor puede invitar o asignar (nunca 'dueno')
export function rolesAsignables(rolActor: Rol): RolMiembro[] {
  if (puede(rolActor, "gestionar_administradores")) return ["administrador", "empleado", "domiciliario"];
  if (puede(rolActor, "gestionar_personal")) return ["empleado", "domiciliario"];
  return [];
}

// ¿Puede el actor modificar o quitar a un miembro con rolObjetivo? (RN de la sección 3.2)
export function puedeGestionarMiembro(rolActor: Rol, rolObjetivo: RolMiembro): boolean {
  if (rolObjetivo === "dueno") return false;
  if (rolObjetivo === "administrador") return puede(rolActor, "gestionar_administradores");
  return puede(rolActor, "gestionar_personal");
}

// ¿Puede el actor cambiar a un miembro de rolObjetivo a rolNuevo?
export function puedeCambiarRol(rolActor: Rol, rolObjetivo: RolMiembro, rolNuevo: RolMiembro): boolean {
  if (rolNuevo === rolObjetivo) return false;
  return puedeGestionarMiembro(rolActor, rolObjetivo) && rolesAsignables(rolActor).includes(rolNuevo);
}

export const NOMBRES_ROL: Record<Rol, string> = {
  dueno: "Dueño",
  administrador: "Administrador",
  empleado: "Empleado",
  domiciliario: "Domiciliario",
  cliente: "Cliente",
};
