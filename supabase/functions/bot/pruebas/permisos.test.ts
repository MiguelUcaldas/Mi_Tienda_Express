import { assertEquals } from "jsr:@std/assert@1";
import {
  type Accion,
  puede,
  puedeCambiarRol,
  puedeGestionarMiembro,
  rolesAsignables,
  type RolMiembro,
} from "../logica/permisos.ts";

// Copia literal de la matriz 3.3: [dueno, administrador, empleado, domiciliario]
const ESPERADO: Record<Accion, [boolean, boolean, boolean, boolean]> = {
  configurar_tienda: [true, false, false, false],
  transferir_tienda: [true, false, false, false],
  gestionar_administradores: [true, false, false, false],
  gestionar_personal: [true, true, false, false],
  gestionar_productos: [true, true, false, false],
  gestionar_promociones: [true, true, false, false],
  gestionar_tarifas: [true, true, false, false],
  actualizar_stock: [true, true, true, false],
  gestionar_pedidos: [true, true, true, false],
  confirmar_pagos: [true, true, false, false],
  asignar_domiciliario: [true, true, true, false],
  entregar_pedido: [true, true, true, true],
  despachar_asignado: [false, false, false, true],
  cancelar_pedido_aceptado: [true, true, false, false],
  ver_reportes: [true, true, false, false],
  ver_dashboard: [true, false, false, false],
};

const ROLES: RolMiembro[] = ["dueno", "administrador", "empleado", "domiciliario"];

Deno.test("matriz completa de permisos", () => {
  for (const [accion, valores] of Object.entries(ESPERADO)) {
    ROLES.forEach((rol, i) => {
      assertEquals(puede(rol, accion as Accion), valores[i], `${rol} / ${accion}`);
    });
    assertEquals(puede("cliente", accion as Accion), false, `cliente / ${accion}`);
  }
});

Deno.test("nadie toca al dueño", () => {
  for (const rol of ROLES) assertEquals(puedeGestionarMiembro(rol, "dueno"), false, rol);
});

Deno.test("administrador no toca a otro administrador ni asciende a administrador", () => {
  assertEquals(puedeGestionarMiembro("administrador", "administrador"), false);
  assertEquals(puedeGestionarMiembro("administrador", "empleado"), true);
  assertEquals(puedeCambiarRol("administrador", "empleado", "administrador"), false);
  assertEquals(puedeCambiarRol("administrador", "empleado", "domiciliario"), true);
  assertEquals(rolesAsignables("administrador"), ["empleado", "domiciliario"]);
});

Deno.test("el dueño gestiona administradores", () => {
  assertEquals(puedeGestionarMiembro("dueno", "administrador"), true);
  assertEquals(puedeCambiarRol("dueno", "empleado", "administrador"), true);
  assertEquals(puedeCambiarRol("dueno", "administrador", "dueno"), false);
});

Deno.test("empleado no confirma pagos ni gestiona equipo", () => {
  assertEquals(puede("empleado", "confirmar_pagos"), false);
  assertEquals(puedeGestionarMiembro("empleado", "domiciliario"), false);
  assertEquals(rolesAsignables("empleado"), []);
});
