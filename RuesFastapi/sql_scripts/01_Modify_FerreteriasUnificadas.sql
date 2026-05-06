-- Script para modificar FerreteriasUnificadas e incluir soporte para ARGOS
-- Ejecutar en ferreterias_db

USE [ferreterias_db]
GO

-- 1. Agregar columnas para ARGOS si no existen
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='FerreteriasUnificadas' AND COLUMN_NAME='ID_ARGOS')
BEGIN
    ALTER TABLE [dbo].[FerreteriasUnificadas]
    ADD [ID_ARGOS] [int] NULL;
    PRINT '[OK] Columna ID_ARGOS agregada'
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='FerreteriasUnificadas' AND COLUMN_NAME='CODIGO_CLIENTE_ARGOS')
BEGIN
    ALTER TABLE [dbo].[FerreteriasUnificadas]
    ADD [CODIGO_CLIENTE_ARGOS] [nvarchar](50) NULL;
    PRINT '[OK] Columna CODIGO_CLIENTE_ARGOS agregada'
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='FerreteriasUnificadas' AND COLUMN_NAME='CANAL')
BEGIN
    ALTER TABLE [dbo].[FerreteriasUnificadas]
    ADD [CANAL] [nvarchar](50) NULL;
    PRINT '[OK] Columna CANAL agregada'
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='FerreteriasUnificadas' AND COLUMN_NAME='NOMBRE_CUENTA')
BEGIN
    ALTER TABLE [dbo].[FerreteriasUnificadas]
    ADD [NOMBRE_CUENTA] [nvarchar](255) NULL;
    PRINT '[OK] Columna NOMBRE_CUENTA agregada'
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='FerreteriasUnificadas' AND COLUMN_NAME='NOMBRE_OBRA')
BEGIN
    ALTER TABLE [dbo].[FerreteriasUnificadas]
    ADD [NOMBRE_OBRA] [nvarchar](255) NULL;
    PRINT '[OK] Columna NOMBRE_OBRA agregada'
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='FerreteriasUnificadas' AND COLUMN_NAME='ES_PUNTO_VENTA_PUBLICO')
BEGIN
    ALTER TABLE [dbo].[FerreteriasUnificadas]
    ADD [ES_PUNTO_VENTA_PUBLICO] [bit] NULL DEFAULT (0);
    PRINT '[OK] Columna ES_PUNTO_VENTA_PUBLICO agregada'
END

-- 2. Agregar Foreign Key a FERRETERIASARGOS si no existe
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_NAME='FerreteriasUnificadas' AND CONSTRAINT_NAME='FK_FU_ARGOS')
BEGIN
    ALTER TABLE [dbo].[FerreteriasUnificadas]
    ADD CONSTRAINT [FK_FU_ARGOS] FOREIGN KEY([ID_ARGOS])
    REFERENCES [dbo].[FERRETERIASARGOS] ([ID]);
    PRINT '[OK] Foreign Key FK_FU_ARGOS agregado'
END

PRINT '[LISTO] FerreteriasUnificadas modificada para soportar ARGOS'
GO
