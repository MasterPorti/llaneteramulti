# Migración del destino publicado

Los ejecutores de esta carpeta no arrancan ni despliegan aplicaciones. `published-merge-rehearsal.mjs` sigue limitado a bases temporales; `published-merge-production.mjs` es un ejecutor separado. No utilizar un ensayo como permiso para ejecutar producción.

## Usuario existente

Guardar bajo `.migration-backups` la identidad exacta del destino obtenida con `identity(client, connection)` de `published-production-support.mjs`. Incluye host, puerto, base, OID, propietario, usuario de sesión, dirección y puerto del servidor, e identificador del clúster. La base de destino debe ser `postgres` y la conexión administrativa debe pertenecer a su propietario.

Por decisión explícita del usuario, la app conserva `admmin`, el propietario existente. El ejecutor no crea roles ni cambia su contraseña, membresías, atributos o permisos. Los ejecutores antiguos de creación y ensayo de un rol limitado no forman parte de este procedimiento.

La versión nueva envía `application_name=llm:<primeros 48 caracteres hex del SHA256 del artefacto>`, configurado mediante `LLANTERA_APPLICATION_ID`. La marca mide 52 bytes y se valida exactamente. Es una barrera para impedir escrituras accidentales de la app vieja. El propietario conserva sus facultades administrativas y podría cambiar deliberadamente la marca, el gate o sus triggers. Por eso se exige detener la app anterior y verificar realmente el artefacto y entorno desplegados antes de activar.

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
  "appRole": "admmin",
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

El destino termina con escrituras bloqueadas, incluida la app nueva. Tras activar, el gate exige el usuario `admmin` y la marca exacta de la versión aprobada. Las conexiones de la app antigua carecen de esa marca. El origen no recibe DML ni cambios de esquema y debe permanecer fuera de operación.

No hay reintento automático. Si COMMIT queda incierto, `status` comprueba el bloqueo del intento anterior: si sigue ocupado informa que el resultado continúa pendiente; si está libre consulta el marcador durable. Un lote existente se rechaza. Si no se confirmó, un reintento exige paquete nuevo: una secuencia SQL puede haber avanzado aunque sus filas se hayan revertido.

## Activación tras desplegar

Configurar la app nueva con la conexión privada existente de `admmin` y `LLANTERA_APPLICATION_ID` igual a `plan.applicationName`. Comprobar por lectura que el artefacto desplegado coincide con el SHA256 del plan, que el entorno real incluye la marca, que la app consulta esa base y que las pantallas y descargas funcionan. Guardar evidencia privada con `reviewed`, `oldWritersStopped`, `newApplicationReadOnlyChecksPassed`, `deployedArtifactVerified` y `deployedEnvironmentVerified` verdaderos, `checkedAt`, `batchId`, `planSha256`, `applicationSha256`, `applicationName`, `appRole` y `databaseIdentity` exactos.

```powershell
node scripts/migration/published-merge-production.mjs activate --plan <planFile> --approved-plan-sha256 <SHA256 revisado> --deployment-proof <evidencia privada> --app-env <app.env privado>
```

La activación verifica una conexión real con el mismo usuario y marca exactos. `status` comprueba el estado después de un resultado incierto. No crear ventas sintéticas en producción para validar el despliegue.

## Evidencia de ensayo

El clon autorizado fue `llantera_restore_7f81aa2aef5adff8e4ec6da1`, OID `16831`. Se verificaron mapeos, originales, IVA, existencias, folios y garantías; backend con transacciones y concurrencia. El primer ensayo con un login temporal limitado terminó y ese login fue eliminado.

La variante definitiva se comprobó después con `admmin` en todas las sesiones: marca correcta, marca incorrecta y conexión sin marca. La app anterior quedó bloqueada; la marcada conservó cálculos, venta de última unidad y cancelación concurrente. También se verificó que el propietario puede cambiar deliberadamente la marca. Los dos guards permanentes de TRUNCATE rechazaron el vaciado del historial incluso con marca válida. Los registros sintéticos se retiraron por sus IDs y todos los hashes originales se conservaron. Solo el gate temporal se retiró al cerrar el ensayo; el usuario existente quedó intacto. Las secuencias del clon conservan los avances de las pruebas.
