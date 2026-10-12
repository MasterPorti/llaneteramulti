# Migración del destino publicado

Los ejecutores de esta carpeta no arrancan ni despliegan aplicaciones. `published-merge-rehearsal.mjs` sigue limitado a bases temporales; `published-merge-production.mjs` es un ejecutor separado. No utilizar un ensayo como permiso para ejecutar producción.

## Preparación del rol

Guardar bajo `.migration-backups` la identidad exacta del destino obtenida con `identity(client, connection)` de `published-production-support.mjs`. Incluye host, puerto, base, OID, propietario, usuario de sesión, dirección y puerto del servidor, e identificador del clúster. La base de destino debe ser `postgres` y la conexión administrativa debe pertenecer a su propietario.

```powershell
node scripts/migration/published-create-app-role.mjs --env .env.auditoria-publicada.local --expected-identity .migration-backups/cutover/destination-identity.json --out .migration-backups/published-app-login
```

Este comando crea únicamente `llaneteramulti_published_app`, con secreto aleatorio, sin superusuario, creación de bases/roles, replicación, bypass de RLS o membresías. Rechaza un rol preexistente y nunca cambia su contraseña. Guarda la URL en `app.env`, sin imprimirla. No concede permisos sobre objetos: `apply` los concede después. Los permisos existentes de `PUBLIC` en el servidor no se modifican.

Si el resultado de COMMIT es incierto, revisar el registro privado y comprobar la existencia del rol antes de cualquier acción; la contraseña generada ya está guardada. No ejecutar otra creación a ciegas.

## Paquete fresco

Detener y comprobar los escritores del destino y de `llaneteramulti_new_tires`. Crear respaldos nativos de ambas bases y verificar su restauración. El plan exige respaldos de menos de una hora, archivos íntegros y comparación en vivo de filas, secuencias, esquema, propietarios, ACL y demás metadatos. Los folios y garantías no se reinician.

Guardar un JSON privado con estos campos para `prepare`:

```json
{
  "sourceEnvFile": "<env administrativo del origen New Tires>",
  "destinationEnvFile": "C:/dev/llaneteramulti/.env.auditoria-publicada.local",
  "sourceBackupDirectory": "<respaldo fresco New Tires con restauración verificada>",
  "destinationBackupDirectory": "<respaldo fresco publicado con restauración verificada>",
  "supplementalManifestFile": "C:/dev/llaneteramulti/.migration-backups/puntodeventa-running-source/supplement-manifest.json",
  "applicationArtifactFile": "<artefacto de aplicación revisado y listo para desplegar>",
  "appRole": "llaneteramulti_published_app",
  "cutoverEvidenceFile": "<evidencia privada de escritores detenidos>"
}
```

La evidencia debe tener `reviewed`, `sourceWritersStopped` y `destinationWritersStopped` verdaderos, `checkedAt` reciente, y `source`/`destination` con sus identidades exactas. Estos campos deben describir verificaciones reales del despliegue. El ejecutor, además, rechaza otras conexiones de clientes al preparar y aplicar.

```powershell
node scripts/migration/published-merge-production.mjs prepare --request .migration-backups/cutover/request.json
```

`prepare` usa conexiones de solo lectura. Entrega `planFile` y su SHA256. Revisar ese plan y conservar los archivos: sus hashes fijan datos, esquema, configuración de ocho bodegas, suplementos, artefacto y código del ejecutor. Si cambia cualquier entrada, generar otro paquete.

## Aplicación y estado

```powershell
node scripts/migration/published-merge-production.mjs apply --plan <planFile> --approved-plan-sha256 <SHA256 revisado>
node scripts/migration/published-merge-production.mjs status --plan <planFile> --approved-plan-sha256 <SHA256 revisado>
```

`apply` verifica ambas identidades, bloquea todas las tablas existentes, coteja nuevamente los respaldos y aplica una sola transacción en destino. Conserva las dos ventas publicadas, sus IVA originales y el resto de sus registros. Añade New Tires con sus cálculos ya autorizados. Archiva literalmente snapshots, metadatos, pre-IVA, contexto y los JSON suplementarios. Los JSON de prueba quedan solo en archivo, sin mezclarse con catálogo ni ventas operativas.

El destino termina con escrituras bloqueadas. La app antigua queda bloqueada incluso después de la activación porque solo se admite el usuario de sesión del nuevo rol. El origen no recibe DML ni cambios de esquema y debe permanecer fuera de operación.

No hay reintento automático. Si COMMIT queda incierto, `status` comprueba el bloqueo del intento anterior: si sigue ocupado informa que el resultado continúa pendiente; si está libre consulta el marcador durable. Un lote existente se rechaza. Si no se confirmó, un reintento exige paquete nuevo: una secuencia SQL puede haber avanzado aunque sus filas se hayan revertido.

## Activación tras desplegar

Configurar la app nueva con el `app.env` privado del rol restringido. Comprobar por lectura que el artefacto desplegado coincide con el SHA256 del plan, que la app consulta esa base y que las pantallas y descargas funcionan. Guardar evidencia privada con `reviewed`, `oldWritersStopped` y `newApplicationReadOnlyChecksPassed` verdaderos, `checkedAt`, `batchId`, `planSha256`, `applicationSha256`, `appRole` y `databaseIdentity` exactos.

```powershell
node scripts/migration/published-merge-production.mjs activate --plan <planFile> --approved-plan-sha256 <SHA256 revisado> --deployment-proof <evidencia privada> --app-env <app.env privado>
```

La activación verifica una conexión real del rol restringido y habilita únicamente ese usuario. `status` comprueba el estado después de un resultado incierto. No crear ventas sintéticas en producción para validar el despliegue.

## Evidencia de ensayo

El clon autorizado fue `llantera_restore_7f81aa2aef5adff8e4ec6da1`, OID `16831`. Se verificaron mapeos, originales, IVA, existencias, folios y garantías; backend con transacciones y concurrencia; y login limitado con los ocho bloqueos de escritura. Los registros sintéticos se retiraron por sus IDs, conservando hashes de originales. El rol temporal y su gate se eliminaron al terminar. Las secuencias del clon conservan los avances del ensayo.
