# Cómo abrir y demostrar la instalación actual

## Qué se ejecuta en cada sitio

| Lugar | Qué ejecuta | Cómo reconocerlo |
|---|---|---|
| VM GCP | Docker: API, PostgreSQL y portal construido | Prompt `usuario@hypernova-demo` |
| Windows, terminal del túnel | Reenvía 3000 y 8080 a la VM | Comando SSH con `-N -L`; permanece esperando |
| Windows, terminal de Expo | Metro y bundle para los emuladores | QR grande y `Metro waiting` |
| Emulador Billetera | App del asistente | Eventos, Billetera, Transferir, Historial |
| Otro emulador | App del staff y su SQLite independiente | Control de acceso y Escanear |

Un APK instalado con bundle incluido no necesita Metro. El perfil de APK entregado sí necesita el túnel para llegar al backend desde `10.0.2.2`. Un APK de emulador no es una app pública para teléfonos físicos.

## Abrir desde cero, sin borrar datos

Comprueba en Compute Engine que la VM esté en ejecución. En CMD de **Windows**, abre el túnel, sustituyendo los nombres por los de tu proyecto:

```cmd
gcloud compute ssh hypernova-demo --zone TU_ZONA --project TU_ID_DE_PROYECTO -- -N -L 3000:127.0.0.1:3000 -L 8080:127.0.0.1:8080
```

Deja esa ventana abierta. Si ya hay un túnel, no abras otro sobre los mismos puertos. Docker local debe estar detenido para no ocuparlos. En Chrome comprueba `http://localhost:3000/v1/readiness` y abre `http://localhost:8080`.

Para consultar el servidor por comandos, abre **otra** CMD:

```cmd
gcloud compute ssh hypernova-demo --zone TU_ZONA --project TU_ID_DE_PROYECTO
```

Solo cuando aparezca el prompt Linux, puedes ejecutar:

```bash
sudo docker ps
curl -fsS http://127.0.0.1:3000/v1/readiness
```

La contraseña de la demo se consulta **en privado** en esa terminal:

```bash
sudo docker exec hypernovalabs_pruebatecnica-api-1 cat /app/runtime/demo-credentials.json
```

Usa el campo `password` sin comillas. No lo copies al README, video o chat. Admin del portal: `admin.101@example.test`; asistente en Android: `asistente.1@example.test`; staff: `staff.301@example.test` / `staff.302@example.test`. Una cuenta registrada manualmente usa su propia contraseña. Local y GCP tienen credenciales y datos independientes.

En otra CMD de **Windows**, entra en tu clon local. Por ejemplo:

```cmd
cd C:\Users\fedgo\Documents\Github\Hypernovalabs\hypernovalabs_pruebatecnica
npm run dev:mobile -- --clear
```

La variable de `apps/mobile/.env` debe ser `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/v1`. Enciende los emuladores en Android Studio → Device Manager y usa Shift+A en Expo para seleccionar cada uno. El contador renovado empieza cerca de 25 s; ver 15 s durante la cuenta regresiva es normal. Si Metro conserva una versión anterior, recarga ambos clientes. Actualiza también la API de GCP antes de probar códigos con una nueva duración.

## Ensayo breve

1. Portal: crear evento futuro, venta abierta, reembolso vigente, límite por cuenta, zona con capacidad y fase vigente con precio entero. `2500` significa USD 25,00; `25` significa USD 0,25.
2. Crear dos puertas y asignar staff. Asistente: reservar una entrada, mostrar contador, pagar y abrir QR.
3. Staff en otro emulador: seleccionar el mismo evento/zona, iniciar turno con red y sincronizar claves/revocaciones.
4. Configurar una imagen del QR en la cámara virtual. Encuadrar primero con una captura de ensayo y sustituir después por una nueva antes de que caduque. El QR anterior no se hace válido por dejarlo quieto.
5. Para offline, mantener la app cargada, activar modo avión y apagar también Wi-Fi en el escáner. Confirmar que la sincronización no puede completarse. Después probar con un ticket nuevo: el ingreso válido anterior no demuestra una primera admisión offline.
6. Para dos puertas, usar dos instalaciones independientes con turnos sincronizados previamente y una entrada no usada. Desconectar ambas, escanear, reconectar y comprobar el incidente. No borrar SQLite ni cambiar de cuenta para simular otro dispositivo.

La [guía extensa de grabación](guia-video.md) contiene los casos de transferencia, expiración y reembolso. Usar tickets separados por escenario. Antes de compartir una captura, ocultar credenciales, semillas, tokens y datos personales del escritorio.

## Repetir la carga en la VM

Este comando es **para la terminal Linux de GCP**, nunca para PowerShell. Localiza primero la carpeta Compose:

```bash
sudo docker inspect hypernovalabs_pruebatecnica-api-1 --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
```

Entra en la ruta devuelta y verifica que `ls package.json` funciona. Desde esa raíz:

```bash
sudo docker run --rm --network host -e COMPOSE_PROJECT_NAME=hypernovalabs_pruebatecnica -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD":/work -w /work node:22-alpine sh -ec 'apk add --no-cache docker-cli docker-cli-compose && npm ci --workspace=@hypernova/contracts --include-workspace-root --ignore-scripts && npm run build --workspace=@hypernova/contracts && npm run test:load'
```

Requiere una VM Linux con Docker, acceso a los registros de imágenes/paquetes y el nombre de proyecto Compose indicado. El contenedor usa el socket Docker para verificar PostgreSQL y leer credenciales sin imprimirlas; ejecutar únicamente con este código de confianza. Instala dependencias y escribe el informe en el clon. No sustituye una prueba distribuida desde 200 máquinas: son 200 compradores lógicos concurrentes por HTTP.

```bash
sudo cat docs/qa/load-results.json
```

Esperado: `passed: true`, 50 ventas, 150 agotados y cero errores inesperados. Conservar el JSON original y metadatos de la ejecución para adjuntarlos a la entrega, sin mezclar métricas de instalaciones distintas.

## Cierre de sesión de trabajo

Ctrl+C en Expo detiene Metro; Ctrl+C en el túnel cierra la conexión. Ninguno detiene la VM. Detener la VM desde Compute Engine reduce el consumo de cómputo, pero el disco y otros recursos conservados pueden seguir generando cargos. No ejecutar `down -v` ni borrar el disco para cerrar una sesión: elimina datos y claves.
