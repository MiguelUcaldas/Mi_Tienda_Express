import { assertEquals } from "jsr:@std/assert@1";
import {
  aplicarPromocion,
  precioVigente,
  type Promocion,
  promocionVigente,
  promocionVigenteOProgramada,
  validarValorPromocion,
} from "../logica/promociones.ts";

const veintePorCiento: Promocion = {
  tipo: "porcentaje",
  valor: 20,
  inicia_en: "2026-11-15",
  termina_en: "2026-12-15",
  activa: true,
};

Deno.test("porcentaje con redondeo", () => {
  assertEquals(aplicarPromocion(4800, veintePorCiento), 3840);
  // 3333 * 0.85 = 2833.05 → 2833
  assertEquals(aplicarPromocion(3333, { ...veintePorCiento, valor: 15 }), 2833);
  // 2.5 se redondea hacia arriba: 5 * 0.5 = 2.5 → 3
  assertEquals(aplicarPromocion(5, { ...veintePorCiento, valor: 50 }), 3);
});

Deno.test("precio especial", () => {
  const especial: Promocion = { ...veintePorCiento, tipo: "precio_especial", valor: 3900 };
  assertEquals(aplicarPromocion(4800, especial), 3900);
});

Deno.test("vigencia por fechas (inclusive)", () => {
  assertEquals(promocionVigente(veintePorCiento, "2026-11-14"), false); // antes del inicio
  assertEquals(promocionVigente(veintePorCiento, "2026-11-15"), true); // día de inicio
  assertEquals(promocionVigente(veintePorCiento, "2026-12-15"), true); // último día
  assertEquals(promocionVigente(veintePorCiento, "2026-12-16"), false); // después del fin
});

Deno.test("promoción finalizada antes de tiempo no aplica", () => {
  const finalizada = { ...veintePorCiento, activa: false };
  assertEquals(promocionVigente(finalizada, "2026-11-20"), false);
  assertEquals(precioVigente(4800, [finalizada], "2026-11-20").precio, 4800);
});

Deno.test("precio vigente con y sin promoción", () => {
  assertEquals(precioVigente(4800, [veintePorCiento], "2026-11-20").precio, 3840);
  assertEquals(precioVigente(4800, [veintePorCiento], "2026-12-20").precio, 4800);
  assertEquals(precioVigente(4800, [], "2026-11-20").promocion, null);
});

Deno.test("programada cuenta para RN-14", () => {
  assertEquals(promocionVigenteOProgramada(veintePorCiento, "2026-11-01"), true);
  assertEquals(promocionVigenteOProgramada(veintePorCiento, "2026-12-16"), false);
});

Deno.test("validación de valores", () => {
  assertEquals(validarValorPromocion("porcentaje", 20, 4800), null);
  assertEquals(typeof validarValorPromocion("porcentaje", 95, 4800), "string");
  assertEquals(typeof validarValorPromocion("porcentaje", 0, 4800), "string");
  assertEquals(validarValorPromocion("precio_especial", 3900, 4800), null);
  assertEquals(typeof validarValorPromocion("precio_especial", 4800, 4800), "string");
});
