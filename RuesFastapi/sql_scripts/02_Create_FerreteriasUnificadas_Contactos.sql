-- Script para crear tabla de contactos unificada
-- Ejecutar en ferreterias_db

USE [ferreterias_db]
GO

-- Crear tabla FerreteriasUnificadas_Contactos si no existe
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='FerreteriasUnificadas_Contactos')
BEGIN
    CREATE TABLE [dbo].[FerreteriasUnificadas_Contactos](
        [ID] [int] IDENTITY(1,1) NOT NULL,
        [FERRETERIA_UNIFICADA_ID] [int] NOT NULL,
        [FERRETERIA_ARGOS_CONTACTO_ID] [int] NULL,
        [NOMBRE_COMPLETO] [nvarchar](255) NULL,
        [CARGO] [nvarchar](100) NULL,
        [MOVIL] [nvarchar](50) NULL,
        [GENERO] [nvarchar](20) NULL,
        [HABEAS_DATA] [bit] NULL,
        [FECHA_CREACION] [datetime] DEFAULT GETDATE(),

        CONSTRAINT [PK_FU_CONTACTOS] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [FK_FU_CONTACTOS_UNIFICADA] FOREIGN KEY([FERRETERIA_UNIFICADA_ID])
            REFERENCES [dbo].[FerreteriasUnificadas] ([ID]) ON DELETE CASCADE,
        CONSTRAINT [FK_FU_CONTACTOS_ARGOS] FOREIGN KEY([FERRETERIA_ARGOS_CONTACTO_ID])
            REFERENCES [dbo].[FERRETERIASARGOS_CONTACTOS] ([ID])
    ) ON [PRIMARY];

    PRINT '[OK] Tabla FerreteriasUnificadas_Contactos creada';
END
ELSE
BEGIN
    PRINT '[!] Tabla FerreteriasUnificadas_Contactos ya existe';
END

-- Crear indice para búsquedas rápidas
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_FU_CONTACTOS_UNIFICADA_ID' AND object_id=OBJECT_ID('FerreteriasUnificadas_Contactos'))
BEGIN
    CREATE INDEX [IX_FU_CONTACTOS_UNIFICADA_ID] ON [dbo].[FerreteriasUnificadas_Contactos]([FERRETERIA_UNIFICADA_ID]);
    PRINT '[OK] Indice IX_FU_CONTACTOS_UNIFICADA_ID creado';
END

PRINT '[LISTO] Tabla de contactos unificada lista'
GO
