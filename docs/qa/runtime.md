# QA ejecutada con API y PostgreSQL reales

Resultados de la ejecución del 14 de octubre de 2026 (America/Bogota); los JSON registran horas UTC del 15 de octubre.
El backend se ejecutó en Docker Compose con PostgreSQL 16.15; el cliente de pruebas
usó Node v24.19.0. Los informes describen esta máquina y estos datos, no una
capacidad garantizada en producción.

## Reproducción

Con Node >= 22, Docker Compose y las dependencias instaladas desde el lockfile:

```sh
docker compose up -d --wait
npm run test:integration
npm run test:load
npx --no-install tsx tests/load/explain.ts
```

La suite y la carga usan HTTP contra `http://127.0.0.1:3000`. `API_PORT` o `API_URL`
permiten apuntar al puerto publicado del mismo Compose. Las comprobaciones SQL
usan `docker compose exec -T postgres`; deben apuntar a la misma base del backend.
La contraseña de demostración se lee internamente desde el archivo de runtime
mediante `docker compose exec -T api` o desde `DEMO_PASSWORD` si ya está definido.
No se imprime ni se guarda en los informes, al igual que los access tokens,
refresh tokens, semillas privadas y QR completos.

Las pruebas crean eventos aislados con prefijo `qa-`, fechas relativas y cuentas
semilla existentes. No consumen el inventario de los eventos entregados. Se
conservan sus fixtures para inspeccionar la evidencia SQL. Las cuentas creadas por
el caso de registro se excluyen de la selección de cuentas demo: tienen su propia
contraseña aleatoria y no comparten la contraseña de la semilla.

## Integración

**18 aprobadas, 0 fallidas, 0 omitidas.** Se ejecutó nuevamente la suite completa
tras corregir la selección de cuentas demo. El detalle y las duraciones están en
[runtime-results.json](runtime-results.json).

Las comprobaciones cubren registro con rol aplicado por el servidor; logout que
invalida access y refresh; rotación y replay de refresh; reservas y pagos
concurrentes con una sola clave; conflicto al cambiar el payload de esa clave;
precio calculado por el servidor y congelado al reservar; vencimiento y pago
tardío con reembolso único; cancelación repetida; límite por cuenta entre zonas;
autorización por organizador, usuario y asignación del staff; firma y prueba de
posesión Ed25519; QR antiguo, futuro, mal formado y alterado; transferencia y su
cancelación; revocaciones incrementales; dos dispositivos y doble ingreso;
reenvío de lote y conflicto de UUID; reembolso idempotente; carrera de ingreso
contra reembolso; auditoría inmutable y restricción física de aforo en PostgreSQL.

El vencimiento se comprueba tanto con el worker, sin tráfico de compra, como
mediante una transacción real que bloquea la zona por dos segundos: el pago
empieza antes del vencimiento, termina de esperar después y debe devolver
`late_refunded` sin ticket. Solo se adelanta el vencimiento de la reserva de
prueba en SQL; no se modifica el reloj del host.

La prueba de dos puertas registra dos dispositivos y turnos independientes,
verifica el mismo QR localmente en ambos y sincroniza después. Confirma dos
intentos persistidos, una admisión canónica y un incidente visible en el endpoint
del portal. Repetir el lote conserva esos conteos. Este caso comprueba el
protocolo y el servidor; no afirma haber usado dos teléfonos o dos bases SQLite
nativas. La cámara, el modo avión del dispositivo, Expo nativo y la persistencia
de SQLite en un teléfono requieren la validación manual indicada en el proyecto.

## Carga de compra y disponibilidad

La carrera lanza 200 reservas simultáneas desde 200 sesiones distintas. Cada
comprador que obtiene reserva paga una entrada. Autenticar usuarios queda fuera
de la medición. Se usa un evento aislado con exactamente 50 entradas restantes,
una zona y límite por cuenta de una entrada.

| Resultado | Medido |
|---|---:|
| Compradores concurrentes | 200 |
| Entradas vendidas | 50 |
| Tickets emitidos / cargos SQL | 50 / 50 |
| Rechazos esperados `409 SOLD_OUT` | 150 |
| Errores inesperados | 0 |
| Reservas activas / cupos reservados al terminar | 0 / 0 |
| Violaciones de aforo o contadores negativos | 0 |
| Duración de la carrera, reserva y pago | 1198.47 ms |

| Operación | Muestras | p50 | p95 |
|---|---:|---:|---:|
| Reserva, incluye rechazos por agotamiento | 200 | 679.64 ms | 908.52 ms |
| Pago, compradores que reservaron | 50 | 663.12 ms | 686.62 ms |
| Disponibilidad, ráfaga independiente | 500 | 23.75 ms | 36.96 ms |

La ráfaga de disponibilidad usó 50 clientes concurrentes y completó las 500
solicitudes en 245.48 ms; todas devolvieron disponibilidad cero después de la
venta. Es una medición breve
sobre esta máquina; no sustituye una prueba sostenida ni caracteriza otros
volúmenes de datos. El detalle está en [load-results.json](load-results.json).
Una primera ejecución se detuvo antes de lanzar la carrera porque seleccionó una
cuenta creada por el test de registro; se corrigió el selector del harness y se
repitió con las 200 cuentas semilla autenticadas.

## Planes de consulta

[explain.txt](explain.txt) contiene `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` real y el
SQL de cuatro consultas de la aplicación, con estadísticas actualizadas mediante
`ANALYZE`. En ese momento había 3971 tickets, 1921 compras, 404 reservas y 1778
intentos de escaneo, incluyendo la semilla y los fixtures.

| Consulta | Tiempo de ejecución SQL |
|---|---:|
| Ingresos administrativos por evento | 1.365 ms |
| Búsqueda de entradas del administrador | 0.645 ms |
| Billetera por cursor, primera página | 0.604 ms |
| Disponibilidad por zona y fase vigente | 0.207 ms |

Ingresos fue la consulta más lenta de esa muestra. La comparación no identifica
un máximo global de todos los endpoints o tamaños de datos. Los tiempos SQL no
incluyen autenticación, transporte, serialización ni la composición de otras
consultas del endpoint.

`zones_event` ayuda a localizar las zonas; `price_phase_current` acota las fases
por zona y fecha; el índice parcial de reservas activas limita el trabajo de
expiración. Los índices únicos de cargos, reembolsos e idempotencia refuerzan la
consistencia. `tickets_holder_cursor` sirve para localizar el titular, aunque el
orden por UUID todavía puede necesitar un sort: un índice `(holder_id,id)` es una
optimización a evaluar para billeteras grandes. La búsqueda `%texto%` requiere
medición con mayor volumen antes de justificar un índice trigram o una proyección.
