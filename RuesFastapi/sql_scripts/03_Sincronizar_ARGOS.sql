-- Script para sincronizar FERRETERIASARGOS hacia FerreteriasUnificadas
-- Ejecutar en ferreterias_db

USE [ferreterias_db]
GO

PRINT '[*] Iniciando sincronizacion de FERRETERIASARGOS...'

-- 1. Insertar nuevas ferreterias de ARGOS que NO existan en Unificadas
INSERT INTO [dbo].[FerreteriasUnificadas](
    [NOMBRE], [TELEFONO], [WHATSAPP], [NIT],
    [LAT], [LNG], [DEPARTAMENTO], [MUNICIPIO], [DIRECCION_COMERCIAL],
    [VENDE_CEMENTO], [VENDE_TUBOS], [VENDE_VARILLAS], [VENDE_LADRILLOS], [VENDE_AGREGADOS],
    [SCORE], [MATERIALES_OBSERVADOS], [NIVEL_CONFIANZA], [ULTIMO_ANALISIS],
    [ID_ARGOS], [CODIGO_CLIENTE_ARGOS], [CANAL], [NOMBRE_CUENTA], [NOMBRE_OBRA],
    [ES_PUNTO_VENTA_PUBLICO], [FUENTE],
    [FECHA_CREACION], [FECHA_ACTUALIZACION]
)
SELECT
    fa.[NOMBRE], fa.[TELEFONO], fa.[WHATSAPP], fa.[NIT],
    fa.[LAT], fa.[LNG], fa.[DEPARTAMENTO], fa.[MUNICIPIO], fa.[DIRECCION],
    fa.[VENDE_CEMENTO], fa.[VENDE_TUBOS], fa.[VENDE_VARILLAS], fa.[VENDE_LADRILLOS], fa.[VENDE_AGREGADOS],
    fa.[SCORE], fa.[MATERIALES_OBSERVADOS], fa.[NIVEL_CONFIANZA], fa.[ULTIMO_ANALISIS],
    fa.[ID], fa.[CODIGO_CLIENTE], fa.[CANAL], fa.[NOMBRE_CUENTA], fa.[NOMBRE_OBRA],
    fa.[ES_PUNTO_VENTA_PUBLICO], 'ARGOS',
    fa.[FECHA_CREACION], fa.[FECHA_ACTUALIZACION]
FROM [dbo].[FERRETERIASARGOS] fa
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[FerreteriasUnificadas] fu
    WHERE fu.[ID_ARGOS] = fa.[ID]
)
AND fa.[CODIGO_CLIENTE] IS NOT NULL;

DECLARE @InsertCount INT = @@ROWCOUNT;
PRINT '[OK] Se insertaron ' + CAST(@InsertCount AS VARCHAR(10)) + ' registros de ARGOS';

-- 2. Actualizar ferreterias de ARGOS existentes con cambios
UPDATE fu
SET
    fu.[NOMBRE] = fa.[NOMBRE],
    fu.[TELEFONO] = ISNULL(fu.[TELEFONO], fa.[TELEFONO]),
    fu.[WHATSAPP] = ISNULL(fu.[WHATSAPP], fa.[WHATSAPP]),
    fu.[NIT] = ISNULL(fu.[NIT], fa.[NIT]),
    fu.[LAT] = ISNULL(fu.[LAT], fa.[LAT]),
    fu.[LNG] = ISNULL(fu.[LNG], fa.[LNG]),
    fu.[DEPARTAMENTO] = ISNULL(fu.[DEPARTAMENTO], fa.[DEPARTAMENTO]),
    fu.[MUNICIPIO] = ISNULL(fu.[MUNICIPIO], fa.[MUNICIPIO]),
    fu.[VENDE_CEMENTO] = ISNULL(fu.[VENDE_CEMENTO], fa.[VENDE_CEMENTO]),
    fu.[VENDE_TUBOS] = ISNULL(fu.[VENDE_TUBOS], fa.[VENDE_TUBOS]),
    fu.[VENDE_VARILLAS] = ISNULL(fu.[VENDE_VARILLAS], fa.[VENDE_VARILLAS]),
    fu.[VENDE_LADRILLOS] = ISNULL(fu.[VENDE_LADRILLOS], fa.[VENDE_LADRILLOS]),
    fu.[VENDE_AGREGADOS] = ISNULL(fu.[VENDE_AGREGADOS], fa.[VENDE_AGREGADOS]),
    fu.[CANAL] = fa.[CANAL],
    fu.[NOMBRE_CUENTA] = fa.[NOMBRE_CUENTA],
    fu.[NOMBRE_OBRA] = fa.[NOMBRE_OBRA],
    fu.[ES_PUNTO_VENTA_PUBLICO] = fa.[ES_PUNTO_VENTA_PUBLICO],
    fu.[FECHA_ACTUALIZACION] = GETDATE()
FROM [dbo].[FerreteriasUnificadas] fu
INNER JOIN [dbo].[FERRETERIASARGOS] fa ON fu.[ID_ARGOS] = fa.[ID]
WHERE fu.[FUENTE] = 'ARGOS';

DECLARE @UpdateCount INT = @@ROWCOUNT;
PRINT '[OK] Se actualizaron ' + CAST(@UpdateCount AS VARCHAR(10)) + ' registros existentes';

-- 3. Sincronizar contactos de ARGOS
INSERT INTO [dbo].[FerreteriasUnificadas_Contactos](
    [FERRETERIA_UNIFICADA_ID],
    [FERRETERIA_ARGOS_CONTACTO_ID],
    [NOMBRE_COMPLETO],
    [CARGO],
    [MOVIL],
    [GENERO],
    [HABEAS_DATA]
)
SELECT
    fu.[ID],
    fac.[ID],
    fac.[NOMBRE_COMPLETO],
    fac.[CARGO],
    fac.[MOVIL],
    fac.[GENERO],
    fac.[HABEAS_DATA]
FROM [dbo].[FERRETERIASARGOS_CONTACTOS] fac
INNER JOIN [dbo].[FERRETERIASARGOS] fa ON fac.[FERRETERIA_ID] = fa.[ID]
INNER JOIN [dbo].[FerreteriasUnificadas] fu ON fu.[ID_ARGOS] = fa.[ID]
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[FerreteriasUnificadas_Contactos] fuc
    WHERE fuc.[FERRETERIA_ARGOS_CONTACTO_ID] = fac.[ID]
);

DECLARE @ContactCount INT = @@ROWCOUNT;
PRINT '[OK] Se sincronizaron ' + CAST(@ContactCount AS VARCHAR(10)) + ' contactos de ARGOS';

PRINT '[LISTO] Sincronizacion de FERRETERIASARGOS completada'
GO
