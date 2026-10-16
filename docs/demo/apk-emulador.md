# APK para el emulador Android con el servidor en GCP

El perfil `emulator` de EAS Build genera un APK instalable, con JavaScript incluido: no necesita Expo Go ni Metro al abrirse. El backend continúa siendo necesario para login, compra y sincronización. Este APK apunta a `http://10.0.2.2:3000/v1` y requiere el túnel SSH en Windows; no sirve para conectar un teléfono físico a GCP.

## Cuenta y preparación en Windows

Crea una cuenta en <https://expo.dev/signup> y verifica tu correo. No compartas tu contraseña ni tokens. EAS puede ofrecer una cuota gratuita o requerir pago según tu cuenta y disponibilidad; revisa las condiciones antes de aceptar un cargo.

En PowerShell de **Windows**, ejecuta:

```powershell
cd C:\Users\fedgo\Documents\Github\Hypernovalabs\hypernovalabs_pruebatecnica
git switch main
git pull --ff-only origin main
npm ci --ignore-scripts
cd apps\mobile
npx eas-cli@25.0.0 login
npx eas-cli@25.0.0 init
```

Si tienes cambios locales, consérvalos antes de cambiar de rama; no uses reset para descartarlos. En `init`, selecciona tu cuenta y crea/vincula el proyecto `hypernova-ticketing`. EAS registrará el identificador del proyecto en `app.json`; no copies un ID ajeno. El ID de proyecto no es una contraseña.

## Compilar

Desde `apps/mobile`:

```powershell
npx eas-cli@25.0.0 build --platform android --profile emulator
```

Si pregunta por crear un Android keystore, permite que EAS genere uno nuevo para esta app. No publiques ni compartas el keystore o sus contraseñas. Mantén la misma clave para futuras actualizaciones del APK.

EAS subirá el monorepo, instalará dependencias, construirá el paquete compartido de contratos mediante `eas-build-post-install` y compilará Android. El perfil fija la URL de la API durante la compilación; cambiar `.env` después no modifica un APK ya creado. El plugin habilita HTTP únicamente cuando está presente `ALLOW_EMULATOR_HTTP=1`; este perfil es para la demo mediante túnel, no para un backend público sin TLS.

Espera a que el trabajo termine con éxito. Abre el enlace de EAS y descarga el archivo `.apk` en Windows. No es un archivo `.aab`. Si falla, conserva el enlace y el error de la etapa fallida, sin incluir secretos. Esta configuración no equivale a un APK compilado: la compilación requiere tu sesión de Expo y debe comprobarse allí.

## Instalar y usar

Arrastra el `.apk` descargado sobre el emulador Android encendido. También puedes usar PowerShell:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s emulator-5554 install -r "$env:USERPROFILE\Downloads\hypernova.apk"
```

Cambia `emulator-5554` por el identificador real listado y el nombre del archivo por el que descargaste. Instálalo en cada emulador que necesites; cada uno conserva su propio almacenamiento. Una instalación `-r` conserva datos, pero una desinstalación los elimina, incluidos escaneos pendientes: sincroniza primero.

Antes de abrir la app, confirma que Docker local está detenido y abre el túnel **desde Windows**:

```powershell
gcloud compute ssh hypernova-demo --zone us-central1-a --project gen-lang-client-0957837064 -- -N -L 3000:127.0.0.1:3000 -L 8080:127.0.0.1:8080
```

Si ya tienes ese túnel abierto, no abras otro. Comprueba <http://localhost:3000/v1/readiness> en Windows. Abre **Hypernova Ticketing** en Android, concede acceso a la cámara para escanear y usa las credenciales de la instalación de GCP. Ya puedes detener Metro/Expo si estaba ejecutándose.

En una instalación nueva hay que iniciar sesión, cargar la billetera o iniciar turno y sincronizar antes de desconectar la red. Comprueba los flujos reales en Android antes de considerar el APK validado. Para una app que funcione fuera del emulador y sin túnel se necesita un backend accesible por HTTPS y otro perfil con esa URL.
