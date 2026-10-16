# Hypernova Labs · Ticketing y control de acceso

Monolito modular NestJS + PostgreSQL, portal React independiente y app React Native + Expo con modos asistente y escáner. El enunciado se recibió en texto y está resumido en [requisitos](docs/requirements/enunciado.md).

Para preparar la presentación: [guía de uso y grabación en emuladores Android](docs/demo/guia-video.md) y [checklist contra el enunciado, con pendientes reales](docs/demo/checklist-entrega.md).

**Validación actual:** 18 pruebas de integración con PostgreSQL, 7 de protocolo criptográfico y 5 de sesiones del portal pasaron. La carrera HTTP de 200 compradores vendió exactamente 50 entradas, con 50 cargos, 150 respuestas de cupo agotado y cero reservas residuales. La ejecución nativa en un dispositivo, el APK/IPA y el video de dos escáneres siguen pendientes. Los bundles Android/iOS y el bytecode criptográfico compilan; eso no acredita cámara, SecureStore o SQLite nativos.

## Arranque desde un clon limpio

Requiere Docker Engine y Docker Compose v2, con puertos 3000 y 8080 disponibles. No requiere crear `.env` ni introducir contraseñas para la demostración local:

```sh
docker compose up --build
```

Compose genera secretos aleatorios en volúmenes, inicia PostgreSQL, ejecuta migraciones y semilla en `initialize`, y arranca API y portal construido. `initialize` y `secrets` terminan con código 0; PostgreSQL, API y portal deben quedar saludables. La API se ejecuta con UID 1000 y rol SQL limitado, sin montar el secreto owner. Los datos persisten al reiniciar.

```sh
docker compose ps -a
curl -fsS http://127.0.0.1:3000/v1/readiness
```

Abre el portal en el puerto 8080 de tu máquina. La API utiliza el puerto 3000. Se pueden configurar con `API_PORT` y `ADMIN_PORT` en `.env`, según [.env.example](.env.example). El contenedor de PostgreSQL no publica su puerto.

En esta nube, el proxy necesita DNS y CA de confianza dentro del constructor Docker. Usa el adaptador que conserva la verificación TLS e integridad npm:

```sh
./scripts/cloud-compose.sh up -d --build --wait --wait-timeout 90
```

El adaptador obtiene la dirección del proxy ya configurado y monta su CA solo durante la construcción. No guarda certificados, claves o valores del proxy en Git. En máquinas sin esa configuración usa Compose normal.

## Arranque en Windows y saltos de línea

El archivo puede existir pero tener CRLF en su shebang. Git fuerza LF en los
scripts mediante `.gitattributes`, y la imagen normaliza el entrypoint antes de
ejecutarlo para cubrir también clones anteriores. Actualiza la rama y reconstruye:

```sh
git pull --ff-only origin feat/ticketing-platform
docker compose up -d --build --wait --wait-timeout 90
curl -fsS http://127.0.0.1:3000/v1/readiness
```

No hace falta eliminar volúmenes. La advertencia de locale de PostgreSQL no es
la causa de este error. Si persiste, consulta `docker compose logs initialize api`.

## Acceso de demostración

Identidades sintéticas de la semilla:

| Rol | Correo |
|---|---|
| Admin | `admin.101@example.test` |
| Organizador | `organizador.201@example.test` |
| Otro organizador | `organizador.202@example.test` |
| Staff | `staff.301@example.test` |
| Asistente | Consulta las identidades sanitizadas del archivo de semilla |

Obtén localmente la contraseña de demostración generada para **tu** instalación:

```sh
docker compose exec -T api cat /app/runtime/demo-credentials.json
```

Para listar unos asistentes de prueba sin mostrar hashes o contraseñas:

```sh
docker compose exec -T postgres psql -U hypernova_owner -d hypernova -c "SELECT email FROM users WHERE id LIKE 'asistente-%' ORDER BY id LIMIT 5"
```

No hay una contraseña pública por defecto. Todas estas cuentas son para demostración local y comparten la contraseña generada de esa instancia. No expongas la instalación de demostración a Internet. Un despliegue público necesita TLS, configuración de origen y gestión propia de identidades y secretos.

## Desarrollo y app móvil

Requiere Node.js 22 o posterior. Las dependencias están ancladas en `package-lock.json`:

```sh
npm ci --ignore-scripts
npm run build
npm run dev:admin
```

Para Expo, configura `apps/mobile/.env` desde su ejemplo, con `EXPO_PUBLIC_API_URL=http://IP_LAN:3000/v1`. Android Emulator usa `http://10.0.2.2:3000/v1`; un teléfono necesita la IP LAN del computador, no su localhost.

```sh
npm run dev:mobile
```

[Instrucciones móviles exactas](apps/mobile/README.md): Expo Go compatible con SDK 54 o build local con `expo run:android` / `expo run:ios`, permisos, modo avión y demostración. En esta nube utiliza `EXPO_NO_TELEMETRY=1` y `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/hypernova-expo` para que la CLI escriba su caché en una ruta permitida. Esa variable solo cambia la ubicación de la caché de Expo.

## Cómo se cumplen los invariantes

- **Aforo:** PostgreSQL bloquea la fila de zona; restricciones impiden inventario negativo o superior al aforo. `account_inventory` serializa el límite por comprador y evento incluso entre zonas. Reserva aumenta reservadas; pago mueve cupo a vendidas; expiración, cancelación y reembolso liberan cupo. Transferir no libera el límite del comprador original; evita comprar y transferir para eludirlo.
- **Pago único:** claves por usuario/operación, fingerprint del payload y bloqueo transaccional persistente. Repetir la clave conserva el resultado; cambiar su payload produce conflicto. Precio en centésimos fijado por el servidor al reservar. Pago simulado, ledger y emisión se confirman juntos. Pago tardío produce reembolso simulado idempotente y ninguna entrada. Una pasarela externa necesitaría idempotencia externa/outbox.
- **Expiración:** TTL por defecto de 600 segundos, worker cada segundo y recuperación a demanda bajo bloqueo. Las filas sobreviven al reinicio. Se usa hora de PostgreSQL después de adquirir bloqueos para no aceptar un pago que esperó hasta después del vencimiento.
- **Autenticidad:** credencial Ed25519 del servidor vinculada a clave pública del titular, más firma de posesión del dispositivo cada 25 segundos. Se admite ventana actual y anterior, menos de 50 segundos. La privada emisora permanece en el servidor; la semilla del titular se genera con Expo Crypto y se guarda en SecureStore. Transferir cambia versión/titular y revoca la credencial previa.
- **Ingreso:** SQLite conserva cada intento y UUID; una transacción impide una segunda aceptación local para el evento/ticket. La API revalida y conserva los resultados local y central. Unicidad central por ticket/evento e incidente `double_ingress` para dos admisiones offline. Repetir el lote no duplica accesos.

Dos puertas aisladas pueden admitir físicamente la misma entrada. El sistema detecta el conflicto al sincronizar y conserva la evidencia. Un escáner desconectado tampoco conoce revocaciones nuevas; aplica el snapshot disponible y exige renovar al vencer su límite offline. Las firmas no prueban la honestidad del reloj del dispositivo. Véanse [protocolo y riesgos](docs/security.md).

## API y configuración

API REST bajo `/v1`, errores `{error: {code, message}, correlationId}` y logs JSON correlacionados. Autorización por rol y recurso en el servidor, refresh rotativo con familias revocables y rate limiting. Registro: 10/min/IP; login: 300/min/IP; compra: 100/min/usuario. El limitador es local al proceso; la configuración entregada ejecuta una API, no promete límites globales entre réplicas.

| Área | Rutas principales |
|---|---|
| Identidad | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` |
| Cartelera | `/events`, `/events/:id` |
| Compra | `/reservations`, `/reservations/:id`, `/reservations/:id/pay`, `/reservations/:id/cancel` |
| Billetera | `/tickets`, `/tickets/:id/credential`, `/tickets/:id/refund`, `/purchases` |
| Transferencias | `/tickets/:id/transfers`, `/transfers`, `/transfers/:id/accept`, `/transfers/:id/cancel` |
| Escáner | `/scanner/devices`, `/scanner/bootstrap`, `/scanner/shifts`, `/scanner/scans`, `/scanner/revocations` |
| Administración | `/admin/events`, zonas, fases, puertas, staff, tickets/refund/void, accesos, dispositivos, incidentes y auditoría |
| Operación | `/health`, `/readiness` |

Envía `Authorization: Bearer <accessToken>` donde corresponde y `Idempotency-Key` al reservar, pagar, reembolsar o anular. Listados grandes usan `items` y `nextCursor`; envía `cursor` en la siguiente petición. La disponibilidad pública tiene caché de 500 ms con agrupación de solicitudes; la compra siempre valida PostgreSQL. El portal refresca ventas cada 10 segundos.

Variables: `API_PORT`, `ADMIN_PORT`, `RESERVATION_TTL_SECONDS` para Compose; `EXPO_PUBLIC_API_URL` pública para móvil. Ejecución API fuera de Compose: `DATABASE_URL`, `DATABASE_ADMIN_URL` solo para inicializar, `DB_APP_PASSWORD`, `JWT_SECRET` de al menos 32 caracteres, `ISSUER_PRIVATE_KEY` semilla Ed25519 hex de 32 bytes o PEM, `DEMO_PASSWORD`, `RUNTIME_DIR`, `DB_POOL_SIZE`, `SCANNER_MAX_OFFLINE_HOURS` y `CORS_ORIGINS`. Nunca coloques secretos en variables `EXPO_PUBLIC_*` o `VITE_*`.

## Datos y pruebas reproducibles

La semilla conserva los 8.762 registros y relaciones del dataset entregado, con contraseñas eliminadas e identidades sanitizadas. IDs de roles se mapean a `(rol,id)` porque se repetían entre tablas. La primera inicialización desplaza las fechas relativas a la referencia del dataset hasta su ancla actual y la guarda; reiniciar no vuelve a desplazar ni duplicar datos. El original no está en Git. [Auditoría y transformación reproducible](docs/qa/dataset.md).

El arranque desde clon limpio y la repetición de semilla están comprobados en [clean-clone.json](docs/qa/clean-clone.json), usando el adaptador de proxy/CA de esta nube.

Con el stack saludable:

```sh
npm test
npm run typecheck
npm run build
npm run test:integration
npm run test:load
npx tsx tests/load/explain.ts
npm run export -w @hypernova/mobile
```

Las pruebas de integración/carga requieren Docker Compose local para comprobar PostgreSQL y leer internamente las credenciales demo, sin imprimirlas. Crean eventos QA aislados y conservan los resultados; la carga no consume las 50 entradas originales de zona 8. La selección usa solo cuentas de semilla, para no reutilizar la contraseña demo con cuentas registradas en pruebas. Si repites muchas veces en un minuto, respeta el rate limit de login.

Evidencia: [integración y carga](docs/qa/runtime.md), [JSON de carga](docs/qa/load-results.json), [EXPLAIN real](docs/qa/explain.txt), [portal en navegador](docs/qa/admin-smoke.json) y [estado móvil](docs/qa/mobile.md). Reserva p50/p95: **679,64/908,52 ms**; pago: **663,12/686,62 ms** en esta ejecución local. Son mediciones de una muestra, no un SLA.

`npm audit` se ejecutó: cero avisos en dependencias de producción de API/portal; el workspace completo conserva 35 avisos (23 altos, 12 moderados), principalmente herramientas Expo/Metro. [Detalle y alcance](docs/qa/dependencies.json). No se desactivó TLS, integridad ni la auditoría; no se aplicó el downgrade incompatible propuesto automáticamente por npm.

## Documentación y pendientes

[Arquitectura](docs/architecture/overview.md) · [modelo transaccional](docs/architecture/data-model.md) · [ADR](docs/adr/README.md) · [matriz de requisitos](docs/requirements/matrix.md) · [auditoría inicial](docs/progress/phase-1.md) · [informe de implementación](docs/progress/phase-2-4.md).

Pendientes explícitos: prueba nativa de cámara/SecureStore/SQLite y modo avión en dos dispositivos, grabación del video/GIF exigido y build instalable preferido. No se implementaron bonus de lista de espera, Wallet, push, asientos, WebSocket o despliegue público. No se declara completa la entrega nativa sin esa evidencia.
