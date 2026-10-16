# Guía de uso y grabación — Android en emuladores Windows

Esta guía sigue el enunciado: recorrido sugerido de 5–12 minutos y evidencia específica de dos escáneres offline. No usa teléfonos físicos. Los resultados que todavía no has comprobado están pendientes en la [checklist](checklist-entrega.md).

## 1. Preparación: no empieces por grabar

Cierra primero los cambios que vas a entregar y pruébalos. `main` tenía la entrega base, pero al revisar aún le faltaba la corrección CRLF de Windows; incorpora los últimos cambios mediante un PR/merge autorizado antes de congelar la grabación. Anota `git log -1` del commit final. Si cambias el commit al añadir el enlace del video, actualiza también la evidencia de la revisión mostrada: no atribuyas el video a un SHA diferente.

Usa OBS Studio con captura de pantalla/ventanas y audio. Configura al menos 1080p, texto legible y escenas para terminal, portal y emuladores. Oculta notificaciones, correos personales y contraseñas. Es posible acelerar las esperas de construcción; conserva completos los flujos y señala las aceleraciones.

### Instancias Android necesarias

En Android Studio → Device Manager, crea dispositivos virtuales distintos con almacenamiento separado:

| Instancia | Cuenta durante el escaneo | Función |
|---|---|---|
| Billetera | Asistente A | Comprar y mostrar QR rotativo |
| Puerta A | `staff.301@example.test` | Escáner independiente, puerta A |
| Puerta B | `staff.302@example.test` | Escáner independiente, puerta B |

Son tres ventanas virtuales del mismo PC; no tres equipos físicos. Se puede reutilizar temporalmente una instancia para registrar al asistente B/aceptar una transferencia, pero antes del doble ingreso deja ambos escáneres preparados y la billetera abierta. Instala Expo Go compatible con SDK 54 o el mismo APK en cada AVD. No dupliques el almacenamiento después de preparar los dispositivos: cada escáner debe registrar su propio UUID.

Si la regla del evaluador exige literalmente **una sola instancia**, no puedes demostrar dos escáneres Android independientes cambiando de cuenta/puerta en ella: la app conserva el rechazo local precisamente para impedirlo. En ese caso presenta el test automatizado de dos dispositivos como evidencia del servidor y declara pendiente la demostración nativa; no borres SQLite para fingir un segundo dispositivo.

Si faltan recursos para tres AVD simultáneos, reduce su resolución/RAM según los recursos reales del PC o consulta el alcance de la restricción. No sustituyas la prueba por una grabación inventada. Prueba el rendimiento antes de iniciar el video definitivo.

## 2. Arranque y configuración

En PowerShell, desde la raíz del proyecto:

```powershell
git branch --show-current
git log -1 --oneline
docker compose up -d --build --wait --wait-timeout 90
docker compose ps -a
Invoke-RestMethod http://127.0.0.1:3000/v1/readiness
```

API, admin y PostgreSQL deben estar saludables; `secrets` e `initialize` terminan con 0. En PowerShell utiliza `Invoke-RestMethod` o `curl.exe`, no `curl -fsS`.

Para demostrar el requisito de clon limpio, usa una carpeta nueva del commit/rama final y volúmenes nuevos. Detén primero la instalación anterior con `docker compose stop` desde su carpeta para liberar los puertos; no elimines sus volúmenes. Desde la nueva carpeta, muestra el clon, `git log -1` y `docker compose up --build`. Una segunda ejecución de `up` debe conservar los datos. La contraseña demo de ese nuevo proyecto puede ser distinta.

El portal usa `http://localhost:8080`. Antes de grabar, obtén la contraseña sin imprimirla en el video:

```powershell
$demo = docker compose exec -T api cat /app/runtime/demo-credentials.json | ConvertFrom-Json
$demo.password | Set-Clipboard
```

Admin: `admin.101@example.test`. Organizador: `organizador.201@example.test`. Los staff de la tabla usan la misma contraseña demo de esa instalación. Las cuentas que registres desde la app usan la contraseña que tú elijas, no necesariamente la demo.

Para Expo, conserva el contenido de `apps/mobile/.env` y configura esta variable:

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/v1
```

Desde la raíz, si aún no tienes dependencias:

```powershell
npm ci --ignore-scripts
npm run build -w @hypernova/contracts
npm run dev:mobile
```

Desde la CLI de Expo usa la selección de dispositivo Android (habitualmente Shift+A) para abrir la misma app en los AVD. También puedes abrir el proyecto en Expo Go en cada uno. Si cambias `.env`, reinicia Expo con caché limpia desde `apps/mobile`: `npx expo start --clear`.

Para listar emuladores si ADB no está en PATH:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```

Si instalaste el SDK en otra ubicación, usa la ruta que indique Android Studio. Activa fecha/hora automáticas en todos los AVD.

### Precaución con Expo Go y el reinicio sin red

Primero verifica el flujo mientras la app ya está cargada. Si al cerrar y abrir sin red Expo Go necesita Metro, ese fallo no prueba pérdida de SQLite, pero tampoco satisface el arranque offline de la entrega. Para ese ensayo conviene un build con bundle incorporado. Con JDK 17 y Android SDK configurados puedes intentar, desde `apps/mobile`:

```powershell
npx expo run:android --variant release
```

No hay un APK previamente validado en esta entrega. Comprueba el build y su comportamiento en tus AVD antes de darlo por aprobado; revisa `git status` después de generar proyectos nativos. Instalar ese APK en los AVD no requiere teléfonos físicos.

## 3. Configura un evento exclusivo para el video

Entra como admin → **Eventos** → **Crear evento**:

- Nombre: `DEMO VIDEO - Control de acceso`.
- Lugar: `Recinto de demostración`.
- Inicio: dentro de dos días, con hora futura.
- Apertura de venta: una hora antes del momento actual.
- Límite de reembolsos: mañana, anterior al inicio del evento.
- Entradas por cuenta: **10**, para disponer de tickets separados por escenario.
- Estado: **En venta**. Organizador: cuenta 201.

Selecciona ese evento y configura:

1. **Zona General**, aforo 100; opcional **Zona VIP**, aforo 20 para rechazo por zona.
2. **Fases de precio** por zona, sin solaparse: Preventa activa ahora, General después y Taquilla después. Un ejemplo de precio activo es `2500` centésimos = **USD 25,00**. No introduzcas `25` esperando USD 25.
3. **Puerta A** y **Puerta B**, ambas habilitadas para General. Opcional Puerta VIP para el caso de zona incorrecta.
4. **Asignar staff**: cuentas 301 y 302 a este evento.
5. En **Vista general**, confirma cero ventas y capacidad disponible del evento nuevo. No reutilices tickets usados de la semilla.

## 4. Asistente: registro, compra y billetera

En el AVD Billetera:

1. **Crear una cuenta** para el asistente A con nombre/correo de demostración y contraseña de al menos 10 caracteres. No muestres la contraseña.
2. Prepara también un asistente B (cuenta registrada o semilla conocida) para recibir una transferencia.
3. A entra en **Eventos** → **Ver zonas y comprar** → **Seleccionar zona**.
4. Introduce cantidad 1 → **Reservar entradas**. Muestra el contador, importe y el incremento de reservas en el portal.
5. Pulsa **Confirmar pago simulado**. Comprueba que la compra terminó y la reserva se convirtió en venta.
6. En **Billetera** → **Ver entrada y código**, abre la entrada con red antes de desconectar. Espera un cambio del contador/QR (ventanas de 25 s).
7. Repite compras para disponer de tickets independientes. Anota el ID y uso de cada uno:

| Ticket | Destino |
|---|---|
| T1 | Ingreso válido, duplicado local y reembolso de usada |
| T2 | Captura de QR antigua, sin admitir primero esa entrada |
| T3 | Transferencia y credencial anterior revocada |
| T4 | Dos puertas offline, sin usos anteriores |
| T5 | Reembolso permitido y recuperación de cupo |
| T6 | Anulación administrativa, si se muestra |

No pruebes todo con el mismo ticket: un resultado «ya usada» no demuestra «código expirado» o «revocada». El historial de compras y el estado de cada entrada están en pantallas distintas.

## 5. Escáner en AVD y cámara virtual

En Puerta A inicia sesión como staff 301 → **Escanear** → evento del video → **Elegir puerta** → **Iniciar turno en esta puerta**. Prepara Puerta B con staff 302 y su puerta B. Hazlo con conexión para guardar claves y revocaciones.

La app ofrece **Activar cámara**, **Sincronizar ahora**, contador de pendientes y **Código QR (verificación manual)**. Ese campo recibe el contenido completo del QR firmado, no el ID del ticket ni una URL. No inventes tokens ni uses la clave privada del emisor.

Para cámara sin teléfono físico, configura la cámara trasera del AVD como **VirtualScene**. En sus controles extendidos busca **Camera / Virtual scene images** y coloca una imagen PNG del QR en la pared/mesa de la escena. La ubicación/nombre del control depende de la versión del emulador; ensaya el encuadre antes del video. Captura únicamente el cuadrado del QR desde la billetera con Recortes de Windows; un screenshot completo puede volverlo demasiado pequeño para leerlo en la escena.

Prepara ambos escáneres y encuadres de antemano. Para un QR válido usa una captura recién tomada y léela antes de que termine su ventana, que admite slot actual/anterior: menos de 50 s. Para el caso expirado conserva la imagen más de 60 s. Repite con una captura nueva si tardaste demasiado en cargarla; no amplíes la ventana criptográfica solo para grabar.

Si capturas con ADB, no redirijas el PNG binario con `>` desde PowerShell antiguo: utiliza `shell screencap -p` a un archivo del dispositivo y luego `adb pull`. La prueba con imagen virtual demuestra la cámara del AVD leyendo un QR, no una cámara física. Una verificación por texto debe presentarse como manual, sin fingir que se usó cámara.

## 6. Casos que debes completar antes de grabar

### A. Compra idempotente, cancelación y expiración

Muestra reserva → contador → pago → una entrada. El bloqueo de doble toque de UI no sustituye la prueba del backend: enseña también el escenario automatizado de idempotencia. Cancela otra reserva y comprueba que vuelve el cupo.

Para expiración puedes usar los 600 s por defecto y acelerar solo la espera. Alternativa: configurar `RESERVATION_TTL_SECONDS=60` en el entorno de demostración y recrear la API antes de empezar; explica que ese es el TTL de la demo y el predeterminado es 600. No cambies el reloj del host ni omitas que modificaste la configuración. Al vencer, comprueba cupo liberado; **Resolver pago tardío** no debe emitir entrada y debe mostrar la devolución simulada.

### B. Entrada válida, usada y persistencia offline

1. Prepara billetera T1 y turno A con red.
2. Activa modo avión en el AVD escáner y apaga también Wi-Fi/datos. Algunos emuladores conservan conectividad virtual: comprueba que **Sincronizar ahora** falle y que los pendientes no desaparezcan.
3. Desconectar Internet del PC no necesariamente corta la conexión local a `10.0.2.2`; no lo uses como única prueba de aislamiento.
4. Lee QR vigente T1: **Entrada válida** y un pendiente local.
5. Espera más de 1,5 s y vuelve a leer T1: **Ya usada en este dispositivo**. Los rechazos también quedan en el historial.
6. Cierra/reabre el cliente según la limitación de bundle explicada arriba. Una lectura nueva de T1 debe continuar rechazada.
7. Reconecta y sincroniza. En el portal observa ingreso, puerta, staff/dispositivo y última sync.
8. Intenta reembolsar T1: el servidor debe rechazarla por usada.

### C. Captura antigua

Captura T2 sin admitirla. Espera 60 s y escanea esa imagen: **Código expirado**, sin admisión. Usa un ticket distinto del ya usado. Muestra claramente la espera o un rótulo de aceleración.

### D. Transferencia y revocación

1. En Billetera A abre T3 y envía transferencia al correo de B; muestra estado pendiente en **Transferir**.
2. En un ensayo aparte cancela una pendiente y comprueba su estado.
3. Para demostrar la versión anterior, deja A con su credencial preparada; después de enviar la transferencia desconecta A y mantén abierta la billetera.
4. B entra con red, va a **Transferir** → **Aceptar entrada** y abre su billetera. Puedes reutilizar temporalmente un AVD, antes de preparar el doble ingreso.
5. El staff sincroniza revocaciones. Escanea un QR recién generado por la billetera antigua A que quedó offline: debe ser **Entrada revocada**. Una captura anterior de más de 60 s podría dar «expirado» y no probar esta regla.
6. Muestra que B recibe una nueva credencial. Al reconectar/actualizar A, la entrada ya no pertenece a su billetera. Un staff que aún no sincronizó puede desconocer la transferencia: explícalo.

### E. Dos puertas offline, caso principal

1. Usa T4 sin ingresos anteriores y con credencial preparada. Turnos A y B ya iniciados con red, mismo evento/zona, distinta puerta y almacenamiento independiente.
2. Deja ambos escáneres sin conexión y comprueba que no sincronizan automáticamente.
3. Carga un QR vigente de T4 en ambas cámaras virtuales; deben registrar localmente **Entrada válida**. Tienen UUID diferentes. Mantén la ventana temporal: si una cámara tarda, genera otra captura vigente de la misma credencial, no reutilices una ya expirada.
4. Antes de reconectar, enseña que ambas instalaciones conservan su intento pendiente.
5. Reconecta A y sincroniza; después B y sincroniza.
6. Portal → **Incidentes**: aparece `double_ingress`. **Accesos** cuenta un ingreso lógico; evidencia conserva ambos intentos/puertas.
7. Pulsa sincronizar otra vez: no aumenta el conteo por reenviar un lote.

La app trata de sincronizar cada 20 s y al volver al primer plano; por eso debes verificar el aislamiento antes de escanear. No borres historial ni reinicies la base para conseguir dos aceptaciones. Explica que se detecta doble ingreso físico offline; no se promete impedirlo globalmente sin comunicación.

### F. Reembolso y operación administrativa

Con T5 sin usar y dentro del plazo, entra en **Entradas**, busca comprador o ID, reembolsa con motivo y muestra que el disponible aumenta en 1. En **Auditoría** verifica autor/motivo. Anular T6 también libera cupo y revoca la entrada; no lo presentes como devolución monetaria: la anulación por sí sola no genera reembolso.

En **Accesos** muestra puerta/hora e ingresos únicos acumulados. En **Dispositivos** muestra última sincronización. No denomines al acumulado ocupación física exacta si no se registran salidas. La detección de picos sospechosos de compra no está implementada: no la anuncies como funcionando.

## 7. Pruebas automatizadas y carga para el video

Con Node 22+, dependencias instaladas, backend saludable y PowerShell en la misma carpeta Compose:

```powershell
npm test
npm run test:integration
npm run test:load
npx --no-install tsx tests/load/explain.ts
```

Cuenta de referencia: 7 tests criptográficos, 5 sesiones web y 18 integración. La carga autentica 200 compradores fuera de la medición y crea un evento QA aislado con 50 disponibles; no consume los 50 originales de la zona 8. Debe terminar con 50 ventas/tickets/cargos, 150 SOLD_OUT y cero errores inesperados/reservas residuales. Un 409 por agotamiento es esperado, no un fallo 500.

```powershell
$r = Get-Content docs/qa/load-results.json -Raw | ConvertFrom-Json
$r.reservation
$r.payment
$r.database
$zoneId = [int]$r.fixture.zoneId
docker compose exec -T postgres psql -U hypernova_owner -d hypernova -c "SELECT id,capacity,sold_count,reserved_count,capacity-sold_count-reserved_count AS available FROM zones WHERE id=$zoneId"
```

Muestra métricas de esa ejecución, no las históricas de la nube como si fueran de tu Windows. Respeta rate limiting si repites muchas ejecuciones seguidas. El test automatizado de dos dispositivos prueba servidor/protocolo; no sustituye el caso E en los AVD.

## 8. Guion sugerido: 11 minutos y 45 segundos

| Tiempo | Qué mostrar | Qué explicar |
|---|---|---|
| 00:00–01:15 | Clon limpio, commit, Compose y health | API, PostgreSQL, portal separado y seed automática; esperas aceleradas señaladas |
| 01:15–02:20 | Evento, zonas, fases, puertas y staff | Aforo por zona, precio en centésimos y propiedad del organizador |
| 02:20–03:40 | Registro, reserva/contador y pago | Precio del servidor, límite por cuenta e idempotencia |
| 03:40–04:30 | Billetera, QR rotativo y captura antigua | Firma emisora más posesión; validez temporal corta |
| 04:30–05:40 | Transferencia pendiente/aceptada y revocación | Nuevo titular, versión anterior rechazada tras sync |
| 05:40–06:40 | Válida, duplicado y reembolso usado rechazado | Registro local persistente y reglas del servidor |
| 06:40–08:30 | Dos AVD offline, reconexión e incidente | Ambos intentos conservados, un ingreso lógico |
| 08:30–09:40 | Carga 200/50, p50/p95 y SQL final | Sin sobreventa ni segundo cobro; rechazos esperados |
| 09:40–10:50 | Reembolso permitido, accesos, dispositivos y auditoría | Cupo recuperado, autor/motivo e historial íntegro |
| 10:50–11:45 | Resumen de tests, README y límites | Qué se ejecutó, pendientes y decisiones; sin inventar evidencias |

Graba primero ensayos sin publicarlos. Si una función falla, guarda el error y corrígela antes de repetir; no edites el fallo para presentarla como aprobada. Si el recorrido queda largo, publica además un clip separado del doble ingreso offline. El clip obligatorio no debe perderse por intentar el bonus de presentación larga.

## 9. Cierre y publicación

- Guarda evidencia legible de dos UUID/intentos y el incidente; no publiques contraseñas, access/refresh tokens ni semillas privadas.
- Guarda el video fuera de Git; súbelo a una plataforma accesible al evaluador y prueba el enlace sin tu sesión. No necesitas subirlo desde esta conversación.
- Añade el enlace en la primera sección del README y conserva coherencia del SHA final mostrado.
- Revisa la [checklist](checklist-entrega.md): especialmente Android nativo, picos de compra, significado de aforo, avisos de dependencias y rama `main`.
- No declares completo lo que no ejecutaste. Si una regla limita la demostración a un único AVD, documenta esa restricción junto a la evidencia automatizada y el pendiente nativo.
