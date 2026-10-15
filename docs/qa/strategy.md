# Estrategia y estado de QA

**Ejecutado en Fase 1:** inspección Git, comparación de fuentes adjuntas, revisión
del dataset y verificación de herramientas locales. **No ejecutado:** suites de
negocio, API, base de datos del proyecto, carga, Expo ni Compose de la aplicación.
No hay métricas, capturas, EXPLAIN ni resultados de app para publicar todavía.

## Validación por fases

| Fase | Condiciones para avanzar |
|---|---|
| 1. Auditoría | Enunciado leído, matriz contrastada, dataset clasificado y reglas pendientes resueltas |
| 2. Base ejecutable | TypeScript estricto, migraciones, semilla idempotente, API/portal/DB con readiness, login y permisos básicos |
| 3. Compras | Inventario, límite, precio, reserva, expiración, pago/reembolso tardío e idempotencia comprobados con DB real |
| 4. Credenciales/móvil | Compatibilidad criptográfica móvil real, transferencias, QR, SQLite y sync probados |
| 5. Administración y entrega | Flujos completos del portal con API real, seguridad, carga, clon limpio y documentación de demo |

No se implementan funciones bonus antes de cerrar invariantes obligatorios. El
cronograma de cuatro días es una restricción del documento, no una promesa de
fecha o una evidencia de trabajo ya realizado.

## Diez escenarios obligatorios

| Caso | Preparación y resultado esperado | Nivel |
|---|---|---|
| 200 compradores / 50 entradas | Zona aislada con 50 disponibles; 200 usuarios, una compra válida cada uno; exactamente 50 vendidas; sin negativos/reservas sobrantes | Integración + carga PostgreSQL |
| Clave idempotente duplicada | Dos o más solicitudes simultáneas; un cobro y ticket; respuesta estable; clave/payload distinto rechazado | API + concurrencia |
| Reserva expira | Avanzar reloj controlado, reiniciar worker, recuperar aforo una sola vez; competir con pago | Integración |
| QR antiguo | Credencial y prueba válidas, luego fuera de ventana; rechazo sin red; test de tolerancia y alteración | Cripto + dispositivo |
| Transferencia | Aceptación del receptor cambia titular/version; anterior revocada; delta recibido la invalida | API + móvil |
| Dos puertas offline | Mismo ticket aceptado por dos DB locales aisladas; sync conserva dos intentos, una admisión y incidente | SQLite + integración |
| Reembolso de usada | Entrada admitida rechaza reembolso; carrera ingreso/reembolso consistente | API + concurrencia |
| Evento ajeno | Organizador con sesión válida intenta modificar otro evento; prohibición sin cambios SQL | API |
| Precio manipulado | Cliente añade/cambia importe; precio final del servidor según fase al reservar | API |
| Sync repetida | Reenviar mismo lote/UUID tras pérdida de respuesta; mismos resultados y conteos; payload diferente da conflicto | API + integración |

Datos para estos escenarios deben ser aislados y deterministas. El reloj de
pruebas puede ser controlado mediante una abstracción explícita sin cambiar el
reloj del host; producción usa hora del servidor. No rebajar aserciones ni usar
almacenamiento en memoria para sustituir PostgreSQL en pruebas críticas.

## Comprobaciones adicionales necesarias

- Refresh concurrente, replay y logout; roles y scope de cada endpoint.
- Límite por usuario con claves distintas; carreras transferencia/refund/scan.
- Expiración recuperable, reinicio entre pasos de pago y replay tardío.
- Restricciones SQL de capacidad, relación evento-zona y precio temporal.
- Persistencia SQLite tras reinicio, miles de scans, lotes con fallos parciales.
- Cancelación de transferencia pendiente, staff revocado y revocaciones paginadas.
- Semilla ejecutada dos veces y Compose desde clon limpio, no solo en workspace.
- Portal sin cifras simuladas, búsqueda paginada y autorización cruzada.

## Evidencia reproducible

Guardar comando, versiones, commit objetivo, hora, configuración no sensible,
conteos y código de salida. Distinguir passed/failed/skipped/unrun; cero pruebas
no valida una suite. Carga: medir p50/p95, fallos de transporte, rechazos esperados
por agotamiento y ventas SQL finales por separado. Conservar EXPLAIN real de una
consulta de reservas vencidas o ventas, junto con tamaño y estado del dataset.

Los hallazgos del dataset pertenecen a [dataset.md](dataset.md); no se confunden
con fallos de una aplicación todavía inexistente.
